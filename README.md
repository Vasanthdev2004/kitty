# Kitty

Put money in the kitty. Kitty is a shared pot for bills, gifts, group buys and seller payment requests. Money stays locked until the goal is met, the recipient is paid once in full, and if the deadline passes everyone gets their own money back. Nobody fronts the money.

Built with [Arc Studio](https://studio.arc.io)

## What you can do

- Split a bill: name each person and their share.
- Pool for a goal: share a link and let anyone chip in until it is full.
- Request payment: a seller starts a kitty that pays themselves, with a button they can add to their own site.
- Start from a template (group gift, trip, rent deposit, group buy, event tickets, team tool).
- Follow a kitty live: progress, countdown, who chipped in, and an activity feed.
- See all your kitties in one place, grouped by what needs your action.
- Get a printable receipt once a kitty is paid out.
- Light, dark and system themes.

## Tech stack

- React, TypeScript, Vite, Tailwind CSS
- wagmi, viem, ConnectKit
- Motion, Number Flow, Phosphor icons, Geist fonts
- Solidity (Foundry) on Arc, paid in USDC
- Vitest

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh) (only for the contracts).

```bash
bun install
bun run dev        # start the app
bun run test       # unit tests
bun run check      # lint + typecheck
bun run kitty:abi  # regenerate src/kitty-abi.ts after `forge build`
bun run kitty:smoke # read-only checks against the deployed contract
```

The chain and contract address live in `src/kitty-config.ts`.

### Environment variables

None.
