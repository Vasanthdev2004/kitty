// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyPermitTestBase} from "./Kitty.PermitBase.t.sol";

/// Fuzz tests for the v2 surface: fundFor, cancel, and permit / no-permit funding.
contract KittyV2FuzzTest is KittyPermitTestBase {
    // ── helpers ──────────────────────────────────────────────────────────────

    function _clean(address a) internal view {
        vm.assume(uint160(a) > 0xFFFF);
        vm.assume(a.code.length == 0);
        vm.assume(
            a != address(kitty) && a != address(usdc) && a != address(this) && a != address(vm)
                && a != creator && a != recipient && a != address(pk) && a != address(pt)
                && a != 0x000000000000000000636F6e736F6c652e6c6f67
        );
    }

    function _giveTokens(address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.prank(who);
        usdc.approve(address(kitty), type(uint256).max);
    }

    // ── fundFor amounts ───────────────────────────────────────────────────────

    /// Split: part1 + part2 never exceed the share; any combination of payers credits only the beneficiary.
    function testFuzz_fundFor_split_boundedByRemainingShare(uint8 benIdx, uint256 a1, uint256 a2, address p1, address p2)
        public
    {
        _clean(p1);
        _clean(p2);
        vm.assume(p1 != p2);
        address ben = benIdx % 3 == 0 ? alice : benIdx % 3 == 1 ? bob : carol;
        uint256 share = ben == alice ? 60e6 : ben == bob ? 25e6 : 15e6;
        bytes32 id = _split3(SALT_A);
        _giveTokens(p1, share);
        _giveTokens(p2, share);

        uint256 part1 = bound(a1, 1, share);
        _fundFor(id, p1, ben, part1);
        assertEq(_contributed(id, ben), part1);
        assertEq(_contributed(id, p1), 0);

        uint256 left = share - part1;
        if (left == 0) {
            vm.prank(p2);
            vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, share + 1, share));
            kitty.fundFor(id, ben, 1);
            return;
        }
        uint256 part2 = bound(a2, 1, left);
        _fundFor(id, p2, ben, part2);
        assertEq(_contributed(id, ben), part1 + part2);
        assertEq(usdc.balanceOf(p1), share - part1);
        assertEq(usdc.balanceOf(p2), share - part2);
        assertEq(kitty.totalEscrowLiability(), part1 + part2);
        assertEq(usdc.balanceOf(address(kitty)), part1 + part2);

        // one unit over the share is always rejected, whoever pays
        if (part1 + part2 == share) {
            vm.prank(p1);
            vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, share + 1, share));
            kitty.fundFor(id, ben, 1);
        }
    }

    /// Open: a first-time beneficiary needs the floor unless completing; a repeat beneficiary may add anything.
    function testFuzz_fundFor_open_floorOrCompleting(uint256 goalSeed, uint256 aSeed, uint256 bSeed) public {
        uint256 goal = bound(goalSeed, 256, 1e12);
        bytes32 id = _open(SALT_A, goal, 0);
        uint256 floorAmt = kitty.effectiveMinContribution(id);
        assertEq(floorAmt, _dust(goal));

        // first-time beneficiary bob
        uint256 amt = bound(aSeed, 1, goal);
        if (amt < floorAmt && amt != goal) {
            vm.prank(stranger);
            vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, amt, floorAmt));
            kitty.fundFor(id, bob, amt);
            assertEq(_count(id), 0);
            amt = floorAmt; // retry at the floor
        }
        _fundFor(id, stranger, bob, amt);
        assertEq(_contributed(id, bob), amt);
        assertEq(_count(id), 1);

        // repeat beneficiary: any positive amount up to the remainder, no floor
        uint256 rem = goal - amt;
        if (rem == 0) return;
        uint256 more = bound(bSeed, 1, rem);
        _fundFor(id, dave, bob, more);
        assertEq(_contributed(id, bob), amt + more);
        assertEq(_count(id), 1);
        assertEq(kitty.totalEscrowLiability(), amt + more);
    }

    // ── refund goes to the beneficiary ────────────────────────────────────────

    function testFuzz_refund_goesToBeneficiary_notPayer(address payer_, address ben, uint96 amtSeed) public {
        _clean(payer_);
        _clean(ben);
        vm.assume(payer_ != ben);
        bytes32 id = _open(SALT_A, GOAL, 0);
        uint256 amt = bound(amtSeed, kitty.effectiveMinContribution(id), GOAL - 1);
        _giveTokens(payer_, amt);

        _fundFor(id, payer_, ben, amt);
        uint256 payerBal = usdc.balanceOf(payer_);
        uint256 benBal = usdc.balanceOf(ben);
        assertEq(payerBal, 0);
        vm.warp(deadline);

        vm.prank(payer_);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);

        vm.prank(ben);
        kitty.refund(id);
        assertEq(usdc.balanceOf(ben) - benBal, amt, "beneficiary refunded");
        assertEq(usdc.balanceOf(payer_), payerBal, "payer got nothing");
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);

        vm.prank(ben);
        vm.expectRevert(Kitty.AlreadyRefunded.selector);
        kitty.refund(id);
    }

    // ── cancel conserves tokens ───────────────────────────────────────────────

    function testFuzz_cancelThenRefunds_conserveTokens(
        uint256[4] memory seeds,
        bool byRecipient,
        bool afterDeadline,
        bool viaFundFor,
        uint256 strayAmt
    ) public {
        uint256 goal = 1e9;
        bytes32 id = _open(SALT_A, goal, 0);
        address[4] memory us = [alice, bob, carol, dave];
        uint256[4] memory amts;
        uint256 total;
        uint256 supplyBefore = usdc.totalSupply();
        for (uint256 i = 0; i < 4; i++) {
            // each between the floor and 24% of goal so the pot can never be full
            amts[i] = bound(seeds[i], kitty.effectiveMinContribution(id), 240_000_000);
            if (viaFundFor && i % 2 == 1) _fundFor(id, stranger, us[i], amts[i]);
            else _fund(id, us[i], amts[i]);
            total += amts[i];
        }
        strayAmt = bound(strayAmt, 0, 1e9);
        if (strayAmt > 0) {
            vm.prank(stranger);
            usdc.transfer(address(kitty), strayAmt);
        }
        if (afterDeadline) vm.warp(deadline + 1);

        uint256 kBal = usdc.balanceOf(address(kitty));
        vm.prank(byRecipient ? recipient : creator);
        kitty.cancel(id);
        assertEq(usdc.balanceOf(address(kitty)), kBal, "cancel moved tokens");
        assertEq(kitty.totalEscrowLiability(), total);

        uint256 out;
        for (uint256 i = 0; i < 4; i++) {
            uint256 b0 = usdc.balanceOf(us[i]);
            vm.prank(us[i]);
            kitty.refund(id);
            assertEq(usdc.balanceOf(us[i]) - b0, amts[i], "exactly own contribution");
            out += amts[i];
            assertEq(kitty.totalEscrowLiability(), total - out);
            assertEq(usdc.balanceOf(address(kitty)), kBal - out);
        }
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), strayAmt, "only stray tokens remain");
        assertEq(usdc.totalSupply(), supplyBefore);
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(us[i]);
            vm.expectRevert(Kitty.AlreadyRefunded.selector);
            kitty.refund(id);
        }
    }

    function testFuzz_cancel_onlyCreatorOrRecipient(address caller, bool openMode) public {
        bytes32 id = openMode ? _open(SALT_A, GOAL, 0) : _split3(SALT_A);
        if (caller == creator || caller == recipient) {
            vm.prank(caller);
            kitty.cancel(id);
            assertTrue(_cancelled(id));
        } else {
            vm.prank(caller);
            vm.expectRevert(Kitty.NotCreatorOrRecipient.selector);
            kitty.cancel(id);
            assertFalse(_cancelled(id));
        }
    }

    // ── permit / no-permit ────────────────────────────────────────────────────

    /// With an unusable signature, fundWithPermit funds iff the allowance already covers the amount;
    /// otherwise it reverts with exactly (allowance, amount).
    function testFuzz_garbageSignature_fundsIffAllowanceCovers(
        uint8 v,
        bytes32 r,
        bytes32 s,
        uint256 allowSeed,
        uint256 amtSeed
    ) public {
        bytes32 id = _pOpen(SALT_A, 0);
        uint256 amt = bound(amtSeed, pk.effectiveMinContribution(id), GOAL);
        uint256 allowance_ = bound(allowSeed, 0, GOAL + 1);
        vm.prank(payer);
        pt.approve(address(pk), allowance_);

        vm.prank(payer);
        if (allowance_ >= amt) {
            pk.fundWithPermit(id, amt, PDL, v, r, s);
            assertEq(_pContributed(id, payer), amt);
            assertEq(pt.allowance(payer, address(pk)), allowance_ - amt);
        } else {
            vm.expectRevert(abi.encodeWithSelector(Kitty.InsufficientAllowanceAfterPermit.selector, allowance_, amt));
            pk.fundWithPermit(id, amt, PDL, v, r, s);
            assertEq(_pTotal(id), 0);
        }
        assertEq(pt.nonces(payer), 0, "garbage permit never consumes a nonce");
    }

    /// Random mixes of approve+fund, valid permit, bad permit with / without allowance, fundFor permit and front-runs.
    function testFuzz_randomPermitAndPlainSequences(uint256 seed) public {
        bytes32 id = _pOpen(SALT_A, 0);
        uint256 expPayer;
        uint256 expDave;
        uint256 expNonce;
        for (uint256 i = 0; i < 10; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 rem = GOAL - _pTotal(id);
            if (rem == 0) break;
            uint256 kind = seed % 6;
            uint256 amt = bound(seed >> 8, 400_000, 8e6); // above the floor of 390_625
            if (amt > rem) amt = rem;

            if (kind == 0) {
                vm.prank(payer);
                pt.approve(address(pk), amt);
                vm.prank(payer);
                pk.fund(id, amt);
                expPayer += amt;
            } else if (kind == 1) {
                (uint8 v, bytes32 r, bytes32 s) = _sig(amt);
                vm.prank(payer);
                pk.fundWithPermit(id, amt, PDL, v, r, s);
                expPayer += amt;
                expNonce++;
            } else if (kind == 2) {
                vm.prank(payer);
                pt.approve(address(pk), amt);
                vm.prank(payer);
                pk.fundWithPermit(id, amt, PDL, 27, bytes32(uint256(7)), bytes32(uint256(8)));
                expPayer += amt;
            } else if (kind == 3) {
                vm.prank(payer);
                pt.approve(address(pk), 0);
                vm.prank(payer);
                vm.expectRevert(abi.encodeWithSelector(Kitty.InsufficientAllowanceAfterPermit.selector, 0, amt));
                pk.fundWithPermit(id, amt, PDL, 27, bytes32(uint256(7)), bytes32(uint256(8)));
            } else if (kind == 4) {
                (uint8 v, bytes32 r, bytes32 s) = _sig(amt);
                vm.prank(payer);
                pk.fundForWithPermit(id, dave, amt, PDL, v, r, s);
                expDave += amt;
                expNonce++;
            } else {
                (uint8 v, bytes32 r, bytes32 s) = _sig(amt);
                vm.prank(stranger); // front-run
                pt.permit(payer, address(pk), amt, PDL, v, r, s);
                vm.prank(payer);
                pk.fundWithPermit(id, amt, PDL, v, r, s);
                expPayer += amt;
                expNonce++;
            }
            assertEq(_pContributed(id, payer), expPayer);
            assertEq(_pContributed(id, dave), expDave);
            assertEq(_pTotal(id), expPayer + expDave);
            assertEq(pk.totalEscrowLiability(), expPayer + expDave);
            assertEq(pt.balanceOf(address(pk)), expPayer + expDave);
            assertEq(pt.nonces(payer), expNonce);
            assertEq(pt.allowance(payer, address(pk)), 0, "allowance fully consumed or revoked");
        }
        // refunds after the deadline pay each beneficiary exactly their credit
        vm.warp(deadline);
        if (_pTotal(id) == GOAL) return; // fully funded pots are settle-only
        if (expPayer > 0) {
            uint256 b0 = pt.balanceOf(payer);
            vm.prank(payer);
            pk.refund(id);
            assertEq(pt.balanceOf(payer) - b0, expPayer);
        }
        if (expDave > 0) {
            uint256 d0 = pt.balanceOf(dave);
            vm.prank(dave);
            pk.refund(id);
            assertEq(pt.balanceOf(dave) - d0, expDave);
        }
        assertEq(pk.totalEscrowLiability(), 0);
    }
}
