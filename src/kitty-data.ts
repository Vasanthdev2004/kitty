// ─── Kitty – chain reads ────────────────────────────────────────────────────
import { decodeEventLog, getAbiItem, pad, toEventSelector, toHex, type Abi, type PublicClient } from 'viem';
import { KITTY_ABI } from './kitty-abi';
import type { KittyDeployment } from './kitty-config';
import { dedupePaidFor, deriveRoles, parseKittyLog, sortActivity, chunkRanges } from './kitty-core';
import type { ActivityItem, KittyData, KittyMode, MineSummary } from './kitty-types';

/** Runs `fn` over `items` with at most `limit` calls in flight. Keeps order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function isPotNotFound(e: unknown): boolean {
  return /PotNotFound/.test(e instanceof Error ? e.message : String(e));
}

/** getPot: creator, recipient, goal, deadline, ref, mode, settled, totalFunded, minContribution, contributorCount, cancelled. */
type PotTuple = readonly [string, string, bigint, bigint, string, number, boolean, bigint, bigint, bigint, boolean];
type ContributionTuple = readonly [bigint, bigint, boolean];

/** Loosely typed read of any Kitty view function. Call sites cast the result to a tuple. */
function callKitty<T>(client: PublicClient, dep: KittyDeployment, functionName: string, args: unknown[]): Promise<T> {
  return client.readContract({ address: dep.kitty, abi: KITTY_ABI as unknown as Abi, functionName, args }) as Promise<T>;
}

const modeOf = (n: number): KittyMode => (n === 1 ? 'open' : 'split');

export interface Call { functionName: string; args: unknown[] }
export type CallResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Several Kitty view calls in ONE eth_call through Multicall3 when the chain has it,
 * otherwise plain reads. Results keep the order of `calls`.
 */
export async function kittyMulticall<T extends unknown[]>(
  client: PublicClient, dep: KittyDeployment, calls: Call[], allowFailure: boolean,
): Promise<{ [K in keyof T]: CallResult<T[K]> }> {
  if (calls.length === 0) return [] as never;
  if (client.chain?.contracts?.multicall3) {
    const res = (await client.multicall({
      contracts: calls.map(c => ({ address: dep.kitty, abi: KITTY_ABI as unknown as Abi, functionName: c.functionName, args: c.args })),
      allowFailure: true,
      batchSize: 16_384,
    })) as Array<{ status: 'success' | 'failure'; result?: unknown; error?: unknown }>;
    const out = res.map(r => (r.status === 'success' ? { ok: true, value: r.result } : { ok: false, error: r.error }));
    if (!allowFailure) {
      const bad = out.find(r => !r.ok) as { error: unknown } | undefined;
      if (bad) throw bad.error;
    }
    return out as never;
  }
  const out = await Promise.all(calls.map(c =>
    callKitty<unknown>(client, dep, c.functionName, c.args).then(
      (value): CallResult<unknown> => ({ ok: true, value }), (error: unknown): CallResult<unknown> => ({ ok: false, error }),
    )));
  if (!allowFailure) {
    const bad = out.find(r => !r.ok) as { error: unknown } | undefined;
    if (bad) throw bad.error;
  }
  return out as never;
}

export const val = <T,>(r: CallResult<T>): T => (r as { ok: true; value: T }).value;

/**
 * Full read of one kitty: terms, people and the chain clock.
 * Two round trips: [terms + people list + minimum, block] then [each person's numbers].
 * The block read rides in the same JSON-RPC batch as the first multicall.
 */
export async function readKitty(client: PublicClient, dep: KittyDeployment, id: `0x${string}`): Promise<KittyData> {
  const [head, block] = await Promise.all([
    kittyMulticall<[PotTuple, readonly string[], bigint]>(client, dep, [
      { functionName: 'getPot', args: [id] },
      { functionName: 'getContributors', args: [id] },
      { functionName: 'effectiveMinContribution', args: [id] },
    ], false),
    client.getBlock(),
  ]);
  const [creator, recipient, goal, deadline, ref, modeNum, settled, totalFunded, minContribution, , cancelled] = val(head[0]);
  const addrs = val(head[1]);
  const mode = modeOf(modeNum);

  const rows = await kittyMulticall<ContributionTuple[]>(
    client, dep, addrs.map(a => ({ functionName: 'getContribution', args: [id, a] })), false,
  );
  const people = addrs.map((address, i) => {
    const [share, contributed, refunded] = val(rows[i]);
    return { address, shareRaw: share, contributedRaw: contributed, refunded };
  });

  return {
    id, creator, recipient, goalRaw: goal, deadline, ref, mode, settled, cancelled: Boolean(cancelled),
    totalFundedRaw: totalFunded, minContributionRaw: minContribution, effectiveMinRaw: val(head[2]),
    contributors: people, chainTimestamp: block.timestamp,
  };
}

/** The connected wallet's own numbers on a kitty that is not in the loaded list (open kitties). */
export async function readMyContribution(client: PublicClient, dep: KittyDeployment, id: `0x${string}`, who: string) {
  const [share, contributed, refunded] = await callKitty<ContributionTuple>(client, dep, 'getContribution', [id, who]);
  return { shareRaw: share, contributedRaw: contributed, refunded };
}

// ── Logs ─────────────────────────────────────────────────────────────────────

export type EventName = 'PotCreated' | 'Funded' | 'FundedFor' | 'Settled' | 'Refunded' | 'Cancelled';
const ALL_EVENTS: EventName[] = ['PotCreated', 'Funded', 'FundedFor', 'Settled', 'Refunded', 'Cancelled'];
export const selector = (name: EventName) => toEventSelector(getAbiItem({ abi: KITTY_ABI, name }));

interface RawLog { data: `0x${string}`; topics: `0x${string}`[]; blockNumber: `0x${string}`; logIndex: `0x${string}`; transactionHash: `0x${string}` }
export interface DecodedLog {
  eventName?: string; args?: unknown; blockNumber: bigint | null; logIndex: number | null; transactionHash: `0x${string}` | null;
}

/**
 * One eth_getLogs for any mix of events, filtered by raw topics. All Kitty
 * events have `potId` as their first indexed argument, so a single request can
 * return a whole pot's history. Starts at the deploy block, never block 0.
 * Only if the RPC rejects the range do we split it into chunks.
 */
export async function getKittyLogs(
  client: PublicClient, dep: KittyDeployment, topics: Array<`0x${string}` | `0x${string}`[] | null>,
): Promise<DecodedLog[]> {
  const run = (from: bigint, to: bigint | 'latest') =>
    (client as unknown as { request: (a: unknown) => Promise<RawLog[]> }).request({
      method: 'eth_getLogs',
      params: [{ address: dep.kitty, fromBlock: toHex(from), toBlock: to === 'latest' ? 'latest' : toHex(to), topics }],
    });
  let raw: RawLog[];
  try {
    raw = await run(dep.deployBlock, 'latest');
  } catch {
    const head = await client.getBlockNumber();
    const ranges = chunkRanges(dep.deployBlock, head, 20_000n);
    if (ranges.length > 400) throw new Error('The activity range is too large for this RPC.');
    raw = (await mapLimit(ranges, 4, ([from, to]) => run(from, to))).flat();
  }
  const out: DecodedLog[] = [];
  for (const l of raw) {
    try {
      const d = decodeEventLog({ abi: KITTY_ABI, data: l.data, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
      out.push({ eventName: d.eventName, args: d.args, blockNumber: BigInt(l.blockNumber), logIndex: Number(l.logIndex), transactionHash: l.transactionHash });
    } catch { /* not one of ours */ }
  }
  return out;
}

/** Activity for one kitty, newest first, with block times where they could be fetched. */
export async function readActivity(client: PublicClient, dep: KittyDeployment, id: `0x${string}`): Promise<ActivityItem[]> {
  const logs = await getKittyLogs(client, dep, [ALL_EVENTS.map(selector), id]);
  const items = dedupePaidFor(logs.map(parseKittyLog).filter((x): x is ActivityItem => x !== null));

  // Block times: one parallel round (they share a JSON-RPC batch). Capped; extra rows just show no time.
  const blocks = [...new Set(items.map(i => i.blockNumber))].slice(-40);
  const times = new Map<bigint, number>();
  await Promise.all(blocks.map(async bn => {
    try {
      const b = await client.getBlock({ blockNumber: bn });
      times.set(bn, Number(b.timestamp));
    } catch { /* leave the time blank */ }
  }));
  return sortActivity(items.map(i => ({ ...i, timestamp: times.get(i.blockNumber) })));
}

// ── My kitties ───────────────────────────────────────────────────────────────

/** How many of the newest split kitties are checked for "invited". */
const INVITE_SCAN_LIMIT = 150;

export interface MineScan { items: MineSummary[]; chainTimestamp: bigint; scannedAt: number }

/**
 * Kitties this wallet created, receives, chipped into, or is invited to.
 * Requests: [all PotCreated, my Funded, block] in one batch, then ONE multicall
 * with (terms, my numbers) for every candidate kitty.
 */
export async function scanMine(client: PublicClient, dep: KittyDeployment, me: string): Promise<MineScan> {
  const meLower = me.toLowerCase();
  const [allCreated, funded, block] = await Promise.all([
    getKittyLogs(client, dep, [selector('PotCreated')]),
    getKittyLogs(client, dep, [selector('Funded'), null, pad(me as `0x${string}`)]),
    client.getBlock(),
  ]);
  const argsOf = (l: DecodedLog) => (l.args ?? {}) as { potId?: `0x${string}`; creator?: string; recipient?: string; mode?: number };

  const mine = new Set<`0x${string}`>();
  for (const l of allCreated) {
    const a = argsOf(l);
    if (a.potId && (a.creator?.toLowerCase() === meLower || a.recipient?.toLowerCase() === meLower)) mine.add(a.potId);
  }
  for (const l of funded) { const id = argsOf(l).potId; if (id) mine.add(id); }

  // Invited: newest split kitties not already mine; kept only if my share is non-zero.
  const invitedCandidates = allCreated
    .map(argsOf)
    .filter(a => a.mode === 0 && a.potId && !mine.has(a.potId))
    .map(a => a.potId as `0x${string}`)
    .reverse()
    .slice(0, INVITE_SCAN_LIMIT);

  const ids = [...mine, ...invitedCandidates];
  const calls = ids.flatMap(id => [
    { functionName: 'getPot', args: [id] },
    { functionName: 'getContribution', args: [id, me] },
  ]);
  const res = await kittyMulticall<unknown[]>(client, dep, calls, true);

  const items: MineSummary[] = [];
  ids.forEach((id, i) => {
    const potR = res[i * 2] as CallResult<PotTuple>;
    const conR = res[i * 2 + 1] as CallResult<ContributionTuple>;
    if (!potR.ok || !conR.ok) return;
    const [creator, recipient, goal, deadline, ref, modeNum, settled, totalFunded, , , cancelled] = potR.value;
    const [share, contributed, refunded] = conR.value;
    if (!mine.has(id) && share === 0n) return;
    const mode = modeOf(modeNum);
    items.push({
      id, ref, mode, creator, recipient, goalRaw: goal, totalFundedRaw: totalFunded, deadline, settled, cancelled: Boolean(cancelled),
      myShareRaw: share, myContributedRaw: contributed, myRefunded: refunded,
      roles: deriveRoles({ me, creator, recipient, mode, myShareRaw: share, myContributedRaw: contributed, myRefunded: refunded }),
    });
  });
  return { items, chainTimestamp: block.timestamp, scannedAt: Date.now() };
}
