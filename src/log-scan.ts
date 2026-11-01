// ─── Chain history scan (pure core) ─────────────────────────────────────────
// The Arc RPCs answer eth_getLogs very differently:
//   - rpc.mainnet.arc.io / rpc.testnet.arc.io (and their same-origin proxies) accept spans up to
//     9,999 blocks and reject 10,000 or more with -32012 "requested range too large".
//   - the Blockdaemon mirrors accept up to 100,000 blocks.
// So history is read on a dedicated "logs path" in chunks of at most 99,000 blocks, newest first. A chunk
// that fails there is retried in pieces of at most 9,999 blocks on the regular transports. Everything
// is cached per chain and contract (Arc has deterministic finality, so old logs never change) and a
// later load only scans what is new. All I/O is injected so this file can be tested without a chain.
import { isNetworkError } from './rpc';

type Hex = `0x${string}`;

export interface RawLog {
  address?: string;
  data: Hex;
  topics: Hex[];
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: Hex;
}

export interface BlockRange { from: bigint; to: bigint }

export const PRIMARY_MAX_SPAN = 99_000n;
export const FALLBACK_MAX_SPAN = 9_999n;
/** A small overlap on resume, deduplicated by transactionHash + logIndex. */
export const CACHE_OVERLAP = 64n;
export const SCAN_CONCURRENCY = 3;
/** Refreshing twice within this window reuses the first answer. */
export const FRESH_MS = 2_000;
const MAX_CACHE_CHARS = 4_000_000;

// ── Planning ─────────────────────────────────────────────────────────────────

/** Split [from, to] (inclusive) into ranges of at most `maxSpan` blocks, newest first. No gaps, no overlaps. */
export function planChunks(from: bigint, to: bigint, maxSpan: bigint): BlockRange[] {
  if (maxSpan < 1n) throw new Error('maxSpan must be at least 1');
  const out: BlockRange[] = [];
  let hi = to;
  while (hi >= from) {
    const lo = hi - maxSpan + 1n > from ? hi - maxSpan + 1n : from;
    out.push({ from: lo, to: hi });
    hi = lo - 1n;
  }
  return out;
}

/** The same split for one failed chunk, in pieces the regular RPCs accept. */
export const splitRange = (r: BlockRange, maxSpan: bigint = FALLBACK_MAX_SPAN): BlockRange[] => planChunks(r.from, r.to, maxSpan);

// ── Errors ───────────────────────────────────────────────────────────────────

export type LogsErrorKind = 'range' | 'pruned' | 'rate' | 'network' | 'other';

type Loose = { name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; status?: unknown; code?: unknown; cause?: unknown };

function links(e: unknown): Loose[] {
  const out: Loose[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur && typeof cur === 'object'; i++) {
    out.push(cur);
    cur = (cur as Loose).cause;
  }
  return out;
}

/** What went wrong with a log request, in terms of what to do next. */
export function classifyLogsError(e: unknown): LogsErrorKind {
  if (isNetworkError(e)) return 'network';
  const ls = links(e);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const text = ls.map(l => `${str(l.name)} ${str(l.shortMessage)} ${str(l.message)} ${str(l.details)}`).join(' ');
  const codes = ls.map(l => l.code).filter((c): c is number => typeof c === 'number');
  const statuses = ls.map(l => l.status).filter((s): s is number => typeof s === 'number');
  if (codes.includes(-32005) || statuses.includes(429) || /\b429\b|rate.?limit|too many requests|limit exceeded/i.test(text)) return 'rate';
  if (codes.includes(4444) || /pruned|history unavailable|missing trie node/i.test(text)) return 'pruned';
  if (codes.includes(-32012) || codes.includes(-32602) || /range|max block|too large|exceed/i.test(text)) return 'range';
  return 'other';
}

// ── Retrying a request ───────────────────────────────────────────────────────

export const RATE_BACKOFF_MS = [500, 1500, 3500] as const;

export interface BackoffIO { sleep?: (ms: number) => Promise<void>; random?: () => number }

const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Retries only rate limits (429, -32005), waiting 0.5s, 1.5s, 3.5s (+/- 25%). Anything else is thrown at once. */
export async function withBackoff<T>(fn: () => Promise<T>, io: BackoffIO = {}): Promise<T> {
  const sleep = io.sleep ?? realSleep;
  const random = io.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (classifyLogsError(e) !== 'rate' || attempt >= RATE_BACKOFF_MS.length) throw e;
      await sleep(Math.round(RATE_BACKOFF_MS[attempt] * (0.75 + random() * 0.5)));
    }
  }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

export interface ScanIO extends BackoffIO {
  /** The logs path: same-origin logs proxy, then Blockdaemon. Chunks of up to PRIMARY_MAX_SPAN. */
  primary(r: BlockRange): Promise<RawLog[]>;
  /** The regular Arc transports. Pieces of up to FALLBACK_MAX_SPAN. */
  fallback(r: BlockRange): Promise<RawLog[]>;
}

export interface ScanProgress { doneBlocks: bigint; totalBlocks: bigint }

export interface ScanOptions {
  concurrency?: number;
  primaryMaxSpan?: bigint;
  fallbackMaxSpan?: bigint;
  onProgress?: (p: ScanProgress) => void;
}

const logKey = (l: RawLog) => `${l.transactionHash}:${l.logIndex.toLowerCase()}`;

export function dedupeLogs(logs: readonly RawLog[]): RawLog[] {
  const seen = new Map<string, RawLog>();
  for (const l of logs) if (!seen.has(logKey(l))) seen.set(logKey(l), l);
  return [...seen.values()];
}

const byPosition = (a: RawLog, b: RawLog) => {
  const ba = BigInt(a.blockNumber);
  const bb = BigInt(b.blockNumber);
  if (ba !== bb) return ba < bb ? -1 : 1;
  return Number(BigInt(a.logIndex) - BigInt(b.logIndex));
};

export const sortLogs = (logs: readonly RawLog[]): RawLog[] => [...logs].sort(byPosition);

/**
 * Every log in [from, to]. Chunks are taken newest first by at most `concurrency` workers. A chunk that
 * fails on the logs path is read again in small pieces on the regular transports. If a piece fails too,
 * the whole scan fails: a gap would make the cache lie.
 */
export async function scanLogs(from: bigint, to: bigint, io: ScanIO, opts: ScanOptions = {}): Promise<RawLog[]> {
  if (to < from) return [];
  const chunks = planChunks(from, to, opts.primaryMaxSpan ?? PRIMARY_MAX_SPAN);
  const small = opts.fallbackMaxSpan ?? FALLBACK_MAX_SPAN;
  const results: RawLog[][] = chunks.map((): RawLog[] => []);
  const total = to - from + 1n;
  let done = 0n;
  let next = 0;

  const readChunk = async (c: BlockRange): Promise<RawLog[]> => {
    try {
      return await withBackoff(() => io.primary(c), io);
    } catch {
      const out: RawLog[] = [];
      for (const piece of splitRange(c, small)) out.push(...(await withBackoff(() => io.fallback(piece), io)));
      return out;
    }
  };

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= chunks.length) return;
      results[i] = await readChunk(chunks[i]);
      done += chunks[i].to - chunks[i].from + 1n;
      opts.onProgress?.({ doneBlocks: done, totalBlocks: total });
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? SCAN_CONCURRENCY, chunks.length) }, worker));
  return sortLogs(dedupeLogs(results.flat()));
}

// ── Topic filter (client side) ───────────────────────────────────────────────

export type TopicFilter = Array<Hex | Hex[] | null | undefined>;

/** eth_getLogs topic semantics: null matches anything, an array matches any of its values. */
export function matchTopics(logTopics: readonly string[], filter: TopicFilter): boolean {
  for (let i = 0; i < filter.length; i++) {
    const f = filter[i];
    if (f === null || f === undefined) continue;
    const have = logTopics[i]?.toLowerCase();
    if (have === undefined) return false;
    if (Array.isArray(f) ? !f.some(x => x.toLowerCase() === have) : f.toLowerCase() !== have) return false;
  }
  return true;
}

// ── Cache ────────────────────────────────────────────────────────────────────

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const cacheKey = (chainId: number, kitty: string) => `kitty:logs:v1:${chainId}:${kitty.toLowerCase()}`;

const isHex = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v);
const isRawLog = (v: unknown): v is RawLog => {
  if (!v || typeof v !== 'object') return false;
  const l = v as Partial<RawLog>;
  return isHex(l.data) && Array.isArray(l.topics) && l.topics.every(isHex) && isHex(l.blockNumber) && isHex(l.logIndex) && isHex(l.transactionHash);
};

export interface CachedLogs { scannedTo: bigint; logs: RawLog[] }

/** The saved scan, or undefined when there is none, storage is unavailable, or the data is damaged. */
export function readCache(store: StorageLike | undefined, key: string): CachedLogs | undefined {
  try {
    const text = store?.getItem(key);
    if (!text) return undefined;
    const v = JSON.parse(text) as { v?: unknown; scannedTo?: unknown; logs?: unknown };
    if (v.v !== 1 || typeof v.scannedTo !== 'string' || !/^\d+$/.test(v.scannedTo) || !Array.isArray(v.logs)) return undefined;
    if (!v.logs.every(isRawLog)) return undefined;
    return { scannedTo: BigInt(v.scannedTo), logs: v.logs };
  } catch {
    return undefined;
  }
}

/** Saves the scan. Returns false (and saves nothing) if storage is unavailable or the data is too big. */
export function writeCache(store: StorageLike | undefined, key: string, scannedTo: bigint, logs: readonly RawLog[]): boolean {
  try {
    if (!store) return false;
    const text = JSON.stringify({ v: 1, scannedTo: scannedTo.toString(), logs });
    if (text.length > MAX_CACHE_CHARS) return false;
    store.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

// ── The loader ───────────────────────────────────────────────────────────────

export interface LoadIO extends ScanIO {
  head(): Promise<bigint>;
  storage?: StorageLike;
  now?: () => number;
}

interface LogState {
  logs: Map<string, RawLog>;
  scannedTo?: bigint;
  hydrated: boolean;
  lastRunAt: number;
  inflight?: Promise<RawLog[]>;
}

const states = new Map<string, LogState>();

/** Forget everything held in memory (tests). The saved copy in storage is left alone. */
export function resetLogState(): void {
  states.clear();
}

/**
 * Every log of the contract since its deploy block, oldest first. The first call scans the whole span
 * (from the deploy block, never block 0) and saves it; later calls read the saved copy and scan only
 * from a little before where the last scan stopped. Callers filter by topic with matchTopics.
 * A refresh that fails after a good scan returns what was already known instead of hiding the history.
 */
export async function loadKittyLogs(
  key: string, deployBlock: bigint, io: LoadIO, opts: Pick<ScanOptions, 'onProgress'> & { freshMs?: number } = {},
): Promise<RawLog[]> {
  const now = io.now ?? Date.now;
  let st = states.get(key);
  if (!st) {
    st = { logs: new Map(), hydrated: false, lastRunAt: 0 };
    states.set(key, st);
  }
  const state = st;
  if (!state.hydrated) {
    state.hydrated = true;
    const cached = readCache(io.storage, key);
    if (cached) {
      for (const l of cached.logs) state.logs.set(logKey(l), l);
      state.scannedTo = cached.scannedTo;
    }
  }
  if (state.inflight) return state.inflight;
  if (state.scannedTo !== undefined && now() - state.lastRunAt < (opts.freshMs ?? FRESH_MS)) return sortLogs([...state.logs.values()]);

  state.inflight = (async () => {
    try {
      const head = await io.head();
      const from = state.scannedTo === undefined ? deployBlock : (state.scannedTo - CACHE_OVERLAP + 1n > deployBlock ? state.scannedTo - CACHE_OVERLAP + 1n : deployBlock);
      if (head >= from) {
        const found = await scanLogs(from, head, io, { onProgress: opts.onProgress });
        for (const l of found) state.logs.set(logKey(l), l);
      }
      if (state.scannedTo === undefined || head > state.scannedTo) state.scannedTo = head;
      state.lastRunAt = now();
      const all = sortLogs([...state.logs.values()]);
      writeCache(io.storage, key, state.scannedTo, all);
      return all;
    } catch (e) {
      if (state.scannedTo !== undefined) return sortLogs([...state.logs.values()]);
      throw e;
    } finally {
      state.inflight = undefined;
    }
  })();
  return state.inflight;
}
