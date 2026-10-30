# Kitty

**Nobody fronts the money.**

Kitty is a group money pool on Arc, settled in USDC. Split a bill with named shares, pool for a goal that anyone can chip in to, or let a seller request a payment that a group pays together. The money sits in escrow until the goal is met and is then paid out once, in full. If the goal is not met by the deadline, everyone pulls their own refund.

Built with [Arc Studio](https://studio.arc.io)

## How it works

1. **Create.** Start a kitty: set a recipient, a goal, a deadline and a name. Choose named shares (split), or an open pool where anyone can chip in. A seller can create a kitty that pays themselves to request payment.
2. **Share the link.** Every kitty has its own link, QR code and a ready-made message to send.
3. **Chip in.** People put in USDC before the deadline. Nothing goes to the recipient yet, and nobody can chip in more than the goal.
4. **Pay out or refund.** When the goal is met, anyone can trigger the payout and the recipient receives the full amount in one payment. If the deadline passes first, each person gets their own money back with one click.

One extra rule protects against a recipient that cannot receive USDC: if a fully funded kitty is still not paid out 30 days after its deadline, paying out closes and every contributor can take back their own money.

## Safety model

- No owner, no admin, no upgrades. The token is set once at deploy time.
- Refunds are pull-based: each contributor withdraws only their own contribution, once.
- OpenZeppelin `SafeERC20` and `ReentrancyGuard`, with state updated before any token transfer.
- Exact-receipt check: a transfer that delivers a different amount than requested (for example a fee-on-transfer token) reverts.
- IDs cannot be squatted: a kitty ID is `keccak256(abi.encode(creator, salt))`, so nobody can claim an ID in someone else's name.
- Bounded work: at most 64 named contributors in a split kitty and 256 distinct contributors in an open one. No loops over unbounded data in any state-changing call.
- Dust floor: in an open kitty, a first-time contributor must chip in at least the larger of the creator's minimum and `goal / 256` (rounded up), unless the payment completes the goal. Filling every contributor slot therefore costs at least the whole goal.
- `totalEscrowLiability` tracks what the contract owes, and invariant tests check it against the token balance.

Kitty has not had a paid third-party audit. Treat testnet as the supported environment for now.

## Deployments

| Network | Chain ID | Kitty contract | Token |
| --- | --- | --- | --- |
| Arc Testnet | 5042002 | [`0x12840026bd9457b41ae104536f0917a19dd88611`](https://explorer.testnet.arc.io/address/0x12840026bd9457b41ae104536f0917a19dd88611) | Arc USDC `0x3600000000000000000000000000000000000000` (6 decimals) |
| Arc mainnet | | Coming soon (address and example transaction to be added) | |

## Built with Arc Studio

[Open this project in Arc Studio](https://studio.arc.io/app/fb199c2b-afd5-4012-8e12-f128223fe87d).

Kitty was built end to end in Arc Studio. The Solidity contract was written, tested and security-reviewed there: a Foundry suite with fuzz and invariant tests, plus two rounds of review that led to the 30-day payout rule and the dust floor. The frontend was built in Studio over several turns, from the first PayTogether prototype to the Kitty rebuild with routes, activity feed, receipts and RPC resilience. The contract was deployed to Arc Testnet from Studio.

## Tech stack

Solidity 0.8.28, Foundry, OpenZeppelin. React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, Motion, Phosphor icons, Geist fonts. Vitest for the frontend tests.

## Run locally

Prerequisites: [Bun](https://bun.sh). [Foundry](https://getfoundry.sh) is only needed for the contracts.

```bash
bun install
bun run dev
```

The chain, contract address and USDC address live in `src/kitty-config.ts`. The app reads no environment variables. `.env.example` lists the optional variables used by the scripts in `scripts/`.

To rebuild the contract ABI used by the app: `forge build`, then `bun run kitty:abi`.

## Tests

```bash
forge test        # 253 tests pass (193 Kitty, 60 legacy PayTogether)
bun run test      # 270 tests pass
bun run check     # lint + typecheck, 0 errors
```

The Kitty suite includes fuzz tests and 7 invariants, each run for 256 runs of 500 calls.

## Roadmap

- Recurring kitties
- Agent chip-in through Circle agent wallets and x402
- Cross-chain chip-in with CCTP
- Milestone payouts
- An embeddable checkout SDK

## Repo map

- `contracts/Kitty.sol`: the escrow contract
- `contracts/test/`: Foundry tests (`Kitty*.t.sol`)
- `contracts/contract-metadata/Kitty.json`: the Arc Testnet deployment record
- `src/kitty-config.ts`: chain and deployment config, one place
- `src/kitty-core.ts`: pure helpers (pot IDs, minimums, phases, routes, templates)
- `src/kitty-tx.ts`, `src/useKittyTx.ts`: safe transaction flow (preflight, one write at a time, uncertain receipts)
- `src/kitty-data.ts`, `src/useKittyData.ts`: batched chain reads and event scans
- `src/components/`: the interface
- `scripts/`: ABI generator and a read-only smoke test (`bun run kitty:smoke`)

## Legacy

`contracts/PayTogether.sol` and its tests, and `archive/pocket-studio`, are earlier prototypes kept for reference. Kitty does not use them.
