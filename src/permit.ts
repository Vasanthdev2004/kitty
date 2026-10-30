// ─── Kitty – EIP-2612 permit helpers (pure) ─────────────────────────────────
// One-tap chip in: the wallet signs a permit for exactly the amount, then a single
// transaction (fundWithPermit / fundForWithPermit) spends it. Everything here is
// pure so the typed data, the domain check and the path choice can be unit tested.
import { encodeAbiParameters, keccak256, toBytes, parseSignature } from 'viem';

type Address = `0x${string}`;
type Hex = `0x${string}`;

/** How long a signed permit stays valid. */
export const PERMIT_VALID_SECONDS = 20n * 60n;

export interface PermitDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function permitDeadline(nowSec: number | bigint): bigint {
  return BigInt(nowSec) + PERMIT_VALID_SECONDS;
}

export interface PermitTypedData {
  domain: PermitDomain;
  types: typeof PERMIT_TYPES;
  primaryType: 'Permit';
  message: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint };
}

/** The exact EIP-712 payload the wallet is asked to sign. */
export function buildPermitTypedData(i: {
  domain: PermitDomain; owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint;
}): PermitTypedData {
  return {
    domain: i.domain,
    types: PERMIT_TYPES,
    primaryType: 'Permit',
    message: { owner: i.owner, spender: i.spender, value: i.value, nonce: i.nonce, deadline: i.deadline },
  };
}

const DOMAIN_TYPEHASH = keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));

/** EIP-712 domain separator, built locally so it can be compared with the token's DOMAIN_SEPARATOR(). */
export function localDomainSeparator(d: PermitDomain): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [DOMAIN_TYPEHASH, keccak256(toBytes(d.name)), keccak256(toBytes(d.version)), BigInt(d.chainId), d.verifyingContract],
  ));
}

/** True only if the domain we would sign is exactly the one the token verifies. */
export function domainMatches(chainSeparator: string, d: PermitDomain): boolean {
  return chainSeparator.toLowerCase() === localDomainSeparator(d).toLowerCase();
}

export type ChipInPath = 'plain' | 'permit' | 'approve';

/**
 * allowance already covers it -> plain (no signature, no approval)
 * otherwise permit when the domain checked out, else approve + chip in.
 */
export function chooseChipInPath(i: { allowanceRaw: bigint; amountRaw: bigint; permitUsable: boolean }): ChipInPath {
  if (i.allowanceRaw >= i.amountRaw) return 'plain';
  return i.permitUsable ? 'permit' : 'approve';
}

/** 65-byte signature -> (v, r, s) as the contract wants them. */
export function splitSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const p = parseSignature(sig);
  const v = p.v !== undefined ? Number(p.v) : p.yParity + 27;
  return { v, r: p.r, s: p.s };
}

/** The wallet said no on purpose (as opposed to not supporting typed-data signing). */
export function isSignRejection(e: unknown): boolean {
  const code = (e as { code?: number } | undefined)?.code;
  if (code === 4001) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /user rejected|user denied|rejected the request|denied (the )?(message )?signature/i.test(msg);
}

/** Helper copy under the Chip in button. */
export function chipInHelper(path: ChipInPath): string {
  return path === 'plain' ? 'One transaction' : 'One signature, one transaction';
}
