// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// fund(): Split and Open modes, bounds, deadline edges, contributor caps.
contract KittyFundTest is KittyTestBase {
    // ── Split mode ────────────────────────────────────────────────────────────

    function test_fundSplit_partialThenFull() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 30e6);
        assertEq(_contributed(id, alice), 30e6);
        assertEq(_totalFunded(id), 30e6);
        assertEq(kitty.totalEscrowLiability(), 30e6);
        assertEq(usdc.balanceOf(address(kitty)), 30e6);

        _fund(id, alice, 30e6);
        assertEq(_contributed(id, alice), 60e6);
        assertEq(kitty.totalEscrowLiability(), 60e6);
    }

    function test_fundSplit_unequalSharesFullFund() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        assertEq(_contributed(id, alice), 60e6);
        assertEq(_contributed(id, bob), 25e6);
        assertEq(_contributed(id, carol), 15e6);
        assertEq(_totalFunded(id), GOAL);
        assertEq(kitty.totalEscrowLiability(), GOAL);
        assertEq(_count(id), 3); // split contributor list never changes
    }

    function test_fundSplit_emitsFunded() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 10e6);
        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Funded(id, bob, 25e6, 35e6);
        _fund(id, bob, 25e6);
    }

    function test_fundSplit_movesTokens() public {
        bytes32 id = _split3(SALT_A);
        uint256 before_ = usdc.balanceOf(alice);
        _fund(id, alice, 40e6);
        assertEq(before_ - usdc.balanceOf(alice), 40e6);
        assertEq(usdc.balanceOf(address(kitty)), 40e6);
    }

    function test_fundSplit_exceedsShareReverts() public {
        bytes32 id = _split3(SALT_A);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, 61e6, 60e6));
        kitty.fund(id, 61e6);
    }

    function test_fundSplit_cumulativeExceedsShareReverts() public {
        bytes32 id = _split3(SALT_A);
        _fund(id, alice, 50e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, 61e6, 60e6));
        kitty.fund(id, 11e6);
        // exact remaining share still ok
        _fund(id, alice, 10e6);
        assertEq(_contributed(id, alice), 60e6);
    }

    function test_fundSplit_exceedsGoalCheckedBeforeShare() public {
        bytes32 id = _split3(SALT_A);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, GOAL + 1, GOAL));
        kitty.fund(id, GOAL + 1);
    }

    function test_fundSplit_nonContributorReverts() public {
        bytes32 id = _split3(SALT_A);
        vm.prank(stranger);
        vm.expectRevert(Kitty.NotAContributor.selector);
        kitty.fund(id, 1e6);
        // creator / recipient are not implicitly contributors
        vm.prank(creator);
        vm.expectRevert(Kitty.NotAContributor.selector);
        kitty.fund(id, 1e6);
        assertEq(_totalFunded(id), 0);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_fund_zeroAmountReverts() public {
        bytes32 id = _split3(SALT_A);
        vm.prank(alice);
        vm.expectRevert(Kitty.ZeroAmount.selector);
        kitty.fund(id, 0);
        bytes32 oid = _open(SALT_B, GOAL, 0);
        vm.prank(alice);
        vm.expectRevert(Kitty.ZeroAmount.selector);
        kitty.fund(oid, 0);
    }

    function test_fund_afterFullyFunded_exceedsGoalWithZeroRemaining() public {
        bytes32 id = _split3(SALT_A);
        _fullFundSplit3(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 1, 0));
        kitty.fund(id, 1);
    }

    function test_fund_afterSettled_reverts() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, GOAL);
        kitty.settle(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 1, 0));
        kitty.fund(id, 1);
    }

    // ── Deadline edges ────────────────────────────────────────────────────────

    function test_fund_rejectsAtDeadline() public {
        bytes32 id = _split3(SALT_A);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(Kitty.DeadlinePassed.selector);
        kitty.fund(id, 10e6);
    }

    function test_fund_allowsAtDeadlineMinus1() public {
        bytes32 id = _split3(SALT_A);
        vm.warp(deadline - 1);
        _fund(id, alice, 10e6);
        assertEq(_contributed(id, alice), 10e6);
    }

    function test_fund_rejectsAfterDeadline() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.warp(uint256(deadline) + 1);
        vm.prank(alice);
        vm.expectRevert(Kitty.DeadlinePassed.selector);
        kitty.fund(id, 10e6);
    }

    // ── Open mode ─────────────────────────────────────────────────────────────

    function test_fundOpen_threeFundersWithRepeat() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 20e6);
        _fund(id, bob, 30e6);
        _fund(id, alice, 10e6); // repeat funder
        _fund(id, carol, 5e6);

        assertEq(_count(id), 3); // alice listed once
        address[] memory cs = kitty.getContributors(id);
        assertEq(cs.length, 3);
        assertEq(cs[0], alice);
        assertEq(cs[1], bob);
        assertEq(cs[2], carol);

        assertEq(_contributed(id, alice), 30e6);
        assertEq(_contributed(id, bob), 30e6);
        assertEq(_contributed(id, carol), 5e6);
        assertEq(_totalFunded(id), 65e6);
        assertEq(kitty.totalEscrowLiability(), 65e6);
        assertEq(usdc.balanceOf(address(kitty)), 65e6);

        // Open pots report share 0 for everyone
        (uint256 sh,,) = kitty.getContribution(id, alice);
        assertEq(sh, 0);
        (sh,,) = kitty.getContribution(id, stranger);
        assertEq(sh, 0);
    }

    function test_fundOpen_emitsFundedWithRunningTotal() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 20e6);
        vm.expectEmit(true, true, false, true, address(kitty));
        emit Kitty.Funded(id, alice, 7e6, 27e6);
        _fund(id, alice, 7e6);
    }

    function test_fundOpen_overfundReverts() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 70e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 31e6, 30e6));
        kitty.fund(id, 31e6);
        assertEq(_totalFunded(id), 70e6);
        assertEq(_count(id), 1); // failed attempt must not register bob
        _fund(id, bob, 30e6); // exact remaining ok
        assertEq(_totalFunded(id), GOAL);
    }

    function test_fundOpen_hugeAmountDoesNotOverflow() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, type(uint256).max, GOAL));
        kitty.fund(id, type(uint256).max);
    }

    function test_fundOpen_anyoneCanFundNoNamedList() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        uint256 floorAmt = kitty.effectiveMinContribution(id);
        _fund(id, stranger, floorAmt);
        assertEq(_contributed(id, stranger), floorAmt);
        // a repeat funder may add a single unit
        _fund(id, stranger, 1);
        assertEq(_contributed(id, stranger), floorAmt + 1);
    }

    function test_fundOpen_belowMinReverts() public {
        bytes32 id = _open(SALT_A, GOAL, 30e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 29e6, 30e6));
        kitty.fund(id, 29e6);
        assertEq(_count(id), 0);
        assertEq(_totalFunded(id), 0);
        _fund(id, alice, 30e6); // exactly min ok
        assertEq(_contributed(id, alice), 30e6);
    }

    /// Creator minContribution applies to FIRST-time funders only: repeat funders may add any amount > 0.
    function test_fundOpen_minDoesNotApplyToRepeatFunder() public {
        bytes32 id = _open(SALT_A, GOAL, 30e6);
        _fund(id, alice, 40e6);
        _fund(id, alice, 5e6); // below creator min, allowed (already listed)
        _fund(id, alice, 1);   // even a single unit
        assertEq(_contributed(id, alice), 40e6 + 5e6 + 1);
        assertEq(_count(id), 1);
        // a different first-time funder is still held to the min
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 5e6, 30e6));
        kitty.fund(id, 5e6);
    }

    function test_fundOpen_completingContributionWaivesMin() public {
        bytes32 id = _open(SALT_A, GOAL, 30e6);
        _fund(id, alice, 30e6);
        _fund(id, bob, 30e6);
        _fund(id, carol, 30e6);
        // remaining = 10e6 < min. A partial 5e6 does not complete -> revert.
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 5e6, 30e6));
        kitty.fund(id, 5e6);
        // exact completing 10e6 is waived.
        _fund(id, dave, 10e6);
        assertEq(_totalFunded(id), GOAL);
        assertEq(_contributed(id, dave), 10e6);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    function test_fundOpen_completingTopUpByExistingFunderWaivesMin() public {
        bytes32 id = _open(SALT_A, GOAL, 60e6);
        _fund(id, alice, 70e6);
        _fund(id, alice, 30e6); // completes, amount < min
        assertEq(_totalFunded(id), GOAL);
        assertEq(_count(id), 1);
    }

    function test_fundOpen_minEqualGoalOnlyFullFunds() public {
        bytes32 id = _open(SALT_A, GOAL, GOAL);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, GOAL - 1, GOAL));
        kitty.fund(id, GOAL - 1);
        _fund(id, alice, GOAL);
        assertEq(_totalFunded(id), GOAL);
    }

    /// The old "257th funder" scenario no longer exists in this form: see Kitty.Floor.t.sol.
    function test_fundOpen_tinyFirstTimeContributionRevertsEvenWithMinZero() public {
        bytes32 id = _open(SALT_A, 1000, 0); // floor = ceil(1000/256) = 4
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, 1, 4));
        kitty.fund(id, 1);
        assertEq(_count(id), 0);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    function test_fundSplit_64ContributorsFullFundAndSettle() public {
        address[] memory cs = new address[](64);
        uint256[] memory ss = new uint256[](64);
        for (uint256 i = 0; i < 64; i++) { cs[i] = _newFunder(i, 1e6); ss[i] = 1e6; }
        vm.prank(creator);
        bytes32 id = kitty.createSplitPot(SALT_A, recipient, 64e6, deadline, "", cs, ss);
        for (uint256 i = 0; i < 64; i++) _fund(id, cs[i], 1e6);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), 64e6);
        assertEq(kitty.totalEscrowLiability(), 0);
    }

    // ── Mode isolation ────────────────────────────────────────────────────────

    function test_modeIsolation_splitListDoesNotGrantOpenOrViceVersa() public {
        bytes32 splitId = _split3(SALT_A);
        bytes32 openId = _open(SALT_B, GOAL, 0);

        // stranger: rejected in split, accepted in open
        vm.prank(stranger);
        vm.expectRevert(Kitty.NotAContributor.selector);
        kitty.fund(splitId, 1e6);
        _fund(openId, stranger, 1e6);

        // alice's split share is not a cap in open pots; open share is 0 for her
        _fund(openId, alice, 90e6);
        (uint256 openShare,,) = kitty.getContribution(openId, alice);
        assertEq(openShare, 0);
        (uint256 splitShare,,) = kitty.getContribution(splitId, alice);
        assertEq(splitShare, 60e6);

        // accounting is per-pot
        _fund(splitId, alice, 10e6);
        assertEq(_contributed(splitId, alice), 10e6);
        assertEq(_contributed(openId, alice), 90e6);
        assertEq(_totalFunded(splitId), 10e6);
        assertEq(_totalFunded(openId), 91e6);
        assertEq(_count(splitId), 3);
        assertEq(_count(openId), 2);
        assertEq(kitty.totalEscrowLiability(), 101e6);
    }

    function test_modeIsolation_minContributionOnlyAppliesToOpen() public {
        bytes32 splitId = _split3(SALT_A);
        (,,,,,,,, uint256 minC,,) = kitty.getPot(splitId);
        assertEq(minC, 0);
        _fund(splitId, carol, 1); // tiny contribution ok in split
        assertEq(_contributed(splitId, carol), 1);
    }

    function test_modeIsolation_fundingOnePotLeavesOtherUntouched() public {
        bytes32 a = _open(SALT_A, GOAL, 0);
        bytes32 b = _open(SALT_B, GOAL, 0);
        _fund(a, alice, 40e6);
        assertEq(_totalFunded(b), 0);
        assertEq(_count(b), 0);
        assertEq(_contributed(b, alice), 0);
    }
}
