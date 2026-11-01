# Kitty

Kitty is a group-payment escrow on Arc, settled in USDC. Tagline: "Nobody fronts the money." A kitty is a pot with a goal and a deadline. Split a bill (named shares), pool for a goal (open, all-or-nothing), or request payment (the seller is the recipient). Money sits in escrow until the goal is met and then pays out once, in full; if it is not met by the deadline, everyone pulls their own refund.

Built with Arc Studio (https://studio.arc.io). Studio wrote, tested and reviewed the contract, built the frontend, and deployed and tested on Arc Testnet. The Arc mainnet contract was deployed from the project owner's own wallet and verified read-only by Studio.

## Run and test

```bash
bun install
bun run dev          # local app
bun run check        # lint + typecheck
bun run test         # vitest (counts are in README and src/project-facts.ts)
forge test           # Solidity tests (contracts/test)
bun run build:site   # both builds: mainnet at /, Arc Testnet at /testnet/
```

## Layout

- `contracts/Kitty.sol` and `contracts/test/Kitty*.t.sol`: the contract and its Foundry tests. `contracts/contract-metadata/Kitty.json` records the deployments.
- `src/kitty-*.ts`, `src/useKitty*.ts`: config, ABI, pure helpers, reads, scans and the transaction layer. `src/components/`: the UI.
- `src/log-scan.ts`, `src/logs-client.ts`: chain history (see below).
- `scripts/verify-deploy.ts`: read-only post-deploy check against the compiled artifact.
- Legacy and unused by the app: `contracts/PayTogether.sol` (and its tests) and `archive/pocket-studio`. `src/pt-*.ts` helpers stay only because Kitty reuses some of them and their tests still run.

## Kitty

- Product: Kitty ("put money in the kitty"), tagline "Nobody fronts the money." Vocabulary: kitty (pot), chip in (fund), pay out (settle), get refund (refund), recipient (payee).
- Contract: `contracts/Kitty.sol` (tests: `contracts/test/Kitty*.t.sol`). `PayTogether.sol` and its tests are legacy and untouched.
- Deployed on Arc Testnet (Kitty v2, permit chip in + pay for a friend + cancel): `0x621b7aadfbc5870b95d4d95245529059536da7e5` (tx `0xb88d8d84eb45570c317a048d4b863eb5636bf2e0aad25e73fc8f2ea9dbcbff2c`, block 69,829,378), token = Arc USDC `0x3600000000000000000000000000000000000000`. Legacy v1: `0x12840026bd9457b41ae104536f0917a19dd88611` (tx `0x18dd71935db31534585192d4ffa2d86c5a71f96f6f6a101377b7b22657c478fc`, block 69,641,176), no longer used. The UI uses the v2 features: one-tap chip in (fundWithPermit / fundForWithPermit, with approve + chip in as the fallback), pay for a friend (fundFor), cancel, and getPot's 11th value `cancelled`. Also live home stats and a seller dashboard (`?view=requests`).
- One config file: `src/kitty-config.ts` (chain id -> contract, USDC, deploy block; Arc Testnet 5042002 and Arc mainnet 5042). Event scans start at the deploy block, never block 0.
- `VITE_KITTY_CHAIN` (`arc` | `arcTestnet`, default `arcTestnet`) picks the deployment. Arc mainnet (5042) Kitty v2 is `0x965281605d34f7045cbef306fe690118e6626192` (deployed by the owner from their own wallet, tx `0xd95a3e960d9ea9ac953ae4a45be14c48eff6d8eed83f0123b0f3982a7dafb86f`, block 28,763,168); it is `ARC_MAINNET_AT` in kitty-config.ts (one line, see DEPLOY.md). The default build stays on testnet unless `VITE_KITTY_CHAIN=arc`. Without an address the app shows "Kitty is not deployed on Arc yet" and blocks reads and writes. Studio never deploys, signs or funds on mainnet.
- Mainnet only: first write of a session shows a confirmation (amount, recipient, irreversible payout); acknowledgement is kept in sessionStorage. Testnet-only copy (footer, Testnet pill, faucet hint) comes from the config.
- Routing is query params: `?kitty=<id>` (legacy `?order=` still works), `?view=mine`, `?view=open`, `?new=<split|open|request|template>`.
- Tx safety lives in `src/kitty-tx.ts` + `src/useKittyTx.ts` and reuses the lock/receipt primitives in `src/pt-tx.ts`: preflight, one write in flight, approval receipt before chip in, uncertain receipt keeps the lock and retries the same hash.
- Pot ids: random 32-byte salt client-side, `computePotId(creator, salt)` = keccak256(abi.encode(creator, salt)); the id is also read back from the PotCreated event.
- Contract rules the UI reflects: open kitties enforce `effectiveMinContribution` for first-time funders; a fully funded kitty unpaid at deadline + 30 days can no longer be paid out and becomes refundable.

## Share, avatars and the kitty page

- Avatars: `boring-avatars` (marble, one 5-colour palette) for addresses, initials on soft tints for names and "You" (`src/avatar.ts`). The connected wallet always shows the "You" avatar.
- Share step (`ShareStep.tsx`): shown after creating a kitty and to its creator until dismissed (localStorage, per chain and kitty). Messages and chat links are pure and tested (`src/share-messages.ts`). No third-party scripts. "Save as image" draws a canvas card (`src/lib/kittyCard.ts`).
- Social preview: static `public/og-image.png` plus og/twitter tags in `index.html`. `VITE_SITE_URL` (optional) makes the image URL absolute.
- Kitty page has ONE clock (`useChainNow`, paused while the tab is hidden). Its live phase drives the countdown, timeline and action card; when the phase passes the last read, the page re-reads once.

- RPC access: `src/config.ts` tries a same-origin proxy first (`/rpc/arc`, `/rpc/arc-testnet`; `vercel.json` in production, `vite.config.ts` proxy in dev/preview), then the direct arc.io RPCs. Reason: some content blockers block third-party requests to arc.io. `src/rpc-health.ts` records outright fetch failures (turned into status 599 so viem does not back off) and `useRpcBlocked()` drives one inline notice. Live URL: https://kitty-five-mu.vercel.app (also builds a Testnet copy under /testnet/; keep proxy paths origin-level, no catch-all rewrite in vercel.json).

- One site, two builds: mainnet at `/` (`VITE_KITTY_CHAIN=arc`), Arc Testnet at `/testnet/` (`vite build --base /testnet/`). Vercel's build command stays the source of truth (no `buildCommand` in vercel.json); `bun run build:site` reproduces it. Both builds read `VITE_MAINNET_URL` / `VITE_TESTNET_URL` (header switch, banners, "this kitty is on the other network" hint); a switch never carries a kitty id. `VITE_WALLETCONNECT_PROJECT_ID` (optional) adds WalletConnect; phones without a wallet get "Open in wallet app" links (src/wallet-links.ts). Facts shown on the home page (proof strip, test counts) live in `src/project-facts.ts` and must match README.

- Merchant checkout ("Pay together"): `src/checkout.ts` parses and builds checkout links (`?new=open|split|request&to&amount&ref&days&lock&shop`, strict validation, bad values ignored and named). `?view=sell` (For sellers: link, button snippet, QR) and `?view=shop` (demo store) are routes; the Requests tab also lists checkout kitties (recipient == wallet, creator != wallet) tagged "Checkout", and the CSV has a Type column. The network switch carries view=sell|shop but never checkout params or a kitty id.

- History reads (home stats, activity feed, My kitties, seller dashboard) go through `src/log-scan.ts`. The official Arc RPCs reject eth_getLogs spans of 10,000 blocks or more; the Blockdaemon mirrors accept up to 100,000. So the whole contract history is read once from the deploy block in chunks of at most 99,000 blocks (newest first, 3 at a time) on the logs path (`/rpc/arc-logs`, `/rpc/arc-testnet-logs` rewrites to Blockdaemon, then Blockdaemon directly). A failed chunk is retried in pieces of at most 9,999 blocks on the regular transports; rate limits back off. The result is cached in localStorage per chain and contract (`kitty:logs:v1:<chainId>:<address>`), later loads only scan what is new, and every consumer filters the same set by topic.
- `VITE_FEATURED_KITTIES` (optional, comma-separated kitty ids; the first is used) adds "See a real paid-out kitty" to the home hero and proof strip. The hero's demo card is labelled "Example". The testnet build gets its own page title (`src/site-html.ts`).
