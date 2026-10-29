# PayTogether

> Built with Arc Studio — split-checkout escrow dApp

## What This App Does

PayTogether is a group-checkout escrow dApp on Arc Testnet. An organizer creates an order naming a merchant, a USDC target, a deadline, and a set of contributors with individual shares. Each contributor approves and funds their share. Once fully funded, anyone may settle (paying the merchant). If the deadline passes with the order still incomplete, each contributor may reclaim their own contribution.

No admin, no upgrades, no loops. All refunds are pull-based.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28, OpenZeppelin 5, Foundry (forge). `via_ir = true` in foundry.toml.
- Wallet: injected (MetaMask, Rabby, etc.)
- Chain: Arc Testnet (chainId from `arcTestnet.id` in `viem/chains`)
- Token: ERC-20 USDC at `0x3600000000000000000000000000000000000000` (6 decimals). NOT the native Arc gas balance.
- Toasts: Sonner

## Key Files

- `src/App.tsx` — Root app, tabs (Create / Look Up)
- `src/pt-tx.ts` — Transaction orchestration: bytecode/token validation, lifecycle guard, approve+fund sequence, all action handlers. Testable without wagmi.
- `src/pt-utils.ts` — Pure utilities: parseUsdcAmount, formatUsdcDisplay, validateCreateDraft, orderStatus, deriveOrderId, etc.
- `src/pt-types.ts` — TypeScript types
- `src/pt-abi.ts` — Contract ABI
- `src/components/` — UI components (CreateOrderForm, OrderView, FundPanel, SettleRefundPanel, OrderLookup)
- `src/__tests__/payTogether.test.ts` — vitest utility tests (47 passing)
- `src/__tests__/pt-tx.test.ts` — vitest orchestration tests (mock wallet/publicClient only)
- `contracts/PayTogether.sol` — Solidity contract
- `contracts/test/PayTogether.t.sol` — Foundry tests (58 passing)
- `archive/pocket-studio/` — Archived prior project (do not touch)

## Contract Addresses

**Arc Testnet deployment (active):**
`CONTRACT_ADDRESS = 0xffa6e150d43fc2305e51cb02f2038433268ae8b0`
Set in `src/App.tsx` line 54.

### Deployment validation note (Oct 26 2026)

| Field | Value |
|---|---|
| Network | Arc Testnet (chainId 5042002) |
| Contract address | `0xffa6e150d43fc2305e51cb02f2038433268ae8b0` |
| Deploy tx hash | `0x988075f8872e0deda9e63a5324ffc81b29ce365a7278d08438eb85556f6b2543` |
| Deploy block | 69159371 |
| `token()` return value | `0x3600000000000000000000000000000000000000` (canonical Arc Testnet USDC) |
| `totalEscrowLiability()` | 0 (no current escrow liability observed at time of check; does not exclude past settled orders) |
| Contract source SHA-256 | `41ee6bfc419b4cfe92a1057e0f54bdb9044c845a8a33a1d200a034f13be28c90` (SHA-256 of UTF-8 file content of `contracts/PayTogether.sol`) |

**Runtime bytecode comparison method (corrected — full byte-for-byte):**
`artifact.deployedBytecode.immutableReferences` lists one immutable variable (id 14, the `address token` field) at four 32-byte slots: offsets 163, 465, 2346, 2645. These slots are zero-filled in the Foundry artifact. Before comparing, all four slots were overwritten with the canonical token address left-padded to 32 bytes (`0x000000000000000000000000` + `3600000000000000000000000000000000000000`). The patched 3993-byte buffer was then compared byte-for-byte against the `eth_getCode` result.

- Length: 3993 bytes (both)
- Every byte equal: **true**
- SHA-256(binary) of patched artifact: `0ea03f91634249d27f8b8e9630b1c6c17bf532365e990de515297625175117b5`
- SHA-256(binary) of eth_getCode:      `0ea03f91634249d27f8b8e9630b1c6c17bf532365e990de515297625175117b5`
- **Boolean equality: true**

The prior note's claim of "exact match" from head/tail/length only was incorrect; that claim is superseded by this result.

**Deployment mechanism:** the deploy transaction went through the ERC-4337 EntryPoint (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`), not a plain EOA CREATE — consistent with a smart-account wallet. The contract deployer address on-chain differs from the signing EOA.

**Test account `0xE8E259541F012b948DFc7B8033614eD48e64691e` at time of check:**
- Balance: `40000000000000000000` (native 18-dec units = 40.000000 USDC in ERC-20 6-dec terms)
- Nonce latest: 0 / pending: 0 (no pending transactions)

## To Run

```bash
bun install
bun run dev
```

## Tests

```bash
forge test          # 58 Solidity tests
bun run test        # 47 vitest utility + orchestration tests
bun run check       # lint + typecheck
```

## Kitty

- Product: Kitty ("put money in the kitty"), tagline "Nobody fronts the money." Vocabulary: kitty (pot), chip in (fund), pay out (settle), get refund (refund), recipient (payee).
- Contract: `contracts/Kitty.sol` (tests: `contracts/test/Kitty*.t.sol`). `PayTogether.sol` and its tests are legacy and untouched.
- Deployed on Arc Testnet: `0x12840026bd9457b41ae104536f0917a19dd88611` (tx `0x18dd71935db31534585192d4ffa2d86c5a71f96f6f6a101377b7b22657c478fc`, block 69,641,176), token = Arc USDC `0x3600000000000000000000000000000000000000`.
- One config file: `src/kitty-config.ts` (chain id -> contract, USDC, deploy block). Event scans start at the deploy block, never block 0.
- Routing is query params: `?kitty=<id>` (legacy `?order=` still works), `?view=mine`, `?view=open`, `?new=<split|open|request|template>`.
- Tx safety lives in `src/kitty-tx.ts` + `src/useKittyTx.ts` and reuses the lock/receipt primitives in `src/pt-tx.ts`: preflight, one write in flight, approval receipt before chip in, uncertain receipt keeps the lock and retries the same hash.
- Pot ids: random 32-byte salt client-side, `computePotId(creator, salt)` = keccak256(abi.encode(creator, salt)); the id is also read back from the PotCreated event.
- Contract rules the UI reflects: open kitties enforce `effectiveMinContribution` for first-time funders; a fully funded kitty unpaid at deadline + 30 days can no longer be paid out and becomes refundable.
- Legacy PayTogether helpers (`pt-utils`, `pt-share`, `pt-ui`, `pt-types`, `pt-abi`) stay only because Kitty reuses some of them and their tests still run.
