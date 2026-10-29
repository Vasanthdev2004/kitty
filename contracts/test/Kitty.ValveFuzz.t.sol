// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Kitty} from "../Kitty.sol";
import {KittyTestBase} from "./Kitty.Base.t.sol";

/// Fuzz around deadline + SETTLE_GRACE: settle XOR refund availability.
contract KittyValveFuzzTest is KittyTestBase {
    // ── fuzz: settle XOR refund around deadline + SETTLE_GRACE ────────────────

    /// Evaluates settle and refund from the same state (via snapshot) at time `t`.
    function _probe(bytes32 id, uint256 t) internal returns (bool canSettle, bool canRefund) {
        uint256 snap = vm.snapshotState();
        vm.warp(t);
        try kitty.settle(id) { canSettle = true; } catch {}
        vm.revertToState(snap);
        vm.warp(t);
        vm.prank(alice);
        try kitty.refund(id) { canRefund = true; } catch {}
    }

    function testFuzz_valveBoundary_wideRange(uint256 offset, bool openMode) public {
        bytes32 id;
        if (openMode) {
            id = _fullOpen(SALT_A);
        } else {
            id = _split3(SALT_A);
            _fullFundSplit3(id);
        }
        uint256 t = uint256(deadline) - 1 + bound(offset, 0, 2 * kitty.SETTLE_GRACE());
        (bool canSettle, bool canRefund) = _probe(id, t);
        // block.timestamp must be at least the funding time; funds were placed before the deadline
        assertTrue(canSettle != canRefund, "settle XOR refund");
        assertEq(canSettle, t < _valveTime());
        assertEq(canRefund, t >= _valveTime() && t >= deadline);
    }

    function testFuzz_valveBoundary_tightAroundGrace(uint256 delta, bool openMode) public {
        bytes32 id;
        if (openMode) {
            id = _fullOpen(SALT_A);
        } else {
            id = _split3(SALT_A);
            _fullFundSplit3(id);
        }
        uint256 t = _valveTime() - 5 + bound(delta, 0, 10);
        (bool canSettle, bool canRefund) = _probe(id, t);
        assertTrue(canSettle != canRefund, "settle XOR refund");
        assertEq(canSettle, t < _valveTime());
        assertEq(canRefund, t >= _valveTime());
    }

    /// Incomplete pots: refund availability is independent of the settle window.
    function testFuzz_incompletePot_refundableFromDeadlineSettleNever(uint256 offset) public {
        bytes32 id = _open(SALT_A, GOAL, 0);
        _fund(id, alice, 99e6);
        uint256 t = uint256(deadline) + bound(offset, 0, 3 * kitty.SETTLE_GRACE());
        (bool canSettle, bool canRefund) = _probe(id, t);
        assertFalse(canSettle);
        assertTrue(canRefund);
    }
}
