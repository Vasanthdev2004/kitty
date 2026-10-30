// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {Kitty} from "../Kitty.sol";
import {KittyMockUSDC} from "./Kitty.Base.t.sol";
import {KittyPermitTestBase} from "./Kitty.PermitBase.t.sol";

/// fundWithPermit / fundForWithPermit on a real EIP-2612 mock token.
contract KittyPermitTest is KittyPermitTestBase {
    function _garbage() internal pure returns (uint8, bytes32, bytes32) {
        return (27, bytes32(uint256(1)), bytes32(uint256(2)));
    }

    function _noAllowanceRevert(uint256 have, uint256 need) internal {
        vm.expectRevert(abi.encodeWithSelector(Kitty.InsufficientAllowanceAfterPermit.selector, have, need));
    }

    function _hasTopic(Vm.Log[] memory logs, bytes32 topic0) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; i++) if (logs[i].topics[0] == topic0) n++;
    }

    // ── happy paths ───────────────────────────────────────────────────────────

    function test_fundWithPermit_split_singleCallNoPriorApproval() public {
        bytes32 id = _pSplit(SALT_A);
        assertEq(pt.allowance(payer, address(pk)), 0);
        (uint8 v, bytes32 r, bytes32 s) = _sig(60e6);
        uint256 b0 = pt.balanceOf(payer);

        vm.expectEmit(true, true, false, true, address(pk));
        emit Kitty.Funded(id, payer, 60e6, 60e6);
        vm.prank(payer);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);

        assertEq(pt.allowance(payer, address(pk)), 0, "allowance consumed");
        assertEq(pt.nonces(payer), 1);
        assertEq(b0 - pt.balanceOf(payer), 60e6);
        assertEq(pt.balanceOf(address(pk)), 60e6);
        assertEq(pk.totalEscrowLiability(), 60e6);
        assertEq(_pContributed(id, payer), 60e6);
        assertEq(_pTotal(id), 60e6);
    }

    function test_fundWithPermit_open_singleCall() public {
        bytes32 id = _pOpen(SALT_A, 0);
        (uint8 v, bytes32 r, bytes32 s) = _sig(40e6);
        vm.prank(payer);
        pk.fundWithPermit(id, 40e6, PDL, v, r, s);
        assertEq(_pContributed(id, payer), 40e6);
        assertEq(pt.allowance(payer, address(pk)), 0);
        (,,,,,,,,, uint256 count,) = pk.getPot(id);
        assertEq(count, 1);
    }

    function test_fundWithPermit_completesPotThenSettles() public {
        bytes32 id = _pOpen(SALT_A, 0);
        (uint8 v, bytes32 r, bytes32 s) = _sig(GOAL);
        vm.prank(payer);
        pk.fundWithPermit(id, GOAL, PDL, v, r, s);
        pk.settle(id);
        assertEq(pt.balanceOf(recipient), GOAL);
        assertEq(pk.totalEscrowLiability(), 0);
    }

    function test_fundForWithPermit_payerSigns_beneficiaryCredited() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(25e6);
        uint256 p0 = pt.balanceOf(payer);
        uint256 b0 = pt.balanceOf(bob);

        vm.expectEmit(true, true, false, true, address(pk));
        emit Kitty.Funded(id, bob, 25e6, 25e6);
        vm.expectEmit(true, true, true, true, address(pk));
        emit Kitty.FundedFor(id, payer, bob, 25e6);
        vm.prank(payer);
        pk.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);

        assertEq(p0 - pt.balanceOf(payer), 25e6, "payer paid");
        assertEq(pt.balanceOf(bob), b0, "beneficiary paid nothing");
        assertEq(_pContributed(id, bob), 25e6);
        assertEq(_pContributed(id, payer), 0, "payer not credited");
        assertEq(pt.allowance(payer, address(pk)), 0);
        assertEq(pk.totalEscrowLiability(), 25e6);
    }

    function test_fundForWithPermit_payerEqualsBeneficiary() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(10e6);
        vm.expectEmit(true, true, true, true, address(pk));
        emit Kitty.FundedFor(id, payer, payer, 10e6);
        vm.prank(payer);
        pk.fundForWithPermit(id, payer, 10e6, PDL, v, r, s);
        assertEq(_pContributed(id, payer), 10e6);
    }

    function test_fundForWithPermit_openPot_floorAppliesToBeneficiary() public {
        bytes32 id = _pOpen(SALT_A, 0);
        uint256 floorAmt = pk.effectiveMinContribution(id);
        (uint8 v, bytes32 r, bytes32 s) = _sig(floorAmt - 1);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, floorAmt - 1, floorAmt));
        pk.fundForWithPermit(id, dave, floorAmt - 1, PDL, v, r, s);

        (v, r, s) = _sig(floorAmt);
        vm.prank(payer);
        pk.fundForWithPermit(id, dave, floorAmt, PDL, v, r, s);
        assertEq(_pContributed(id, dave), floorAmt);
    }

    function test_refundAfterFundForWithPermit_paysBeneficiaryNotPayer() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(25e6);
        vm.prank(payer);
        pk.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);
        vm.warp(deadline);

        uint256 p0 = pt.balanceOf(payer);
        uint256 b0 = pt.balanceOf(bob);
        vm.prank(payer);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        pk.refund(id);
        vm.prank(bob);
        pk.refund(id);
        assertEq(pt.balanceOf(bob) - b0, 25e6);
        assertEq(pt.balanceOf(payer), p0);
        assertEq(pk.totalEscrowLiability(), 0);
    }

    // ── FundedFor emission rules ──────────────────────────────────────────────

    function test_fundAndFundWithPermit_neverEmitFundedFor() public {
        bytes32 id = _pSplit(SALT_A);
        bytes32 fundedFor = Kitty.FundedFor.selector;
        bytes32 funded = Kitty.Funded.selector;

        vm.prank(payer);
        pt.approve(address(pk), 10e6);
        vm.recordLogs();
        vm.prank(payer);
        pk.fund(id, 10e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_hasTopic(logs, funded), 1);
        assertEq(_hasTopic(logs, fundedFor), 0, "fund() emitted FundedFor");

        (uint8 v, bytes32 r, bytes32 s) = _sig(10e6);
        vm.recordLogs();
        vm.prank(payer);
        pk.fundWithPermit(id, 10e6, PDL, v, r, s);
        logs = vm.getRecordedLogs();
        assertEq(_hasTopic(logs, funded), 1);
        assertEq(_hasTopic(logs, fundedFor), 0, "fundWithPermit emitted FundedFor");

        (v, r, s) = _sig(5e6);
        vm.recordLogs();
        vm.prank(payer);
        pk.fundForWithPermit(id, bob, 5e6, PDL, v, r, s);
        logs = vm.getRecordedLogs();
        assertEq(_hasTopic(logs, funded), 1);
        assertEq(_hasTopic(logs, fundedFor), 1);
    }

    // ── permit front-run / invalid / expired / wrong signer ───────────────────

    function test_frontRun_permitConsumedByOthers_stillFunds() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(60e6);

        vm.prank(stranger); // a mempool watcher submits the very same permit first
        pt.permit(payer, address(pk), 60e6, PDL, v, r, s);
        assertEq(pt.nonces(payer), 1);
        assertEq(pt.allowance(payer, address(pk)), 60e6);

        vm.prank(payer);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s); // permit now reverts; allowance covers it
        assertEq(_pContributed(id, payer), 60e6);
        assertEq(pt.nonces(payer), 1, "nonce not double-spent");
        assertEq(pt.allowance(payer, address(pk)), 0);
        assertEq(pk.totalEscrowLiability(), 60e6);
    }

    function test_frontRun_fundForWithPermit_stillFunds() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(25e6);
        vm.prank(stranger);
        pt.permit(payer, address(pk), 25e6, PDL, v, r, s);
        vm.prank(payer);
        pk.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);
        assertEq(_pContributed(id, bob), 25e6);
    }

    function test_replaySameSignature_secondCallRevertsNoAllowance() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(30e6);
        vm.prank(payer);
        pk.fundWithPermit(id, 30e6, PDL, v, r, s);
        vm.prank(payer);
        _noAllowanceRevert(0, 30e6);
        pk.fundWithPermit(id, 30e6, PDL, v, r, s);
        assertEq(_pContributed(id, payer), 30e6);
    }

    function test_invalidSignature_noAllowance_reverts() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _garbage();
        vm.prank(payer);
        _noAllowanceRevert(0, 60e6);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
        assertEq(_pTotal(id), 0);
        assertEq(pk.totalEscrowLiability(), 0);

        vm.prank(payer);
        _noAllowanceRevert(0, 25e6);
        pk.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);
    }

    function test_invalidSignature_butSufficientAllowance_funds() public {
        bytes32 id = _pSplit(SALT_A);
        vm.prank(payer);
        pt.approve(address(pk), 100e6);
        (uint8 v, bytes32 r, bytes32 s) = _garbage();
        vm.prank(payer);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
        assertEq(_pContributed(id, payer), 60e6);
        assertEq(pt.allowance(payer, address(pk)), 40e6, "pre-existing allowance spent, not reset");
        assertEq(pt.nonces(payer), 0);
    }

    function test_partialAllowance_isNotEnough() public {
        bytes32 id = _pSplit(SALT_A);
        vm.prank(payer);
        pt.approve(address(pk), 60e6 - 1);
        (uint8 v, bytes32 r, bytes32 s) = _garbage();
        vm.prank(payer);
        _noAllowanceRevert(60e6 - 1, 60e6);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
    }

    function test_expiredPermit_noAllowance_reverts_withAllowance_funds() public {
        bytes32 id = _pSplit(SALT_A);
        uint256 dl = block.timestamp + 10 minutes;
        (uint8 v, bytes32 r, bytes32 s) = _signOn(pt, payerKey, payer, address(pk), 60e6, dl);
        skip(11 minutes); // permit expired; pot (1 day) still open

        vm.prank(payer);
        _noAllowanceRevert(0, 60e6);
        pk.fundWithPermit(id, 60e6, dl, v, r, s);

        vm.prank(payer);
        pt.approve(address(pk), 60e6);
        vm.prank(payer);
        pk.fundWithPermit(id, 60e6, dl, v, r, s);
        assertEq(_pContributed(id, payer), 60e6);
    }

    function test_expiredPermit_fundForWithPermit_sameHandling() public {
        bytes32 id = _pSplit(SALT_A);
        uint256 dl = block.timestamp + 1;
        (uint8 v, bytes32 r, bytes32 s) = _signOn(pt, payerKey, payer, address(pk), 25e6, dl);
        skip(2);
        vm.prank(payer);
        _noAllowanceRevert(0, 25e6);
        pk.fundForWithPermit(id, bob, 25e6, dl, v, r, s);
    }

    function test_wrongSigner_noAllowance_reverts_withAllowance_funds() public {
        bytes32 id = _pSplit(SALT_A);
        (, uint256 malloryKey) = makeAddrAndKey("mallory");
        (uint8 v, bytes32 r, bytes32 s) = _signOn(pt, malloryKey, payer, address(pk), 60e6, PDL);
        vm.prank(payer);
        _noAllowanceRevert(0, 60e6);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);

        vm.prank(payer);
        pt.approve(address(pk), 60e6);
        vm.prank(payer);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
        assertEq(_pContributed(id, payer), 60e6);
    }

    function test_permitSignedForOtherAmountOrSpender_doesNotAuthorize() public {
        bytes32 id = _pSplit(SALT_A);
        // signed for 59e6 but pot call asks 60e6
        (uint8 v, bytes32 r, bytes32 s) = _sig(59e6);
        vm.prank(payer);
        _noAllowanceRevert(0, 60e6);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
        // signed for a different spender
        (v, r, s) = _signOn(pt, payerKey, payer, stranger, 60e6, PDL);
        vm.prank(payer);
        _noAllowanceRevert(0, 60e6);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
        // a different payer cannot use the payer's signature
        vm.prank(alice);
        _noAllowanceRevert(0, 60e6);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
    }

    function test_permitNonceIncrementsPerUse() public {
        bytes32 id = _pSplit(SALT_A);
        for (uint256 i = 0; i < 3; i++) {
            assertEq(pt.nonces(payer), i);
            (uint8 v, bytes32 r, bytes32 s) = _sig(20e6);
            vm.prank(payer);
            pk.fundWithPermit(id, 20e6, PDL, v, r, s);
        }
        assertEq(pt.nonces(payer), 3);
        assertEq(_pContributed(id, payer), 60e6);
    }

    // ── permit on missing / cancelled pots never touches the token ────────────

    function test_permitOnCancelledPot_revertsBeforeToken() public {
        bytes32 id = _pSplit(SALT_A);
        _pCancel(id);
        (uint8 v, bytes32 r, bytes32 s) = _sig(60e6);
        vm.prank(payer);
        vm.expectRevert(Kitty.PotCancelled.selector);
        pk.fundWithPermit(id, 60e6, PDL, v, r, s);
        vm.prank(payer);
        vm.expectRevert(Kitty.PotCancelled.selector);
        pk.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);
        assertEq(pt.nonces(payer), 0, "permit must not run");
        assertEq(pt.allowance(payer, address(pk)), 0);
    }

    function test_permitOnUnknownPot_revertsBeforeToken() public {
        bytes32 ghost = keccak256("ghost");
        (uint8 v, bytes32 r, bytes32 s) = _sig(10e6);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotNotFound.selector, ghost));
        pk.fundWithPermit(ghost, 10e6, PDL, v, r, s);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotNotFound.selector, ghost));
        pk.fundForWithPermit(ghost, bob, 10e6, PDL, v, r, s);
        assertEq(pt.nonces(payer), 0);
        assertEq(pt.allowance(payer, address(pk)), 0);
    }
}
