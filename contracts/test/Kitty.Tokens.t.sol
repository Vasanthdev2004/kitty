// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Kitty} from "../Kitty.sol";
import {
    KittyTestBase,
    KittyFeeToken,
    KittyRevertToken,
    KittyFalseReturnToken,
    KittyFalseOutboundToken,
    KittyCallbackToken,
    KittyReentrancyAttacker
} from "./Kitty.Base.t.sol";

/// Misbehaving tokens, stray transfers, and callback-token reentrancy.
contract KittyTokensTest is KittyTestBase {
    KittyCallbackToken internal cb;
    Kitty internal ck;
    KittyReentrancyAttacker internal att;

    function setUp() public override {
        super.setUp();
        cb = new KittyCallbackToken();
        ck = new Kitty(address(cb));
        att = new KittyReentrancyAttacker(ck);
        cb.setTarget(att);
        att.approveToken(cb);
        cb.mint(address(att), 1_000e6);
        cb.mint(alice, 1_000e6);
        vm.prank(alice);
        cb.approve(address(ck), type(uint256).max);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _openOn(Kitty k, bytes32 salt, uint256 goal) internal returns (bytes32 id) {
        vm.prank(creator);
        id = k.createOpenPot(salt, recipient, goal, deadline, "tok", 0);
    }

    function _splitOneOn(Kitty k, bytes32 salt, address who, uint256 goal) internal returns (bytes32 id) {
        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = who; ss[0] = goal;
        vm.prank(creator);
        id = k.createSplitPot(salt, recipient, goal, deadline, "tok", cs, ss);
    }

    function _approveAndMint(address tok, address who, Kitty k) internal {
        KittyRevertToken(tok).mint(who, 1_000e6); // all helper tokens share mint(address,uint256)
        vm.prank(who);
        KittyRevertToken(tok).approve(address(k), type(uint256).max);
    }

    // ── reverting token: inbound ──────────────────────────────────────────────

    function test_fund_revertingTokenRejected_stateUntouched() public {
        KittyRevertToken rt = new KittyRevertToken();
        Kitty k = new Kitty(address(rt));
        bytes32 id = _openOn(k, SALT_A, GOAL);
        _approveAndMint(address(rt), alice, k);
        rt.setRevertTransferFrom(true);
        vm.prank(alice);
        vm.expectRevert(bytes("KittyRevertToken: transferFrom failed"));
        k.fund(id, GOAL);
        assertEq(k.totalEscrowLiability(), 0);
        (,,,,,,, uint256 funded,, uint256 count,) = k.getPot(id);
        assertEq(funded, 0);
        assertEq(count, 0);
    }

    function test_fund_falseReturnTokenRejected_stateUntouched() public {
        KittyFalseReturnToken ft = new KittyFalseReturnToken();
        Kitty k = new Kitty(address(ft));
        bytes32 id = _splitOneOn(k, SALT_A, alice, GOAL);
        ft.mint(alice, 1_000e6);
        vm.prank(alice);
        ft.approve(address(k), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(ft)));
        k.fund(id, GOAL);
        assertEq(k.totalEscrowLiability(), 0);
        (, uint256 contributed,) = k.getContribution(id, alice);
        assertEq(contributed, 0);
    }

    // ── fee-on-transfer ───────────────────────────────────────────────────────

    function test_fund_feeOnTransferReverts_open_stateUntouched() public {
        KittyFeeToken fee = new KittyFeeToken();
        Kitty k = new Kitty(address(fee));
        bytes32 id = _openOn(k, SALT_A, GOAL);
        fee.mint(alice, 1_000e6);
        vm.prank(alice);
        fee.approve(address(k), type(uint256).max);
        uint256 a0 = fee.balanceOf(alice);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.TokenTransferShort.selector, GOAL, GOAL - 1));
        k.fund(id, GOAL);

        assertEq(k.totalEscrowLiability(), 0);
        (,,,,,,, uint256 funded,, uint256 count,) = k.getPot(id);
        assertEq(funded, 0);
        assertEq(count, 0);
        assertEq(k.getContributors(id).length, 0);
        (, uint256 contributed,) = k.getContribution(id, alice);
        assertEq(contributed, 0);
        assertEq(fee.balanceOf(address(k)), 0);
        assertEq(fee.balanceOf(alice), a0);
    }

    function test_fund_feeOnTransferReverts_split_stateUntouched() public {
        KittyFeeToken fee = new KittyFeeToken();
        Kitty k = new Kitty(address(fee));
        bytes32 id = _splitOneOn(k, SALT_A, alice, GOAL);
        fee.mint(alice, 1_000e6);
        vm.prank(alice);
        fee.approve(address(k), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.TokenTransferShort.selector, 10e6, 10e6 - 1));
        k.fund(id, 10e6);
        assertEq(k.totalEscrowLiability(), 0);
        (, uint256 contributed,) = k.getContribution(id, alice);
        assertEq(contributed, 0);
        assertEq(fee.balanceOf(address(k)), 0);
    }

    // ── outbound failures roll back ───────────────────────────────────────────

    function test_settle_revertingTokenRollsBack_retrySucceeds() public {
        KittyRevertToken rt = new KittyRevertToken();
        Kitty k = new Kitty(address(rt));
        bytes32 id = _splitOneOn(k, SALT_A, alice, 50e6);
        _approveAndMint(address(rt), alice, k);
        vm.prank(alice);
        k.fund(id, 50e6);

        rt.setRevertTransfer(true);
        vm.expectRevert(bytes("KittyRevertToken: transfer failed"));
        k.settle(id);
        (,,,,,, bool settled,,,,) = k.getPot(id);
        assertFalse(settled);
        assertEq(k.totalEscrowLiability(), 50e6);
        assertEq(rt.balanceOf(recipient), 0);

        rt.setRevertTransfer(false);
        k.settle(id);
        assertEq(rt.balanceOf(recipient), 50e6);
        assertEq(k.totalEscrowLiability(), 0);
    }

    function test_settle_falseReturnRollsBack_retrySucceeds() public {
        KittyFalseOutboundToken ft = new KittyFalseOutboundToken();
        Kitty k = new Kitty(address(ft));
        bytes32 id = _openOn(k, SALT_A, 50e6);
        ft.mint(alice, 1_000e6);
        vm.prank(alice);
        ft.approve(address(k), type(uint256).max);
        vm.prank(alice);
        k.fund(id, 50e6);

        ft.setFalseOutbound(true);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(ft)));
        k.settle(id);
        (,,,,,, bool settled,,,,) = k.getPot(id);
        assertFalse(settled);
        assertEq(k.totalEscrowLiability(), 50e6);
        assertEq(ft.balanceOf(recipient), 0);

        ft.setFalseOutbound(false);
        k.settle(id);
        assertEq(ft.balanceOf(recipient), 50e6);
        assertEq(k.totalEscrowLiability(), 0);
    }

    function test_refund_revertingTokenRollsBack_retrySucceeds() public {
        KittyRevertToken rt = new KittyRevertToken();
        Kitty k = new Kitty(address(rt));
        bytes32 id = _openOn(k, SALT_A, GOAL);
        _approveAndMint(address(rt), alice, k);
        vm.prank(alice);
        k.fund(id, 50e6);
        vm.warp(deadline);

        rt.setRevertTransfer(true);
        uint256 a0 = rt.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(bytes("KittyRevertToken: transfer failed"));
        k.refund(id);
        (, , bool refunded) = k.getContribution(id, alice);
        assertFalse(refunded);
        assertEq(k.totalEscrowLiability(), 50e6);
        assertEq(rt.balanceOf(alice), a0);

        rt.setRevertTransfer(false);
        vm.prank(alice);
        k.refund(id);
        assertEq(rt.balanceOf(alice) - a0, 50e6);
        assertEq(k.totalEscrowLiability(), 0);
    }

    function test_refund_falseReturnRollsBack_retrySucceeds() public {
        KittyFalseOutboundToken ft = new KittyFalseOutboundToken();
        Kitty k = new Kitty(address(ft));
        bytes32 id = _splitOneOn(k, SALT_A, alice, GOAL);
        ft.mint(alice, 1_000e6);
        vm.prank(alice);
        ft.approve(address(k), type(uint256).max);
        vm.prank(alice);
        k.fund(id, 50e6);
        vm.warp(deadline);

        ft.setFalseOutbound(true);
        uint256 a0 = ft.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(ft)));
        k.refund(id);
        (, , bool refunded) = k.getContribution(id, alice);
        assertFalse(refunded);
        assertEq(k.totalEscrowLiability(), 50e6);
        assertEq(ft.balanceOf(alice), a0);

        ft.setFalseOutbound(false);
        vm.prank(alice);
        k.refund(id);
        assertEq(ft.balanceOf(alice) - a0, 50e6);
        assertEq(k.totalEscrowLiability(), 0);
    }

    // ── accidental transfers ──────────────────────────────────────────────────

    function test_strayTransfer_doesNotInflateLiabilityOrPayout() public {
        bytes32 id = _split3(SALT_A);
        vm.prank(alice);
        usdc.transfer(address(kitty), 1_000e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 1_000e6);

        _fullFundSplit3(id);
        assertEq(kitty.totalEscrowLiability(), GOAL);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL); // not GOAL + stray
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 1_000e6); // stray stays stuck
    }

    function test_strayTransfer_doesNotInflateRefund() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 10e6);
        vm.prank(bob);
        usdc.transfer(address(kitty), 500e6);
        vm.warp(deadline);
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(alice);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, 10e6);
        assertEq(usdc.balanceOf(address(kitty)), 500e6);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_strayTransfer_cannotSatisfyGoal() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.prank(alice);
        usdc.transfer(address(kitty), GOAL);
        assertEq(_totalFunded(id), 0);
        vm.expectRevert(Kitty.NotFullyFunded.selector);
        kitty.settle(id);
    }

    // ── reentrancy via callback token ─────────────────────────────────────────

    function _assertBlocked() internal view {
        assertTrue(att.attempted(), "nested call not attempted");
        assertTrue(att.reverted(), "nested call not blocked");
        assertFalse(att.succeeded(), "nested call succeeded");
        assertEq(
            bytes4(att.revertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "must revert with ReentrancyGuardReentrantCall"
        );
    }

    /// Outer refund by `att` with alice also funded; nested `a` attempted from the transfer hook.
    function _refundReentry(KittyReentrancyAttacker.Attack a) internal {
        bytes32 id = _openOn(ck, SALT_A, GOAL);
        att.fundPot(id, 60e6);
        vm.prank(alice);
        ck.fund(id, 10e6);
        vm.warp(deadline);

        att.configure(a, id, 1);
        cb.arm(true, false);
        uint256 b0 = cb.balanceOf(address(att));
        att.refundPot(id);

        _assertBlocked();
        assertEq(cb.balanceOf(address(att)) - b0, 60e6);
        (, uint256 contributed, bool refunded) = ck.getContribution(id, address(att));
        assertEq(contributed, 60e6);
        assertTrue(refunded);
        // alice's funds untouched and still refundable
        assertEq(ck.totalEscrowLiability(), 10e6);
        assertEq(cb.balanceOf(address(ck)), 10e6);
        uint256 a0 = cb.balanceOf(alice);
        vm.prank(alice);
        ck.refund(id);
        assertEq(cb.balanceOf(alice) - a0, 10e6);
        assertEq(ck.totalEscrowLiability(), 0);
    }

    function test_reentrancy_refund_nestedRefundBlocked() public {
        _refundReentry(KittyReentrancyAttacker.Attack.Refund);
    }

    function test_reentrancy_refund_nestedSettleBlocked() public {
        _refundReentry(KittyReentrancyAttacker.Attack.Settle);
    }

    function test_reentrancy_refund_nestedFundBlocked() public {
        _refundReentry(KittyReentrancyAttacker.Attack.Fund);
    }

    /// Outer settle (pot funded by `att`); nested `a` attempted from the transfer hook.
    function _settleReentry(KittyReentrancyAttacker.Attack a) internal {
        bytes32 id = _openOn(ck, SALT_A, 100e6);
        att.fundPot(id, 100e6);
        assertEq(ck.totalEscrowLiability(), 100e6);

        att.configure(a, id, 1);
        cb.arm(true, false);
        vm.prank(stranger);
        ck.settle(id);

        _assertBlocked();
        assertEq(cb.balanceOf(recipient), 100e6); // paid exactly once
        assertEq(ck.totalEscrowLiability(), 0);
        assertEq(cb.balanceOf(address(ck)), 0);
        assertTrue(_settledOn(ck, id));
        (, uint256 contributed, bool refunded) = ck.getContribution(id, address(att));
        assertEq(contributed, 100e6);
        assertFalse(refunded);
    }

    function _settledOn(Kitty k, bytes32 id) internal view returns (bool s) {
        (,,,,,, s,,,,) = k.getPot(id);
    }

    function test_reentrancy_settle_nestedSettleBlocked() public {
        _settleReentry(KittyReentrancyAttacker.Attack.Settle);
    }

    function test_reentrancy_settle_nestedFundBlocked() public {
        _settleReentry(KittyReentrancyAttacker.Attack.Fund);
    }

    function test_reentrancy_settle_nestedRefundBlocked() public {
        _settleReentry(KittyReentrancyAttacker.Attack.Refund);
    }

    /// Outer fund by `att` with a hook on the inbound transferFrom; nested `a` attempted mid-fund.
    function _fundReentry(KittyReentrancyAttacker.Attack a) internal {
        bytes32 id = _openOn(ck, SALT_A, 100e6);
        att.configure(a, id, 1);
        cb.arm(false, true);
        uint256 b0 = cb.balanceOf(address(att));
        att.fundPot(id, 40e6);

        _assertBlocked();
        (, uint256 contributed,) = ck.getContribution(id, address(att));
        assertEq(contributed, 40e6); // only the outer contribution recorded
        (,,,,,, bool settled, uint256 funded,, uint256 count,) = ck.getPot(id);
        assertFalse(settled);
        assertEq(funded, 40e6);
        assertEq(count, 1);
        assertEq(ck.totalEscrowLiability(), 40e6);
        assertEq(cb.balanceOf(address(ck)), 40e6);
        assertEq(b0 - cb.balanceOf(address(att)), 40e6);
    }

    function test_reentrancy_fund_nestedFundBlocked() public {
        _fundReentry(KittyReentrancyAttacker.Attack.Fund);
    }

    function test_reentrancy_fund_nestedSettleBlocked() public {
        _fundReentry(KittyReentrancyAttacker.Attack.Settle);
    }

    function test_reentrancy_fund_nestedRefundBlocked() public {
        _fundReentry(KittyReentrancyAttacker.Attack.Refund);
    }

    /// Control: a non-reentrant direct refund after completion reports AlreadyRefunded (not the guard),
    /// proving the guard selector asserted above is what blocked the nested call.
    function test_reentrancy_postCompletionDirectCallGivesAlreadyRefunded() public {
        _refundReentry(KittyReentrancyAttacker.Attack.Refund);
        bytes32 id = ck.computePotId(creator, SALT_A);
        vm.expectRevert(Kitty.AlreadyRefunded.selector);
        att.refundPot(id);
    }
}
