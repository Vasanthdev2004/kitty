# PayTogether — Arc Testnet Live Test Results (2026-10-26)

**Scope:** Manual end-to-end flow verification on Arc Testnet (chain 5042002) using a
real browser wallet (Rabby) against the deployed contract. This is testnet flow
evidence provided by the tester; it is not a formal audit or security review.
Arc Studio did not independently observe these transactions — the results below
are reported by the tester and noted here for project record-keeping.

**Contract:** `0xffa6e150d43fc2305e51cb02f2038433268ae8b0`
**Token:** `0x3600000000000000000000000000000000000000` (Arc Testnet USDC, 6 decimals)

---

## Test 1 — Full funding + settlement

**Order ID:** `0xbda9425ce58ad49f2bb13b6f1cb7e94f949a6c60e943979e47d4a2f3bce9e300`

| Step | Detail |
|---|---|
| createOrder | Target 0.10 USDC, two contributors (A + B) |
| Fund A (partial) | 0.02 USDC |
| Fund A (top-up) | 0.04 USDC (cumulative 0.06) |
| Fund B | 0.04 USDC — order fully funded |
| Settle | Paid exact 0.10 USDC to merchant |
| Settlement tx | `0x03c7c5e3177669d2cfc6b57c1ff576513abaa71ef52d17231daa14afa844159a` |

**Post-settlement state (independent RPC):** escrow balance/liability 0, exact
gas-adjusted balances match, order marked settled.

---

## Test 2 — Partial funding + expiry + refund

**Order ID:** `0xe6b0f7f149fae7872c28265636e5e77636726e46fd3ea96c7e09c1c37cd5d88d`

| Step | Detail |
|---|---|
| createOrder | Two contributors (A + B); short deadline |
| Fund A | 0.02 USDC |
| Expiry | Order expired 2026-10-26 08:46 UTC without full funding |
| Refund A | 0.02 USDC returned to A |
| Refund tx | `0x8324486c4a451de45a2687117321c1e9008245a538635ad28448b95135170960` |
| Confirmed at block | 69170861 |

**Post-refund state (independent RPC):** A.refunded = true, B contribution 0 /
refunded = false, historical totalFunded 20000 retained in struct,
escrow balance/liability 0, allowances 0, merchant unchanged, exact
gas-adjusted balances match.

---

## Environment notes

- uBlock Origin EasyPrivacy blocked local third-party Arc RPC requests;
  filtering was paused for the test page.
- Rabby Wallet had a stale `rpc.testnet.arc.network` endpoint configured;
  switching to the official `rpc.testnet.arc.io` resolved write failures.
- No further transactions planned against this contract.
