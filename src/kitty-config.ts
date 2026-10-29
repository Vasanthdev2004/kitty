// ─── Kitty – deployment config (one place) ──────────────────────────────────
// Chain + contract address live here, keyed by chain ID. To move the app to
// Arc mainnet later: add a deployment entry for the mainnet chain ID (and add
// that chain to the wagmi config), then point ACTIVE_CHAIN_ID at it.
import type { Chain } from 'viem';
import { arcTestnet } from 'viem/chains';
import { getUsdc, requireChain } from './onchain-facts';

export interface KittyDeployment {
  chainId: number;
  chain: Chain;
  /** Human name shown in copy, e.g. "Arc Testnet". */
  name: string;
  /** Kitty contract. */
  kitty: `0x${string}`;
  /** The single ERC-20 the contract was deployed with. */
  usdc: `0x${string}`;
  usdcDecimals: number;
  /** Block the contract was deployed in. Event scans start here, never at block 0. */
  deployBlock: bigint;
  explorerBase: string;
  testnet: boolean;
}

function usdcFor(chainId: number): `0x${string}` {
  const usdc = getUsdc(chainId);
  if (!usdc) throw new Error(`No USDC registered for chain ${chainId}`);
  return usdc.address as `0x${string}`;
}

export const KITTY_DEPLOYMENTS: Record<number, KittyDeployment> = {
  [arcTestnet.id]: {
    chainId: arcTestnet.id,
    chain: arcTestnet,
    name: 'Arc Testnet',
    kitty: '0x12840026bd9457b41ae104536f0917a19dd88611',
    usdc: usdcFor(arcTestnet.id),
    usdcDecimals: 6,
    deployBlock: 69_641_176n,
    explorerBase: requireChain(arcTestnet.id).explorerBase,
    testnet: true,
  },
};

/** The chain this build talks to. Changing this one line switches the whole app. */
export const ACTIVE_CHAIN_ID: number = arcTestnet.id;

export function getDeployment(chainId: number = ACTIVE_CHAIN_ID): KittyDeployment {
  const d = KITTY_DEPLOYMENTS[chainId];
  if (!d) throw new Error(`Kitty is not deployed on chain ${chainId}`);
  return d;
}

export const ACTIVE = getDeployment();
