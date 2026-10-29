# PayTogether – Verification Report

_Last updated: session 2, all open items from session 1 resolved._

---

## Summary

| Check | Result |
|---|---|
| `forge build` (Solc 0.8.28, `via_ir = true`) | PASS |
| Foundry unit + fuzz tests | **53 pass, 0 fail** |
| Foundry stateful invariant suite | **5 invariants pass, 256 runs × 500 calls each** |
| `bun run check` (oxlint + tsc) | PASS, 0 errors |
| `bun run test` (vitest 47 unit tests) | PASS, 47/47 |
| `bunx vite build` production build | PASS (chunk-size warnings only, not errors) |

---

## Contract: PayTogether.sol

### Design changes since session 1

1. **Immutable token**: `IERC20 public immutable token` is set in the constructor and shared
   by all orders on a deployment. Removed per-order `address token` from `createOrder`,
   `Order` struct, `getOrder` return tuple, ABI, and frontend. Deploy a fresh instance for
   a different token. Production target: Arc Testnet USDC
   (`0x3600000000000000000000000000000000000000`, 6 decimals).

2. **Self-address rejection**: `createOrder` now rejects `merchant == address(this)` in
   addition to `merchant == address(0)`. A self-transfer would mark the order settled while
   the tokens remain in the contract with no withdrawal path.

### Security properties

| Property | Mechanism |
|---|---|
| No double-spend (refund) | `refunded[msg.sender]` flag; CEI pattern |
| No double-settle | `settled` flag; CEI pattern |
| No excess withdrawal | `contributed[msg.sender]` ceiling |
| No inflation from donations | `totalEscrowLiability` counter separate from `balanceOf` |
| Reentrancy blocked | `ReentrancyGuard` on `fund`, `settle`, `refund` |
| Fee-on-transfer rejected | Balance-before/after delta check in `fund` |
| Outgoing transfer failure → rollback | CEI: effects before `safeTransfer`; Solidity reverts undo effects |
| Shares sum check | `sum != target → SharesSumMismatch` |
| Deadline exclusivity | Funding: `block.timestamp >= deadline → DeadlinePassed`; Refund: `block.timestamp < deadline → DeadlineNotReached` (so deadline == deadline is valid for refund) |

### Known trust assumptions and limitations

- Token must behave as a standard ERC-20 (no fee-on-transfer, no arbitrary callbacks on
  transfer, no admin freeze during a transaction).
- A token freeze or restriction _after_ a `fund()` call may trap contributed funds. There is no
  admin withdrawal or emergency exit.
- Merchant address is trusted by the organizer at order creation time.
- No oracle: `deadline` uses `block.timestamp` (validator-adjustable ±15 s).
- Settlement does not guarantee off-chain delivery or postpayment refund.
- No automatic execution: `settle`/`refund` require an explicit caller.

---

## Test suite: PayTogether.t.sol

### Unit + fuzz tests (PayTogetherTest): 53 total

| Category | Count |
|---|---|
| Contract meta (token immutable, zero-token constructor) | 2 |
| Order creation | 9 |
| Funding (partial, full, rejects) | 11 |
| Settlement | 7 |
| Outgoing-transfer failure on settle (revert + retry) | 2 |
| Refund (boundary, pull-only, double-refund, expiry) | 10 |
| Outgoing-transfer failure on refund (revert + retry) | 1 |
| No early settlement | 1 |
| Multiple independent orders | 1 |
| Failed inbound ERC-20 transfers (fund path) | 3 |
| Accounting / accidental transfer | 1 |
| Reentrancy callback-attempt tests | 3 |
| Fuzz (liability, settle, no-double-spend) | 3 |

**Exact-deadline boundary tests:**

| Test | Expected |
|---|---|
| `test_fund_rejectsAtDeadline` | `DeadlinePassed` when `block.timestamp == deadline` |
| `test_fund_allowsAtDeadlineMinus1` | succeeds at `deadline - 1` |
| `test_refund_succeedsAtExactDeadline` | succeeds when `block.timestamp == deadline` |
| `test_refund_failsBeforeDeadline` | `DeadlineNotReached` at `deadline - 1` |

**Real reentrancy callback-attempt tests (all three use `CallbackToken`):**

| Test | Outer call | Nested attempt | Guard result |
|---|---|---|---|
| `test_reentrancy_nestedRefund_blockedByGuard` | `refund()` | `refund()` | `ReentrancyGuard` reverts |
| `test_reentrancy_nestedSettle_duringRefund_blocked` | `refund()` | `settle()` | `ReentrancyGuard` reverts |
| `test_reentrancy_nestedFund_duringSettle_blocked` | `settle()` | `fund()` | `ReentrancyGuard` reverts |

All three tests assert `nestedXxxAttempted = true` (callback was reached, not vacuous)
and `nestedXxxReverted = true` (the guard blocked it, not any earlier check).

### Stateful invariant suite (PayTogetherInvariantTest): 5 invariants

Backed by a real `StdInvariant` handler with 5 actors, 5 randomised action handlers
(`handler_fund`, `handler_settle`, `handler_refundAfterExpiry`, `handler_donate`,
`handler_warp`), and 256 runs × 500 calls each. All use `bound()` instead of
`vm.assume` narrow ranges.

| Invariant | Assertion |
|---|---|
| `invariant_escrowLiabilityConsistent` | `totalEscrowLiability == sum of unrefunded contributions` |
| `invariant_balanceCoverLiability` | `balanceOf(address(pt)) >= totalEscrowLiability` |
| `invariant_noDoubleSpend` | `refunded[actor] <= funded[actor]` for all actors |
| `invariant_contribLEShare` | `contributed[actor] <= share[actor]` for all actors |
| `invariant_totalFundedLETarget` | `totalFunded <= target` |

---

## Frontend: vitest (47 tests)

All 47 tests pass in `src/__tests__/payTogether.test.ts`:
- `parseUsdcAmount` — 11 tests
- `formatUsdc` / `formatUsdcDisplay` / `USDC_DECIMALS` / `ARC_TESTNET_USDC` — 6 tests
- `isoToUnixSeconds` / `formatDeadline` — 4 tests
- `orderStatus` — 6 tests
- `validateCreateDraft` / `isDraftValid` — 12 tests
- `deriveOrderId` — 3 tests
- `shortAddress` — 2 tests
- `emptyDraft` — 2 tests (updated: no `tokenAddress` field; token fixed per deployment)

---

## Build notes

- `via_ir = true` in `foundry.toml` required to resolve stack-too-deep during compilation.
- Vite production build emits large-chunk warnings (wagmi/viem dependencies); no build errors.
- CSS fix: removed bare `font-mono;` invalid property at `index.css:287`.

---

## Open items

None. All items from session 1 are resolved.
