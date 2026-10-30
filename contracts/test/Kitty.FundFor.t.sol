// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {Kitty} from "../Kitty.sol";
import {KittyTestBase, KittyFeeToken} from "./Kitty.Base.t.sol";

/// fundFor: the payer pays, the beneficiary is credited. All funding rules apply to the beneficiary.
contract KittyFundForTest is KittyTestBase {
    // ── Split pots ────────────────────────────────────────────────────────────

    function test_fundFor_split_withinShare_creditsBeneficiary() public {
        bytes32 id = _split3(SALT_A);
        uint256 p0 = usdc.balanceOf(stranger);
        uint256 b0 = usdc.balanceOf(bob);

        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Funded(id, bob, 20e6, 20e6);
        vm.expectEmit(true, true, true, true, address(kitty));
        emit Kitty.FundedFor(id, stranger, bob, 20e6);
        _fundFor(id, stranger, bob, 20e6);

        assertEq(p0 - usdc.balanceOf(stranger), 20e6, "payer paid");
        assertEq(usdc.balanceOf(bob), b0, "beneficiary paid nothing");
        assertEq(_contributed(id, bob), 20e6);
        assertEq(_contributed(id, stranger), 0);
        assertEq(_totalFunded(id), 20e6);
        assertEq(usdc.balanceOf(address(kitty)), 20e6);
        assertEq(kitty.totalEscrowLiability(), 20e6);
        assertEq(_count(id), 3, "split contributor list is fixed");
    }

    function test_fundFor_emitsFundedThenFundedFor_inThatOrder() public {
        bytes32 id = _split3(SALT_A);
        vm.recordLogs();
        _fundFor(id, stranger, bob, 5e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 iFunded = type(uint256).max;
        uint256 iFor = type(uint256).max;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == Kitty.Funded.selector) iFunded = i;
            if (logs[i].topics[0] == Kitty.FundedFor.selector) iFor = i;
        }
        assertTrue(iFunded < iFor, "Funded must precede FundedFor");
        // Funded.contributor (topic 2) is the beneficiary, FundedFor payer/beneficiary are topics 2/3
        assertEq(address(uint160(uint256(logs[iFunded].topics[2]))), bob);
        assertEq(address(uint160(uint256(logs[iFor].topics[2]))), stranger);
        assertEq(address(uint160(uint256(logs[iFor].topics[3]))), bob);
    }

    function test_fund_neverEmitsFundedFor() public {
        bytes32 id = _split3(SALT_A);
        vm.recordLogs();
        _fund(id, alice, 10e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_topicCount(logs, Kitty.Funded.selector), 1);
        assertEq(_topicCount(logs, Kitty.FundedFor.selector), 0);
    }

    function test_fundFor_payerEqualsBeneficiary_behavesLikeFundButEmitsFundedFor() public {
        bytes32 id = _split3(SALT_A);
        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Funded(id, alice, 10e6, 10e6);
        vm.expectEmit(true, true, true, true, address(kitty));
        emit Kitty.FundedFor(id, alice, alice, 10e6);
        _fundFor(id, alice, alice, 10e6);
        assertEq(_contributed(id, alice), 10e6);
        assertEq(kitty.totalEscrowLiability(), 10e6);
    }

    function test_fundFor_split_exceedsShare() public {
        bytes32 id = _split3(SALT_A);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, 25e6 + 1, 25e6));
        kitty.fundFor(id, bob, 25e6 + 1);

        // cumulative across payers
        _fundFor(id, stranger, bob, 20e6);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, 26e6, 25e6));
        kitty.fundFor(id, bob, 6e6);
        _fundFor(id, dave, bob, 5e6); // exactly to the share is fine
        assertEq(_contributed(id, bob), 25e6);
    }

    function test_fundFor_split_nonContributorBeneficiary() public {
        bytes32 id = _split3(SALT_A);
        vm.prank(alice); // even a contributor paying for an outsider
        vm.expectRevert(Kitty.NotAContributor.selector);
        kitty.fundFor(id, dave, 1e6);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(_contributed(id, dave), 0);
    }

    function test_fundFor_invalidBeneficiaries_splitAndOpen() public {
        bytes32 s = _split3(SALT_A);
        bytes32 o = _open(SALT_B, GOAL, 0);
        address[3] memory bad = [address(0), address(kitty), address(usdc)];
        for (uint256 i = 0; i < bad.length; i++) {
            vm.prank(alice);
            vm.expectRevert(Kitty.InvalidBeneficiary.selector);
            kitty.fundFor(s, bad[i], 10e6);
            vm.prank(alice);
            vm.expectRevert(Kitty.InvalidBeneficiary.selector);
            kitty.fundFor(o, bad[i], 10e6);
        }
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_fundFor_beneficiaryCheckPrecedesAmountChecks() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.prank(alice);
        vm.expectRevert(Kitty.InvalidBeneficiary.selector);
        kitty.fundFor(id, address(0), 0);
        vm.prank(alice);
        vm.expectRevert(Kitty.ZeroAmount.selector);
        kitty.fundFor(id, bob, 0);
    }

    function test_fundFor_partialThenBeneficiaryTopsUpHimself() public {
        bytes32 id = _split3(SALT_A);
        _fundFor(id, stranger, bob, 10e6);
        _fund(id, bob, 15e6);
        assertEq(_contributed(id, bob), 25e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, 25e6 + 1, 25e6));
        kitty.fund(id, 1);
        assertEq(_totalFunded(id), 25e6);
    }

    function test_fundFor_namedContributorCanStillFundSelfAfterSomeonePaidPart() public {
        bytes32 id = _split3(SALT_A);
        _fundFor(id, dave, alice, 20e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, 61e6, 60e6));
        kitty.fund(id, 41e6);
        _fund(id, alice, 40e6);
        assertEq(_contributed(id, alice), 60e6);
        _fund(id, bob, 25e6);
        _fundFor(id, alice, carol, 15e6); // alice (already full) pays carol's share
        assertEq(_totalFunded(id), GOAL);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_fundFor_payerIsContributorButNotCreditedForOthersShare() public {
        bytes32 id = _split3(SALT_A);
        _fundFor(id, alice, bob, 25e6);
        assertEq(_contributed(id, alice), 0);
        assertEq(_contributed(id, bob), 25e6);
        _fund(id, alice, 60e6); // alice's own full share is unaffected
        assertEq(_contributed(id, alice), 60e6);
    }

    function test_fundFor_fullPot_viaOnePayer_thenSettle() public {
        bytes32 id = _split3(SALT_A);
        _fundFor(id, stranger, alice, 60e6);
        _fundFor(id, stranger, bob, 25e6);
        _fundFor(id, stranger, carol, 15e6);
        assertEq(_totalFunded(id), GOAL);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    // ── pot state gating ──────────────────────────────────────────────────────

    function test_fundFor_unknownPot() public {
        bytes32 ghost = keccak256("ghost");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotNotFound.selector, ghost));
        kitty.fundFor(ghost, bob, 1e6);
    }

    function test_fundFor_afterDeadline_reverts() public {
        bytes32 id = _split3(SALT_A);
        vm.warp(deadline);
        vm.prank(stranger);
        vm.expectRevert(Kitty.DeadlinePassed.selector);
        kitty.fundFor(id, bob, 1e6);
    }

    function test_fundFor_lastSecondBeforeDeadline_works() public {
        bytes32 id = _split3(SALT_A);
        vm.warp(deadline - 1);
        _fundFor(id, stranger, bob, 1e6);
        assertEq(_contributed(id, bob), 1e6);
    }

    function test_fundFor_settledPot_exceedsGoalZeroRemaining() public {
        bytes32 id = _fullOpen(SALT_A);
        kitty.settle(id);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 1, 0));
        kitty.fundFor(id, alice, 1);
    }

    function test_fundFor_exceedsGoal_checkedBeforeShareAndFloor() public {
        bytes32 id = _open(SALT_A, 1000, 500);
        _fund(id, alice, 600);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 450, 400));
        kitty.fundFor(id, bob, 450);
    }

    // ── Open pots: floor and slots apply to the BENEFICIARY ───────────────────

    function test_fundFor_open_firstTimeBeneficiary_belowFloorReverts() public {
        bytes32 id = _open(SALT_A, 1000, 0); // floor 4
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 3, 4));
        kitty.fundFor(id, bob, 3);
        assertEq(_count(id), 0);
        _fundFor(id, stranger, bob, 4);
        assertEq(_count(id), 1);
        assertEq(_contributed(id, bob), 4);
    }

    function test_fundFor_open_creatorMinimumAppliesToFirstTimeBeneficiary() public {
        bytes32 id = _open(SALT_A, GOAL, 30e6);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 29e6, 30e6));
        kitty.fundFor(id, bob, 29e6);
        _fundFor(id, stranger, bob, 30e6);
    }

    function test_fundFor_open_completingExceptionWaivesFloor() public {
        bytes32 id = _open(SALT_A, 1000, 0); // floor 4
        _fundFor(id, stranger, alice, 998);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 1, 4));
        kitty.fundFor(id, bob, 1); // remaining 2, not completing
        _fundFor(id, stranger, bob, 2); // completing
        assertEq(_totalFunded(id), 1000);
        assertEq(_contributed(id, bob), 2);
        assertEq(_count(id), 2);
    }

    function test_fundFor_open_repeatBeneficiaryMayAddAnyAmount() public {
        bytes32 id = _open(SALT_A, GOAL, 30e6);
        _fundFor(id, stranger, bob, 30e6);
        _fundFor(id, dave, bob, 1);
        _fund(id, bob, 7);
        assertEq(_contributed(id, bob), 30e6 + 1 + 7);
        assertEq(_count(id), 1);
    }

    function test_fundFor_open_floorIsOnBeneficiaryNotPayer() public {
        bytes32 id = _open(SALT_A, 1000, 0); // floor 4
        _fund(id, alice, 100); // alice is listed (repeat funder)
        // a listed PAYER does not waive the floor for a first-time beneficiary
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 1, 4));
        kitty.fundFor(id, bob, 1);
        // an unlisted PAYER paying a tiny amount for a listed beneficiary is fine, and stays unlisted
        _fundFor(id, dave, alice, 1);
        assertEq(_contributed(id, alice), 101);
        assertEq(_contributed(id, dave), 0);
        assertEq(_count(id), 1);
        address[] memory cs = kitty.getContributors(id);
        assertEq(cs.length, 1);
        assertEq(cs[0], alice);
    }

    function test_fundFor_open_listsBeneficiaryNotPayer() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fundFor(id, stranger, bob, 10e6);
        _fundFor(id, stranger, carol, 10e6);
        address[] memory cs = kitty.getContributors(id);
        assertEq(cs.length, 2);
        assertEq(cs[0], bob);
        assertEq(cs[1], carol);
    }

    /// 256 distinct first-time BENEFICIARIES, each credited exactly the floor by one payer, complete the pot;
    /// the 257th only reaches ExceedsGoal (the slot cap is unreachable via the floor, as for plain fund()).
    function test_fundFor_open_256FloorBeneficiariesCompleteExactly() public {
        bytes32 id = _open(SALT_A, 2560, 0); // floor 10
        uint256 p0 = usdc.balanceOf(stranger);
        for (uint256 i = 0; i < 256; i++) {
            address ben = address(uint160(0x20000 + i));
            _fundFor(id, stranger, ben, 10);
        }
        assertEq(_count(id), 256);
        assertEq(_totalFunded(id), 2560);
        assertEq(p0 - usdc.balanceOf(stranger), 2560);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 1, 0));
        kitty.fundFor(id, address(uint160(0x30000)), 1);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), 2560);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_fundFor_open_255FloorBeneficiariesPlusCompletingRemainder() public {
        bytes32 id = _open(SALT_A, 2559, 0); // floor ceil(2559/256) = 10
        for (uint256 i = 0; i < 255; i++) _fundFor(id, stranger, address(uint160(0x20000 + i)), 10);
        assertEq(_totalFunded(id), 2550);
        address last = address(uint160(0x20000 + 255));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 8, 10));
        kitty.fundFor(id, last, 8); // remaining 9: 8 is neither floor nor completing
        _fundFor(id, stranger, last, 9); // completing remainder below the floor
        assertEq(_count(id), 256);
        assertEq(_totalFunded(id), 2559);
    }

    // ── create-time contributor validation (v2) ──────────────────────────────

    function _one(address c) internal returns (bytes32) {
        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = c; ss[0] = GOAL;
        vm.prank(creator);
        return kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "x", cs, ss);
    }

    function test_createSplit_rejectsThisAndTokenAndZeroContributors() public {
        _oneRevert(address(kitty));
        _oneRevert(address(usdc));
        _oneRevert(address(0));
        // a normal address is fine
        bytes32 id = _one(alice);
        assertEq(_count(id), 1);
    }

    function test_createSplit_rejectsKittyAsOneOfManyContributors() public {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 50e6;
        cs[1] = address(kitty); ss[1] = 50e6;
        vm.prank(creator);
        vm.expectRevert(Kitty.InvalidContributor.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "x", cs, ss);
        cs[1] = address(usdc);
        vm.prank(creator);
        vm.expectRevert(Kitty.InvalidContributor.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "x", cs, ss);
    }

    function _oneRevert(address c) internal {
        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = c; ss[0] = GOAL;
        vm.prank(creator);
        vm.expectRevert(Kitty.InvalidContributor.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "x", cs, ss);
    }

    // ── fee-on-transfer ───────────────────────────────────────────────────────

    function test_fundFor_feeOnTransferToken_revertsTokenTransferShort() public {
        KittyFeeToken fee = new KittyFeeToken();
        Kitty fk = new Kitty(address(fee));
        fee.mint(stranger, 1_000e6);
        vm.prank(stranger);
        fee.approve(address(fk), type(uint256).max);
        vm.prank(creator);
        bytes32 id = fk.createOpenPot(SALT_A, recipient, GOAL, deadline, "fee", 0);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Kitty.TokenTransferShort.selector, 10e6, 10e6 - 1));
        fk.fundFor(id, bob, 10e6);
        assertEq(fk.totalEscrowLiability(), 0);
        (, uint256 c,) = fk.getContribution(id, bob);
        assertEq(c, 0);
    }
}
