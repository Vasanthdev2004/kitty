// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// settle(), refund(), payment-request flow.
contract KittySettleRefundTest is KittyTestBase {
    // ── settle ────────────────────────────────────────────────────────────────

    function test_settleSplit_paysGoalToRecipient() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        uint256 before_ = usdc.balanceOf(recipient);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient) - before_, GOAL);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
        assertTrue(_settled(id));
        // contributed unchanged by settlement
        assertEq(_contributed(id, alice), 60e6);
    }

    function test_settleOpen_paysGoalToRecipient() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 50e6);
        _fund(id, bob, 30e6);
        _fund(id, alice, 20e6);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertTrue(_settled(id));
    }

    function test_settle_emitsSettled() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Settled(id, recipient, GOAL);
        kitty.settle(id);
    }

    function test_settle_permissionless() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.prank(stranger);
        kitty.settle(id);
        assertTrue(_settled(id));
        assertEq(usdc.balanceOf(stranger), 1_000_000e6); // caller gets nothing extra
    }

    function test_settle_beforeDeadlineAllowedWhenFull() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, GOAL);
        assertLt(block.timestamp, deadline);
        kitty.settle(id);
        assertTrue(_settled(id));
    }

    function test_settle_afterDeadlineWhenFull() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.warp(uint256(deadline) + kitty.SETTLE_GRACE() - 1); // last instant of the settle window
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    function test_settle_exactlyOnce() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, GOAL);
        bytes32 other = _open(SALT_B, GOAL, 0);
        _fund(other, bob, 40e6);

        kitty.settle(id);
        assertEq(kitty.totalEscrowLiability(), 40e6); // only `other` remains
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.settle(id);
        vm.prank(stranger);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL); // paid once
        assertEq(kitty.totalEscrowLiability(), 40e6);
        assertEq(usdc.balanceOf(address(kitty)), 40e6);
    }

    function test_settle_notFullyFundedReverts() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 60e6);
        vm.expectRevert(Kitty.NotFullyFunded.selector);
        kitty.settle(id);
        bytes32 oid = _open(SALT_B, GOAL, 0);
        vm.expectRevert(Kitty.NotFullyFunded.selector);
        kitty.settle(oid); // zero funded
        assertFalse(_settled(id));
    }

    function test_settle_afterDeadlineUnderfundedStillReverts() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 60e6);
        vm.warp(deadline);
        vm.expectRevert(Kitty.NotFullyFunded.selector);
        kitty.settle(id);
    }

    function test_settle_leavesOtherPotsLiability() public {
        bytes32 a = _split3(SALT_A);
        _fullFundSplit3(a);
        bytes32 b = _open(SALT_B, GOAL, 0);
        _fund(b, dave, 25e6);
        assertEq(kitty.totalEscrowLiability(), 125e6);
        kitty.settle(a);
        assertEq(kitty.totalEscrowLiability(), 25e6);
        assertFalse(_settled(b));
    }

    // ── payment request (recipient == creator) ────────────────────────────────

    function test_paymentRequest_open_creatorReceivesGoal() public {
        vm.prank(creator);
        bytes32 id = kitty.createOpenPot(SALT_A, creator, GOAL, deadline, "invoice-42", 0);
        uint256 before_ = usdc.balanceOf(creator);
        _fund(id, alice, 60e6);
        _fund(id, bob, 40e6);
        vm.prank(stranger);
        kitty.settle(id);
        assertEq(usdc.balanceOf(creator) - before_, GOAL);
        assertEq(kitty.totalEscrowLiability(), 0);
        (address c, address r,,,,,,,,) = kitty.getPot(id);
        assertEq(c, r);
    }

    function test_paymentRequest_split_creatorReceivesGoal() public {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 70e6;
        cs[1] = bob;   ss[1] = 30e6;
        vm.prank(creator);
        bytes32 id = kitty.createSplitPot(SALT_A, creator, GOAL, deadline, "split-req", cs, ss);
        _fund(id, alice, 70e6);
        _fund(id, bob, 30e6);
        kitty.settle(id);
        assertEq(usdc.balanceOf(creator), GOAL);
    }

    function test_paymentRequest_creatorHasNoPowers() public {
        vm.prank(creator);
        bytes32 id = kitty.createOpenPot(SALT_A, creator, GOAL, deadline, "req", 0);
        _fund(id, alice, 40e6);
        // creator cannot settle an underfunded pot or pull funds
        vm.prank(creator);
        vm.expectRevert(Kitty.NotFullyFunded.selector);
        kitty.settle(id);
        vm.warp(deadline);
        vm.prank(creator);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
    }

    // ── refund ────────────────────────────────────────────────────────────────

    function test_refundOpen_eachFunderGetsExactlyOwnAmount() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 20e6);
        _fund(id, bob, 15e6);
        _fund(id, alice, 5e6);
        _fund(id, carol, 7e6);
        vm.warp(deadline);

        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        uint256 c0 = usdc.balanceOf(carol);

        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Refunded(id, alice, 25e6);
        vm.prank(alice);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 25e6);
        assertEq(kitty.totalEscrowLiability(), 22e6);
        // bob and carol untouched so far
        assertEq(usdc.balanceOf(bob), b0);
        assertEq(usdc.balanceOf(carol), c0);

        vm.prank(bob);
        kitty.refund(id);
        vm.prank(carol);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, 15e6);
        assertEq(usdc.balanceOf(carol) - c0, 7e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
    }

    function test_refundOpen_doubleClaimAndNonFunder() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 20e6);
        _fund(id, bob, 10e6);
        vm.warp(uint256(deadline) + 1);
        vm.prank(alice);
        kitty.refund(id);

        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadyRefunded.selector);
        kitty.refund(id);

        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);

        // bob unaffected by alice's claims and can still claim exactly 10e6
        assertEq(kitty.totalEscrowLiability(), 10e6);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, 10e6);
    }

    function test_refund_flagsAndContributedAfterRefund() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 20e6);
        vm.warp(deadline);
        vm.prank(alice);
        kitty.refund(id);
        (uint256 sh, uint256 contributed, bool refunded) = kitty.getContribution(id, alice);
        assertEq(sh, 0);
        assertEq(contributed, 20e6); // unchanged after refund
        assertTrue(refunded);
        assertEq(_totalFunded(id), 20e6); // totalFunded also unchanged
        assertEq(_count(id), 1);
    }

    function test_refundSplit_exactOwnAmountOnly() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 30e6);
        _fund(id, bob, 25e6);
        vm.warp(uint256(deadline) + 1);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(alice);
        kitty.refund(id);
        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 30e6);
        assertEq(usdc.balanceOf(bob) - b0, 25e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        // carol is a named contributor but funded nothing
        vm.prank(carol);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
    }

    function test_refund_succeedsAtExactDeadline() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 60e6);
        vm.warp(deadline);
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 60e6);
    }

    function test_refund_failsBeforeDeadline() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 60e6);
        vm.warp(deadline - 1);
        vm.prank(alice);
        vm.expectRevert(Kitty.DeadlineNotReached.selector);
        kitty.refund(id);
    }

    function test_refund_fundAtDeadlineMinus1ThenRefundAtDeadline() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.warp(deadline - 1);
        _fund(id, alice, 10e6);
        vm.warp(deadline);
        vm.prank(alice);
        kitty.refund(id);
        assertTrue(_refunded(id, alice));
    }

    function test_refund_strangerCannotPullOthersFunds() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 60e6);
        vm.warp(deadline);
        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
        assertEq(kitty.totalEscrowLiability(), 60e6);
    }

    function test_refund_rejectsFullyFundedUnsettled() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.warp(uint256(deadline) + kitty.SETTLE_GRACE() - 1); // just before the valve opens
        vm.prank(alice);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(id);
        // and the pot can still be settled afterwards
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    function test_refund_rejectsFullyFundedOpenUnsettled() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 60e6);
        _fund(id, bob, 40e6);
        vm.warp(uint256(deadline) + kitty.SETTLE_GRACE() - 1); // just before the valve opens
        vm.prank(bob);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(id);
    }

    function test_refund_rejectsSettledPot() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        kitty.settle(id);
        vm.warp(uint256(deadline) + 1);
        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.refund(id);
        vm.prank(stranger);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.refund(id);
    }

    function test_refund_beforeDeadlineWhenFullyFundedReportsDeadlineNotReached() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, GOAL);
        vm.prank(alice);
        vm.expectRevert(Kitty.DeadlineNotReached.selector);
        kitty.refund(id);
        kitty.settle(id);
        vm.prank(alice);
        vm.expectRevert(Kitty.DeadlineNotReached.selector);
        kitty.refund(id);
    }

    function test_refund_potsAreIndependent() public {
        bytes32 a = _open(SALT_A, GOAL, 0);
        bytes32 b = _open(SALT_B, GOAL, 0);
        _fund(a, alice, 10e6);
        _fund(b, alice, 20e6);
        vm.warp(deadline);
        vm.prank(alice);
        kitty.refund(a);
        assertEq(kitty.totalEscrowLiability(), 20e6);
        assertFalse(_refunded(b, alice));
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        kitty.refund(b);
        assertEq(usdc.balanceOf(alice) - a0, 20e6);
    }

    function test_noFundingAfterDeadlineEvenAfterPartialRefunds() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 10e6);
        vm.warp(deadline);
        vm.prank(alice);
        kitty.refund(id);
        vm.prank(bob);
        vm.expectRevert(Kitty.DeadlinePassed.selector);
        kitty.fund(id, 1e6);
    }
}
