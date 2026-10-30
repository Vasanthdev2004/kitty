// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

contract KittyFuzzTest is KittyTestBase {
    uint256 internal constant MAXAMT = 1_000_000e6; // each actor's balance

    // fund exactness: balances, liability, totals all move by exactly the amounts funded
    function testFuzz_open_fundExactness(uint256 goal, uint256 a, uint256 b) public {
        goal = bound(goal, 2, MAXAMT);
        uint256 fl = (goal + 255) / 256; // dust floor for first-time funders
        a = bound(a, fl, goal - 1);
        // bob is first-time too: either at/above the floor or the exact completing payment
        b = bound(b, goal - a < fl ? goal - a : fl, goal - a);
        bytes32 id = _open(SALT_A, goal, 0);

        uint256 aBal = usdc.balanceOf(alice);
        uint256 bBal = usdc.balanceOf(bob);
        _fund(id, alice, a);
        _fund(id, bob, b);

        assertEq(aBal - usdc.balanceOf(alice), a);
        assertEq(bBal - usdc.balanceOf(bob), b);
        assertEq(_contributed(id, alice), a);
        assertEq(_contributed(id, bob), b);
        assertEq(_totalFunded(id), a + b);
        assertEq(kitty.totalEscrowLiability(), a + b);
        assertEq(usdc.balanceOf(address(kitty)), a + b);
        assertLe(_totalFunded(id), goal);

        // over the goal always reverts with the exact remaining
        uint256 remaining = goal - a - b;
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, remaining + 1, remaining));
        kitty.fund(id, remaining + 1);
    }

    // settle pays exactly goal regardless of strays; strays stay in the contract
    function testFuzz_settle_exactTransfer(uint256 goal, uint256 stray) public {
        goal = bound(goal, 1, MAXAMT);
        stray = bound(stray, 0, MAXAMT);
        bytes32 id = _open(SALT_A, goal, 0);
        _fund(id, alice, goal);
        usdc.mint(address(kitty), stray);

        uint256 r0 = usdc.balanceOf(recipient);
        vm.prank(stranger);
        kitty.settle(id);
        assertEq(usdc.balanceOf(recipient) - r0, goal);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), stray);
        vm.expectRevert(Kitty.AlreadySettled.selector);
        kitty.settle(id);
    }

    // Split shares must sum to goal exactly; mismatch reports (actual, expected)
    function testFuzz_split_sumOfShares(uint256 s1, uint256 s2, uint256 s3, uint256 goal, bool exact) public {
        s1 = bound(s1, 1, 1e12);
        s2 = bound(s2, 1, 1e12);
        s3 = bound(s3, 1, 1e12);
        uint256 sum = s1 + s2 + s3;
        goal = exact ? sum : bound(goal, 1, 4e12);

        address[] memory cs = new address[](3);
        uint256[] memory ss = new uint256[](3);
        cs[0] = alice; ss[0] = s1;
        cs[1] = bob;   ss[1] = s2;
        cs[2] = carol; ss[2] = s3;

        vm.prank(creator);
        if (goal != sum) {
            vm.expectRevert(abi.encodeWithSelector(Kitty.SharesSumMismatch.selector, sum, goal));
            kitty.createSplitPot(SALT_A, recipient, goal, deadline, "", cs, ss);
        } else {
            bytes32 id = kitty.createSplitPot(SALT_A, recipient, goal, deadline, "", cs, ss);
            (uint256 a,,) = kitty.getContribution(id, alice);
            (uint256 b,,) = kitty.getContribution(id, bob);
            (uint256 c,,) = kitty.getContribution(id, carol);
            assertEq(a + b + c, goal);
        }
    }

    // Split: a contributor can fund up to their own share, never beyond
    function testFuzz_split_cannotExceedOwnShare(uint256 s1, uint256 s2, uint256 amt) public {
        s1 = bound(s1, 1, 5e11);
        s2 = bound(s2, 1, 5e11);
        amt = bound(amt, 1, s1 + s2);
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = s1;
        cs[1] = bob;   ss[1] = s2;
        vm.prank(creator);
        bytes32 id = kitty.createSplitPot(SALT_A, recipient, s1 + s2, deadline, "", cs, ss);

        vm.prank(alice);
        if (amt > s1) {
            vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, amt, s1));
            kitty.fund(id, amt);
            assertEq(_contributed(id, alice), 0);
        } else {
            kitty.fund(id, amt);
            assertEq(_contributed(id, alice), amt);
        }
    }

    // Refund returns only the caller's own amount; strangers get nothing; liability returns to zero
    function testFuzz_refund_onlyOwnAmount(uint256 a, uint256 b, uint256 c) public {
        uint256 fl = (4 * MAXAMT + 255) / 256; // dust floor for this goal
        a = bound(a, fl, MAXAMT);
        b = bound(b, fl, MAXAMT);
        c = bound(c, fl, MAXAMT);
        bytes32 id = _open(SALT_A, 4 * MAXAMT, 0);
        _fund(id, alice, a);
        _fund(id, bob, b);
        _fund(id, carol, c);
        vm.warp(deadline);

        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        uint256 c0 = usdc.balanceOf(carol);

        vm.prank(bob);
        kitty.refund(id);
        assertEq(usdc.balanceOf(bob) - b0, b);
        assertEq(usdc.balanceOf(alice), a0);
        assertEq(usdc.balanceOf(carol), c0);
        assertEq(kitty.totalEscrowLiability(), a + c);

        vm.prank(bob);
        vm.expectRevert(Kitty.AlreadyRefunded.selector);
        kitty.refund(id);
        vm.prank(dave);
        vm.expectRevert(Kitty.NothingToRefund.selector);
        kitty.refund(id);

        vm.prank(alice);
        kitty.refund(id);
        vm.prank(carol);
        kitty.refund(id);
        assertEq(usdc.balanceOf(alice) - a0, a);
        assertEq(usdc.balanceOf(carol) - c0, c);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
    }

    // first-time contribution must reach max(minContribution, ceil(goal/256)) unless it completes the goal
    function testFuzz_open_minContribution(uint256 goal, uint256 minC, uint256 amt) public {
        goal = bound(goal, 1, MAXAMT);
        minC = bound(minC, 0, goal);
        amt = bound(amt, 1, goal);
        bytes32 id = _open(SALT_A, goal, minC);
        uint256 dust = (goal + 255) / 256;
        uint256 eff = minC > dust ? minC : dust;
        assertEq(kitty.effectiveMinContribution(id), eff);
        vm.prank(alice);
        if (amt < eff && amt != goal) {
            vm.expectRevert(abi.encodeWithSelector(Kitty.BelowMinContribution.selector, amt, eff));
            kitty.fund(id, amt);
            assertEq(_count(id), 0);
        } else {
            kitty.fund(id, amt);
            assertEq(_contributed(id, alice), amt);
        }
    }

    // fund iff t < deadline
    function testFuzz_fund_deadlineBoundary(uint256 t) public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        t = bound(t, block.timestamp, uint256(deadline) + 10 days);
        vm.warp(t);
        vm.prank(alice);
        if (t >= deadline) {
            vm.expectRevert(Kitty.DeadlinePassed.selector);
            kitty.fund(id, 1e6);
        } else {
            kitty.fund(id, 1e6);
            assertEq(_totalFunded(id), 1e6);
        }
    }

    // refund iff t >= deadline (pot not fully funded)
    function testFuzz_refund_deadlineBoundary(uint256 t) public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 10e6);
        t = bound(t, block.timestamp, uint256(deadline) + 10 days);
        vm.warp(t);
        vm.prank(alice);
        if (t < deadline) {
            vm.expectRevert(Kitty.DeadlineNotReached.selector);
            kitty.refund(id);
        } else {
            kitty.refund(id);
            assertTrue(_refunded(id, alice));
        }
    }

    // ids are bound to the creator
    function testFuzz_potId_boundToCreator(address c1, address c2, bytes32 salt) public view {
        vm.assume(c1 != c2);
        assertEq(kitty.computePotId(c1, salt), keccak256(abi.encode(c1, salt)));
        assertTrue(kitty.computePotId(c1, salt) != kitty.computePotId(c2, salt));
    }

    // any creator may reuse any salt (no squatting): ids never collide across creators
    function testFuzz_sameSaltTwoCreatorsCoexist(address c1, address c2, bytes32 salt) public {
        vm.assume(c1 != c2 && c1 != address(0) && c2 != address(0));
        vm.prank(c1);
        bytes32 id1 = kitty.createOpenPot(salt, recipient, GOAL, deadline, "", 0);
        vm.prank(c2);
        bytes32 id2 = kitty.createOpenPot(salt, recipient, GOAL, deadline, "", 0);
        assertTrue(id1 != id2);
        (address k1,,,,,,,,,,) = kitty.getPot(id1);
        (address k2,,,,,,,,,,) = kitty.getPot(id2);
        assertEq(k1, c1);
        assertEq(k2, c2);
    }
}
