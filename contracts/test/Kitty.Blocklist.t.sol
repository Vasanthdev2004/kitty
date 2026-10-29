// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase, KittyBlocklistToken} from "./Kitty.Base.t.sol";

/// Blocklisted / reverting recipient: settle fails, but the funds are recoverable via the valve refund.
contract KittyBlocklistTest is KittyTestBase {
    string internal constant BLOCKED_MSG = "KittyBlocklistToken: recipient blocklisted";

    KittyBlocklistToken internal blk;
    Kitty internal bk;

    function setUp() public override {
        super.setUp();
        blk = new KittyBlocklistToken();
        bk = new Kitty(address(blk));
        address[4] memory us = [alice, bob, carol, dave];
        for (uint256 i = 0; i < us.length; i++) {
            blk.mint(us[i], 1_000_000e6);
            vm.prank(us[i]);
            blk.approve(address(bk), type(uint256).max);
        }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _bOpen(bytes32 salt, address rec) internal returns (bytes32 id) {
        vm.prank(creator);
        id = bk.createOpenPot(salt, rec, GOAL, deadline, "blk", 0);
    }

    function _bSplit(bytes32 salt, address rec) internal returns (bytes32 id) {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 70e6;
        cs[1] = bob;   ss[1] = 30e6;
        vm.prank(creator);
        id = bk.createSplitPot(salt, rec, GOAL, deadline, "blk", cs, ss);
    }

    /// alice 70 / bob 30 fills either pot kind.
    function _bFill(bytes32 id) internal {
        vm.prank(alice);
        bk.fund(id, 70e6);
        vm.prank(bob);
        bk.fund(id, 30e6);
    }

    function _bSettled(bytes32 id) internal view returns (bool s) {
        (,,,,,, s,,,) = bk.getPot(id);
    }

    function _settleFails(bytes32 id) internal {
        vm.expectRevert(bytes(BLOCKED_MSG));
        bk.settle(id);
        assertFalse(_bSettled(id));
        assertEq(bk.totalEscrowLiability(), GOAL);
        assertEq(blk.balanceOf(address(bk)), GOAL);
    }

    function _refundBlockedUntilValve(bytes32 id) internal {
        vm.prank(alice);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        bk.refund(id);
    }

    /// Precondition: pot is fully funded, unsettled, and `rec` is currently blocklisted.
    function _runBlockedScenario(bytes32 id, address rec) internal {
        uint256 r0 = blk.balanceOf(rec);
        uint256 a0 = blk.balanceOf(alice);
        uint256 b0 = blk.balanceOf(bob);

        // before the deadline and until the window opens: settle reverts (token), refund PotFullyFunded
        _settleFails(id);
        vm.warp(deadline);
        _settleFails(id);
        _refundBlockedUntilValve(id);
        vm.warp(_valveTime() - 1);
        _settleFails(id);
        _refundBlockedUntilValve(id);

        // the window opens: settle is closed for good, refund recovers each contributor's own share
        vm.warp(_valveTime());
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        bk.settle(id);

        vm.prank(alice);
        bk.refund(id);
        assertEq(blk.balanceOf(alice) - a0, 70e6);
        assertEq(bk.totalEscrowLiability(), 30e6);
        assertEq(blk.balanceOf(address(bk)), 30e6);

        vm.prank(bob);
        bk.refund(id);
        assertEq(blk.balanceOf(bob) - b0, 30e6);
        assertEq(bk.totalEscrowLiability(), 0);
        assertEq(blk.balanceOf(address(bk)), 0);

        assertEq(blk.balanceOf(rec), r0); // blocked recipient never got paid
        assertFalse(_bSettled(id));
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        bk.settle(id);
    }

    // ── recipient blocklisted from the start ──────────────────────────────────

    function test_blocklist_split_blockedBeforeFunding() public {
        blk.setBlocked(recipient, true);
        bytes32 id = _bSplit(SALT_A, recipient);
        _bFill(id);
        _runBlockedScenario(id, recipient);
    }

    function test_blocklist_open_blockedBeforeFunding() public {
        blk.setBlocked(recipient, true);
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFill(id);
        _runBlockedScenario(id, recipient);
    }

    // ── recipient blocklisted only after the pot was fully funded ─────────────

    function test_blocklist_split_blockedAfterFullyFunded() public {
        bytes32 id = _bSplit(SALT_A, recipient);
        _bFill(id);
        assertEq(bk.totalEscrowLiability(), GOAL);
        blk.setBlocked(recipient, true); // freeze happens late
        _runBlockedScenario(id, recipient);
    }

    function test_blocklist_open_blockedAfterFullyFunded() public {
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFill(id);
        blk.setBlocked(recipient, true);
        _runBlockedScenario(id, recipient);
    }

    function test_blocklist_blockedLateButAfterDeadline_stillRecoverable() public {
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFill(id);
        vm.warp(_valveTime() - 1);
        blk.setBlocked(recipient, true); // blocked at the last moment of the settle window
        _settleFails(id);
        vm.warp(_valveTime());
        vm.prank(bob);
        bk.refund(id);
        assertEq(bk.totalEscrowLiability(), 70e6);
    }

    // ── payment request (recipient == creator) ────────────────────────────────

    function test_blocklist_paymentRequest_open_recoverable() public {
        blk.setBlocked(creator, true);
        bytes32 id = _bOpen(SALT_A, creator);
        (address c, address r,,,,,,,,) = bk.getPot(id);
        assertEq(c, r);
        _bFill(id);
        _runBlockedScenario(id, creator);
    }

    function test_blocklist_paymentRequest_split_blockedAfterFunding() public {
        bytes32 id = _bSplit(SALT_A, creator);
        _bFill(id);
        blk.setBlocked(creator, true);
        _runBlockedScenario(id, creator);
    }

    // ── recoverable only because of the valve: unblock in time still settles ──

    function test_blocklist_unblockedBeforeWindow_settleSucceeds() public {
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFill(id);
        blk.setBlocked(recipient, true);
        _settleFails(id);
        blk.setBlocked(recipient, false);
        vm.warp(_valveTime() - 1);
        bk.settle(id);
        assertEq(blk.balanceOf(recipient), GOAL);
        assertEq(bk.totalEscrowLiability(), 0);
        vm.warp(_valveTime());
        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        bk.refund(id);
    }

    function test_blocklist_unblockedAfterWindow_settleStillClosed() public {
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFill(id);
        blk.setBlocked(recipient, true);
        vm.warp(_valveTime());
        blk.setBlocked(recipient, false);
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        bk.settle(id);
        vm.prank(alice);
        bk.refund(id);
        assertEq(bk.totalEscrowLiability(), 30e6);
    }

    // ── isolation ─────────────────────────────────────────────────────────────

    function test_blocklist_otherPotsWithDifferentRecipientUnaffected() public {
        blk.setBlocked(recipient, true);
        address other = makeAddr("other-recipient");
        bytes32 bad = _bOpen(SALT_A, recipient);
        bytes32 good = _bOpen(SALT_B, other);
        _bFill(bad);
        _bFill(good);
        assertEq(bk.totalEscrowLiability(), 2 * GOAL);

        bk.settle(good);
        assertEq(blk.balanceOf(other), GOAL);
        assertEq(bk.totalEscrowLiability(), GOAL);

        vm.warp(_valveTime());
        vm.prank(alice);
        bk.refund(bad);
        vm.prank(bob);
        bk.refund(bad);
        assertEq(bk.totalEscrowLiability(), 0);
        assertEq(blk.balanceOf(address(bk)), 0);
        assertEq(blk.balanceOf(other), GOAL); // good pot payout unchanged
    }

    /// A blocklisted CONTRIBUTOR's own refund reverts atomically; other contributors are unaffected.
    function test_blocklist_blockedContributorRefundRevertsOthersUnaffected() public {
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFill(id);
        blk.setBlocked(recipient, true);
        blk.setBlocked(alice, true);
        vm.warp(_valveTime());

        vm.prank(alice);
        vm.expectRevert(bytes(BLOCKED_MSG));
        bk.refund(id);
        (, uint256 contributed, bool refunded) = bk.getContribution(id, alice);
        assertEq(contributed, 70e6);
        assertFalse(refunded);
        assertEq(bk.totalEscrowLiability(), GOAL);

        uint256 b0 = blk.balanceOf(bob);
        vm.prank(bob);
        bk.refund(id);
        assertEq(blk.balanceOf(bob) - b0, 30e6);
        assertEq(bk.totalEscrowLiability(), 70e6);

        blk.setBlocked(alice, false);
        uint256 a0 = blk.balanceOf(alice);
        vm.prank(alice);
        bk.refund(id);
        assertEq(blk.balanceOf(alice) - a0, 70e6);
        assertEq(bk.totalEscrowLiability(), 0);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    /// With a blocklisted recipient, funds are always either blocked-by-token (before the window)
    /// or refundable (from the window); never both stuck and settled.
    function testFuzz_blocklist_fundsAlwaysRecoverableAfterWindow(uint256 offset, bool openMode) public {
        bytes32 id = openMode ? _bOpen(SALT_A, recipient) : _bSplit(SALT_A, recipient);
        _bFill(id);
        blk.setBlocked(recipient, true);
        uint256 t = uint256(deadline) + bound(offset, 0, 3 * bk.SETTLE_GRACE());
        vm.warp(t);

        if (t < _valveTime()) {
            vm.expectRevert(bytes(BLOCKED_MSG));
            bk.settle(id);
            vm.prank(alice);
            vm.expectRevert(Kitty.PotFullyFunded.selector);
            bk.refund(id);
        } else {
            vm.expectRevert(Kitty.SettleWindowClosed.selector);
            bk.settle(id);
            uint256 a0 = blk.balanceOf(alice);
            vm.prank(alice);
            bk.refund(id);
            assertEq(blk.balanceOf(alice) - a0, 70e6);
            vm.prank(bob);
            bk.refund(id);
            assertEq(bk.totalEscrowLiability(), 0);
            assertEq(blk.balanceOf(address(bk)), 0);
        }
    }
}
