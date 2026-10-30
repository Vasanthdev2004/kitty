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

    // v2 ghosts / counters
    mapping(bytes32 => mapping(address => uint256)) public ghostCredit; // what each beneficiary was credited
    uint256 public fundForOk;        // successful fundFor / fundForWithPermit
    uint256 public permitOk;         // successful fundWithPermit / fundForWithPermit
    uint256 public cancelOk;
    uint256 public cancelRejected;   // cancel correctly rejected
    uint256 public fundRejected;     // funding correctly rejected
    uint256 public unexpectedFund;   // a funding call succeeded when it must not
    uint256 public missedFund;       // a funding call failed when it must succeed
    uint256 public unexpectedCancel; // cancel succeeded when it must not
    uint256 public missedCancel;     // cancel failed when it must succeed
    uint256 public cancelMovedTokens;// cancel changed a token balance or the liability
    uint256 public settleAfterCancel;// settle succeeded on a cancelled pot
    uint256 public cancelledRefundOk;// refunds paid out of cancelled pots

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

    /// Largest-sensible amount for `ben` in pot `id` (always valid when ok == true).
    function _validAmt(bytes32 id, address ben, uint256 amtSeed) internal view returns (uint256 amt, bool ok) {
        (, , uint256 goal, uint64 dl,, Kitty.Mode mode,, uint256 tf,,, bool canc) = kitty.getPot(id);
        if (canc || block.timestamp >= dl) return (0, false);
        uint256 remaining = goal - tf;
        if (remaining == 0) return (0, false);

        uint256 maxAmt = remaining;
        (uint256 sh, uint256 prior,) = kitty.getContribution(id, ben);
        if (mode == Kitty.Mode.Split) {
            if (sh == 0 || sh == prior) return (0, false);
            if (sh - prior < maxAmt) maxAmt = sh - prior;
        }
        amt = amtSeed % 3 == 0 ? maxAmt : bound(amtSeed, 1, maxAmt);
        if (mode == Kitty.Mode.Open && prior == 0) {
            uint256 eff = kitty.effectiveMinContribution(id);
            // first-time beneficiaries must reach the floor unless completing; repeat ones may add anything
            if (amt < eff && amt != remaining) amt = eff <= remaining ? eff : remaining;
        }
        ok = true;
    }

    /// Independent model of when a funding call must succeed.
    function _legal(bytes32 id, address payer, address ben, uint256 amt, uint8 kind) internal view returns (bool) {
        (, , uint256 goal, uint64 dl,, Kitty.Mode mode,, uint256 tf,,, bool canc) = kitty.getPot(id);
        if (canc || amt == 0 || block.timestamp >= dl) return false;
        uint256 rem = goal - tf;
        if (amt > rem) return false;
        (uint256 sh, uint256 prior,) = kitty.getContribution(id, ben);
        if (mode == Kitty.Mode.Split) {
            if (sh == 0 || prior + amt > sh) return false;
        } else if (prior == 0) {
            uint256 eff = kitty.effectiveMinContribution(id);
            if (amt < eff && amt != rem) return false; // the 256 cap is unreachable through the floor
        }
        if (kind >= 2 && usdc.allowance(payer, address(kitty)) < amt) return false;
        return true;
    }

    /// kind: 0 fund, 1 fundFor, 2 fundWithPermit, 3 fundForWithPermit (mock token has no permit: allowance path).
    function _attempt(bytes32 id, address payer, address ben, uint256 amt, uint8 kind) internal {
        bool legal = _legal(id, payer, ben, amt, kind);
        bool ok;
        vm.prank(payer);
        if (kind == 0) {
            try kitty.fund(id, amt) { ok = true; } catch {}
        } else if (kind == 1) {
            try kitty.fundFor(id, ben, amt) { ok = true; } catch {}
        } else if (kind == 2) {
            try kitty.fundWithPermit(id, amt, type(uint256).max, 27, bytes32(0), bytes32(0)) { ok = true; } catch {}
        } else {
            try kitty.fundForWithPermit(id, ben, amt, type(uint256).max, 27, bytes32(0), bytes32(0)) { ok = true; }
            catch {}
        }
        if (ok) {
            ghostIn += amt;
            ghostCredit[id][ben] += amt;
            fundOk++;
            if (kind == 1 || kind == 3) fundForOk++;
            if (kind >= 2) permitOk++;
            if (!legal) unexpectedFund++;
        } else {
            fundRejected++;
            if (legal) missedFund++;
        }
    }

    function fund(uint256 potSeed, uint256 actorSeed, uint256 amtSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        address a = actors[actorSeed % actors.length];
        (uint256 amt, bool ok) = _validAmt(id, a, amtSeed);
        if (!ok) return;
        _attempt(id, a, a, amt, 0);
    }

    /// Any funding flavour, payer and beneficiary independent. Mostly sensible amounts, sometimes junk.
    function fundAny(uint256 potSeed, uint256 payerSeed, uint256 benSeed, uint256 amtSeed, uint256 kindSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        address payer = actors[payerSeed % actors.length];
        address ben = actors[benSeed % actors.length];
        uint8 kind = uint8(kindSeed % 4);
        if (kind == 0) ben = payer;
        if (kind == 2) ben = payer;

        (uint256 amt, bool ok) = _validAmt(id, ben, amtSeed);
        if (!ok || (amtSeed >> 4) % 6 == 0) {
            (, , uint256 goal,,,,,,,,) = kitty.getPot(id);
            amt = bound(amtSeed >> 8, 0, goal + 1); // junk: usually illegal, model decides
        }

        // permit-style calls: sometimes strip or trim the payer's allowance first
        uint256 allowMode = (kindSeed >> 8) % 3;
        if (kind >= 2 && allowMode != 2) {
            vm.prank(payer);
            usdc.approve(address(kitty), allowMode == 0 ? 0 : amt);
        }
        _attempt(id, payer, ben, amt, kind);
        if (kind >= 2 && allowMode != 2) {
            vm.prank(payer);
            usdc.approve(address(kitty), type(uint256).max);
        }
    }

    function cancel(uint256 potSeed, uint256 whoSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        (address cr, address rc, uint256 goal,,,, bool settled_, uint256 tf,,, bool canc) = kitty.getPot(id);
        uint256 w = whoSeed % 3;
        address who = w == 0 ? address(this) : w == 1 ? rc : actors[(whoSeed / 3) % actors.length];
        bool legal = (who == cr || who == rc) && !settled_ && !canc && tf != goal;
        // legal cancels end a pot's life: let only about one in ten through so the others keep being explored
        if (legal && (whoSeed >> 16) % 10 != 0) return;

        uint256 bal = usdc.balanceOf(address(kitty));
        uint256 liab = kitty.totalEscrowLiability();
        if (who != address(this)) vm.prank(who);
        try kitty.cancel(id) {
            cancelOk++;
            if (!legal) unexpectedCancel++;
            if (usdc.balanceOf(address(kitty)) != bal || kitty.totalEscrowLiability() != liab) cancelMovedTokens++;
        } catch {
            cancelRejected++;
            if (legal) missedCancel++;
        }
    }

    function settle(uint256 potSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        (, , uint256 goal, uint64 dl,,, bool settled_, uint256 tf,,, bool canc) = kitty.getPot(id);
        bool full = !settled_ && tf == goal;
        bool inWindow = block.timestamp < uint256(dl) + kitty.SETTLE_GRACE();
        try kitty.settle(id) {
            ghostOutSettle += goal;
            settleOk++;
            if (canc) settleAfterCancel++;
            if (!(full && inWindow) || canc) unexpectedSettle++;
        } catch (bytes memory d) {
            if (full && inWindow && !canc) missedSettle++;
            if (full && !inWindow && !canc) {
                if (bytes4(d) == Kitty.SettleWindowClosed.selector) windowRejects++;
                else missedSettle++;
            }
        }
    }

    function refund(uint256 potSeed, uint256 actorSeed) external {
        bytes32 id = pots[potSeed % pots.length];
        address a = actors[actorSeed % actors.length];
        (, , uint256 goal, uint64 dl,,, bool settled_, uint256 tf,,, bool canc) = kitty.getPot(id);
        (, uint256 contrib, bool already) = kitty.getContribution(id, a);
        bool full = tf == goal;
        bool shouldWork = !settled_ && (canc || block.timestamp >= dl) && !already && contrib > 0
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
            if (canc) cancelledRefundOk++;
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
        (, , , uint64 dl,,,,,,,) = kitty.getPot(id);
        uint256 valve = uint256(dl) + kitty.SETTLE_GRACE();
        uint256 m = (mode / 5) % 4;
        uint256 target = m == 0 ? valve - 1 : m == 1 ? valve : m == 2 ? valve + 1 : valve + bound(mode, 1, 3 days);
        if (target > block.timestamp) {
            vm.warp(target);
            valveWarps++;
        }
    }
}
