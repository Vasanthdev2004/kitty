// ─── PayTogether – Pure utilities ───────────────────────────────────────────
// No chain calls, no React. All functions are testable in vitest.

import { parseUnits, formatUnits, isAddress, keccak256, encodePacked } from 'viem';
import type { CreateOrderDraft, CreateFormErrors, DraftShare } from './pt-types';

// Arc Testnet USDC ERC-20 (6 decimals)
// Source: onchain-facts.ts (Arc Testnet usdc.address)
export const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';
export const USDC_DECIMALS = 6;

// ── Amount parsing ────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; raw: bigint }
  | { ok: false; error: string };

/**
 * Parse a decimal USDC string to raw 6-decimal bigint.
 * Rejects: empty, NaN, Infinity, exponent notation, > 6 fractional digits,
 * negative, zero (unless allowZero).
 */
export function parseUsdcAmount(input: string, allowZero = false): ParseResult {
  const s = input.trim();
  if (!s) return { ok: false, error: 'Amount is required' };
  // Reject exponent notation
  if (/[eE]/.test(s)) return { ok: false, error: 'Exponent notation not allowed' };
  // Reject non-numeric (allow digits, one dot, optional leading minus)
  if (!/^-?\d+(\.\d*)?$/.test(s)) return { ok: false, error: 'Invalid number' };
  // Reject negative
  if (s.startsWith('-')) return { ok: false, error: 'Amount must be positive' };
  // Check fractional digits
  const dotIdx = s.indexOf('.');
  if (dotIdx !== -1) {
    const frac = s.slice(dotIdx + 1);
    if (frac.length > USDC_DECIMALS) {
      return { ok: false, error: `Maximum ${USDC_DECIMALS} decimal places` };
    }
  }
  try {
    const raw = parseUnits(s, USDC_DECIMALS);
    if (!allowZero && raw === 0n) return { ok: false, error: 'Amount must be greater than zero' };
    return { ok: true, raw };
  } catch {
    return { ok: false, error: 'Invalid amount' };
  }
}

/** Format a raw 6-decimal bigint to a display string (e.g. "60.00") */
export function formatUsdc(raw: bigint): string {
  return formatUnits(raw, USDC_DECIMALS);
}

/**
 * Format a raw 6-decimal bigint to a display string with grouping.
 * Never uses parseFloat/Number — all arithmetic stays in bigint/string.
 * Examples: 100_000_000n → "$100.00 USDC", 1n → "$0.000001 USDC",
 *           1_000_000_000_000n → "$1,000,000.00 USDC"
 */
export function formatUsdcDisplay(raw: bigint): string {
  // formatUnits gives the exact decimal string from viem (no float rounding)
  const s = formatUnits(raw, USDC_DECIMALS); // e.g. "100", "0.000001", "1000000"
  // Split on decimal point
  const dotIdx = s.indexOf('.');
  let intPart = dotIdx === -1 ? s : s.slice(0, dotIdx);
  let fracPart = dotIdx === -1 ? '' : s.slice(dotIdx + 1);

  // Pad/trim fractional part to exactly 2 minimum display digits
  // (show up to 6 significant fractional digits, trimming trailing zeros beyond 2)
  while (fracPart.length < 2) fracPart += '0';
  // Trim trailing zeros beyond 2 places
  while (fracPart.length > 2 && fracPart.endsWith('0')) {
    fracPart = fracPart.slice(0, -1);
  }

  // Add thousands grouping to integer part without parseFloat
  // Walk from right, insert comma every 3 digits
  let grouped = '';
  const digits = intPart.startsWith('-') ? intPart.slice(1) : intPart;
  const neg = intPart.startsWith('-');
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits[i];
  }
  if (neg) grouped = '-' + grouped;

  return `$${grouped}.${fracPart} USDC`;
}

// ── OrderId derivation ────────────────────────────────────────────────────────

/**
 * Derive a deterministic bytes32 orderId from the organizer's address,
 * orderRef string, and target amount. Organizer controls uniqueness via ref.
 * The UI appends a timestamp component to reduce collision risk.
 */
export function deriveOrderId(
  organizer: string,
  ref: string,
  targetRaw: bigint,
  nonce: number
): `0x${string}` {
  return keccak256(
    encodePacked(
      ['address', 'string', 'uint256', 'uint256'],
      [organizer as `0x${string}`, ref, targetRaw, BigInt(nonce)]
    )
  );
}

// ── Deadline helpers ──────────────────────────────────────────────────────────

/** Convert ISO datetime-local string to unix timestamp seconds */
export function isoToUnixSeconds(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return Math.floor(d.getTime() / 1000);
}

/** Format a unix timestamp as a human-readable string */
export function formatDeadline(unixSec: bigint | number): string {
  const ms = typeof unixSec === 'bigint' ? Number(unixSec) * 1000 : unixSec * 1000;
  return new Date(ms).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

/**
 * Returns 'open' (funding ok), 'past-deadline' (no funding, refund eligible),
 * or 'settled'. Derived from chain timestamp — wall-clock is indicative only.
 */
export function orderStatus(
  settled: boolean,
  totalFunded: bigint,
  target: bigint,
  deadline: bigint,
  chainTimestamp: bigint
): 'funded-settled' | 'funded-unsettled' | 'open' | 'expired-incomplete' {
  if (settled) return 'funded-settled';
  if (totalFunded >= target) return 'funded-unsettled';
  if (chainTimestamp >= deadline) return 'expired-incomplete';
  return 'open';
}

// ── Form validation ───────────────────────────────────────────────────────────

// The zero address as a checksummed/lowercased string for comparison.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Max safe uint256 for share/target amounts: 2^256-1 in raw 6-dec units.
 *  We cap at 10^30 (1 trillion USDC, far above any realistic value) to catch overflow inputs. */
const MAX_USDC_RAW = 1_000_000_000_000_000_000n; // 10^18 * 10^6 — effectively impossible to reach

/**
 * Validate the create-order draft form. Returns errors object (empty = valid).
 * @param contractAddress  When set, rejects merchant === contractAddress (would trap funds).
 */
export function validateCreateDraft(
  draft: CreateOrderDraft,
  nowUnixSeconds: number,
  contractAddress?: string
): CreateFormErrors {
  const errors: CreateFormErrors = {};

  // Merchant
  const merchantTrimmed = draft.merchant.trim();
  if (!merchantTrimmed) {
    errors.merchant = 'Merchant address is required';
  } else if (!isAddress(merchantTrimmed)) {
    errors.merchant = 'Invalid Ethereum address';
  } else if (merchantTrimmed.toLowerCase() === ZERO_ADDRESS) {
    errors.merchant = 'Merchant cannot be the zero address';
  } else if (
    contractAddress &&
    merchantTrimmed.toLowerCase() === contractAddress.toLowerCase()
  ) {
    errors.merchant = 'Merchant cannot be the escrow contract itself (funds would be trapped)';
  }

  // Order ref
  if (!draft.orderRef.trim()) {
    errors.orderRef = 'Order reference is required';
  }

  // Target
  if (!draft.targetUsdc.trim()) {
    errors.targetUsdc = 'Target amount is required';
  } else {
    const parsed = parseUsdcAmount(draft.targetUsdc);
    if (!parsed.ok) {
      errors.targetUsdc = parsed.error;
    } else if (parsed.raw > MAX_USDC_RAW) {
      errors.targetUsdc = 'Amount exceeds maximum representable value';
    }
  }

  // Deadline
  const deadlineTs = isoToUnixSeconds(draft.deadlineIso);
  if (!draft.deadlineIso) {
    errors.deadlineIso = 'Deadline is required';
  } else if (deadlineTs <= nowUnixSeconds) {
    errors.deadlineIso = 'Deadline must be in the future';
  }

  // Shares
  const shareErrors: string[] = [];
  let sumOk = true;
  const targetParsed = parseUsdcAmount(draft.targetUsdc);
  const seenAddresses = new Set<string>();

  for (let i = 0; i < draft.shares.length; i++) {
    const s: DraftShare = draft.shares[i];
    let err = '';
    const addrTrimmed = s.address.trim();
    if (!addrTrimmed) {
      err = 'Address required';
    } else if (!isAddress(addrTrimmed)) {
      err = 'Invalid address';
    } else if (addrTrimmed.toLowerCase() === ZERO_ADDRESS) {
      err = 'Contributor cannot be the zero address';
    } else if (seenAddresses.has(addrTrimmed.toLowerCase())) {
      err = 'Duplicate contributor address';
    } else {
      seenAddresses.add(addrTrimmed.toLowerCase());
    }
    if (!err) {
      const ap = parseUsdcAmount(s.amount);
      if (!ap.ok) {
        err = ap.error;
      } else if (ap.raw > MAX_USDC_RAW) {
        err = 'Amount exceeds maximum representable value';
      }
    }
    shareErrors.push(err);
  }

  errors.shares = shareErrors;

  // Sum check — only if all individual shares parsed
  if (targetParsed.ok && shareErrors.every(e => !e)) {
    const sumRaw = draft.shares.reduce((acc, s) => {
      const p = parseUsdcAmount(s.amount);
      return acc + (p.ok ? p.raw : 0n);
    }, 0n);
    if (sumRaw !== targetParsed.raw) {
      sumOk = false;
      errors.sharesSum = `Shares sum to ${formatUsdc(sumRaw)} USDC but target is ${formatUsdc(targetParsed.raw)} USDC`;
    }
  } else {
    sumOk = false;
  }

  // Clean up empty shares array
  if (errors.shares?.every(e => !e)) delete errors.shares;
  if (!errors.sharesSum && sumOk) delete errors.sharesSum;

  return errors;
}

/** Returns true when validateCreateDraft returns no non-empty errors */
export function isDraftValid(draft: CreateOrderDraft, nowUnixSeconds: number, contractAddress?: string): boolean {
  const e = validateCreateDraft(draft, nowUnixSeconds, contractAddress);
  return (
    !e.merchant &&
    !e.orderRef &&
    !e.targetUsdc &&
    !e.deadlineIso &&
    !e.sharesSum &&
    !(e.shares?.some(s => s))
  );
}

// ── Address formatting ────────────────────────────────────────────────────────

export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ── Default draft ─────────────────────────────────────────────────────────────

export function emptyDraft(): CreateOrderDraft {
  return {
    merchant: '',
    orderRef: '',
    targetUsdc: '',
    deadlineIso: '',
    shares: [
      { address: '', amount: '' },
      { address: '', amount: '' },
    ],
  };
}

// ── Local draft persistence key ────────────────────────────────────────────────
export const DRAFT_STORAGE_KEY = 'pt-create-draft-v1';
