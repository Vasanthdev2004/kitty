// ─── PayTogether – Share & progress helpers ─────────────────────────────────
// Pure functions only (no React, no chain calls). Tested in vitest.

import { formatUsdcDisplay, orderStatus } from './pt-utils';
import type { ContributionInfo } from './pt-types';

// ── Order link parameter ──────────────────────────────────────────────────────

export const ORDER_PARAM = 'order';
const ORDER_ID_RE = /^0x[0-9a-fA-F]{64}$/;

/** True when `s` is a bytes32 hex string (0x + 64 hex chars). */
export function isValidOrderId(s: string): s is `0x${string}` {
  return ORDER_ID_RE.test(s);
}

export type OrderParamResult =
  | { kind: 'none' }
  | { kind: 'valid'; orderId: `0x${string}` }
  | { kind: 'invalid'; raw: string };

/**
 * Read `?order=<bytes32>` from a location.search string.
 * Missing/blank param -> none. Present but malformed -> invalid (never loaded).
 */
export function parseOrderParam(search: string): OrderParamResult {
  const raw = new URLSearchParams(search).get(ORDER_PARAM);
  if (raw === null) return { kind: 'none' };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'none' };
  return isValidOrderId(trimmed) ? { kind: 'valid', orderId: trimmed } : { kind: 'invalid', raw: trimmed };
}

/**
 * Build the relative URL (path + query + hash) with `order` set to `orderId`,
 * preserving every other query param. Used with history.replaceState.
 */
export function withOrderParam(pathname: string, search: string, hash: string, orderId: string): string {
  const params = new URLSearchParams(search);
  params.set(ORDER_PARAM, orderId);
  return `${pathname}?${params.toString()}${hash}`;
}

/** Full share URL for an order. `base` is the share-safe app base (no query). */
export function buildShareUrl(base: string, orderId: string): string {
  return `${base.replace(/\/+$/, '')}/?${ORDER_PARAM}=${orderId}`;
}

// ── Nudge message ─────────────────────────────────────────────────────────────

/** USDC amount without the "$" / "USDC" decoration, e.g. "25.00". */
export function formatUsdcPlain(raw: bigint): string {
  return formatUsdcDisplay(raw).replace(/^\$/, '').replace(/ USDC$/, '');
}

export interface NudgeInput {
  ref: string;
  /** Connected wallet's share when it is a contributor; undefined otherwise. */
  shareRaw?: bigint;
  targetRaw: bigint;
  deadlineText: string;
  link: string;
}

export function buildNudgeMessage(i: NudgeInput): string {
  if (i.shareRaw !== undefined) {
    return `You're in on ${i.ref}: your share is ${formatUsdcPlain(i.shareRaw)} USDC, deadline ${i.deadlineText}. Pay here: ${i.link}`;
  }
  return `You're in on ${i.ref}: chip in your share of the ${formatUsdcPlain(i.targetRaw)} USDC total, deadline ${i.deadlineText}. Pay here: ${i.link}`;
}

// ── Progress ──────────────────────────────────────────────────────────────────

/** Funded percentage, floored to one decimal and clamped to 0..100. */
export function fundedPercent(totalFunded: bigint, target: bigint): number {
  if (target <= 0n || totalFunded <= 0n) return 0;
  const tenths = (totalFunded * 1000n) / target;
  return Number(tenths > 1000n ? 1000n : tenths) / 10;
}

export function progressLabel(totalFunded: bigint, target: bigint): string {
  return `${formatUsdcPlain(totalFunded)} of ${formatUsdcPlain(target)} USDC`;
}

// ── Contributor status ────────────────────────────────────────────────────────

export type ContributorStatus = 'paid' | 'partial' | 'not-paid' | 'refunded';

export function contributorStatus(c: Pick<ContributionInfo, 'shareRaw' | 'contributedRaw' | 'refunded'>): ContributorStatus {
  if (c.refunded) return 'refunded';
  if (c.shareRaw > 0n && c.contributedRaw >= c.shareRaw) return 'paid';
  if (c.contributedRaw > 0n) return 'partial';
  return 'not-paid';
}

export const CONTRIBUTOR_STATUS_LABEL: Record<ContributorStatus, string> = {
  'paid': 'Paid',
  'partial': 'Partial',
  'not-paid': 'Not paid',
  'refunded': 'Refunded',
};

export function paidCount(contribs: ReadonlyArray<Pick<ContributionInfo, 'shareRaw' | 'contributedRaw' | 'refunded'>>): number {
  return contribs.filter(c => contributorStatus(c) === 'paid').length;
}

export function paidSummary(contribs: ReadonlyArray<Pick<ContributionInfo, 'shareRaw' | 'contributedRaw' | 'refunded'>>): string {
  return `${paidCount(contribs)} of ${contribs.length} paid`;
}

// ── Countdown / lifecycle ─────────────────────────────────────────────────────

/** Offset (seconds) between the chain's block time and the local clock at read time. */
export function chainOffsetSeconds(chainTimestamp: bigint, readAtMs: number): number {
  return Number(chainTimestamp) - Math.floor(readAtMs / 1000);
}

/** Estimated chain "now" in unix seconds, from the offset captured at read time. */
export function estimateChainNow(offsetSeconds: number, nowMs: number): bigint {
  return BigInt(Math.floor(nowMs / 1000) + offsetSeconds);
}

/** "2d 3h 15m" / "3h 15m" / "12m 05s" / "Deadline passed". */
export function formatCountdown(secondsRemaining: number): string {
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) return 'Deadline passed';
  const s = Math.floor(secondsRemaining);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export type Lifecycle = ReturnType<typeof orderStatus>;

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  'open': 'Open',
  'funded-unsettled': 'Fully funded — ready to settle',
  'funded-settled': 'Settled (paid to merchant)',
  'expired-incomplete': 'Expired — refunds open',
};
