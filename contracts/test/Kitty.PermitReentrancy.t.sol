// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";
import {KittyPermitAttacker, KittyPermitHookToken} from "./Kitty.PermitBase.t.sol";

/// A token whose permit() / transferFrom() call back into Kitty while the permit-path funding call
/// holds the reentrancy lock: every nested entry point must be rejected by the guard.
contract KittyPermitReentrancyTest is KittyTestBase {
    KittyPermitHookToken internal ht;
    Kitty internal hk;
    KittyPermitAttacker internal att;

    uint256 internal constant AMT = 10e6;

    function setUp() public override {
        super.setUp();
        ht = new KittyPermitHookToken();
        hk = new Kitty(address(ht));
        att = new KittyPermitAttacker(hk);
        ht.setTarget(att);
        ht.mint(address(att), 1_000e6);
        ht.mint(alice, 1_000e6);
    }

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

    function _one(KittyPermitAttacker.Attack a, bool onPermit, bool outerFor) internal {
        bytes32 id = att.createOpen(SALT_A, recipient, GOAL, deadline);
        att.configure(a, id, AMT);
        ht.arm(onPermit, !onPermit);
        if (outerFor) att.fundForWithPermitPot(id, alice, AMT);
        else att.fundWithPermitPot(id, AMT);

        _assertBlocked();
        address credited = outerFor ? alice : address(att);
        (, uint256 c,) = hk.getContribution(id, credited);
        assertEq(c, AMT, "outer funding credited exactly once");
        (,,,,,,, uint256 tf,,,) = hk.getPot(id);
        assertEq(tf, AMT);
        assertEq(hk.totalEscrowLiability(), AMT);
        assertEq(ht.balanceOf(address(hk)), AMT);
        assertFalse(ht.hookOnPermit() || ht.hookOnTransferFrom(), "hook is one-shot");
    }

    function _loop(bool onPermit, bool outerFor) internal {
        for (uint8 i = 1; i <= 7; i++) {
            uint256 snap = vm.snapshotState();
            _one(KittyPermitAttacker.Attack(i), onPermit, outerFor);
            assertTrue(vm.revertToState(snap));
        }
    }

    function test_reentrancy_viaPermitCallback_fundWithPermit() public {
        _loop(true, false);
    }

    function test_reentrancy_viaPermitCallback_fundForWithPermit() public {
        _loop(true, true);
    }

    function test_reentrancy_viaTransferFromCallback_fundWithPermit() public {
        _loop(false, false);
    }

    function test_reentrancy_viaTransferFromCallback_fundForWithPermit() public {
        _loop(false, true);
    }

    function test_guardReleasedAfterPermitPath_normalCallsWork() public {
        bytes32 id = att.createOpen(SALT_A, recipient, GOAL, deadline);
        att.configure(KittyPermitAttacker.Attack.Fund, id, AMT);
        ht.arm(true, false);
        att.fundWithPermitPot(id, AMT);
        _assertBlocked();

        // lock released: ordinary calls from anyone succeed again
        att.approveToken(ht);
        att.fundPot(id, 20e6);
        vm.prank(alice);
        ht.approve(address(hk), type(uint256).max);
        vm.prank(alice);
        hk.fund(id, 30e6);
        (,,,,,,, uint256 tf,,,) = hk.getPot(id);
        assertEq(tf, 60e6);
        att.configure(KittyPermitAttacker.Attack.None, id, 0);
    }
}
