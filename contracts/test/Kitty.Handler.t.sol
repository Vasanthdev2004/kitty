// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Kitty} from "../Kitty.sol";
import {KittyMockUSDC} from "./Kitty.Base.t.sol";

/// Drives Kitty across several pots (both modes), several actors, time warps and stray transfers.
contract KittyHandler is Test {
    Kitty public kitty;
    KittyMockUSDC public usdc;

    address[] public actors;
    address[] public recipients;
    bytes32[] public pots;

    // ghosts
    uint256 public totalStray;
    uint256 public ghostIn;
    uint256 public ghostOutSettle;
    uint256 public ghostOutRefund;
    mapping(bytes32 => mapping(address => uint256)) public refundReceived;

    // coverage counters
    uint256 public fundOk;
    uint256 public settleOk;
    uint256 public refundOk;
    uint256 public strayCount;
    uint256 public valveRefundOk;     // refunds of fully funded, unsettled pots (valve)
    uint256 public windowRejects;     // settle correctly rejected with SettleWindowClosed
    uint256 public valveWarps;

    // property violations observed by the handler (must stay 0)
    uint256 public unexpectedSettle;  // settle succeeded when it must not (after window / not full / settled)
    uint256 public missedSettle;      // settle failed when it must succeed (full, unsettled, inside window)
    uint256 public unexpectedRefund;  // refund succeeded when it must not
    uint256 public missedRefund;      // refund failed when it must succeed
    mapping(bytes32 => uint256) public refundCount;

    constructor(Kitty k, KittyMockUSDC u) {
        kitty = k;
        usdc = u;

        for (uint256 i = 0; i < 6; i++) {
            address a = address(uint160(0xB000 + i));
            actors.push(a);
            usdc.mint(a, 1e12);
            vm.prank(a);
            usdc.approve(address(k), type(uint256).max);
        }
        for (uint256 i = 0; i < 3; i++) recipients.push(address(uint160(0xA000 + i)));
        usdc.mint(address(this), 1e15);

        // Pot 0: split 50/30/20 among actors 0..2, closes in 2 days
        {
            address[] memory cs = new address[](3);
            uint256[] memory ss = new uint256[](3);
            cs[0] = actors[0]; ss[0] = 50e6;
            cs[1] = actors[1]; ss[1] = 30e6;
            cs[2] = actors[2]; ss[2] = 20e6;
            pots.push(k.createSplitPot(bytes32(uint256(1)), recipients[0], 100e6, uint64(block.timestamp + 2 days), "p0", cs, ss));
        }
        // Pot 1: split 10/10/20/20 among actors 2..5, closes in 4 days
        {
            address[] memory cs = new address[](4);
            uint256[] memory ss = new uint256[](4);
            cs[0] = actors[2]; ss[0] = 10e6;
            cs[1] = actors[3]; ss[1] = 10e6;
            cs[2] = actors[4]; ss[2] = 20e6;
            cs[3] = actors[5]; ss[3] = 20e6;
            pots.push(k.createSplitPot(bytes32(uint256(2)), recipients[1], 60e6, uint64(block.timestamp + 4 days), "p1", cs, ss));
        }
        // Pot 2: open, min 10e6, closes in 6 days
        pots.push(k.createOpenPot(bytes32(uint256(3)), recipients[2], 100e6, uint64(block.timestamp + 6 days), "p2", 10e6));
        // Pot 3: open payment request (recipient == creator == this handler), closes in 8 days
        pots.push(k.createOpenPot(bytes32(uint256(4)), address(this), 50e6, uint64(block.timestamp + 8 days), "p3", 0));
    }

    function potCount() external view returns (uint256) { return pots.length; }
    function recipientCount() external view returns (uint256) { return recipients.length; }
    function actorCount() external view returns (uint256) { return actors.length; }

    // ── actions ───────────────────────────────────────────────────────────────

    function fund(uint256 potSeed, uint256 actorSeed, uint256 amtSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        address a = actors[actorSeed % actors.length];
        (, , uint256 goal, uint64 dl,, Kitty.Mode mode,, uint256 tf,,) = kitty.getPot(id);
        if (block.timestamp >= dl) return;
        uint256 remaining = goal - tf;
        if (remaining == 0) return;

        uint256 maxAmt = remaining;
        if (mode == Kitty.Mode.Split) {
            (uint256 sh, uint256 c,) = kitty.getContribution(id, a);
            if (sh == 0 || sh == c) return;
            if (sh - c < maxAmt) maxAmt = sh - c;
        }
        uint256 amt = amtSeed % 3 == 0 ? maxAmt : bound(amtSeed, 1, maxAmt);
        if (mode == Kitty.Mode.Open) {
            (, uint256 prior,) = kitty.getContribution(id, a);
            uint256 eff = kitty.effectiveMinContribution(id);
            // first-time funders must reach the floor unless completing; repeat funders may add anything
            if (prior == 0 && amt < eff && amt != remaining) amt = eff <= remaining ? eff : remaining;
        }

        vm.prank(a);
        try kitty.fund(id, amt) {
            ghostIn += amt;
            fundOk++;
        } catch {}
    }

    function settle(uint256 potSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        (, , uint256 goal, uint64 dl,,, bool settled_, uint256 tf,,) = kitty.getPot(id);
        bool full = !settled_ && tf == goal;
        bool inWindow = block.timestamp < uint256(dl) + kitty.SETTLE_GRACE();
        try kitty.settle(id) {
            ghostOutSettle += goal;
            settleOk++;
            if (!(full && inWindow)) unexpectedSettle++;
        } catch (bytes memory d) {
            if (full && inWindow) missedSettle++;
            if (full && !inWindow) {
                if (bytes4(d) == Kitty.SettleWindowClosed.selector) windowRejects++;
                else missedSettle++;
            }
        }
    }

    function refund(uint256 potSeed, uint256 actorSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        address a = actors[actorSeed % actors.length];
        (, , uint256 goal, uint64 dl,,, bool settled_, uint256 tf,,) = kitty.getPot(id);
        (, uint256 contrib, bool already) = kitty.getContribution(id, a);
        bool full = tf == goal;
        bool shouldWork = !settled_ && block.timestamp >= dl && !already && contrib > 0
            && !(full && block.timestamp < uint256(dl) + kitty.SETTLE_GRACE());

        uint256 before_ = usdc.balanceOf(a);
        vm.prank(a);
        try kitty.refund(id) {
            uint256 got = usdc.balanceOf(a) - before_;
            refundReceived[id][a] += got;
            ghostOutRefund += got;
            refundOk++;
            refundCount[id]++;
            if (full) valveRefundOk++;
            if (!shouldWork) unexpectedRefund++;
        } catch {
            if (shouldWork) missedRefund++;
        }
    }

    function createOpen(uint256 saltSeed, uint256 goalSeed, uint256 minSeed, uint256 dlSeed) external {
        if (pots.length >= 8) return;
        uint256 goal = bound(goalSeed, 1e6, 200e6);
        uint256 minC = bound(minSeed, 0, goal);
        uint64 dl = uint64(block.timestamp + bound(dlSeed, 1 hours, 10 days));
        address rec = recipients[saltSeed % recipients.length];
        bytes32 salt = keccak256(abi.encode("dyn", saltSeed));
        try kitty.createOpenPot(salt, rec, goal, dl, "dyn", minC) returns (bytes32 id) {
            pots.push(id);
        } catch {}
    }

    function stray(uint256 amtSeed) external {
        uint256 amt = bound(amtSeed, 1, 500e6);
        usdc.transfer(address(kitty), amt);
        totalStray += amt;
        strayCount++;
    }

    function warp(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 1, 4 hours));
    }

    /// Jump (forward only) to just before / exactly at / after deadline + SETTLE_GRACE of a pot.
    function warpToValve(uint256 potSeed, uint256 mode) external {
        if (mode % 5 != 0) return; // keep valve warps rare so funding still gets explored
        bytes32 id = pots[potSeed % pots.length];
        (, , , uint64 dl,,,,,,) = kitty.getPot(id);
        uint256 valve = uint256(dl) + kitty.SETTLE_GRACE();
        uint256 m = (mode / 5) % 4;
        uint256 target = m == 0 ? valve - 1 : m == 1 ? valve : m == 2 ? valve + 1 : valve + bound(mode, 1, 3 days);
        if (target > block.timestamp) {
            vm.warp(target);
            valveWarps++;
        }
    }
}
