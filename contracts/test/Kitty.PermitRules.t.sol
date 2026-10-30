// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyPermitTestBase} from "./Kitty.PermitBase.t.sol";

/// Permit-path funding: normal funding rules still apply, failures roll the permit back, and tokens without permit work.
contract KittyPermitRulesTest is KittyPermitTestBase {
    function _garbage() internal pure returns (uint8, bytes32, bytes32) {
        return (27, bytes32(uint256(1)), bytes32(uint256(2)));
    }

    // ── all normal funding rules still apply; failure rolls the permit back ───

    function test_rulesApply_exceedsShare_rollsBackPermit() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(61e6);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsShare.selector, 61e6, 60e6));
        pk.fundWithPermit(id, 61e6, PDL, v, r, s);
        assertEq(pt.nonces(payer), 0, "tx reverted so nonce intact");
        assertEq(pt.allowance(payer, address(pk)), 0);
    }

    function test_rulesApply_notAContributor_zeroAmount_deadline_exceedsGoal() public {
        bytes32 id = _pSplit(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _sig(10e6);
        vm.prank(payer);
        vm.expectRevert(Kitty.NotAContributor.selector);
        pk.fundForWithPermit(id, stranger, 10e6, PDL, v, r, s);

        (v, r, s) = _sig(0);
        vm.prank(payer);
        vm.expectRevert(Kitty.ZeroAmount.selector);
        pk.fundWithPermit(id, 0, PDL, v, r, s);

        bytes32 open = _pOpen(SALT_B, 0);
        (v, r, s) = _sig(GOAL + 1);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, GOAL + 1, GOAL));
        pk.fundWithPermit(open, GOAL + 1, PDL, v, r, s);

        (v, r, s) = _sig(10e6);
        vm.warp(deadline);
        vm.prank(payer);
        vm.expectRevert(Kitty.DeadlinePassed.selector);
        pk.fundWithPermit(id, 10e6, PDL, v, r, s);
    }

    function test_fundForWithPermit_invalidBeneficiaries() public {
        bytes32 id = _pOpen(SALT_A, 0);
        address[3] memory bad = [address(0), address(pk), address(pt)];
        for (uint256 i = 0; i < bad.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = _sig(10e6);
            vm.prank(payer);
            vm.expectRevert(Kitty.InvalidBeneficiary.selector);
            pk.fundForWithPermit(id, bad[i], 10e6, PDL, v, r, s);
        }
    }

    function test_settledPot_fundWithPermitRevertsExceedsGoal() public {
        bytes32 id = _pOpen(SALT_A, 0);
        (uint8 v, bytes32 r, bytes32 s) = _sig(GOAL);
        vm.prank(payer);
        pk.fundWithPermit(id, GOAL, PDL, v, r, s);
        pk.settle(id);
        (v, r, s) = _sig(1e6);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Kitty.ExceedsGoal.selector, 1e6, 0));
        pk.fundWithPermit(id, 1e6, PDL, v, r, s);
    }

    // ── token WITHOUT permit (plain ERC-20) ───────────────────────────────────

    function _plainUser(uint256 i, bool approve_) internal returns (address a) {
        a = address(uint160(0x7000 + i));
        usdc.mint(a, 1_000e6);
        if (approve_) {
            vm.prank(a);
            usdc.approve(address(kitty), type(uint256).max);
        }
    }

    function test_plainToken_withAllowance_fundWithPermitStillFunds() public {
        bytes32 id = _split3(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _garbage();
        vm.prank(alice);
        kitty.fundWithPermit(id, 60e6, PDL, v, r, s);
        assertEq(_contributed(id, alice), 60e6);
    }

    function test_plainToken_withAllowance_fundForWithPermitStillFunds() public {
        bytes32 id = _split3(SALT_A);
        (uint8 v, bytes32 r, bytes32 s) = _garbage();
        vm.prank(stranger);
        kitty.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);
        assertEq(_contributed(id, bob), 25e6);
        assertEq(_contributed(id, stranger), 0);
    }

    function test_plainToken_withoutAllowance_reverts() public {
        bytes32 id = _split3(SALT_A);
        address broke = _plainUser(1, false);
        (uint8 v, bytes32 r, bytes32 s) = _garbage();
        vm.prank(broke);
        vm.expectRevert(abi.encodeWithSelector(Kitty.InsufficientAllowanceAfterPermit.selector, 0, 25e6));
        kitty.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);

        address half = _plainUser(2, false);
        vm.prank(half);
        usdc.approve(address(kitty), 24e6);
        vm.prank(half);
        vm.expectRevert(abi.encodeWithSelector(Kitty.InsufficientAllowanceAfterPermit.selector, 24e6, 25e6));
        kitty.fundForWithPermit(id, bob, 25e6, PDL, v, r, s);
    }
}
