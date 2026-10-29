// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// RULE 1: stuck-funds valve. A fully funded unsettled pot is settle-only until
/// block.timestamp >= deadline + SETTLE_GRACE; from that instant it is refund-only.
contract KittyValveTest is KittyTestBase {
    bytes32 internal constant SALT_C = keccak256("kitty-salt-c");
    bytes32 internal constant SALT_D = keccak256("kitty-salt-d");

    function _balEqualsLiability() internal view {
        assertEq(usdc.balanceOf(address(kitty)), kitty.totalEscrowLiability(), "balance != liability");
    }

    // ── settle window ─────────────────────────────────────────────────────────

    function test_settleSplit_worksAtGraceMinus1() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.warp(_valveTime() - 1);
        kitty.settle(id);
        assertTrue(_settled(id));
        assertEq(usdc.balanceOf(recipient), GOAL);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_settleOpen_worksAtGraceMinus1() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime() - 1);
        vm.prank(stranger);
        kitty.settle(id);
        assertTrue(_settled(id));
        assertEq(usdc.balanceOf(recipient), GOAL);
        _balEqualsLiability();
    }

    function test_settle_revertsAtExactGrace_split() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.warp(_valveTime());
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(id);
        assertFalse(_settled(id));
        assertEq(kitty.totalEscrowLiability(), GOAL);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_settle_revertsAtExactGrace_open() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime());
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(id);
        assertFalse(_settled(id));
    }

    function test_settle_revertsAfterGrace_atPlusOneAndMuchLater() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime() + 1);
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(id);
        vm.warp(_valveTime() + 365 days);
        vm.prank(alice);
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_settle_afterWindow_incompletePotStillNotFullyFunded() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 60e6);
        vm.warp(_valveTime() + 1);
        vm.expectRevert(Kitty.NotFullyFunded.selector); // checked before the window
        kitty.settle(id);
    }

    function test_settle_alreadySettledTakesPrecedenceOverWindow() public {
        bytes32 id = _fullOpen(SALT_A);
        kitty.settle(id);
        vm.warp(_valveTime() + 1);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.settle(id);
    }

    function test_settle_windowMeasuredFromDeadlineNotFundingTime() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.warp(deadline - 1);
        _fund(id, alice, GOAL); // funded at the last second
        vm.warp(_valveTime() - 1);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    // ── valve refunds ─────────────────────────────────────────────────────────

    function test_refund_fullyFundedRevertsPotFullyFundedAtGraceMinus1_split() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.warp(_valveTime() - 1);
        vm.prank(alice);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(id);
        assertEq(kitty.totalEscrowLiability(), GOAL);
    }

    function test_refund_fullyFundedRevertsPotFullyFundedAtGraceMinus1_open() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime() - 1);
        vm.prank(bob);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(id);
        assertEq(kitty.totalEscrowLiability(), GOAL);
    }

    function test_refundSplit_valveOpensAtExactGrace_eachGetsOwn() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.warp(_valveTime());
        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        uint256 c0 = usdc.balanceOf(carol);

        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Refunded(id, alice, 60e6);
        vm.prank(alice);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 60e6);
        assertEq(kitty.totalEscrowLiability(), 40e6);
        _balEqualsLiability();

        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, 25e6);
        assertEq(kitty.totalEscrowLiability(), 15e6);
        _balEqualsLiability();

        vm.prank(carol);
        kitty.refund(id);
        assertEq(usdc.balanceOf(carol) - c0, 15e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
        assertFalse(_settled(id));
        assertTrue(_refunded(id, alice) && _refunded(id, bob) && _refunded(id, carol));
        assertEq(usdc.balanceOf(recipient), 0);
    }

    function test_refundOpen_valveOpensAtExactGrace_eachGetsOwn_repeatFunderAggregated() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime());
        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);

        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Refunded(id, alice, 75e6);
        vm.prank(alice);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 75e6);
        assertEq(kitty.totalEscrowLiability(), 25e6);
        _balEqualsLiability();

        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, 25e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
    }

    function test_refund_valveStaysOpenMuchLater() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime() + 400 days);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, 25e6);
    }

    function test_refund_noDoubleRefundAfterValve() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime());
        vm.prank(alice);
        kitty.refund(id);
        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadyRefunded.selector);
        kitty.refund(id);
        vm.warp(_valveTime() + 10 days);
        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadyRefunded.selector);
        kitty.refund(id);
        assertEq(kitty.totalEscrowLiability(), 25e6); // only bob remains
        _balEqualsLiability();
    }

    function test_refund_strangerAndNonContributorGetNothingToRefund() public {
        bytes32 id = _fullOpen(SALT_A);
        bytes32 sid = _split3(SALT_B);
        _fullFundSplit3(sid);
        vm.warp(_valveTime());
        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
        vm.prank(creator);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(sid);
        vm.prank(recipient);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
        // carol did not fund the open pot
        vm.prank(carol);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
        assertEq(kitty.totalEscrowLiability(), 2 * GOAL);
    }

    function test_refund_afterSettleStillAlreadySettled_evenPastWindow() public {
        bytes32 id = _fullOpen(SALT_A);
        kitty.settle(id);
        vm.warp(_valveTime() + 1);
        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.refund(id);
    }

    // ── mutual exclusion ──────────────────────────────────────────────────────

    function test_partRefundedPotCanNeverBeSettled() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime());
        vm.prank(alice);
        kitty.refund(id);
        // totalFunded is unchanged (still == goal) but settle must still fail
        assertEq(_totalFunded(id), GOAL);
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(id);
        vm.prank(bob);
        kitty.refund(id);
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(id);
        assertFalse(_settled(id));
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_noFundingAfterValveRefunds() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(_valveTime());
        vm.prank(alice);
        kitty.refund(id);
        vm.prank(carol);
        vm.expectRevert(Kitty.DeadlinePassed.selector);
        kitty.fund(id, 1e6);
    }

    // ── multi-pot accounting ──────────────────────────────────────────────────

    /// A settled, B refunded via the valve, C incomplete and refunded: liability and balance stay exact.
    function test_mixOfPots_liabilityAndBalanceExactAtEveryStep() public {
        bytes32 a = _split3(SALT_A); // will settle
        _fullFundSplit3(a);
        bytes32 b = _fullOpen(SALT_B); // will be refunded via the valve
        bytes32 c = _open(SALT_C, 200e6, 0); // incomplete
        _fund(c, carol, 50e6);
        _fund(c, dave, 20e6);
        assertEq(kitty.totalEscrowLiability(), 270e6);
        _balEqualsLiability();

        kitty.settle(a);
        assertEq(kitty.totalEscrowLiability(), 170e6);
        _balEqualsLiability();
        assertEq(usdc.balanceOf(recipient), GOAL);

        // incomplete pot C is refundable from the deadline; fully funded B is not
        vm.warp(deadline);
        vm.prank(carol);
        kitty.refund(c);
        assertEq(kitty.totalEscrowLiability(), 120e6);
        _balEqualsLiability();
        vm.prank(alice);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(b);
        assertEq(kitty.totalEscrowLiability(), 120e6);

        vm.warp(_valveTime() - 1);
        vm.prank(alice);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(b);

        vm.warp(_valveTime());
        vm.prank(alice);
        kitty.refund(b); // 75
        assertEq(kitty.totalEscrowLiability(), 45e6);
        _balEqualsLiability();
        vm.prank(bob);
        kitty.refund(b); // 25
        assertEq(kitty.totalEscrowLiability(), 20e6);
        _balEqualsLiability();
        vm.prank(dave);
        kitty.refund(c); // 20
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);

        // A stays settled (cannot be refunded), B/C never settled
        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.refund(a);
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(b);
        vm.expectRevert(Kitty.NotFullyFunded.selector);
        kitty.settle(c);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    function test_valveRefundsNeverTouchOtherPotsFunds() public {
        bytes32 b = _fullOpen(SALT_B);
        // pot D has a later deadline, so it is still live when B's valve opens
        vm.prank(creator);
        bytes32 d = kitty.createOpenPot(SALT_D, recipient, GOAL, uint64(_valveTime() + 60 days), "later", 0);
        _fund(d, alice, 40e6);
        _fund(d, stranger, 10e6);

        vm.warp(_valveTime());
        vm.prank(alice);
        kitty.refund(b);
        vm.prank(bob);
        kitty.refund(b);

        // D is untouched: funds, flags, liability and token balance
        assertEq(_contributed(d, alice), 40e6);
        assertEq(_contributed(d, stranger), 10e6);
        assertEq(_totalFunded(d), 50e6);
        assertFalse(_refunded(d, alice));
        assertFalse(_settled(d));
        assertEq(kitty.totalEscrowLiability(), 50e6);
        assertEq(usdc.balanceOf(address(kitty)), 50e6);

        // alice's refund flag in B does not leak into D; D is still fundable and refundable later
        _fund(d, bob, 50e6);
        assertEq(_totalFunded(d), GOAL);
        vm.warp(_valveTime() + 60 days); // D's deadline: fully funded, so still settle-only
        vm.prank(alice);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(d);
        vm.warp(_valveTime() + 60 days + kitty.SETTLE_GRACE()); // D's own valve
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        kitty.refund(d);
        assertEq(usdc.balanceOf(alice) - a0, 40e6);
        assertEq(kitty.totalEscrowLiability(), 60e6);
        _balEqualsLiability();
    }
}
