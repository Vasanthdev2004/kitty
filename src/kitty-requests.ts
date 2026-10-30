// ─── Seller requests and live stats (pure) ──────────────────────────────────
// A "request" is a kitty whose creator is also its recipient. These helpers group,
// total and export them, and fold raw logs into the numbers on the home page.
import { formatUnits } from 'viem';
import { PHASE_PILL, kittyPhase, type KittyPhase } from './kitty-core';
import { toCsv } from './csv';

// ── Seller requests ──────────────────────────────────────────────────────────

export interface RequestSummary {
  id: `0x${string}`;
  ref: string;
  goalRaw: bigint;
  totalFundedRaw: bigint;
  deadline: bigint;
  settled: boolean;
  cancelled: boolean;
  /** People who chipped in (getPot's contributorCount). */
  contributorCount: number;
  createdBlock: bigint;
  /** Unix seconds of the creation block, when it could be fetched. */
  createdAt?: number;
  /** Transaction that paid the request out, when it was. */
  payoutTx?: `0x${string}`;
}

export function requestPhase(r: RequestSummary, now: bigint): KittyPhase {
  return kittyPhase({
    settled: r.settled, cancelled: r.cancelled, totalFundedRaw: r.totalFundedRaw, goalRaw: r.goalRaw, deadline: r.deadline, now,
  });
}

export interface RequestGroups { active: RequestSummary[]; paid: RequestSummary[]; closed: RequestSummary[] }

/** Active = still collecting or ready to pay out. Paid. Expired or cancelled. */
export function groupRequests(list: readonly RequestSummary[], now: bigint): RequestGroups {
  const g: RequestGroups = { active: [], paid: [], closed: [] };
  for (const r of list) {
    const p = requestPhase(r, now);
    if (p === 'open' || p === 'ready') g.active.push(r);
    else if (p === 'paid') g.paid.push(r);
    else g.closed.push(r);
  }
  const newest = (a: RequestSummary, b: RequestSummary) => (a.createdBlock < b.createdBlock ? 1 : a.createdBlock > b.createdBlock ? -1 : 0);
  g.active.sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));
  g.paid.sort(newest);
  g.closed.sort(newest);
  return g;
}

export interface RequestTotals { requestedRaw: bigint; collectedRaw: bigint; pendingRaw: bigint }

/**
 * requested  everything asked for, across all requests
 * collected  what was actually paid out to you (settled requests pay their full goal)
 * pending    money chipped in and still held for open or ready requests
 */
export function requestTotals(list: readonly RequestSummary[], now: bigint): RequestTotals {
  let requestedRaw = 0n; let collectedRaw = 0n; let pendingRaw = 0n;
  for (const r of list) {
    requestedRaw += r.goalRaw;
    const p = requestPhase(r, now);
    if (p === 'paid') collectedRaw += r.goalRaw;
    else if (p === 'open' || p === 'ready') pendingRaw += r.totalFundedRaw;
  }
  return { requestedRaw, collectedRaw, pendingRaw };
}

export const REQUEST_CSV_HEADER = [
  'Name', 'Kitty ID', 'Goal (USDC)', 'Funded (USDC)', 'Status', 'Created block', 'Created time (UTC)', 'Payout transaction',
] as const;

export function requestCsv(list: readonly RequestSummary[], now: bigint): string {
  const rows = list.map(r => [
    r.ref, r.id, formatUnits(r.goalRaw, 6), formatUnits(r.totalFundedRaw, 6), PHASE_PILL[requestPhase(r, now)].label,
    r.createdBlock.toString(), r.createdAt !== undefined ? new Date(r.createdAt * 1000).toISOString() : '', r.payoutTx ?? '',
  ]);
  return toCsv(REQUEST_CSV_HEADER, rows);
}

// ── Live stats ───────────────────────────────────────────────────────────────

export interface RecentPayout {
  id: `0x${string}`;
  ref: string;
  amountRaw: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  timestamp?: number;
}

export interface KittyStats {
  created: number;
  paidOutRaw: bigint;
  /** Distinct wallets that were credited a contribution. */
  people: number;
  recent: RecentPayout[];
}

interface StatLog {
  eventName?: string; args?: unknown; blockNumber: bigint | null; logIndex: number | null; transactionHash: `0x${string}` | null;
}

export const RECENT_PAYOUTS = 5;

export function computeStats(logs: readonly StatLog[]): KittyStats {
  const refs = new Map<string, string>();
  const people = new Set<string>();
  let created = 0;
  let paidOutRaw = 0n;
  const settled: Array<RecentPayout & { logIndex: number }> = [];
  for (const l of logs) {
    const a = (l.args ?? {}) as { potId?: `0x${string}`; ref?: string; contributor?: string; amount?: bigint };
    if (l.eventName === 'PotCreated') { created++; if (a.potId) refs.set(a.potId, a.ref ?? ''); }
    else if (l.eventName === 'Funded' && a.contributor) people.add(a.contributor.toLowerCase());
    else if (l.eventName === 'Settled' && a.potId && typeof a.amount === 'bigint' && l.blockNumber !== null && l.logIndex !== null && l.transactionHash) {
      paidOutRaw += a.amount;
      settled.push({ id: a.potId, ref: '', amountRaw: a.amount, blockNumber: l.blockNumber, txHash: l.transactionHash, logIndex: l.logIndex });
    }
  }
  settled.sort((x, y) => (x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : x.blockNumber < y.blockNumber ? 1 : -1));
  const recent = settled.slice(0, RECENT_PAYOUTS).map(({ logIndex: _l, ...s }) => ({ ...s, ref: refs.get(s.id) ?? '' }));
  return { created, paidOutRaw, people: people.size, recent };
}

// ── Cache (sessionStorage, short TTL) ───────────────────────────────────────

export const STATS_TTL_MS = 60_000;

export function serializeStats(s: KittyStats, at: number): string {
  return JSON.stringify({
    at, created: s.created, paidOutRaw: s.paidOutRaw.toString(), people: s.people,
    recent: s.recent.map(r => ({ ...r, amountRaw: r.amountRaw.toString(), blockNumber: r.blockNumber.toString() })),
  });
}

export function parseStats(raw: string | null | undefined, now: number, ttlMs: number = STATS_TTL_MS): KittyStats | undefined {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw) as {
      at: number; created: number; paidOutRaw: string; people: number;
      recent: Array<Omit<RecentPayout, 'amountRaw' | 'blockNumber'> & { amountRaw: string; blockNumber: string }>;
    };
    if (typeof j.at !== 'number' || now - j.at > ttlMs || now < j.at) return undefined;
    return {
      created: j.created, paidOutRaw: BigInt(j.paidOutRaw), people: j.people,
      recent: j.recent.map(r => ({ ...r, amountRaw: BigInt(r.amountRaw), blockNumber: BigInt(r.blockNumber) })),
    };
  } catch { return undefined; }
}
