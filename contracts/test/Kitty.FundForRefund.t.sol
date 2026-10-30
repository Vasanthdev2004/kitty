// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase, KittyBlocklistToken} from "./Kitty.Base.t.sol";

/// Refunds after fundFor always go to the BENEFICIARY, never the payer; blocklist trapping is per beneficiary.
contract KittyFundForRefundTest is KittyTestBase {
    string internal constant BLOCKED_MSG = "KittyBlocklistToken: recipient blocklisted";

    KittyBlocklistToken internal blk;
    Kitty internal bk;

    function setUp() public override {
        super.setUp();
        blk = new KittyBlocklistToken();
        bk = new Kitty(address(blk));
        address[5] memory us = [alice, bob, carol, dave, stranger];
        for (uint256 i = 0; i < us.length; i++) {
            blk.mint(us[i], 1_000_000e6);
            vm.prank(us[i]);
            blk.approve(address(bk), type(uint256).max);
        }
    }

    function _bOpen(bytes32 salt, address rec) internal returns (bytes32 id) {
        vm.prank(creator);
        id = bk.createOpenPot(salt, rec, GOAL, deadline, "blk", 0);
    }

    function _bFundFor(bytes32 id, address p, address ben, uint256 amt) internal {
        vm.prank(p);
        bk.fundFor(id, ben, amt);
    }

    // ── refund goes to the beneficiary ────────────────────────────────────────

    function test_refund_split_paysBeneficiaryNothingToPayer() public {
        bytes32 id = _split3(SALT_A);
        _fundFor(id, stranger, bob, 25e6);
        _fundFor(id, stranger, alice, 30e6);
        uint256 s0 = usdc.balanceOf(stranger);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        vm.warp(deadline);

        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);

        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, 25e6);
        assertEq(usdc.balanceOf(stranger), s0, "payer got nothing");
        assertEq(kitty.totalEscrowLiability(), 30e6);

        vm.prank(alice);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 30e6);
        assertEq(usdc.balanceOf(stranger), s0);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
    }

    function test_refund_open_payerOwnAndForOthers_eachGetsOwn() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, dave, 10e6);
        _fundFor(id, dave, alice, 20e6);
        _fundFor(id, dave, bob, 5e6);
        vm.warp(deadline);

        uint256 d0 = usdc.balanceOf(dave);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(dave);
        kitty.refund(id);
        assertEq(usdc.balanceOf(dave) - d0, 10e6, "payer refunded only own contribution");
        vm.prank(alice);
        kitty.refund(id);
        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 20e6);
        assertEq(usdc.balanceOf(bob) - b0, 5e6);
        assertEq(usdc.balanceOf(dave) - d0, 10e6);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_refund_doubleClaimByBeneficiary_reverts() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fundFor(id, stranger, bob, 10e6);
        vm.warp(deadline);
        vm.prank(bob);
        kitty.refund(id);
        vm.prank(bob);
        vm.expectRevert(Kitty.AlreadyRefunded.selector);
        kitty.refund(id);
        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_refund_beneficiaryBeforeDeadline_reverts() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fundFor(id, stranger, bob, 10e6);
        vm.prank(bob);
        vm.expectRevert(Kitty.DeadlineNotReached.selector);
        kitty.refund(id);
    }

    function test_refund_payerCannotRefundEvenIfBeneficiaryAlreadyClaimed() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fundFor(id, stranger, bob, 10e6);
        vm.warp(deadline);
        vm.prank(bob);
        kitty.refund(id);
        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
    }

    function test_fundForCompletesPot_settleOnly_thenNoRefund() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fundFor(id, stranger, alice, 60e6);
        _fundFor(id, stranger, bob, 40e6);
        vm.prank(alice);
        vm.expectRevert(Kitty.DeadlineNotReached.selector);
        kitty.refund(id);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(Kitty.PotFullyFunded.selector);
        kitty.refund(id);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
        vm.prank(alice);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.refund(id);
    }

    function test_valveRefund_afterFundFor_paysBeneficiaries() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fundFor(id, stranger, alice, 60e6);
        _fundFor(id, stranger, bob, 40e6);
        vm.warp(_valveTime());
        vm.expectRevert(Kitty.SettleWindowClosed.selector);
        kitty.settle(id);
        uint256 s0 = usdc.balanceOf(stranger);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);
        vm.prank(alice);
        kitty.refund(id);
        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 60e6);
        assertEq(usdc.balanceOf(bob) - b0, 40e6);
        assertEq(usdc.balanceOf(stranger), s0);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    // ── blocklisted beneficiary traps only that beneficiary ───────────────────

    function test_blocklist_creditedBeneficiaryBlockedBeforeFunding_onlyHeIsTrapped() public {
        blk.setBlocked(alice, true); // paying FOR a blocked address is allowed: the transfer goes to Kitty
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFundFor(id, stranger, alice, 30e6);
        _bFundFor(id, stranger, bob, 20e6);
        _bFundFor(id, stranger, carol, 10e6);
        vm.warp(deadline);
        assertEq(bk.totalEscrowLiability(), 60e6);

        vm.prank(alice);
        vm.expectRevert(bytes(BLOCKED_MSG));
        bk.refund(id);
        (, uint256 ca, bool ra) = bk.getContribution(id, alice);
        assertEq(ca, 30e6);
        assertFalse(ra, "failed refund rolled back");
        assertEq(bk.totalEscrowLiability(), 60e6);

        uint256 b0 = blk.balanceOf(bob);
        uint256 c0 = blk.balanceOf(carol);
        uint256 s0 = blk.balanceOf(stranger);
        vm.prank(bob);
        bk.refund(id);
        vm.prank(carol);
        bk.refund(id);
        assertEq(blk.balanceOf(bob) - b0, 20e6);
        assertEq(blk.balanceOf(carol) - c0, 10e6);
        assertEq(bk.totalEscrowLiability(), 30e6, "only the blocked beneficiary's share remains");
        assertEq(blk.balanceOf(address(bk)), 30e6);

        // payer cannot claim the trapped share
        vm.prank(stranger);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        bk.refund(id);
        assertEq(blk.balanceOf(stranger), s0);

        // once the issuer unblocks, the beneficiary recovers it
        blk.setBlocked(alice, false);
        uint256 a0 = blk.balanceOf(alice);
        vm.prank(alice);
        bk.refund(id);
        assertEq(blk.balanceOf(alice) - a0, 30e6);
        assertEq(bk.totalEscrowLiability(), 0);
    }

    function test_blocklist_beneficiaryBlockedAfterFunding_othersStillRefund() public {
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFundFor(id, stranger, alice, 15e6);
        _bFundFor(id, dave, bob, 25e6);
        blk.setBlocked(alice, true);
        vm.warp(deadline);

        vm.prank(alice);
        vm.expectRevert(bytes(BLOCKED_MSG));
        bk.refund(id);
        uint256 b0 = blk.balanceOf(bob);
        vm.prank(bob);
        bk.refund(id);
        assertEq(blk.balanceOf(bob) - b0, 25e6);
        assertEq(bk.totalEscrowLiability(), 15e6);
    }

    function test_blocklist_blockedPayerCanStillFundForOthers() public {
        blk.setBlocked(stranger, true); // blocklist only restricts transfers TO the blocked address
        bytes32 id = _bOpen(SALT_A, recipient);
        _bFundFor(id, stranger, bob, 10e6);
        assertEq(bk.totalEscrowLiability(), 10e6);
        vm.warp(deadline);
        vm.prank(bob);
        bk.refund(id);
        assertEq(bk.totalEscrowLiability(), 0);
    }
}
