// ─── History scan: chunk planner, fallbacks, backoff, cache, logs path ───────
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CACHE_OVERLAP, FALLBACK_MAX_SPAN, PRIMARY_MAX_SPAN, cacheKey, classifyLogsError, loadKittyLogs, matchTopics, planChunks,
  readCache, resetLogState, scanLogs, splitRange, withBackoff, writeCache, type BlockRange, type RawLog, type ScanIO, type StorageLike,
} from '../log-scan';
import { BLOCKDAEMON_URL, LOGS_PROXY_PATH, logsTransportUrls } from '../rpc-proxy';

type H = `0x${string}`;
const hex = (n: number | bigint): H => `0x${n.toString(16)}`;
const h64 = (n: number): H => `0x${n.toString(16).padStart(64, '0')}`;
const T0: H = `0x${'a'.repeat(64)}`;
const log = (block: number, idx = 0, topics: `0x${string}`[] = [T0]): RawLog => ({
  data: '0x', topics, blockNumber: hex(block), logIndex: hex(idx), transactionHash: h64(block),
});
const rpcError = (message: string, code?: number, status?: number) => Object.assign(new Error(message), { code, status });
const wrapped = (inner: Error) => Object.assign(new Error('RPC Request failed.'), { name: 'HttpRequestError', cause: inner });
const noSleep = () => Promise.resolve();

/** A chain with a log on every `every`th block. Reads are limited to `maxSpan` blocks per request. */
function chainWith(opts: { every?: number; primaryMax?: bigint; fallbackMax?: bigint } = {}) {
  const every = opts.every ?? 1000;
  const calls = { primary: [] as BlockRange[], fallback: [] as BlockRange[] };
  const logsIn = (r: BlockRange) => {
    const out: RawLog[] = [];
    for (let b = (Number(r.from) + every - 1 - ((Number(r.from) + every - 1) % every)); b <= Number(r.to); b += every) out.push(log(b));
    return out;
  };
  const io: ScanIO = {
    sleep: noSleep,
    random: () => 0.5,
    primary: r => {
      calls.primary.push(r);
      if (r.to - r.from + 1n > (opts.primaryMax ?? 100_000n)) return Promise.reject(rpcError('max block range 100000', -32602));
      return Promise.resolve(logsIn(r));
    },
    fallback: r => {
      calls.fallback.push(r);
      if (r.to - r.from + 1n > (opts.fallbackMax ?? 9_999n)) return Promise.reject(rpcError('requested range too large', -32012));
      return Promise.resolve(logsIn(r));
    },
  };
  return { io, calls, logsIn };
}

// ── Chunk planner ────────────────────────────────────────────────────────────

describe('planChunks', () => {
  const covered = (cs: BlockRange[]) => cs.reduce((n, c) => n + (c.to - c.from + 1n), 0n);

  it('newest chunk first, every chunk within the span', () => {
    const cs = planChunks(1_000n, 250_999n, PRIMARY_MAX_SPAN);
    expect(cs[0].to).toBe(250_999n);
    expect(cs[cs.length - 1].from).toBe(1_000n);
    for (const c of cs) expect(c.to - c.from + 1n).toBeLessThanOrEqual(PRIMARY_MAX_SPAN);
  });
  it('no gaps and no overlaps', () => {
    for (const [from, to, span] of [[5n, 5n, 99_000n], [0n, 98_999n, 99_000n], [0n, 99_000n, 99_000n], [10n, 500_000n, 99_000n], [100n, 130_000n, 9_999n]] as const) {
      const cs = planChunks(from, to, span);
      expect(covered(cs)).toBe(to - from + 1n);
      for (let i = 1; i < cs.length; i++) expect(cs[i].to + 1n).toBe(cs[i - 1].from); // contiguous, descending
    }
  });
  it('a span of exactly the limit is one chunk; one block more is two', () => {
    expect(planChunks(1n, 99_000n, 99_000n)).toHaveLength(1);
    expect(planChunks(1n, 99_001n, 99_000n)).toHaveLength(2);
  });
  it('an empty or reversed range plans nothing', () => {
    expect(planChunks(10n, 9n, 99_000n)).toEqual([]);
  });
  it('splitRange breaks a 99k chunk into pieces of at most 9,999 blocks', () => {
    const pieces = splitRange({ from: 1_000n, to: 99_999n });
    expect(pieces).toHaveLength(10);
    for (const p of pieces) expect(p.to - p.from + 1n).toBeLessThanOrEqual(FALLBACK_MAX_SPAN);
    expect(covered(pieces)).toBe(99_000n);
  });
  it('the limits are the measured ones', () => {
    expect(PRIMARY_MAX_SPAN).toBe(99_000n);
    expect(FALLBACK_MAX_SPAN).toBe(9_999n);
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────

describe('classifyLogsError', () => {
  it.each([
    ['range', rpcError('requested range too large', -32012)],
    ['range', rpcError('invalid params', -32602)],
    ['range', rpcError('max block range 100000')],
    ['range', wrapped(rpcError('Block range is too wide'))],
    ['pruned', rpcError('history pruned', 4444)],
    ['pruned', rpcError('missing trie node')],
    ['rate', rpcError('limit exceeded', -32005)],
    ['rate', Object.assign(new Error('HTTP request failed'), { status: 429 })],
    ['rate', wrapped(rpcError('Too Many Requests'))],
    ['network', new TypeError('Failed to fetch')],
    ['network', Object.assign(new Error('HTTP request failed'), { name: 'HttpRequestError', status: 599 })],
    ['other', new Error('boom')],
  ] as const)('%s', (kind, err) => expect(classifyLogsError(err)).toBe(kind));
});

describe('withBackoff', () => {
  it('retries rate limits with growing waits, then succeeds', async () => {
    const waits: number[] = [];
    let n = 0;
    const out = await withBackoff(() => (++n < 3 ? Promise.reject(rpcError('limit exceeded', -32005)) : Promise.resolve('ok')), { sleep: ms => { waits.push(ms); return Promise.resolve(); }, random: () => 0.5 });
    expect(out).toBe('ok');
    expect(waits).toEqual([500, 1500]);
  });
  it('gives up after the third wait', async () => {
    let n = 0;
    await expect(withBackoff(() => { n++; return Promise.reject(rpcError('429', undefined, 429)); }, { sleep: noSleep })).rejects.toThrow();
    expect(n).toBe(4);
  });
  it('does not retry a range error or a network failure', async () => {
    for (const e of [rpcError('requested range too large', -32012), new TypeError('Failed to fetch')]) {
      let n = 0;
      await expect(withBackoff(() => { n++; return Promise.reject(e); }, { sleep: noSleep })).rejects.toBe(e);
      expect(n).toBe(1);
    }
  });
});

// ── Scanning ─────────────────────────────────────────────────────────────────

describe('scanLogs', () => {
  it('reads a span over 99,000 blocks in chunks, newest first, at most 3 at once, and returns every log', async () => {
    const { io, calls, logsIn } = chainWith();
    let inflight = 0;
    let peak = 0;
    const primary = io.primary.bind(io);
    io.primary = async r => { inflight++; peak = Math.max(peak, inflight); await Promise.resolve(); inflight--; return primary(r); };
    const out = await scanLogs(1_000n, 450_999n, io);
    expect(calls.fallback).toHaveLength(0);
    expect(calls.primary[0].to).toBe(450_999n); // the newest chunk was asked for first
    expect(calls.primary).toHaveLength(5);
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual(logsIn({ from: 1_000n, to: 450_999n }));
  });
  it('a chunk the logs path rejects is read again in 9,999-block pieces on the regular transports', async () => {
    for (const err of [rpcError('requested range too large', -32012), rpcError('invalid params', -32602), rpcError('max block range 100000'), rpcError('pruned', 4444), new TypeError('Failed to fetch'), new Error('weird')]) {
      const { io, calls, logsIn } = chainWith();
      io.primary = () => Promise.reject(err);
      const out = await scanLogs(1_000n, 100_999n, io); // 100,000 blocks: two chunks
      expect(calls.fallback.length).toBeGreaterThanOrEqual(10);
      for (const p of calls.fallback) expect(p.to - p.from + 1n).toBeLessThanOrEqual(FALLBACK_MAX_SPAN);
      expect(out).toEqual(logsIn({ from: 1_000n, to: 100_999n }));
    }
  });
  it('only the failing chunk falls back', async () => {
    const { io, calls } = chainWith();
    const primary = io.primary.bind(io);
    io.primary = r => (r.to === 250_999n ? Promise.reject(rpcError('max block range 100000')) : primary(r));
    await scanLogs(1_000n, 250_999n, io);
    expect(calls.fallback.length).toBeGreaterThan(0);
    for (const p of calls.fallback) expect(p.from).toBeGreaterThanOrEqual(250_999n - 99_000n + 1n);
  });
  it('waits and retries on a rate limit instead of falling back', async () => {
    const { io, calls } = chainWith();
    let n = 0;
    const primary = io.primary.bind(io);
    io.primary = r => (++n === 1 ? Promise.reject(rpcError('limit exceeded', -32005)) : primary(r));
    await scanLogs(1_000n, 5_000n, io);
    expect(calls.fallback).toHaveLength(0);
    expect(n).toBe(2);
  });
  it('fails (does not leave a gap) if a small piece fails too', async () => {
    const { io } = chainWith();
    io.primary = () => Promise.reject(rpcError('max block range 100000'));
    io.fallback = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(scanLogs(1_000n, 20_000n, io)).rejects.toThrow();
  });
  it('reports progress and removes duplicates', async () => {
    const { io } = chainWith();
    const dup = log(7);
    io.primary = () => Promise.resolve([dup, dup, log(9)]);
    const seen: bigint[] = [];
    const out = await scanLogs(1n, 150_000n, io, { onProgress: p => seen.push(p.doneBlocks) });
    expect(out.map(l => l.blockNumber)).toEqual([hex(7), hex(9)]);
    expect(seen[seen.length - 1]).toBe(150_000n);
  });
});

// ── Topic filter ─────────────────────────────────────────────────────────────

describe('matchTopics', () => {
  const A: H = `0x${'1'.repeat(64)}`;
  const B: H = `0x${'2'.repeat(64)}`;
  const C: H = `0x${'3'.repeat(64)}`;
  it('null matches anything, arrays match any value, case does not matter', () => {
    expect(matchTopics([A, B, C], [A])).toBe(true);
    expect(matchTopics([A, B, C], [[B, A]])).toBe(true);
    expect(matchTopics([A, B, C], [A, null, C])).toBe(true);
    expect(matchTopics([A, B, C], [A, `0x${'2'.repeat(64)}`.toUpperCase().replace('0X', '0x') as `0x${string}`])).toBe(true);
    expect(matchTopics([A, B, C], [B])).toBe(false);
    expect(matchTopics([A], [A, null, C])).toBe(false); // wanted a third topic the log does not have
    expect(matchTopics([A, B], [])).toBe(true);
  });
});

// ── Cache and resume ─────────────────────────────────────────────────────────

class MemStore implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('cache', () => {
  const KEY = cacheKey(5042, '0x965281605D34f7045cBef306fe690118e6626192');
  beforeEach(() => resetLogState());

  it('the key is versioned and scoped by chain and contract', () => {
    expect(KEY).toBe('kitty:logs:v1:5042:0x965281605d34f7045cbef306fe690118e6626192');
    expect(cacheKey(5042002, '0x621b7aadfbc5870b95d4d95245529059536da7e5')).not.toBe(KEY);
  });
  it('round trips', () => {
    const store = new MemStore();
    expect(writeCache(store, KEY, 123n, [log(5), log(6)])).toBe(true);
    const back = readCache(store, KEY)!;
    expect(back.scannedTo).toBe(123n);
    expect(back.logs.map(l => l.blockNumber)).toEqual([hex(5), hex(6)]);
  });
  it('ignores a corrupt, wrong-version or malformed cache', () => {
    const store = new MemStore();
    for (const bad of ['{not json', '{"v":2,"scannedTo":"1","logs":[]}', '{"v":1,"scannedTo":"abc","logs":[]}', '{"v":1,"scannedTo":"5","logs":[{"x":1}]}', '{"v":1,"scannedTo":"5","logs":"no"}', 'null', '']) {
      store.setItem(KEY, bad);
      expect(readCache(store, KEY)).toBeUndefined();
    }
  });
  it('survives storage that throws or is missing', () => {
    const boom: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(readCache(boom, KEY)).toBeUndefined();
    expect(writeCache(boom, KEY, 1n, [])).toBe(false);
    expect(readCache(undefined, KEY)).toBeUndefined();
    expect(writeCache(undefined, KEY, 1n, [])).toBe(false);
  });
  it('a first load scans from the deploy block (never block 0) and saves the result', async () => {
    const { io, calls, logsIn } = chainWith({ every: 500 });
    const store = new MemStore();
    const out = await loadKittyLogs(KEY, 28_763_168n, { ...io, head: () => Promise.resolve(28_900_000n), storage: store, now: () => 1 });
    expect(calls.primary.every(r => r.from >= 28_763_168n)).toBe(true);
    expect(calls.primary[calls.primary.length - 1].from).toBe(28_763_168n);
    expect(out).toEqual(logsIn({ from: 28_763_168n, to: 28_900_000n }));
    expect(readCache(store, KEY)!.scannedTo).toBe(28_900_000n);
  });
  it('the next load scans only from just before scannedTo and dedupes the overlap', async () => {
    const { io, calls, logsIn } = chainWith({ every: 500 });
    const store = new MemStore();
    let head = 28_900_000n;
    const mk = (t: number) => ({ ...io, head: () => Promise.resolve(head), storage: store, now: () => t });
    const first = await loadKittyLogs(KEY, 28_763_168n, mk(1));
    resetLogState(); // a new page load: memory is gone, the saved copy stays
    calls.primary.length = 0;
    head = 28_900_700n;
    const second = await loadKittyLogs(KEY, 28_763_168n, mk(10_000));
    expect(calls.primary).toHaveLength(1);
    expect(calls.primary[0].from).toBe(28_900_000n - CACHE_OVERLAP + 1n);
    expect(calls.primary[0].to).toBe(28_900_700n);
    expect(second).toEqual(logsIn({ from: 28_763_168n, to: 28_900_700n }));
    expect(second.length).toBeGreaterThan(first.length);
    const keys = second.map(l => `${l.transactionHash}:${l.logIndex}`);
    expect(new Set(keys).size).toBe(keys.length); // the overlap did not double anything
  });
  it('a damaged cache is ignored and the history is scanned fresh', async () => {
    const { io, calls } = chainWith({ every: 500 });
    const store = new MemStore();
    store.setItem(KEY, '{"v":1,"scannedTo":"99999999999","logs":[{"oops":true}]}');
    await loadKittyLogs(KEY, 1_000n, { ...io, head: () => Promise.resolve(5_000n), storage: store, now: () => 1 });
    expect(calls.primary[calls.primary.length - 1].from).toBe(1_000n);
  });
  it('two calls in the same moment share one scan', async () => {
    const { io, calls } = chainWith();
    const load = () => loadKittyLogs(KEY, 1_000n, { ...io, head: () => Promise.resolve(5_000n), now: () => 1 });
    await Promise.all([load(), load(), load()]);
    await load(); // still fresh
    expect(calls.primary).toHaveLength(1);
  });
  it('a failed refresh after a good scan keeps showing what is known; a failed first scan throws', async () => {
    const { io } = chainWith();
    const base = { ...io, head: () => Promise.resolve(5_000n) };
    await loadKittyLogs(KEY, 1_000n, { ...base, now: () => 1 });
    const failing = { ...base, head: () => Promise.reject(new TypeError('Failed to fetch')) };
    expect((await loadKittyLogs(KEY, 1_000n, { ...failing, now: () => 100_000 })).length).toBeGreaterThan(0);
    resetLogState();
    await expect(loadKittyLogs(KEY, 1_000n, { ...failing, now: () => 1 })).rejects.toThrow();
  });
});

// ── The logs path (transport list) ───────────────────────────────────────────

describe('logs transport', () => {
  it('same-origin logs proxy first, then direct Blockdaemon', () => {
    expect(logsTransportUrls(5042, 'https://kitty-five-mu.vercel.app')).toEqual(['https://kitty-five-mu.vercel.app/rpc/arc-logs', 'https://rpc.blockdaemon.mainnet.arc.io']);
    expect(logsTransportUrls(5042002, 'https://kitty-five-mu.vercel.app/')).toEqual(['https://kitty-five-mu.vercel.app/rpc/arc-testnet-logs', 'https://rpc.blockdaemon.testnet.arc.io']);
  });
  it('origin-level, so the /testnet/ build uses the same path', () => {
    expect(logsTransportUrls(5042002, 'https://kitty-five-mu.vercel.app')[0]).not.toContain('/testnet/');
  });
  it('no proxy entry without a window; unknown chains get nothing', () => {
    expect(logsTransportUrls(5042, undefined)).toEqual(['https://rpc.blockdaemon.mainnet.arc.io']);
    expect(logsTransportUrls(1, 'https://x.app')).toEqual([]);
  });
  it('the paths and hosts are the ones vercel.json rewrites', () => {
    expect(LOGS_PROXY_PATH).toEqual({ 5042: '/rpc/arc-logs', 5042002: '/rpc/arc-testnet-logs' });
    expect(BLOCKDAEMON_URL[5042]).toBe('https://rpc.blockdaemon.mainnet.arc.io');
    expect(BLOCKDAEMON_URL[5042002]).toBe('https://rpc.blockdaemon.testnet.arc.io');
  });
});
