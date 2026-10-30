// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// cancel(): access control, state gating, events, view, and what a cancelled pot refuses.
contract KittyCancelTest is KittyTestBase {
    function _cancelBy(address who, bytes32 id) internal {
        vm.prank(who);
        kitty.cancel(id);
    }

    function _cancelReverts(address who, bytes32 id, bytes4 sel) internal {
        vm.prank(who);
        vm.expectRevert(sel);
        kitty.cancel(id);
    }

    /// Hash of the first ten getPot values (the v1 tuple).
    function _firstTen(bytes32 id) internal view returns (bytes32) {
        (
            address c, address r, uint256 goal, uint64 dl, string memory ref,
            Kitty.Mode mode, bool settled, uint256 funded, uint256 minC, uint256 count,
        ) = kitty.getPot(id);
        return keccak256(abi.encode(c, r, goal, dl, ref, mode, settled, funded, minC, count));
    }

    // ── who can cancel ────────────────────────────────────────────────────────

    function test_cancel_byCreator_emitsAndFlags() public {
        bytes32 id = _split3(SALT_A);
        assertFalse(_cancelled(id));
        vm.expectEmit(true, true, false, false, address(kitty));
        emit Kitty.Cancelled(id, creator);
        _cancelBy(creator, id);
        assertTrue(_cancelled(id));
    }

    function test_cancel_byRecipient_emitsAndFlags() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.expectEmit(true, true, false, false, address(kitty));
        emit Kitty.Cancelled(id, recipient);
        _cancelBy(recipient, id);
        assertTrue(_cancelled(id));
    }

    function test_cancel_paymentRequest_creatorEqualsRecipient() public {
        vm.prank(creator);
        bytes32 id = kitty.createOpenPot(SALT_A, creator, GOAL, deadline, "req", 0);
        _fund(id, alice, 10e6);
        _cancelBy(creator, id);
        assertTrue(_cancelled(id));
    }

    function test_cancel_byStranger_reverts() public {
        bytes32 id = _split3(SALT_A);
        _cancelReverts(stranger, id, Kitty.NotCreatorOrRecipient.selector);
        assertFalse(_cancelled(id));
    }

    function test_cancel_byContributorWhoIsNeither_reverts() public {
        bytes32 s = _split3(SALT_A);
        bytes32 o = _open(SALT_B, GOAL, 0);
        _fund(s, alice, 10e6);
        _fund(o, bob, 10e6);
        _cancelReverts(alice, s, Kitty.NotCreatorOrRecipient.selector);
        _cancelReverts(bob, o, Kitty.NotCreatorOrRecipient.selector);
        assertFalse(_cancelled(s));
        assertFalse(_cancelled(o));
    }

    function test_cancel_accessCheckedBeforeStateChecks() public {
        bytes32 id = _fullOpen(SALT_A);
        _cancelReverts(stranger, id, Kitty.NotCreatorOrRecipient.selector); // not PotFullyFunded
        kitty.settle(id);
        _cancelReverts(stranger, id, Kitty.NotCreatorOrRecipient.selector); // not AlreadySettled
        bytes32 id2 = _split3(SALT_B);
        _cancelBy(creator, id2);
        _cancelReverts(stranger, id2, Kitty.NotCreatorOrRecipient.selector); // not AlreadyCancelled
    }

    function test_cancel_unknownPot_reverts() public {
        bytes32 ghost = keccak256("ghost");
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotNotFound.selector, ghost));
        kitty.cancel(ghost);
    }

    // ── state gating ──────────────────────────────────────────────────────────

    function test_cancel_twice_reverts_evenByTheOtherParty() public {
        bytes32 id = _split3(SALT_A);
        _cancelBy(creator, id);
        _cancelReverts(creator, id, Kitty.AlreadyCancelled.selector);
        _cancelReverts(recipient, id, Kitty.AlreadyCancelled.selector);
    }

    function test_cancel_fullyFunded_reverts_split_and_open() public {
        bytes32 s = _split3(SALT_A);
        bytes32 o = _fullOpen(SALT_B);
        _fullFundSplit3(s);
        _cancelReverts(creator, s, Kitty.PotFullyFunded.selector);
        _cancelReverts(recipient, o, Kitty.PotFullyFunded.selector);
        assertFalse(_cancelled(s));
        assertFalse(_cancelled(o));
    }

    function test_cancel_fullyFunded_afterDeadlineAndAfterValve_stillReverts() public {
        bytes32 id = _fullOpen(SALT_A);
        vm.warp(deadline);
        _cancelReverts(creator, id, Kitty.PotFullyFunded.selector);
        vm.warp(_valveTime());
        _cancelReverts(creator, id, Kitty.PotFullyFunded.selector);
    }

    function test_cancel_afterSettle_reverts() public {
        bytes32 id = _fullOpen(SALT_A);
        kitty.settle(id);
        _cancelReverts(creator, id, Kitty.AlreadySettled.selector);
        _cancelReverts(recipient, id, Kitty.AlreadySettled.selector);
    }

    function test_cancel_withZeroContributions_works_andPotBecomesInert() public {
        bytes32 id = _split3(SALT_A);
        _cancelBy(creator, id);
        assertEq(kitty.totalEscrowLiability(), 0);
        vm.prank(alice);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.fund(id, 1e6);
        vm.prank(alice);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
    }

    function test_cancel_beforeAndAfterDeadline() public {
        bytes32 before_ = _open(SALT_A, GOAL, 0);
        bytes32 after_ = _open(SALT_B, GOAL, 0);
        _fund(before_, alice, 10e6);
        _fund(after_, alice, 10e6);
        _cancelBy(creator, before_);
        vm.warp(deadline + 1 days);
        _cancelBy(recipient, after_);
        assertTrue(_cancelled(before_));
        assertTrue(_cancelled(after_));
    }

    function test_cancel_at99PercentFunded_works() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 60e6);
        _fund(id, bob, 25e6);
        _fund(id, carol, 14e6);
        assertEq(_totalFunded(id), 99e6);
        _cancelBy(creator, id);
        assertTrue(_cancelled(id));
    }

    function test_cancel_movesNoTokens_andChangesNoAccounting() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 30e6);
        _fundFor(id, stranger, bob, 20e6);
        uint256 kBal = usdc.balanceOf(address(kitty));
        uint256 liab = kitty.totalEscrowLiability();
        uint256 cr = usdc.balanceOf(creator);
        uint256 rc = usdc.balanceOf(recipient);
        uint256 al = usdc.balanceOf(alice);
        _cancelBy(creator, id);
        assertEq(usdc.balanceOf(address(kitty)), kBal);
        assertEq(kitty.totalEscrowLiability(), liab);
        assertEq(usdc.balanceOf(creator), cr);
        assertEq(usdc.balanceOf(recipient), rc);
        assertEq(usdc.balanceOf(alice), al);
        assertEq(_contributed(id, alice), 30e6);
        assertEq(_totalFunded(id), 50e6);
    }

    // ── getPot ────────────────────────────────────────────────────────────────

    function test_getPot_cancelledTrue_firstTenValuesUnchanged() public {
        bytes32 id = _open(SALT_A, GOAL, 5e6);
        _fund(id, alice, 30e6);
        bytes32 h0 = _firstTen(id);
        assertFalse(_cancelled(id));
        _cancelBy(creator, id);
        assertTrue(_cancelled(id));
        assertEq(_firstTen(id), h0, "cancel must not alter the first ten getPot values");
        (address c,,,,,, bool settled, uint256 funded,, uint256 count,) = kitty.getPot(id);
        assertEq(c, creator);
        assertFalse(settled);
        assertEq(funded, 30e6);
        assertEq(count, 1);
    }

    function test_getPot_otherPotsUnaffectedByCancel() public {
        bytes32 a = _open(SALT_A, GOAL, 0);
        bytes32 b = _open(SALT_B, GOAL, 0);
        _cancelBy(creator, a);
        assertTrue(_cancelled(a));
        assertFalse(_cancelled(b));
        _fund(b, alice, 1e6); // sibling pot keeps working
    }

    // ── everything that must revert on a cancelled pot ────────────────────────

    function test_afterCancel_allFundVariantsAndSettleRevertPotCancelled() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 10e6);
        _cancelBy(creator, id);

        vm.prank(alice);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.fund(id, 1e6);

        vm.prank(stranger);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.fundFor(id, bob, 1e6);

        vm.prank(alice);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.fundWithPermit(id, 1e6, type(uint64).max, 27, bytes32(uint256(1)), bytes32(uint256(2)));

        vm.prank(stranger);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.fundForWithPermit(id, bob, 1e6, type(uint64).max, 27, bytes32(uint256(1)), bytes32(uint256(2)));

        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.settle(id);

        assertEq(_totalFunded(id), 10e6);
        assertEq(kitty.totalEscrowLiability(), 10e6);
    }

    function test_afterCancel_cancelCheckPrecedesOtherFundChecks() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _cancelBy(creator, id);
        vm.warp(deadline); // also expired
        vm.prank(alice);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.fundFor(id, address(0), 0); // invalid beneficiary, zero amount, expired: still PotCancelled
        vm.prank(alice);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.fund(id, 0);
    }

    function test_afterCancel_settleNeverSucceeds_evenAfterGraceWindow() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 99e6);
        _cancelBy(creator, id);
        vm.expectRevert(Kitty.PotCancelled.selector);
        kitty.settle(id);
        vm.warp(_valveTime() + 1);
        vm.expectRevert(Kitty.PotCancelled.selector); // not SettleWindowClosed: valve logic never applies
        kitty.settle(id);
    }

    function test_cancelledPot_neverEntersValveLogic_refundIdenticalBeforeAndAfterGrace() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 40e6);
        _fund(id, bob, 59e6);
        _cancelBy(creator, id);
        vm.warp(_valveTime() - 1);
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 40e6);
        vm.warp(_valveTime() + 10 days);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, 59e6);
        assertEq(kitty.totalEscrowLiability(), 0);
    }
}
