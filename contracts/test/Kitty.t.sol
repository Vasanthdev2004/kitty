// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// Deployment, creation validation, pot ids / squatting, views.
contract KittyTest is KittyTestBase {
    // ── Deployment ────────────────────────────────────────────────────────────

    function test_token_isImmutable() public view {
        assertEq(address(kitty.token()), address(usdc));
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(kitty.MAX_SPLIT_CONTRIBUTORS(), 64);
        assertEq(kitty.MAX_OPEN_CONTRIBUTORS(), 256);
        assertEq(kitty.SETTLE_GRACE(), 30 days);
        assertEq(kitty.MAX_REF_BYTES(), 64);
    }

    function test_constructor_rejectsZeroToken() public {
        vm.expectRevert(Kitty.InvalidToken.selector);
        new Kitty(address(0));
    }

    function test_constructor_rejectsNonContractToken() public {
        vm.expectRevert(Kitty.InvalidToken.selector);
        new Kitty(makeAddr("eoa"));
    }

    // ── Split creation ────────────────────────────────────────────────────────

    function test_createSplit_storesTerms() public {
        bytes32 id = _split3(SALT_A);
        (
            address c, address r, uint256 goal, uint64 dl, string memory ref,
            Kitty.Mode mode, bool settled, uint256 funded, uint256 minC, uint256 count
        ) = kitty.getPot(id);
        assertEq(c, creator);
        assertEq(r, recipient);
        assertEq(goal, GOAL);
        assertEq(dl, deadline);
        assertEq(ref, "inv-001");
        assertEq(uint8(mode), uint8(Kitty.Mode.Split));
        assertFalse(settled);
        assertEq(funded, 0);
        assertEq(minC, 0);
        assertEq(count, 3);

        address[] memory cs = kitty.getContributors(id);
        assertEq(cs.length, 3);
        assertEq(cs[0], alice);
        assertEq(cs[1], bob);
        assertEq(cs[2], carol);

        (uint256 sh, uint256 contributed, bool refunded) = kitty.getContribution(id, bob);
        assertEq(sh, 25e6);
        assertEq(contributed, 0);
        assertFalse(refunded);
        (sh,,) = kitty.getContribution(id, stranger);
        assertEq(sh, 0);
    }

    function test_createSplit_emitsPotCreated() public {
        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = GOAL;
        bytes32 expected = kitty.computePotId(creator, SALT_A);
        vm.expectEmit(true, true, true, true, address(kitty));
        emit Kitty.PotCreated(expected, creator, recipient, Kitty.Mode.Split, GOAL, deadline, "evt");
        vm.prank(creator);
        bytes32 id = kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "evt", cs, ss);
        assertEq(id, expected);
    }

    function test_createSplit_64ContributorsOk() public {
        address[] memory cs = new address[](64);
        uint256[] memory ss = new uint256[](64);
        for (uint256 i = 0; i < 64; i++) { cs[i] = address(uint160(0x500 + i)); ss[i] = 1e6; }
        vm.prank(creator);
        bytes32 id = kitty.createSplitPot(SALT_A, recipient, 64e6, deadline, "", cs, ss);
        assertEq(_count(id), 64);
    }

    function test_createSplit_65ContributorsReverts() public {
        address[] memory cs = new address[](65);
        uint256[] memory ss = new uint256[](65);
        for (uint256 i = 0; i < 65; i++) { cs[i] = address(uint160(0x500 + i)); ss[i] = 1e6; }
        vm.prank(creator);
        vm.expectRevert(Kitty.TooManyContributors.selector);
        kitty.createSplitPot(SALT_A, recipient, 65e6, deadline, "", cs, ss);
    }

    function test_createSplit_noContributorsReverts() public {
        address[] memory cs = new address[](0);
        uint256[] memory ss = new uint256[](0);
        vm.expectRevert(Kitty.NoContributors.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_createSplit_lengthMismatchReverts() public {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](1);
        cs[0] = alice; cs[1] = bob; ss[0] = GOAL;
        vm.expectRevert(abi.encodeWithSelector(Kitty.LengthMismatch.selector, 2, 1));
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_createSplit_zeroContributorReverts() public {
        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = address(0); ss[0] = GOAL;
        vm.expectRevert(Kitty.InvalidContributor.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_createSplit_zeroShareReverts() public {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = GOAL;
        cs[1] = bob;   ss[1] = 0;
        vm.expectRevert(Kitty.ZeroShare.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_createSplit_duplicateContributorReverts() public {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 50e6;
        cs[1] = alice; ss[1] = 50e6;
        vm.expectRevert(abi.encodeWithSelector(Kitty.DuplicateContributor.selector, alice));
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_createSplit_sharesSumUnderReverts() public {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 60e6;
        cs[1] = bob;   ss[1] = 30e6;
        vm.expectRevert(abi.encodeWithSelector(Kitty.SharesSumMismatch.selector, 90e6, GOAL));
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_createSplit_sharesSumOverReverts() public {
        address[] memory cs = new address[](2);
        uint256[] memory ss = new uint256[](2);
        cs[0] = alice; ss[0] = 60e6;
        cs[1] = bob;   ss[1] = 50e6;
        vm.expectRevert(abi.encodeWithSelector(Kitty.SharesSumMismatch.selector, 110e6, GOAL));
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function _oneSplit() internal view returns (address[] memory cs, uint256[] memory ss) {
        cs = new address[](1);
        ss = new uint256[](1);
        cs[0] = alice; ss[0] = GOAL;
    }

    function test_createSplit_invalidRecipientReverts() public {
        (address[] memory cs, uint256[] memory ss) = _oneSplit();
        vm.expectRevert(Kitty.InvalidRecipient.selector);
        kitty.createSplitPot(SALT_A, address(0), GOAL, deadline, "", cs, ss);
        vm.expectRevert(Kitty.InvalidRecipient.selector);
        kitty.createSplitPot(SALT_A, address(kitty), GOAL, deadline, "", cs, ss);
        vm.expectRevert(Kitty.InvalidRecipient.selector);
        kitty.createSplitPot(SALT_A, address(usdc), GOAL, deadline, "", cs, ss);
    }

    function test_createSplit_zeroGoalReverts() public {
        (address[] memory cs, uint256[] memory ss) = _oneSplit();
        ss[0] = 0;
        vm.expectRevert(Kitty.ZeroGoal.selector);
        kitty.createSplitPot(SALT_A, recipient, 0, deadline, "", cs, ss);
    }

    function test_createSplit_deadlineNotFutureReverts() public {
        (address[] memory cs, uint256[] memory ss) = _oneSplit();
        vm.expectRevert(Kitty.DeadlineNotFuture.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, uint64(block.timestamp), "", cs, ss);
        vm.expectRevert(Kitty.DeadlineNotFuture.selector);
        kitty.createSplitPot(SALT_A, recipient, GOAL, uint64(block.timestamp - 1), "", cs, ss);
        // now + 1 is accepted
        kitty.createSplitPot(SALT_A, recipient, GOAL, uint64(block.timestamp + 1), "", cs, ss);
    }

    function test_createSplit_refLength64Ok65Reverts() public {
        (address[] memory cs, uint256[] memory ss) = _oneSplit();
        string memory ref64 = _str(64);
        string memory ref65 = _str(65);
        bytes32 id = kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, ref64, cs, ss);
        (,,,, string memory stored,,,,,) = kitty.getPot(id);
        assertEq(stored, ref64);
        vm.expectRevert(Kitty.RefTooLong.selector);
        kitty.createSplitPot(SALT_B, recipient, GOAL, deadline, ref65, cs, ss);
    }

    function _str(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i = 0; i < n; i++) b[i] = "x";
        return string(b);
    }

    // ── Open creation ─────────────────────────────────────────────────────────

    function test_createOpen_storesTerms() public {
        bytes32 id = _open(SALT_A, GOAL, 5e6);
        (
            address c, address r, uint256 goal, uint64 dl, string memory ref,
            Kitty.Mode mode, bool settled, uint256 funded, uint256 minC, uint256 count
        ) = kitty.getPot(id);
        assertEq(c, creator);
        assertEq(r, recipient);
        assertEq(goal, GOAL);
        assertEq(dl, deadline);
        assertEq(ref, "open");
        assertEq(uint8(mode), uint8(Kitty.Mode.Open));
        assertFalse(settled);
        assertEq(funded, 0);
        assertEq(minC, 5e6);
        assertEq(count, 0);
        assertEq(kitty.getContributors(id).length, 0);
    }

    function test_createOpen_emitsPotCreated() public {
        bytes32 expected = kitty.computePotId(creator, SALT_A);
        vm.expectEmit(true, true, true, true, address(kitty));
        emit Kitty.PotCreated(expected, creator, recipient, Kitty.Mode.Open, GOAL, deadline, "evt-open");
        vm.prank(creator);
        bytes32 id = kitty.createOpenPot(SALT_A, recipient, GOAL, deadline, "evt-open", 0);
        assertEq(id, expected);
    }

    function test_createOpen_minContributionBounds() public {
        // == goal ok, 0 ok
        _open(SALT_A, GOAL, GOAL);
        _open(SALT_B, GOAL, 0);
        vm.prank(creator);
        vm.expectRevert(Kitty.InvalidMinContribution.selector);
        kitty.createOpenPot(keccak256("c"), recipient, GOAL, deadline, "", GOAL + 1);
    }

    function test_createOpen_invalidRecipientReverts() public {
        vm.expectRevert(Kitty.InvalidRecipient.selector);
        kitty.createOpenPot(SALT_A, address(0), GOAL, deadline, "", 0);
        vm.expectRevert(Kitty.InvalidRecipient.selector);
        kitty.createOpenPot(SALT_A, address(kitty), GOAL, deadline, "", 0);
        vm.expectRevert(Kitty.InvalidRecipient.selector);
        kitty.createOpenPot(SALT_A, address(usdc), GOAL, deadline, "", 0);
    }

    function test_createOpen_zeroGoalReverts() public {
        vm.expectRevert(Kitty.ZeroGoal.selector);
        kitty.createOpenPot(SALT_A, recipient, 0, deadline, "", 0);
    }

    function test_createOpen_deadlineNotFutureReverts() public {
        vm.expectRevert(Kitty.DeadlineNotFuture.selector);
        kitty.createOpenPot(SALT_A, recipient, GOAL, uint64(block.timestamp), "", 0);
    }

    function test_createOpen_refLength64Ok65Reverts() public {
        kitty.createOpenPot(SALT_A, recipient, GOAL, deadline, _str(64), 0);
        vm.expectRevert(Kitty.RefTooLong.selector);
        kitty.createOpenPot(SALT_B, recipient, GOAL, deadline, _str(65), 0);
    }

    // ── Pot ids, collisions, squatting ────────────────────────────────────────

    function test_potId_matchesComputeAndPreimage() public {
        bytes32 id = _split3(SALT_A);
        assertEq(id, kitty.computePotId(creator, SALT_A));
        assertEq(id, keccak256(abi.encode(creator, SALT_A)));
        bytes32 id2 = _open(SALT_B, GOAL, 0);
        assertEq(id2, kitty.computePotId(creator, SALT_B));
    }

    function test_sameCreatorSameSalt_reverts_split() public {
        bytes32 id = _split3(SALT_A);
        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = GOAL;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotAlreadyExists.selector, id));
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_sameCreatorSameSalt_reverts_open_andAcrossModes() public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotAlreadyExists.selector, id));
        kitty.createOpenPot(SALT_A, recipient, GOAL, deadline, "", 0);

        address[] memory cs = new address[](1);
        uint256[] memory ss = new uint256[](1);
        cs[0] = alice; ss[0] = GOAL;
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(Kitty.PotAlreadyExists.selector, id));
        kitty.createSplitPot(SALT_A, recipient, GOAL, deadline, "", cs, ss);
    }

    function test_sameSalt_twoCreators_differentIds_bothCoexist() public {
        bytes32 idA = _open(SALT_A, GOAL, 0);
        vm.prank(stranger);
        bytes32 idS = kitty.createOpenPot(SALT_A, dave, 40e6, deadline, "other", 0);
        assertTrue(idA != idS);
        assertEq(idS, kitty.computePotId(stranger, SALT_A));

        (address c1, address r1, uint256 g1,,,,,,,) = kitty.getPot(idA);
        (address c2, address r2, uint256 g2,,,,,,,) = kitty.getPot(idS);
        assertEq(c1, creator); assertEq(r1, recipient); assertEq(g1, GOAL);
        assertEq(c2, stranger); assertEq(r2, dave); assertEq(g2, 40e6);

        // independent funding / settlement
        uint256 d0 = usdc.balanceOf(dave);
        _fund(idS, alice, 40e6);
        kitty.settle(idS);
        assertEq(usdc.balanceOf(dave) - d0, 40e6);
        assertFalse(_settled(idA));
        assertEq(_totalFunded(idA), 0);
    }

    function test_squatting_attackerCannotTouchOrBlockVictimPot() public {
        address attacker = makeAddr("attacker");
        // Attacker pre-empts the victim's salt with a hostile pot (same salt, own creator).
        vm.prank(attacker);
        bytes32 hostile = kitty.createOpenPot(SALT_A, attacker, 1, deadline, "squat", 0);

        // Victim creation with the same salt still works and gets a different id.
        bytes32 victimId = _split3(SALT_A);
        assertTrue(victimId != hostile);
        assertEq(victimId, kitty.computePotId(creator, SALT_A));
        (address c, address r,,,,,,,,) = kitty.getPot(victimId);
        assertEq(c, creator);
        assertEq(r, recipient);

        // Attacker's id for the victim salt resolves to the attacker's pot, never the victim's.
        assertEq(kitty.computePotId(attacker, SALT_A), hostile);
        assertTrue(kitty.computePotId(attacker, SALT_A) != kitty.computePotId(creator, SALT_A));

        // Attacker settling / funding their own pot does not alter the victim's.
        _fund(hostile, alice, 1);
        kitty.settle(hostile);
        assertTrue(_settled(hostile));
        assertFalse(_settled(victimId));
        assertEq(_totalFunded(victimId), 0);
        assertEq(_count(victimId), 3);

        // The victim pot completes normally.
        _fullFundSplit3(victimId);
        kitty.settle(victimId);
        assertEq(usdc.balanceOf(recipient), GOAL);
    }

    function test_squatting_victimCreatedFirst_attackerReuseDoesNotRevertOrAffectVictim() public {
        bytes32 victimId = _open(SALT_A, GOAL, 0);
        _fund(victimId, alice, 10e6);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        bytes32 hostile = kitty.createOpenPot(SALT_A, attacker, GOAL, deadline, "", 0);
        assertTrue(hostile != victimId);
        (address c,,,,,,,,,) = kitty.getPot(victimId);
        assertEq(c, creator);
        assertEq(_totalFunded(victimId), 10e6);
        assertEq(_totalFunded(hostile), 0);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function test_views_revertPotNotFound() public {
        bytes32 ghost = keccak256("ghost");
        bytes memory err = abi.encodeWithSelector(Kitty.PotNotFound.selector, ghost);
        vm.expectRevert(err);
        kitty.getPot(ghost);
        vm.expectRevert(err);
        kitty.getContributors(ghost);
        vm.expectRevert(err);
        kitty.getContribution(ghost, alice);
        vm.expectRevert(err);
        kitty.effectiveMinContribution(ghost);
    }

    function test_actions_revertPotNotFound() public {
        bytes32 ghost = keccak256("ghost");
        bytes memory err = abi.encodeWithSelector(Kitty.PotNotFound.selector, ghost);
        vm.prank(alice);
        vm.expectRevert(err);
        kitty.fund(ghost, 1e6);
        vm.expectRevert(err);
        kitty.settle(ghost);
        vm.warp(block.timestamp + 365 days);
        vm.prank(alice);
        vm.expectRevert(err);
        kitty.refund(ghost);
    }

    function test_computePotId_isPure_forAnyCreator() public view {
        assertEq(kitty.computePotId(address(0), bytes32(0)), keccak256(abi.encode(address(0), bytes32(0))));
    }
}
