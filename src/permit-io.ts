// ─── Kitty – reading the token's permit domain (impure) ─────────────────────
// The typed-data domain is read from the token and checked against its own
// DOMAIN_SEPARATOR() before anyone is asked to sign. Any mismatch or read failure
// means "do not use permit": the caller falls back to approve + chip in.
import { parseAbi } from 'viem';
import type { KittyDeployment } from './kitty-config';
import type { MinimalPublicClient } from './pt-tx';
import { domainMatches, type PermitDomain } from './permit';

const permitReadAbi = parseAbi([
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function nonces(address owner) view returns (uint256)',
]);

/** Arc USDC reports version "2" (verified on chain). Used only if version() cannot be read. */
export const FALLBACK_PERMIT_VERSION = '2';

export type PermitCheck =
  | { ok: true; domain: PermitDomain }
  | { ok: false; reason: string };

// The domain never changes for a token on a chain, so a successful check is kept for the session.
const verified = new Map<string, PermitDomain>();
const keyOf = (dep: KittyDeployment) => `${dep.chainId}:${dep.usdc.toLowerCase()}`;

export async function checkPermitDomain(client: MinimalPublicClient, dep: KittyDeployment): Promise<PermitCheck> {
  const hit = verified.get(keyOf(dep));
  if (hit) return { ok: true, domain: hit };
  const read = (functionName: string) => client.readContract({ address: dep.usdc, abi: permitReadAbi, functionName });
  const [name, version, separator] = await Promise.allSettled([read('name'), read('version'), read('DOMAIN_SEPARATOR')]);
  if (name.status !== 'fulfilled' || typeof name.value !== 'string') return { ok: false, reason: 'Token name unavailable' };
  if (separator.status !== 'fulfilled' || typeof separator.value !== 'string') return { ok: false, reason: 'Domain separator unavailable' };
  const domain: PermitDomain = {
    name: name.value,
    version: version.status === 'fulfilled' && typeof version.value === 'string' ? version.value : FALLBACK_PERMIT_VERSION,
    chainId: dep.chainId,
    verifyingContract: dep.usdc,
  };
  if (!domainMatches(separator.value, domain)) return { ok: false, reason: 'Permit domain does not match the token' };
  verified.set(keyOf(dep), domain);
  return { ok: true, domain };
}

export type PreparedPermit =
  | { ok: true; domain: PermitDomain; nonce: bigint }
  | { ok: false; reason: string };

/** Domain check (cached) plus the owner's current nonce (always fresh). */
export async function preparePermit(client: MinimalPublicClient, dep: KittyDeployment, owner: `0x${string}`): Promise<PreparedPermit> {
  try {
    const check = await checkPermitDomain(client, dep);
    if (!check.ok) return check;
    const nonce = await client.readContract({ address: dep.usdc, abi: permitReadAbi, functionName: 'nonces', args: [owner] });
    if (typeof nonce !== 'bigint') return { ok: false, reason: 'Nonce unavailable' };
    return { ok: true, domain: check.domain, nonce };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 80) : 'Permit check failed' };
  }
}

/** Test hook. */
export function clearPermitCache(): void { verified.clear(); }
