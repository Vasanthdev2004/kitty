# Kitty

**Nobody fronts the money.**

Kitty is a group money pool on Arc, settled in USDC. Split a bill with named shares, pool for a goal that anyone can chip in to, or let a seller request a payment that a group pays together. The money sits in escrow until the goal is met and is then paid out once, in full. If the goal is not met by the deadline, everyone pulls their own refund.

Built with [Arc Studio](https://studio.arc.io)

Live app: [kitty-five-mu.vercel.app](https://kitty-five-mu.vercel.app) (Arc mainnet)
Try it free: [kitty-five-mu.vercel.app/testnet/](https://kitty-five-mu.vercel.app/testnet/) (Arc Testnet, test USDC)

## Judge's tour (60 seconds)

1. Open the [testnet app](https://kitty-five-mu.vercel.app/testnet/), or open the live app and flip the **Mainnet | Testnet** switch in the header.
2. Connect a wallet and get free test USDC from the [Circle faucet](https://faucet.circle.com) (the **Get USDC** button in the app links to it).
3. Create a **split**: name two or more people and their shares, set a deadline, start the kitty.
4. **Chip in** with one signature and one transaction (no separate approval step).
5. When everyone has chipped in, **pay out**. The recipient is paid once, in full.
6. Flip the switch to **Mainnet**. The proof strip on the home page shows the real contract, its deploy transaction and the facts behind it, and you can open the real mainnet transactions on the explorer.

No wallet? When the host has set `VITE_FEATURED_KITTIES`, the home page links **See a real paid-out kitty**: a finished kitty you can read, with its activity and receipt, without connecting anything.

## Features

- **One-tap chip in.** One signature and one transaction, no separate approval step, on wallets that can sign typed data. Other wallets fall back to approve, then chip in.
- **Pay for a friend.** Cover someone's share. They are credited, so if the kitty is refunded the money goes to them, not you.
- **Cancel.** The creator or the recipient can stop a kitty that is not fully funded. Everyone can take their money back right away.
- **Live stats.** The home page shows how much has been paid out, how many kitties were started and how many people chipped in, plus the latest payouts.
- **Seller requests.** A dashboard of the payment requests you made to yourself, with totals, a link and embed button for each, and a CSV export.
- **Share tools.** An editable message, WhatsApp and Telegram links, the device share sheet, a QR code, a "Save as image" card, reminders for people who still owe, and a "What happens next" timeline.

## For merchants

A shop can put a **Pay together** link or button next to its normal checkout. The buyer opens it with the shop and the amount already filled in, shares it with friends, and the shop is paid once, in full, when everyone has chipped in. If it falls short by the deadline, everyone is refunded. There is no backend and no account: the link is the order.

**Link format**

```
<app>/?new=open|split|request&to=<shop address>&amount=<USDC>&ref=<what it is for>&days=<1 to 90>&lock=1&shop=<shop name>
```

| Parameter | Meaning |
| --- | --- |
| `new` | `open` (a pool anyone chips into) or `split` (named people) fix the mode. `request` lets the buyer choose. |
| `to` | The shop's wallet address. It is the recipient. It cannot be the Kitty contract or the USDC token. |
| `amount` | The order amount in USDC: above zero, at most 6 decimals. |
| `ref` | What it is for. At most 64 bytes of UTF-8. |
| `days` | Deadline, counted from when the buyer opens the link. A whole number from 1 to 90. |
| `lock` | `1` makes the recipient and amount read-only for the buyer. |
| `shop` | Display name, at most 40 characters. |

Bad values are ignored, and the page says which. Example (replace the address with your own):

```
https://kitty-five-mu.vercel.app/?new=open&to=0x3333333333333333333333333333333333333333&amount=240&ref=Espresso+machine&days=7&lock=1&shop=Acme+Coffee
```

**Button snippet** (one inline-styled link, no script, no external files):

```html
<a href="https://kitty-five-mu.vercel.app/?new=open&amp;to=0x3333333333333333333333333333333333333333&amp;amount=240&amp;ref=Espresso+machine&amp;days=7&amp;lock=1&amp;shop=Acme+Coffee" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#3563F2;color:#F7F8FF;font:600 14px/1 system-ui,sans-serif;text-decoration:none">Pay together</a>
```

The **For sellers** page in the app (`?view=sell`) builds the link, the snippet, a QR code and a live preview of the button as you type, and the **Demo store** (`?view=shop`) shows the buyer's side. Links made on the testnet build keep the `/testnet/` path.

**The flow**

1. The shop adds the link or button next to its checkout.
2. The buyer opens it. The kitty form is prefilled with the shop as recipient and the order amount.
3. The buyer shares the kitty. Friends chip in with one signature each.
4. When the amount is reached, anyone can pay out and the shop receives it in one payment. If the deadline passes first, everyone pulls their own refund.

Funds go straight from escrow to the merchant address. There is no intermediary: no one at Kitty holds, routes or can redirect the money. Checkout kitties started by buyers also show up in the shop's **Requests** tab, tagged "Checkout", and in its CSV export.

## How it works

1. **Create.** Start a kitty: set a recipient, a goal, a deadline and a name. Choose named shares (split), or an open pool where anyone can chip in. A seller can create a kitty that pays themselves to request payment.
2. **Share the link.** A new kitty opens on a share step: an editable message, WhatsApp and Telegram links, the device's share sheet, a QR code and a "Save as image" card for group chats. On a split kitty the creator and the recipient can also remind each person who still owes, with that person's exact remaining share. A "What happens next" timeline shows the deadline and the 30-day payout window.
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

Kitty has not had a paid third-party audit. The contract was tested and reviewed in Arc Studio (see below), but that is not a substitute for one. Start with small amounts on mainnet, or try everything free on testnet first.

## Deployments

| Network | Chain ID | Kitty contract | Token |
| --- | --- | --- | --- |
| Arc Testnet | 5042002 | [`0x621b7aadfbc5870b95d4d95245529059536da7e5`](https://explorer.testnet.arc.io/address/0x621b7aadfbc5870b95d4d95245529059536da7e5) | Arc USDC `0x3600000000000000000000000000000000000000` (6 decimals) |
| Arc mainnet | 5042 | [`0x965281605d34f7045cbef306fe690118e6626192`](https://explorer.arc.io/address/0x965281605d34f7045cbef306fe690118e6626192) ([deploy tx](https://explorer.arc.io/tx/0xd95a3e960d9ea9ac953ae4a45be14c48eff6d8eed83f0123b0f3982a7dafb86f), block 28,763,168) | Arc USDC `0x3600000000000000000000000000000000000000` (6 decimals) |

Both contracts are Kitty v2 (the same bytecode, token address aside). The live app, [kitty-five-mu.vercel.app](https://kitty-five-mu.vercel.app), is built for Arc mainnet. The earlier v1 contract (`0x12840026bd9457b41ae104536f0917a19dd88611`) is legacy and no longer used by the app.

## Built with Arc Studio

[Open this project in Arc Studio](https://studio.arc.io/app/fb199c2b-afd5-4012-8e12-f128223fe87d).

Kitty was built end to end in Arc Studio. The Solidity contract was written, tested and security-reviewed there: a Foundry suite with fuzz and invariant tests, plus two rounds of review that led to the 30-day payout rule and the dust floor. The frontend was built in Studio over several turns, from the first PayTogether prototype to the Kitty rebuild with routes, activity feed, receipts and RPC resilience. Studio deployed Kitty to Arc Testnet and tested it there. The Arc mainnet contract was deployed from the builder's own wallet, outside Studio, and Studio then verified it read-only: the deployed code matches the compiled contract, the token is Arc USDC, and nothing is held in escrow. Studio does not deploy to, sign for, or fund anything on mainnet.

## Tech stack

Solidity 0.8.28, Foundry, OpenZeppelin. React, TypeScript, Vite, Tailwind CSS, wagmi, viem, ConnectKit, Motion, Phosphor icons, Geist fonts. Vitest for the frontend tests.

## Run locally

Prerequisites: [Bun](https://bun.sh). [Foundry](https://getfoundry.sh) is only needed for the contracts.

```bash
bun install
bun run dev
```

The chain, contract address and USDC address live in `src/kitty-config.ts`.

Environment variables (all optional):

- `VITE_KITTY_CHAIN`: which deployment the build uses, `arcTestnet` (default) or `arc`. The hosted build sets it. Any other value means `arcTestnet`. If a chain has no contract address in `src/kitty-config.ts`, the app shows "Kitty is not deployed on Arc yet" and blocks every read and write. See [DEPLOY.md](DEPLOY.md).
- `VITE_MAINNET_URL` and `VITE_TESTNET_URL`: absolute URLs of the two builds (production: `https://kitty-five-mu.vercel.app` and `https://kitty-five-mu.vercel.app/testnet/`). Both builds read the same two values. They drive the **Mainnet | Testnet** switch in the header, the "Back to mainnet" and "Try it free on testnet" links, and the "This kitty is on the other network" hint. The switch is hidden when the other network's URL is not set.
- `VITE_WALLETCONNECT_PROJECT_ID`: a WalletConnect project id. When set, WalletConnect (phones, QR) is offered next to injected browser wallets on both Arc chains. When missing or empty, nothing changes. On a phone without a wallet extension, the app also shows "Open in wallet app" links for MetaMask and Coinbase Wallet that reopen the current page there.
- `VITE_FEATURED_KITTIES`: one or more kitty ids (`0x` plus 64 hex characters, comma-separated; invalid entries are ignored). The first is linked as "See a real paid-out kitty" from the home page, so visitors without a wallet can see a finished kitty. Unset, nothing is shown. The app never lists anyone else's kitties.
- `VITE_SITE_URL`: the public address of the hosted app. For the live app set it to `https://kitty-five-mu.vercel.app`. It makes the social preview image (`public/og-image.png`) an absolute URL, which chat apps need, so link previews get the image. Without it the tags use a relative path.

### Hosting notes

- **One Vercel project, two builds.** The mainnet app is served at `/` and the Arc Testnet app at `/testnet/`, both from the same deployment. The project's build command is exactly:

  ```bash
  vite build && VITE_KITTY_CHAIN=arcTestnet vite build --base /testnet/ --outDir dist/testnet
  ```

  with `VITE_KITTY_CHAIN=arc` set in the project's environment, so the first build is mainnet. That setting stays the source of truth: `vercel.json` sets no `buildCommand` or `outputDirectory`. To reproduce the same two builds locally, run `bun run build:site` (it sets the chain for each build itself; export `VITE_MAINNET_URL`, `VITE_TESTNET_URL` and `VITE_SITE_URL` first). The output is `dist/` plus `dist/testnet/`.
- Links the app builds (share links, QR codes, reminders, the embed button) keep the base path, so the testnet build shares `/testnet/?kitty=...` links.

- The app reads Arc through a same-origin `/rpc` proxy: `/rpc/arc` and `/rpc/arc-testnet` are rewritten to the public Arc RPCs by `vercel.json` (and by `vite.config.ts` for local dev and `vite preview`). Requests to your own origin are first-party, so browser content blockers that block `arc.io` do not break the app. The direct Arc RPCs stay in the list as fallbacks. The proxy paths sit at the root of the origin, so a second build served from `/testnet/` uses the same ones.
- History (home stats, activity, My kitties, the seller dashboard) is read from the Blockdaemon mirror of the Arc RPC, which accepts `eth_getLogs` spans up to 100,000 blocks; the official RPCs reject spans of 10,000 or more. `/rpc/arc-logs` and `/rpc/arc-testnet-logs` are rewritten to the Blockdaemon hosts the same way, then Blockdaemon is tried directly. The app reads the whole history once in chunks of at most 99,000 blocks, falls back to 9,999-block pieces on the regular RPCs if a chunk fails, and keeps the result in the browser (localStorage) so later visits only read what is new.
- If the browser still cannot reach any RPC, the app says so once, in a notice with a Reload button, instead of failing silently.

To rebuild the contract ABI used by the app: `forge build`, then `bun run kitty:abi`.

## Tests

```bash
forge test        # 377 tests pass (317 Kitty, 60 legacy PayTogether)
bun run test      # 606 tests pass
bun run check     # lint + typecheck, 0 errors
```

The Kitty suite includes fuzz tests and 14 invariants, each run for 256 runs of 500 calls.

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
- `src/share-messages.ts`, `src/avatar.ts`: share messages and chat links, and avatar identity (pure, tested)
- `public/og-image.png`: the social preview image (`tools/make-og-image.mjs` regenerates it)
- `scripts/`: ABI generator, a read-only smoke test (`bun run kitty:smoke`) and a read-only post-deploy check (`scripts/verify-deploy.ts`)
- `DEPLOY.md`: how the owner deploys Kitty to Arc mainnet and switches the app over

## Legacy

`contracts/PayTogether.sol` and its tests, and `archive/pocket-studio`, are earlier prototypes kept for reference. Kitty does not use them.
