// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// RULE 2: Open-pot dust floor.
///   effectiveMin = max(minContribution, ceil(goal / 256)), enforced on FIRST-time funders only,
///   waived only for the exact completing payment (amount == goal - totalFunded).
contract KittyFloorTest is KittyTestBase {
    bytes32 internal constant SALT_C = keccak256("kitty-salt-c");

    // ── helpers ───────────────────────────────────────────────────────────────

    function _belowMin(bytes32 id, address who, uint256 amt, uint256 minimum) internal {
        vm.prank(who);
        vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, amt, minimum));
        kitty.fund(id, amt);
    }

    /// Creates an Open pot with minContribution 0 and checks the view + the floor boundary.
    function _checkFloor(uint256 goal, uint256 expected, bytes32 salt) internal {
        bytes32 id = _open(salt, goal, 0);
        assertEq(kitty.effectiveMinContribution(id), expected, "effectiveMinContribution");
        if (expected > 1) _belowMin(id, alice, expected - 1, expected);
        assertEq(_count(id), 0);
        usdc.mint(alice, expected);
        _fund(id, alice, expected);
        assertEq(_contributed(id, alice), expected);
    }

    // ── effectiveMinContribution view ─────────────────────────────────────────

    function test_floor_equalsCeilGoalOver256_whenMinIsZero() public {
        _checkFloor(1, 1, keccak256("g1"));
        _checkFloor(255, 1, keccak256("g255"));
        _checkFloor(256, 1, keccak256("g256"));      // exact multiple
        _checkFloor(257, 2, keccak256("g257"));      // just above a multiple
        _checkFloor(512, 2, keccak256("g512"));      // exact multiple
        _checkFloor(513, 3, keccak256("g513"));
        _checkFloor(2560, 10, keccak256("g2560"));   // exact multiple
        _checkFloor(2561, 11, keccak256("g2561"));
        _checkFloor(100e6, 390_625, keccak256("g100e6"));       // 100e6 = 256 * 390625
        _checkFloor(100e6 + 1, 390_626, keccak256("g100e6p1"));
        _checkFloor(100e6 - 1, 390_625, keccak256("g100e6m1"));
    }

    function test_floor_largeGoals() public {
        // 1e30 is divisible by 256 (2^30 * 5^30)
        _checkFloor(1e30, 1e30 / 256, keccak256("big"));
        _checkFloor(1e30 + 1, 1e30 / 256 + 1, keccak256("bigp1"));
        _checkFloor(1e30 - 1, 1e30 / 256, keccak256("bigm1")); // 1e30-1 = 256*q + 255 -> q+1 where q = 1e30/256 - 1
    }

    function test_floor_maxUintGoalDoesNotOverflow() public {
        bytes32 id = _open(SALT_A, type(uint256).max, 0);
        // max = 2^256 - 1 = 256 * (2^248 - 1) + 255 -> ceil = 2^248
        assertEq(kitty.effectiveMinContribution(id), 1 << 248);
        bytes32 id2 = _open(SALT_B, type(uint256).max, type(uint256).max);
        assertEq(kitty.effectiveMinContribution(id2), type(uint256).max);
    }

    function test_floor_creatorMinAboveFloorWins() public {
        bytes32 id = _open(SALT_A, GOAL, 30e6);
        assertEq(kitty.effectiveMinContribution(id), 30e6);
        _belowMin(id, alice, 30e6 - 1, 30e6);
        _fund(id, alice, 30e6);
        // raw creator value is still what getPot reports
        (,,,,,,,, uint256 minC,) = kitty.getPot(id);
        assertEq(minC, 30e6);
    }

    function test_floor_creatorMinBelowFloorIsRaisedToFloor() public {
        bytes32 id = _open(SALT_A, GOAL, 1);
        assertEq(kitty.effectiveMinContribution(id), 390_625);
        _belowMin(id, alice, 390_624, 390_625);
        _fund(id, alice, 390_625);
        (,,,,,,,, uint256 minC,) = kitty.getPot(id);
        assertEq(minC, 1); // stored creator value unchanged
    }

    function test_floor_creatorMinEqualToFloor() public {
        bytes32 id = _open(SALT_A, GOAL, 390_625);
        assertEq(kitty.effectiveMinContribution(id), 390_625);
    }

    function test_floor_creatorMinEqualGoal() public {
        bytes32 id = _open(SALT_A, GOAL, GOAL);
        assertEq(kitty.effectiveMinContribution(id), GOAL);
    }

    function test_floor_splitPotsReturnZero() public {
        bytes32 id = _split3(SALT_A);
        assertEq(kitty.effectiveMinContribution(id), 0);
    }

    function test_floor_unknownPotReverts() public {
        bytes32 ghost = keccak256("nope");
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotNotFound.selector, ghost));
        kitty.effectiveMinContribution(ghost);
    }

    // ── first-time funders ────────────────────────────────────────────────────

    function test_firstTimer_exactlyAtFloorOk_floorMinus1Reverts() public {
        bytes32 id = _open(SALT_A, 1000, 0); // floor = 4
        _belowMin(id, alice, 3, 4);
        assertEq(_count(id), 0);
        assertEq(_totalFunded(id), 0);
        assertEq(kitty.totalEscrowLiability(), 0);
        _fund(id, alice, 4);
        assertEq(_contributed(id, alice), 4);
        assertEq(_count(id), 1);
    }

    function test_firstTimer_exactMultipleGoal_boundary() public {
        bytes32 id = _open(SALT_A, 2560, 0); // floor = 10 exactly
        _belowMin(id, alice, 9, 10);
        _fund(id, alice, 10);
    }

    function test_firstTimer_completingPaymentBelowFloorAllowed() public {
        bytes32 id = _open(SALT_A, 1000, 0); // floor = 4
        _fund(id, alice, 998);                // remaining 2
        _belowMin(id, bob, 1, 4);             // partial below floor and not completing -> revert
        _fund(id, bob, 2);                    // exact completing payment waives the floor
        assertEq(_totalFunded(id), 1000);
        assertEq(_contributed(id, bob), 2);
        assertEq(_count(id), 2);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), 1000);
    }

    function test_firstTimer_oneUnitCompletingPaymentAllowed() public {
        bytes32 id = _open(SALT_A, 1000, 0);
        _fund(id, alice, 999);
        _fund(id, bob, 1);
        assertEq(_totalFunded(id), 1000);
    }

    function test_firstTimer_nonCompletingJustBelowFloorWhenRemainingLarger() public {
        bytes32 id = _open(SALT_A, 1000, 0);
        _fund(id, alice, 994);   // remaining 6, floor 4
        _belowMin(id, bob, 3, 4); // 3 != remaining 6 -> reverts
        _fund(id, bob, 4);        // at floor, not completing: fine
        _fund(id, carol, 2);      // remaining 2 completes
        assertEq(_totalFunded(id), 1000);
    }

    function test_firstTimer_creatorMinLargerThanRemainingStillAllowsCompletion() public {
        bytes32 id = _open(SALT_A, GOAL, 60e6);
        _fund(id, alice, 70e6);                 // remaining 30e6 < creator min 60e6
        _belowMin(id, bob, 29e6, 60e6);         // not completing
        _fund(id, bob, 30e6);                   // completing -> allowed
        assertEq(_totalFunded(id), GOAL);
    }

    function test_firstTimer_exceedsGoalCheckedBeforeFloor() public {
        bytes32 id = _open(SALT_A, 1000, 500);
        _fund(id, alice, 600); // remaining 400
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 450, 400));
        kitty.fund(id, 450);
    }

    function test_firstTimer_zeroAmountCheckedBeforeFloor() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.prank(alice);
        vm.expectRevert(Kitty.ZeroAmount.selector);
        kitty.fund(id, 0);
    }

    // ── repeat funders ────────────────────────────────────────────────────────

    function test_repeatFunder_addsOneUnitBelowFloor() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        uint256 floorAmt = kitty.effectiveMinContribution(id);
        _fund(id, alice, floorAmt);
        _fund(id, alice, 1);
        _fund(id, alice, 1);
        assertEq(_contributed(id, alice), floorAmt + 2);
        assertEq(_count(id), 1);
        // the same amount from a first-timer is rejected
        _belowMin(id, bob, 1, floorAmt);
    }

    function test_repeatFunder_creatorMinNoLongerApplies() public {
        bytes32 id = _open(SALT_A, GOAL, 30e6);
        _fund(id, alice, 30e6);
        _fund(id, alice, 1);
        _fund(id, alice, 12_345);
        assertEq(_contributed(id, alice), 30e6 + 1 + 12_345);
    }

    function test_repeatFunder_failedFirstAttemptDoesNotListHim() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _belowMin(id, alice, 1, 390_625);
        // still first-time: tiny retry is rejected again
        _belowMin(id, alice, 1, 390_625);
        assertEq(_count(id), 0);
    }

    // ── slot-cap economics ────────────────────────────────────────────────────

    /// 256 distinct first-time funders, each paying exactly the floor, complete the pot exactly.
    /// The 257th distinct funder can only hit ExceedsGoal (remaining == 0).
    ///
    /// NOTE: Kitty's `TooManyContributors` check in fund() is defense-in-depth. It is UNREACHABLE
    /// through the public flow for Open pots: occupying 256 slots requires 256 first-time payments,
    /// each >= effectiveMin >= ceil(goal/256) (only the final completing payment may be smaller), so
    /// totalFunded would already equal goal, and ExceedsGoal is checked first (before the slot check).
    function test_slots_256FloorFundersCompleteExactly_257thHitsExceedsGoal() public {
        bytes32 id = _open(SALT_A, 2560, 0); // floor = 10, 256 * 10 = 2560
        assertEq(kitty.effectiveMinContribution(id), 10);
        for (uint256 i = 0; i < 256; i++) {
            address f = _newFunder(i, 10);
            _fund(id, f, 10);
        }
        assertEq(_count(id), 256);
        assertEq(_totalFunded(id), 2560);
        assertEq(kitty.totalEscrowLiability(), 2560);
        assertEq(usdc.balanceOf(address(kitty)), 2560);

        // the 257th distinct funder: ExceedsGoal(amount, 0), not TooManyContributors
        address extra = _newFunder(1000, 100);
        vm.prank(extra);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 10, 0));
        kitty.fund(id, 10);
        vm.prank(extra);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 1, 0));
        kitty.fund(id, 1);
        assertEq(_count(id), 256);
        assertEq(_contributed(id, extra), 0);

        // settle pays the recipient exactly once
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), 2560);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), 2560);
    }

    /// Non-multiple goal: 250 funders at the floor (4) leave 1 unit; one more first-timer completes with 1.
    function test_slots_nonMultipleGoal_completesWithDustCompletingPayment() public {
        bytes32 id = _open(SALT_A, 1001, 0); // floor = ceil(1001/256) = 4
        assertEq(kitty.effectiveMinContribution(id), 4);
        for (uint256 i = 0; i < 250; i++) _fund(id, _newFunder(i, 4), 4);
        assertEq(_totalFunded(id), 1000);
        assertEq(_count(id), 250);
        address last = _newFunder(5000, 10);
        vm.prank(last);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 4, 1));
        kitty.fund(id, 4);
        _fund(id, last, 1); // exact completing payment, below the floor
        assertEq(_totalFunded(id), 1001);
        assertEq(_count(id), 251);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient), 1001);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    /// First-timer: reverts iff amount > remaining (ExceedsGoal) or (amount < floor and not completing).
    /// forge-config: default.fuzz.runs = 512
    function testFuzz_floor_firstTimerAndCompletingException(uint256 goal, uint256 minC, uint256 pre, uint256 amt)
        public
    {
        goal = bound(goal, 1, 1e12);
        minC = bound(minC, 0, goal);
        uint256 eff = _dust(goal) > minC ? _dust(goal) : minC;
        bytes32 id = _open(SALT_A, goal, minC);
        assertEq(kitty.effectiveMinContribution(id), eff);

        // alice is a valid first-time funder (>= floor, or exactly the whole goal)
        pre = bound(pre, eff, goal);
        _fund(id, alice, pre);
        uint256 remaining = goal - pre;

        amt = bound(amt, 1, remaining + 2);
        vm.prank(bob);
        if (amt > remaining) {
            vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, amt, remaining));
            kitty.fund(id, amt);
            assertEq(_count(id), 1);
        } else if (amt < eff && amt != remaining) {
            vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, amt, eff));
            kitty.fund(id, amt);
            assertEq(_count(id), 1);
        } else {
            kitty.fund(id, amt);
            assertEq(_contributed(id, bob), amt);
            assertEq(_count(id), 2);
            assertEq(_totalFunded(id), pre + amt);
        }
    }

    /// Repeat funders may add any amount > 0 (up to the remaining goal), regardless of floor / creator min.
    function testFuzz_floor_repeatFunderAnyAmount(uint256 goal, uint256 minC, uint256 first, uint256 amt) public {
        goal = bound(goal, 2, 1e12);
        minC = bound(minC, 0, goal - 1); // keeps eff <= goal - 1 (dust <= goal - 1 for goal >= 2)
        uint256 eff = _dust(goal) > minC ? _dust(goal) : minC;
        bytes32 id = _open(SALT_A, goal, minC);
        first = bound(first, eff, goal - 1);
        _fund(id, alice, first);
        amt = bound(amt, 1, goal - first);
        _fund(id, alice, amt);
        assertEq(_contributed(id, alice), first + amt);
        assertEq(_count(id), 1);
    }

    /// Economic property: however the adversary fills, using first-time funders each paying
    /// min(floor, remaining), the pot is complete after at most 256 distinct funders.
    /// forge-config: default.fuzz.runs = 24
    function testFuzz_slots_cannotOccupyAllSlotsWithoutCompleting(uint256 goal, uint256 minC) public {
        goal = bound(goal, 1, 100_000);
        minC = bound(minC, 0, goal);
        bytes32 id = _open(SALT_A, goal, minC);
        uint256 eff = kitty.effectiveMinContribution(id);

        uint256 n;
        while (_totalFunded(id) < goal) {
            require(n < 256, "slot cap reached before completion");
            uint256 remaining = goal - _totalFunded(id);
            uint256 pay = remaining < eff ? remaining : eff;
            _fund(id, _newFunder(n, pay), pay);
            n++;
        }
        assertLe(n, 256);
        assertEq(_count(id), n);
        assertEq(_totalFunded(id), goal);

        address extra = _newFunder(100_000, 10);
        vm.prank(extra);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 1, 0));
        kitty.fund(id, 1);
    }
}
