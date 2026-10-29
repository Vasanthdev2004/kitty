// ─── PayTogether – UI helpers (pure) ────────────────────────────────────────
// Presentation-only helpers. No React, no chain calls. Tested in vitest.
// Money logic stays in pt-utils.ts / pt-share.ts / pt-tx.ts.

import { formatUnits } from 'viem';
import { isValidOrderId, parseOrderParam } from './pt-share';
import type { Lifecycle } from './pt-share';

// ── Copy hygiene ──────────────────────────────────────────────────────────────

/** Replace em/en dashes in dynamic strings (e.g. tx reasons) with a comma. */
export function plain(text: string): string {
  return text.replace(/\s*[\u2014\u2013]\s*/g, ', ');
}

// ── Avatars ───────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash of the lowercased input. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  const s = input.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hues 0..254 only: the 255..359 band (violet / magenta) is never used. */
const HUE_SPAN = 255;

export interface AvatarColors {
  from: string;
  to: string;
  hueA: number;
  hueB: number;
}

/** Deterministic two-tone gradient for an address. Case-insensitive. */
export function avatarColors(address: string): AvatarColors {
  const h = hashString(address);
  const hueA = h % HUE_SPAN;
  // Same hue family: the second stop sits a few degrees away, a touch darker.
  const hueB = (hueA + 10 + ((h >>> 8) % 10)) % HUE_SPAN;
  return {
    hueA,
    hueB,
    from: `hsl(${hueA} 38% 62%)`,
    to: `hsl(${hueB} 42% 55%)`,
  };
}

// ── Order input (ID or share URL) ─────────────────────────────────────────────

export type OrderInputResult =
  | { kind: 'empty' }
  | { kind: 'valid'; orderId: `0x${string}` }
  | { kind: 'invalid' };

/**
 * Accepts a bare bytes32 order ID, a full share URL, or a query fragment
 * ("?order=0x…" / "order=0x…"), and extracts the order ID.
 */
export function parseOrderInput(input: string): OrderInputResult {
  const t = input.trim();
  if (!t) return { kind: 'empty' };
  if (isValidOrderId(t)) return { kind: 'valid', orderId: t };

  let search = '';
  const q = t.indexOf('?');
  if (q >= 0) search = t.slice(q).split('#')[0];
  else if (t.toLowerCase().startsWith('order=')) search = `?${t.split('#')[0]}`;
  else return { kind: 'invalid' };

  const r = parseOrderParam(search);
  return r.kind === 'valid' ? { kind: 'valid', orderId: r.orderId } : { kind: 'invalid' };
}

// ── Segmented progress ────────────────────────────────────────────────────────

/**
 * Width of each contributor segment as a percent of the bar, proportional to
 * share. Floors to hundredths of a percent; the remainder goes to the last
 * segment so widths sum to exactly 100 (or all zeros when there is no share).
 */
export function segmentWidths(shares: readonly bigint[]): number[] {
  const total = shares.reduce((a, b) => a + b, 0n);
  if (shares.length === 0 || total <= 0n) return shares.map(() => 0);
  const bps = shares.map(s => (s * 10000n) / total);
  const used = bps.reduce((a, b) => a + b, 0n);
  bps[bps.length - 1] += 10000n - used;
  return bps.map(b => Number(b) / 100);
}

/** How full one segment is (0..100, floored to one decimal). */
export function segmentFillPct(contributed: bigint, share: bigint): number {
  if (share <= 0n || contributed <= 0n) return 0;
  const tenths = (contributed * 1000n) / share;
  return Number(tenths > 1000n ? 1000n : tenths) / 10;
}

// ── Splitting ─────────────────────────────────────────────────────────────────

/**
 * Split a raw 6-decimal target across n people. Shares always sum to exactly
 * the target. Works in whole cents when the target is a whole number of cents,
 * otherwise in raw units. The first `remainder` people get one extra unit.
 */
export function splitEvenly(targetRaw: bigint, n: number): bigint[] {
  if (n <= 0 || targetRaw <= 0n) return [];
  const count = BigInt(n);
  const unit = targetRaw % 10000n === 0n ? 10000n : 1n;
  const units = targetRaw / unit;
  const base = units / count;
  const rem = Number(units % count);
  return Array.from({ length: n }, (_, i) => (base + (i < rem ? 1n : 0n)) * unit);
}

// ── Countdown ─────────────────────────────────────────────────────────────────

export interface CountdownParts {
  days: number;
  hours: number;
  mins: number;
  secs: number;
  done: boolean;
}

export function splitCountdown(secondsRemaining: number): CountdownParts {
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) {
    return { days: 0, hours: 0, mins: 0, secs: 0, done: true };
  }
  const s = Math.floor(secondsRemaining);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
    done: false,
  };
}

/** "in 3 days", "in 5 hours", "in 12 minutes", "already passed". */
export function relativeFromNow(deltaSeconds: number): string {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 'already passed';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (deltaSeconds >= 86400) return `in ${plural(Math.floor(deltaSeconds / 86400), 'day')}`;
  if (deltaSeconds >= 3600) return `in ${plural(Math.floor(deltaSeconds / 3600), 'hour')}`;
  if (deltaSeconds >= 60) return `in ${plural(Math.floor(deltaSeconds / 60), 'minute')}`;
  return 'in under a minute';
}

// ── Status copy (no dashes) ───────────────────────────────────────────────────

export const STATUS_PILL: Record<Lifecycle, { label: string; tone: 'neutral' | 'ok' | 'warn' }> = {
  'open': { label: 'Open', tone: 'neutral' },
  'funded-unsettled': { label: 'Ready to settle', tone: 'ok' },
  'funded-settled': { label: 'Settled', tone: 'ok' },
  'expired-incomplete': { label: 'Expired, refunds open', tone: 'warn' },
};

// ── Number display ────────────────────────────────────────────────────────────

/** Raw 6-decimal bigint to a JS number for display animation only (never for money logic). */
export function rawToDisplayNumber(raw: bigint): number {
  return Number(formatUnits(raw, 6));
}

// ── Action panel routing ──────────────────────────────────────────────────────

export type ActionKind =
  | 'connect' | 'switch'
  | 'fund' | 'share-paid' | 'not-listed'
  | 'settle' | 'settled'
  | 'refund' | 'refunded' | 'no-contribution';

/**
 * Which single card the order page shows for the current wallet and state.
 * `status` is the read-time lifecycle (the same one that gated actions before).
 */
export function actionKind(i: {
  connected: boolean;
  correctChain: boolean;
  status: Lifecycle;
  my?: { shareRaw: bigint; contributedRaw: bigint; refunded: boolean };
}): ActionKind {
  if (!i.connected) return 'connect';
  if (!i.correctChain) return 'switch';
  switch (i.status) {
    case 'open':
      if (!i.my) return 'not-listed';
      return i.my.shareRaw - i.my.contributedRaw > 0n ? 'fund' : 'share-paid';
    case 'funded-unsettled':
      return 'settle';
    case 'funded-settled':
      return 'settled';
    case 'expired-incomplete':
      if (!i.my) return 'not-listed';
      if (i.my.refunded) return 'refunded';
      return i.my.contributedRaw > 0n ? 'refund' : 'no-contribution';
  }
}

/** Kinds that carry a transaction button (docked to the bottom on mobile). */
export function actionHasDock(kind: ActionKind): boolean {
  return kind === 'fund' || kind === 'settle' || kind === 'refund';
}

// ── Deadline presets and wording ──────────────────────────────────────────────

export type DeadlinePreset = '24h' | '3d' | '1w';

export const DEADLINE_PRESETS: ReadonlyArray<{ id: DeadlinePreset; label: string; seconds: number }> = [
  { id: '24h', label: '24 hours', seconds: 86400 },
  { id: '3d', label: '3 days', seconds: 3 * 86400 },
  { id: '1w', label: '1 week', seconds: 7 * 86400 },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local date-time as a datetime-local value: "YYYY-MM-DDTHH:mm". */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function presetDeadlineIso(preset: DeadlinePreset, nowMs: number): string {
  const p = DEADLINE_PRESETS.find(x => x.id === preset);
  return toLocalInputValue(nowMs + (p ? p.seconds : 86400) * 1000);
}

export const DEFAULT_DEADLINE_TIME = '18:00';

export function splitIso(iso: string): { date: string; time: string } {
  const [date = '', time = ''] = iso.split('T');
  return { date, time: time.slice(0, 5) };
}

/** No date means no deadline. A date without a time defaults to 6:00 PM. */
export function joinIso(date: string, time: string): string {
  if (!date) return '';
  return `${date}T${time || DEFAULT_DEADLINE_TIME}`;
}

/** "Sat, 1 Nov at 6:00 PM" plus a relative phrase such as "in 3 days". */
export function describeDeadline(deadlineSec: number, nowSec: number): { when: string; rel: string } {
  const d = new Date(deadlineSec * 1000);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' ');
  return { when: `${weekday}, ${d.getDate()} ${month} at ${time}`, rel: relativeFromNow(deadlineSec - nowSec) };
}

// ── Small display helpers ─────────────────────────────────────────────────────

/** 33.3 -> "33.3%", 50 -> "50%". */
export function formatPercent(n: number): string {
  return `${n.toFixed(1).replace(/\.0$/, '')}%`;
}

/**
 * Display form of a share link: no protocol, and the 32-byte order ID is
 * abbreviated in the middle ("localhost:5173/?order=0xbda9…e300").
 * Copy buttons keep using the full URL.
 */
export function shortenShareUrl(url: string): string {
  return url
    .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
    .replace(/0x[0-9a-fA-F]{64}/g, id => `${id.slice(0, 6)}\u2026${id.slice(-4)}`);
}
