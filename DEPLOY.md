# Deploying Kitty to Arc mainnet

This guide is for the project owner. You deploy `contracts/Kitty.sol` yourself, from your own wallet. Arc Studio does not deploy to, sign for, fund or send transactions on mainnet.

> Warning: Transactions on mainnet involve real funds and, once submitted, are irreversible. Any code used for mainnet must be independently reviewed, tested, validated, deployed, and operated by you. You are solely responsible for any losses, errors, or other consequences. Before proceeding, use testnet, obtain an independent professional audit, and carefully review all wallet addresses, contract addresses, chain settings, permissions, and other configuration details.

Kitty has had a Foundry test suite and two rounds of automated security review. It has not had a paid third-party audit.

## Facts you will use

| | |
| --- | --- |
| Network | Arc mainnet |
| Chain ID | 5042 |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| Token (constructor argument) | Arc USDC `0x3600000000000000000000000000000000000000`, 6 decimals |
| Gas | Paid in USDC. The deploy needs about 1.3M gas, so keep a small USDC buffer in the deploying wallet. |

## 1. Build and test

```bash
forge build
forge test
bun run test
bun run check
```

All of it should pass before you spend anything.

## 2. Deploy

Never paste a private key into a file, a chat, or the command history. Pick one way to sign:

- Hardware wallet: add `--ledger` (or `--trezor`) instead of `--interactive`.
- Interactive prompt: `--interactive` asks for the key without echoing it.
- Environment variable, for this shell only: run `read -s PRIVATE_KEY && export PRIVATE_KEY`, use `--private-key "$PRIVATE_KEY"`, then `unset PRIVATE_KEY`. Do not put it in `.env`.

```bash
export ARC_RPC_URL=https://rpc.mainnet.arc.io

forge create contracts/Kitty.sol:Kitty \
  --rpc-url "$ARC_RPC_URL" \
  --interactive \
  --broadcast \
  --constructor-args 0x3600000000000000000000000000000000000000
```

Keep `--constructor-args` last, because it takes every value after it.

Save the two values it prints: `Deployed to` (the Kitty address) and `Transaction hash`. Then get the deploy block:

```bash
cast receipt <transaction hash> blockNumber --rpc-url "$ARC_RPC_URL"
```

## 3. Verify before anything points at it

The quickest way is the read-only check in this repo. It sends no transaction and needs no key:

```bash
forge build
bun run scripts/verify-deploy.ts <Kitty address> --rpc "$ARC_RPC_URL"
```

It must print PASS for every line:

1. `eth_getCode` is not empty.
2. The on-chain code matches the compiled artifact byte for byte. One 32-byte slot is ignored because it holds the token address, which Solidity writes into the code at deploy time.
3. `token()` is Arc USDC.
4. `SETTLE_GRACE` is 2592000 seconds (30 days).
5. The contributor caps are 64 and 256.
6. `totalEscrowLiability` is 0.

The same checks by hand:

```bash
cast code <Kitty address> --rpc-url "$ARC_RPC_URL"
cast call <Kitty address> "token()(address)" --rpc-url "$ARC_RPC_URL"
cast call <Kitty address> "SETTLE_GRACE()(uint256)" --rpc-url "$ARC_RPC_URL"
cast call <Kitty address> "totalEscrowLiability()(uint256)" --rpc-url "$ARC_RPC_URL"
```

If any check fails, do not use the address. There is no admin to fix a contract: deploy a fresh one instead. If the explorer supports source verification, do that too so people can read the code.

## 4. Switch the app over (one line)

In `src/kitty-config.ts`, replace the `ARC_MAINNET_AT` line with the address and block from step 2:

```ts
export const ARC_MAINNET_AT: DeployedAt = { kitty: '0x<Kitty address>', deployBlock: 123456n };
```

Both fields are required. Until both are set, the app says "Kitty is not deployed on Arc yet" and blocks every read and write. The app also re-checks the deployment in the browser (code present, `token()` is Arc USDC, USDC has 6 decimals) and blocks writes if that fails.

Then tell the hosted build to use mainnet. Set this in the hosting provider's build environment settings and rebuild:

```
VITE_KITTY_CHAIN=arc
```

The default is `arcTestnet`. Any other value, including a typo, also means testnet, so mainnet can only be selected on purpose. For a local mainnet run: `VITE_KITTY_CHAIN=arc bun run dev`.

Finally update the mainnet row in `README.md` with the address, an explorer link and an example transaction.

## 5. First real use

1. Start a tiny kitty (for example 1 USDC to a wallet you control) and read the confirmation that appears before the first write of the session.
2. Chip in, pay out, and check the receipt.
3. Start a second tiny kitty with a short deadline, chip in a little, let it expire, and get the refund.

Only then share links.

## If something is wrong

Kitty has no owner, no upgrade path and no pause. To move to a new contract, deploy it, update `ARC_MAINNET_AT`, and rebuild. Kitties on the old contract keep working on their own: people can still pay out and get refunds there. To go back to the testnet build, unset `VITE_KITTY_CHAIN`.
