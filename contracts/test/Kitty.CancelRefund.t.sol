// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// Refunds on cancelled pots: immediate, exact, once per contributor, with exact liability accounting.
contract KittyCancelRefundTest is KittyTestBase {
    function _refund(bytes32 id, address who) internal returns (uint256 got) {
        uint256 b0 = usdc.balanceOf(who);
        vm.prank(who);
        kitty.refund(id);
        got = usdc.balanceOf(who) - b0;
    }

    function _refundReverts(bytes32 id, address who, bytes4 sel) internal {
        vm.prank(who);
        vm.expectRevert(sel);
        kitty.refund(id);
    }

    // ── refund before the deadline is a cancel-only privilege ─────────────────

    function test_refund_withoutCancel_beforeDeadline_stillReverts() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 10e6);
        _refundReverts(id, alice, Kitty.DeadlineNotReached.selector);
    }

    // ── Split pots ────────────────────────────────────────────────────────────

    function test_split_everyContributorRefundsOwnImmediately() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 40e6);
        _fund(id, bob, 25e6);
        _fund(id, carol, 10e6); // 75 / 100 funded
        _cancel(id);
        assertLt(block.timestamp, deadline, "still before the deadline");
        assertEq(kitty.totalEscrowLiability(), 75e6);
        assertEq(usdc.balanceOf(address(kitty)), 75e6);

        assertEq(_refund(id, alice), 40e6);
        assertEq(kitty.totalEscrowLiability(), 35e6);
        assertEq(usdc.balanceOf(address(kitty)), 35e6);

        assertEq(_refund(id, bob), 25e6);
        assertEq(kitty.totalEscrowLiability(), 10e6);
        assertEq(usdc.balanceOf(address(kitty)), 10e6);

        assertEq(_refund(id, carol), 10e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);

        assertTrue(_refunded(id, alice) && _refunded(id, bob) && _refunded(id, carol));
        assertFalse(_settled(id));
    }

    function test_split_cancelAt99Percent_refundsAll() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 60e6);
        _fund(id, bob, 25e6);
        _fund(id, carol, 14e6);
        _cancel(id);
        assertEq(_refund(id, alice), 60e6);
        assertEq(_refund(id, bob), 25e6);
        assertEq(_refund(id, carol), 14e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
    }

    function test_split_doubleClaim_andNonContributors() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 10e6);
        _cancel(id);
        _refund(id, alice);
        _refundReverts(id, alice, Kitty.AlreadyRefunded.selector);
        // named in the split but contributed nothing
        _refundReverts(id, bob, Kitty.NothingToRefund.selector);
        // never involved at all, and the creator / recipient themselves
        _refundReverts(id, dave, Kitty.NothingToRefund.selector);
        _refundReverts(id, creator, Kitty.NothingToRefund.selector);
        _refundReverts(id, recipient, Kitty.NothingToRefund.selector);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    // ── Open pots ─────────────────────────────────────────────────────────────

    function test_open_everyContributorRefundsOwnImmediately() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 30e6);
        _fund(id, bob, 20e6);
        _fund(id, alice, 5e6); // repeat
        _fund(id, carol, 10e6);
        _fundFor(id, stranger, dave, 7e6);
        _cancel(id);
        assertEq(kitty.totalEscrowLiability(), 72e6);

        assertEq(_refund(id, alice), 35e6);
        assertEq(kitty.totalEscrowLiability(), 37e6);
        assertEq(_refund(id, bob), 20e6);
        assertEq(_refund(id, carol), 10e6);
        assertEq(kitty.totalEscrowLiability(), 7e6);
        assertEq(usdc.balanceOf(address(kitty)), 7e6);
        assertEq(_refund(id, dave), 7e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);

        _refundReverts(id, alice, Kitty.AlreadyRefunded.selector);
        _refundReverts(id, stranger, Kitty.NothingToRefund.selector);
        _refundReverts(id, creator, Kitty.NothingToRefund.selector);
    }

    function test_open_cancelAt99Percent_refundsAll() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 50e6);
        _fund(id, bob, 49e6);
        _cancel(id);
        assertEq(_refund(id, alice), 50e6);
        assertEq(_refund(id, bob), 49e6);
        assertEq(usdc.balanceOf(address(kitty)), 0);
    }

    function test_open_cancelAfterDeadline_refundsExactlyAsBefore() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 30e6);
        _fund(id, bob, 20e6);
        vm.warp(deadline + 1);
        _cancel(id);
        assertEq(_refund(id, alice), 30e6);
        assertEq(_refund(id, bob), 20e6);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_refundCancelled_afterFundFor_paysBeneficiaryNotPayer() public {
        bytes32 id = _split3(SALT_A);
        _fundFor(id, stranger, bob, 25e6);
        _cancel(id);
        uint256 s0 = usdc.balanceOf(stranger);
        _refundReverts(id, stranger, Kitty.NothingToRefund.selector);
        assertEq(_refund(id, bob), 25e6);
        assertEq(usdc.balanceOf(stranger), s0, "payer receives nothing");
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_refundCancelled_strayTokensStayOutOfRefundsAndLiability() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 10e6);
        vm.prank(dave);
        usdc.transfer(address(kitty), 50e6);
        _cancel(id);
        assertEq(_refund(id, alice), 10e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 50e6);
    }

    // ── partial refund, then isolation between pots ───────────────────────────

    function test_cancelOnePot_doesNotAffectSiblingRefundsOrSettle() public {
        bytes32 a = _open(SALT_A, GOAL, 0);
        bytes32 b = _fullOpen(SALT_B);
        _fund(a, alice, 10e6);
        _cancel(a);
        assertEq(kitty.totalEscrowLiability(), 110e6);
        kitty.settle(b);
        assertEq(kitty.totalEscrowLiability(), 10e6);
        _refund(a, alice);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    /// One cancelled, one settled, one valve-refunded, one expired-incomplete pot: liability stays exact.
    function test_mixedPots_cancelled_settled_valveRefunded_expired_liabilityExact() public {
        bytes32 pc = _open(bytes32(uint256(1)), GOAL, 0);   // will be cancelled
        bytes32 ps = _fullOpen(bytes32(uint256(2)));        // will be settled
        bytes32 pv = _open(bytes32(uint256(3)), GOAL, 0);   // fully funded, valve-refunded
        bytes32 pe = _open(bytes32(uint256(4)), GOAL, 0);   // incomplete, expires
        _fund(pc, alice, 40e6);
        _fund(pv, alice, 70e6);
        _fund(pv, bob, 30e6);
        _fund(pe, carol, 25e6);
        assertEq(kitty.totalEscrowLiability(), 40e6 + 100e6 + 100e6 + 25e6);

        _cancel(pc);
        assertEq(kitty.totalEscrowLiability(), 265e6);
        kitty.settle(ps);
        assertEq(kitty.totalEscrowLiability(), 165e6);
        assertEq(usdc.balanceOf(address(kitty)), 265e6 - 100e6);

        // cancelled pot refunds immediately; others are not yet refundable
        assertEq(_refund(pc, alice), 40e6);
        assertEq(kitty.totalEscrowLiability(), 125e6);
        _refundReverts(pe, carol, Kitty.DeadlineNotReached.selector);
        _refundReverts(pv, alice, Kitty.DeadlineNotReached.selector);

        vm.warp(deadline);
        assertEq(_refund(pe, carol), 25e6);
        assertEq(kitty.totalEscrowLiability(), 100e6);
        _refundReverts(pv, alice, Kitty.PotFullyFunded.selector);
        _refundReverts(ps, alice, Kitty.AlreadySettled.selector);
        _refundReverts(pc, alice, Kitty.AlreadyRefunded.selector);

        vm.warp(_valveTime());
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(pv);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.settle(pc);
        assertEq(_refund(pv, alice), 70e6);
        assertEq(_refund(pv, bob), 30e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }
}
