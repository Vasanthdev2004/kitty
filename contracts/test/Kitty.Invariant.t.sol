// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {Kitty} from "../Kitty.sol";
import {KittyMockUSDC} from "./Kitty.Base.t.sol";
import {KittyHandler} from "./Kitty.Handler.t.sol";

contract KittyInvariantTest is Test {
    Kitty internal kitty;
    KittyMockUSDC internal usdc;
    KittyHandler internal handler;

    function setUp() public {
        usdc = new KittyMockUSDC();
        kitty = new Kitty(address(usdc));
        handler = new KittyHandler(kitty, usdc);

        bytes4[] memory sels = new bytes4[](9);
        sels[0] = KittyHandler.fund.selector;
        sels[1] = KittyHandler.settle.selector;
        sels[2] = KittyHandler.refund.selector;
        sels[3] = KittyHandler.createOpen.selector;
        sels[4] = KittyHandler.stray.selector;
        sels[5] = KittyHandler.warp.selector;
        sels[6] = KittyHandler.warpToValve.selector;
        sels[7] = KittyHandler.fundAny.selector;   // fund / fundFor / fundWithPermit / fundForWithPermit
        sels[8] = KittyHandler.cancel.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        // Only the handler drives state: keep the fuzzer off the token (free mint!) and Kitty itself.
        excludeContract(address(usdc));
        excludeContract(address(kitty));
    }

    // ── deterministic sanity: every handler path can succeed ──────────────────

    function test_handlerPathsExecute() public {
        // pot 3: open, goal 50e6, recipient = handler. actors fund & settle.
        handler.fund(3, 0, 0); // amtSeed%3==0 -> maxAmt = 50e6 (completes)
        assertEq(handler.fundOk(), 1);
        handler.settle(3);
        assertEq(handler.settleOk(), 1);
        // pot 0: actor 0 funds partially then everyone refunds after warp
        handler.fund(0, 0, 1);
        assertEq(handler.fundOk(), 2);
        handler.stray(123e6);
        vm.warp(block.timestamp + 3 days);
        handler.refund(0, 0);
        assertEq(handler.refundOk(), 1);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 123e6);
    }

    /// Valve path, deterministically: fully funded pot, settle before the window, refund only after it.
    function test_handlerValvePathExecutes() public {
        handler.fund(3, 0, 0);           // pot 3 (open, goal 50e6) fully funded by actor 0
        assertEq(handler.fundOk(), 1);
        handler.warpToValve(3, 0);       // mode%5==0, (0/5)%4==0 -> valve - 1
        handler.refund(3, 0);            // PotFullyFunded: must not succeed
        assertEq(handler.refundOk(), 0);
        assertEq(handler.unexpectedRefund(), 0);
        handler.warpToValve(3, 5);       // (5/5)%4==1 -> exactly the valve
        handler.settle(3);               // SettleWindowClosed
        assertEq(handler.settleOk(), 0);
        assertEq(handler.windowRejects(), 1);
        handler.refund(3, 0);            // valve refund
        assertEq(handler.refundOk(), 1);
        assertEq(handler.valveRefundOk(), 1);
        assertEq(kitty.totalEscrowLiability(), 0);
        assertEq(usdc.balanceOf(address(kitty)), 0);
        assertEq(handler.missedRefund() + handler.missedSettle() + handler.unexpectedRefund() + handler.unexpectedSettle(), 0);
    }

    /// cancel path, deterministically: partial pot, cancel (no tokens move), immediate refund before the deadline.
    function test_handlerCancelPathExecutes() public {
        handler.fund(0, 0, 1);                 // pot 0: actor 0 funds part of their share
        uint256 liab = kitty.totalEscrowLiability();
        uint256 bal = usdc.balanceOf(address(kitty));
        handler.cancel(0, 0);                  // handler is the creator: legal
        assertEq(handler.cancelOk(), 1);
        assertEq(handler.cancelMovedTokens(), 0);
        assertEq(kitty.totalEscrowLiability(), liab);
        assertEq(usdc.balanceOf(address(kitty)), bal);
        handler.fundAny(0, 1, 1, 16, 0);       // funding a cancelled pot is rejected
        assertEq(handler.unexpectedFund() + handler.missedFund(), 0);
        handler.settle(0);
        assertEq(handler.settleOk(), 0);
        assertEq(handler.settleAfterCancel(), 0);
        handler.refund(0, 0);                  // before the deadline, but cancelled
        assertEq(handler.refundOk(), 1);
        assertEq(handler.cancelledRefundOk(), 1);
        assertEq(handler.unexpectedRefund() + handler.missedRefund(), 0);
        assertEq(kitty.totalEscrowLiability(), 0);
        handler.cancel(0, 0);                  // AlreadyCancelled: correctly rejected
        assertEq(handler.cancelRejected(), 1);
        assertEq(handler.unexpectedCancel() + handler.missedCancel(), 0);
    }

    /// fundFor / permit-style funding, deterministically (payer != beneficiary, allowance stripped, junk amounts).
    function test_handlerFundAnyPathsExecute() public {
        uint256 eff = kitty.effectiveMinContribution(handler.pots(3));
        handler.fundAny(3, 0, 1, 16, 1);       // kind 1 fundFor: actor0 pays, actor1 credited
        assertEq(handler.fundOk(), 1);
        assertEq(handler.fundForOk(), 1);
        assertEq(handler.ghostCredit(handler.pots(3), handler.actors(1)), eff);
        assertEq(handler.ghostCredit(handler.pots(3), handler.actors(0)), 0);

        handler.fundAny(3, 2, 3, 16, 3 + (2 << 8)); // kind 3 fundForWithPermit with max allowance
        assertEq(handler.fundForOk(), 2);
        assertEq(handler.permitOk(), 1);

        handler.fundAny(3, 2, 2, 16, 2);       // kind 2 with allowance stripped (allowMode 0): must be rejected
        assertEq(handler.permitOk(), 1);
        handler.fundAny(3, 2, 2, 16, 2 + (2 << 8)); // kind 2, allowance intact: funds
        assertEq(handler.permitOk(), 2);
        assertEq(handler.unexpectedFund() + handler.missedFund(), 0);
        assertEq(usdc.allowance(handler.actors(2), address(kitty)), type(uint256).max, "allowance restored");
    }

    /// Logs how much of each action actually executed (coverage evidence, -vv).
    function afterInvariant() public view {
        console2.log("fundOk", handler.fundOk());
        console2.log("settleOk", handler.settleOk());
        console2.log("refundOk", handler.refundOk());
        console2.log("strays", handler.strayCount());
        console2.log("valveRefundOk", handler.valveRefundOk());
        console2.log("windowRejects", handler.windowRejects());
        console2.log("valveWarps", handler.valveWarps());
        console2.log("pots", handler.potCount());
        console2.log("fundForOk", handler.fundForOk());
        console2.log("permitOk", handler.permitOk());
        console2.log("fundRejected", handler.fundRejected());
        console2.log("cancelOk", handler.cancelOk());
        console2.log("cancelRejected", handler.cancelRejected());
        console2.log("cancelledRefundOk", handler.cancelledRefundOk());
    }

    // ── invariants ────────────────────────────────────────────────────────────

    /// totalEscrowLiability == sum over pots of (unsettled, un-refunded contributions)
    function invariant_liabilityEqualsOpenContributions() public view {
        uint256 expected;
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            (,,,,,, bool settled,,,,) = kitty.getPot(id);
            if (settled) continue;
            address[] memory cs = kitty.getContributors(id);
            for (uint256 j = 0; j < cs.length; j++) {
                (, uint256 c, bool r) = kitty.getContribution(id, cs[j]);
                if (!r) expected += c;
            }
        }
        assertEq(kitty.totalEscrowLiability(), expected, "liability != unsettled un-refunded contributions");
    }

    /// balance >= liability, and the surplus is exactly the stray transfers
    function invariant_balanceCoversLiability_surplusIsStray() public view {
        uint256 bal = usdc.balanceOf(address(kitty));
        uint256 liab = kitty.totalEscrowLiability();
        assertGe(bal, liab, "balance < liability");
        assertEq(bal - liab, handler.totalStray(), "surplus != stray");
    }

    /// token conservation: everything in minus everything out
    function invariant_tokenConservation() public view {
        assertEq(
            usdc.balanceOf(address(kitty)),
            handler.ghostIn() + handler.totalStray() - handler.ghostOutSettle() - handler.ghostOutRefund(),
            "conservation broken"
        );
    }

    /// totalFunded <= goal and totalFunded == sum(contributed)
    function invariant_totalFundedWithinGoal() public view {
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            (,, uint256 goal,,,,, uint256 tf,,,) = kitty.getPot(id);
            assertLe(tf, goal, "totalFunded > goal");
            address[] memory cs = kitty.getContributors(id);
            uint256 sum;
            for (uint256 j = 0; j < cs.length; j++) {
                (, uint256 c,) = kitty.getContribution(id, cs[j]);
                sum += c;
            }
            assertEq(sum, tf, "sum(contributed) != totalFunded");
        }
    }

    /// Split pots: contributed <= share
    function invariant_contributedWithinShare() public view {
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            (,,,,, Kitty.Mode mode,,,,,) = kitty.getPot(id);
            if (mode != Kitty.Mode.Split) continue;
            address[] memory cs = kitty.getContributors(id);
            for (uint256 j = 0; j < cs.length; j++) {
                (uint256 sh, uint256 c,) = kitty.getContribution(id, cs[j]);
                assertLe(c, sh, "contributed > share");
            }
        }
    }

    /// No one refunded more than contributed (and exactly contributed when flagged);
    /// no pot is both settled and refunded; settled pots are fully funded.
    function invariant_refundsBoundedAndExclusiveWithSettle() public view {
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            (,, uint256 goal,,,, bool settled, uint256 tf,,,) = kitty.getPot(id);
            if (settled) assertEq(tf, goal, "settled but not fully funded");
            address[] memory cs = kitty.getContributors(id);
            for (uint256 j = 0; j < cs.length; j++) {
                (, uint256 c, bool r) = kitty.getContribution(id, cs[j]);
                uint256 got = handler.refundReceived(id, cs[j]);
                assertLe(got, c, "refunded > contributed");
                if (r) {
                    assertEq(got, c, "refund != contribution");
                    assertFalse(settled, "pot both settled and refunded");
                    // a refund from a fully funded pot is only legal via the valve (counted by the handler)
                    if (tf == goal) assertGt(handler.refundCount(id), 0, "full-pot refund not from handler");
                } else {
                    assertEq(got, 0, "refund without flag");
                }
            }
        }
    }

    /// Each non-handler recipient holds exactly the sum of goals of its settled pots
    function invariant_recipientsPaidGoalExactlyOnce() public view {
        for (uint256 r = 0; r < handler.recipientCount(); r++) {
            address rec = handler.recipients(r);
            uint256 expected;
            for (uint256 i = 0; i < handler.potCount(); i++) {
                (, address prec, uint256 goal,,,, bool settled,,,,) = kitty.getPot(handler.pots(i));
                if (settled && prec == rec) expected += goal;
            }
            assertEq(usdc.balanceOf(rec), expected, "recipient payout mismatch");
        }
    }

    /// settle never succeeds after the window / twice / on an unfunded pot, and always succeeds inside
    /// the window on a fully funded unsettled pot. Likewise refund legality (incl. the valve) is exact.
    function invariant_settleAndRefundGatingExact() public view {
        assertEq(handler.unexpectedSettle(), 0, "settle succeeded outside its window");
        assertEq(handler.missedSettle(), 0, "settle failed inside its window");
        assertEq(handler.unexpectedRefund(), 0, "refund succeeded when illegal");
        assertEq(handler.missedRefund(), 0, "refund failed when legal");
    }

    /// No pot is both settled and (even partly) refunded, including via the valve.
    function invariant_noPotBothSettledAndRefunded() public view {
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            (,,,,,, bool settled,,,,) = kitty.getPot(id);
            if (settled) assertEq(handler.refundCount(id), 0, "settled pot has refunds");
        }
    }

    /// Valve refunds only ever return a contributor's own contribution (conservation of the pot's escrow):
    /// the sum refunded + still-owed for an unsettled pot equals totalFunded.
    function invariant_unsettledPotEscrowSplitsIntoRefundedPlusOwed() public view {
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            (,,,,,, bool settled, uint256 tf,,,) = kitty.getPot(id);
            if (settled) continue;
            address[] memory cs = kitty.getContributors(id);
            uint256 refundedSum;
            uint256 owed;
            for (uint256 j = 0; j < cs.length; j++) {
                (, uint256 c, bool r) = kitty.getContribution(id, cs[j]);
                if (r) refundedSum += handler.refundReceived(id, cs[j]);
                else owed += c;
            }
            assertEq(refundedSum + owed, tf, "refunded + owed != totalFunded");
        }
    }

    // ── v2 invariants ─────────────────────────────────────────────────────────

    /// A cancelled pot is never settled, is never fully funded, and settle never succeeded on one.
    function invariant_cancelledPotNeverSettled() public view {
        assertEq(handler.settleAfterCancel(), 0, "settle succeeded after cancel");
        for (uint256 i = 0; i < handler.potCount(); i++) {
            (,, uint256 goal,,,, bool settled, uint256 tf,,, bool canc) = kitty.getPot(handler.pots(i));
            if (!canc) continue;
            assertFalse(settled, "cancelled pot settled");
            assertLt(tf, goal, "cancelled pot is fully funded");
        }
    }

    /// Funding legality (incl. fundFor / permit-style / cancelled pots) and cancel legality match the model exactly;
    /// cancel never moves tokens or changes the liability.
    function invariant_fundAndCancelGatingExact() public view {
        assertEq(handler.unexpectedFund(), 0, "funding succeeded when illegal");
        assertEq(handler.missedFund(), 0, "funding failed when legal");
        assertEq(handler.unexpectedCancel(), 0, "cancel succeeded when illegal");
        assertEq(handler.missedCancel(), 0, "cancel failed when legal");
        assertEq(handler.cancelMovedTokens(), 0, "cancel moved tokens");
    }

    /// Only beneficiaries are credited: contributed == the sum of what the handler paid for that address
    /// (payers paying for others are never credited, in any funding flavour).
    function invariant_creditsGoToBeneficiariesOnly() public view {
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            address[] memory cs = kitty.getContributors(id);
            for (uint256 j = 0; j < cs.length; j++) {
                (, uint256 c,) = kitty.getContribution(id, cs[j]);
                assertEq(c, handler.ghostCredit(id, cs[j]), "credit != paid-for amount");
            }
            for (uint256 a = 0; a < handler.actorCount(); a++) {
                address actor = handler.actors(a);
                (, uint256 c,) = kitty.getContribution(id, actor);
                assertEq(c, handler.ghostCredit(id, actor), "actor credit mismatch");
            }
        }
    }

    /// Per person on a cancelled pot: refunded exactly what was contributed, never more.
    function invariant_cancelledRefundsExactAndBounded() public view {
        for (uint256 i = 0; i < handler.potCount(); i++) {
            bytes32 id = handler.pots(i);
            (,,,,,,,,,, bool canc) = kitty.getPot(id);
            if (!canc) continue;
            address[] memory cs = kitty.getContributors(id);
            for (uint256 j = 0; j < cs.length; j++) {
                (, uint256 c, bool r) = kitty.getContribution(id, cs[j]);
                uint256 got = handler.refundReceived(id, cs[j]);
                assertLe(got, c, "refunded > contributed");
                assertEq(got, r ? c : 0, "cancelled-pot refund != contribution");
            }
        }
    }
}
