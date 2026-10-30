// ─── Kitty – deployment config (one place) ──────────────────────────────────
// Chain, contract address and USDC live here, keyed by chain ID. Everything
// chain-specific in the UI (network name, explorer links, faucet hint, footer
// note) is read from the active deployment, never hardcoded in components.
//
// WHICH chain a build uses is chosen by VITE_KITTY_CHAIN ("arc" | "arcTestnet",
// default "arcTestnet"). The hosted build sets it; local dev leaves it unset.
import type { Chain } from 'viem';
import { arc, arcTestnet } from 'viem/chains';
import { getUsdc, requireChain } from './onchain-facts';

export type KittyChainKey = 'arc' | 'arcTestnet';

export interface KittyDeployment {
  key: KittyChainKey;
  chainId: number;
  chain: Chain;
  /** Network name shown in copy, e.g. "Arc Testnet". */
  name: string;
  /** Short name for buttons, e.g. "Switch to Arc". */
  shortName: string;
  /** Kitty contract. Meaningless (zero address) while `deployed` is false: never read from it. */
  kitty: `0x${string}`;
  /** False until BOTH the address and the deploy block are filled in below. Blocks all reads and writes. */
  deployed: boolean;
  /** The single ERC-20 the contract is deployed with. */
  usdc: `0x${string}`;
  usdcDecimals: number;
  /** Block the contract was deployed in. Event scans start here, never at block 0. */
  deployBlock: bigint;
  explorerBase: string;
  testnet: boolean;
  /** Faucet for test USDC. Testnet only: mainnet has none, so no hint is ever shown there. */
  faucetUrl?: string;
}

/** Where a Kitty contract lives on one chain. Both fields are needed. */
export interface DeployedAt {
  kitty?: `0x${string}`;
  deployBlock?: bigint;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// ── Fill these in. They are the ONLY lines to edit when a contract is deployed. ──

/**
 * Arc Testnet: Kitty v2 (permit chip in, pay for a friend, cancel), deployed from Arc Studio.
 * LEGACY, no longer used by the app: Kitty v1 at 0x12840026bd9457b41ae104536f0917a19dd88611
 * (tx 0x18dd71935db31534585192d4ffa2d86c5a71f96f6f6a101377b7b22657c478fc, block 69,641,176).
 * Kitties created on v1 are not visible in this build.
 */
const ARC_TESTNET_AT: DeployedAt = {
  kitty: '0x621b7aadfbc5870b95d4d95245529059536da7e5',
  deployBlock: 69_829_378n,
};

/**
 * TODO(mainnet): after deploying contracts/Kitty.sol to Arc mainnet (see DEPLOY.md), replace
 * this ONE line with: { kitty: '0x<deployed address>', deployBlock: <block number>n }
 * The app shows "Kitty is not deployed on Arc yet" and blocks every write until both are set.
 */
export const ARC_MAINNET_AT: DeployedAt = { kitty: undefined, deployBlock: undefined };

// ── Builders ─────────────────────────────────────────────────────────────────

function usdcFor(chainId: number): `0x${string}` {
  const usdc = getUsdc(chainId);
  if (!usdc) throw new Error(`No USDC registered for chain ${chainId}`);
  return usdc.address as `0x${string}`;
}

/** Pure: builds a deployment from a chain and where Kitty lives on it. */
export function makeDeployment(
  key: KittyChainKey,
  chain: Chain,
  meta: { name: string; shortName: string; testnet: boolean; faucetUrl?: string },
  at: DeployedAt,
): KittyDeployment {
  const deployed = !!at.kitty && at.deployBlock !== undefined && at.deployBlock > 0n;
  return {
    key,
    chainId: chain.id,
    chain,
    name: meta.name,
    shortName: meta.shortName,
    kitty: deployed ? (at.kitty as `0x${string}`) : ZERO_ADDRESS,
    deployed,
    usdc: usdcFor(chain.id),
    usdcDecimals: 6,
    deployBlock: deployed ? (at.deployBlock as bigint) : 0n,
    explorerBase: requireChain(chain.id).explorerBase,
    testnet: meta.testnet,
    faucetUrl: meta.faucetUrl,
  };
}

export const KITTY_DEPLOYMENTS: Record<number, KittyDeployment> = {
  [arcTestnet.id]: makeDeployment(
    'arcTestnet', arcTestnet,
    { name: 'Arc Testnet', shortName: 'Arc', testnet: true, faucetUrl: 'https://faucet.circle.com' },
    ARC_TESTNET_AT,
  ),
  [arc.id]: makeDeployment('arc', arc, { name: 'Arc', shortName: 'Arc', testnet: false }, ARC_MAINNET_AT),
};

const KEY_TO_CHAIN_ID: Record<KittyChainKey, number> = { arc: arc.id, arcTestnet: arcTestnet.id };

/** VITE_KITTY_CHAIN -> chain key. Anything but "arc" means the testnet, so a typo can never select mainnet. */
export function selectChainKey(raw: string | undefined): KittyChainKey {
  return raw?.trim().toLowerCase() === 'arc' ? 'arc' : 'arcTestnet';
}

export const ACTIVE_CHAIN_KEY: KittyChainKey = selectChainKey(import.meta.env.VITE_KITTY_CHAIN);

/** The chain this build talks to. */
export const ACTIVE_CHAIN_ID: number = KEY_TO_CHAIN_ID[ACTIVE_CHAIN_KEY];

export function getDeployment(chainId: number = ACTIVE_CHAIN_ID): KittyDeployment {
  const d = KITTY_DEPLOYMENTS[chainId];
  if (!d) throw new Error(`Kitty is not deployed on chain ${chainId}`);
  return d;
}

export const ACTIVE = getDeployment();

// ── Chain-specific copy (all of it lives here, not in components) ────────────

/** First line of the footer. */
export function footerNote(dep: KittyDeployment): string {
  return dep.testnet
    ? `${dep.name} only. Test USDC has no real value.`
    : 'Kitty moves real USDC on Arc. Payouts cannot be reversed. Only chip in to kitties you trust.';
}

/** One sentence for the "terms are permanent" notice. */
export function fundsNote(dep: KittyDeployment): string {
  return dep.testnet ? `${dep.name} uses test USDC with no real value.` : 'This moves real USDC.';
}

export function notDeployedTitle(dep: KittyDeployment): string {
  return `Kitty is not deployed on ${dep.shortName} yet`;
}
