// ─── Same-origin RPC proxy, network-failure handling, stats timeout ─────────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createPublicClient, fallback, http } from 'viem';
import { arc, arcTestnet } from 'viem/chains';
import { RPC_PROXY_PATH, proxyUrlFor, transportUrls } from '../rpc-proxy';
import { NETWORK_FAILURE_STATUS, isNetworkError, isRetryableRpcError } from '../rpc';
import { RpcHealth, trackedFetch } from '../rpc-health';
import { TimeoutError, withTimeout } from '../lib/timeout';
import { STATS_TIMEOUT_MS, statsPhase } from '../kitty-requests';
import { validateWithRetry, type MinimalPublicClient } from '../kitty-tx';
import { makeDeployment } from '../kitty-config';
import { RPC_BLOCKED_TEXT, RpcBlockedNotice } from '../components/RpcBlockedNotice';

const ORIGIN = 'https://kitty-five-mu.vercel.app';

describe('same-origin proxy paths', () => {
  it('maps each Arc chain to an origin-level path', () => {
    expect(RPC_PROXY_PATH[5042]).toBe('/rpc/arc');
    expect(RPC_PROXY_PATH[5042002]).toBe('/rpc/arc-testnet');
    expect(proxyUrlFor(5042, ORIGIN)).toBe(`${ORIGIN}/rpc/arc`);
    expect(proxyUrlFor(5042002, ORIGIN)).toBe(`${ORIGIN}/rpc/arc-testnet`);
  });
  it('ignores a trailing slash and never depends on a sub-path build like /testnet/', () => {
    expect(proxyUrlFor(5042, `${ORIGIN}/`)).toBe(`${ORIGIN}/rpc/arc`);
    // the testnet build is served from /testnet/ but the proxy is built from the origin only
    expect(proxyUrlFor(5042002, new URL('https://kitty-five-mu.vercel.app/testnet/').origin)).toBe(`${ORIGIN}/rpc/arc-testnet`);
  });
  it('has no proxy without an origin (tests, server rendering) or for other chains', () => {
    expect(proxyUrlFor(5042, undefined)).toBeUndefined();
    expect(proxyUrlFor(5042, '')).toBeUndefined();
    expect(proxyUrlFor(1, ORIGIN)).toBeUndefined();
  });
});

describe('transport list order', () => {
  it('proxy first, then the direct URLs in their existing order', () => {
    const urls = transportUrls(arc.id, arc.rpcUrls.default.http, ORIGIN);
    expect(urls[0]).toBe(`${ORIGIN}/rpc/arc`);
    expect(urls.slice(1)).toEqual([...arc.rpcUrls.default.http]);
    expect(urls.length).toBe(arc.rpcUrls.default.http.length + 1);
    const t = transportUrls(arcTestnet.id, arcTestnet.rpcUrls.default.http, ORIGIN);
    expect(t[0]).toBe(`${ORIGIN}/rpc/arc-testnet`);
    expect(t.slice(1)).toEqual([...arcTestnet.rpcUrls.default.http]);
  });
  it('no proxy entry without a window', () => {
    expect(transportUrls(arc.id, arc.rpcUrls.default.http, undefined)).toEqual([...arc.rpcUrls.default.http]);
  });

  describe('the wagmi config', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock('../tracing'); });
    const load = async (origin?: string) => {
      vi.resetModules();
      vi.doMock('../tracing', () => ({ registerChain: () => undefined }));
      if (origin) {
        vi.stubGlobal('window', {
          location: { origin },
          addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => true,
        });
      }
      return import('../config');
    };
    it('with a window: proxy first for both chains', async () => {
      const { RPC_URLS } = await load(ORIGIN);
      expect(RPC_URLS[arc.id][0]).toBe(`${ORIGIN}/rpc/arc`);
      expect(RPC_URLS[arcTestnet.id][0]).toBe(`${ORIGIN}/rpc/arc-testnet`);
      expect(RPC_URLS[arc.id].slice(1)).toEqual([...arc.rpcUrls.default.http]);
    });
    it('without a window: direct URLs only', async () => {
      const { RPC_URLS } = await load();
      expect(RPC_URLS[arc.id]).toEqual([...arc.rpcUrls.default.http]);
      expect(RPC_URLS[arcTestnet.id]).toEqual([...arcTestnet.rpcUrls.default.http]);
    });
  });
});

describe('hosting files', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as Record<string, unknown> & { rewrites: Array<{ source: string; destination: string }> };
  it('vercel.json rewrites exactly the RPC paths and the two history (logs) paths', () => {
    expect(vercel.rewrites).toEqual([
      { source: '/rpc/arc', destination: 'https://rpc.mainnet.arc.io/' },
      { source: '/rpc/arc-testnet', destination: 'https://rpc.testnet.arc.io/' },
      { source: '/rpc/arc-logs', destination: 'https://rpc.blockdaemon.mainnet.arc.io/' },
      { source: '/rpc/arc-testnet-logs', destination: 'https://rpc.blockdaemon.testnet.arc.io/' },
    ]);
  });
  it('adds no catch-all that could swallow /testnet/ or its assets, and no build settings', () => {
    for (const r of vercel.rewrites) expect(r.source).toMatch(/^\/rpc\/[a-z-]+$/);
    expect(vercel).not.toHaveProperty('buildCommand');
    expect(vercel).not.toHaveProperty('outputDirectory');
  });
  it('vite.config.ts proxies the same two paths exactly (a prefix key would catch /rpc/arc-testnet)', () => {
    const src = readFileSync('vite.config.ts', 'utf8');
    expect(src).toContain("'^/rpc/arc$'");
    expect(src).toContain("'^/rpc/arc-testnet$'");
    expect(src).toContain("'^/rpc/arc-logs$'");
    expect(src).toContain("'^/rpc/arc-testnet-logs$'");
    expect(src).toContain('https://rpc.blockdaemon.mainnet.arc.io');
    expect(src).toContain('https://rpc.blockdaemon.testnet.arc.io');
    expect(src).toContain('https://rpc.mainnet.arc.io');
    expect(src).toContain('https://rpc.testnet.arc.io');
    expect(src).toMatch(/server:\s*{[\s\S]*proxy: rpcProxy[\s\S]*}[\s\S]*preview:\s*{[\s\S]*proxy: rpcProxy/);
  });
});

describe('isNetworkError', () => {
  const chainErr = (top: object, cause?: object) => Object.assign(new Error('HTTP request failed.'), top, { cause });
  it('fetch itself failing (blocked, offline) is a network error', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkError(chainErr({ name: 'HttpRequestError' }, new TypeError('Failed to fetch')))).toBe(true);
  });
  it('the marker status that trackedFetch produces is a network error', () => {
    expect(isNetworkError(chainErr({ name: 'HttpRequestError', status: NETWORK_FAILURE_STATUS }))).toBe(true);
  });
  it('anything the network answered is NOT a network error', () => {
    expect(isNetworkError(chainErr({ name: 'HttpRequestError', status: 429 }))).toBe(false);
    expect(isNetworkError(chainErr({ name: 'HttpRequestError', status: 503 }))).toBe(false);
    expect(isNetworkError(chainErr({ name: 'HttpRequestError', status: 404 }))).toBe(false);
    expect(isNetworkError(new Error('execution reverted: PotNotFound'))).toBe(false);
    expect(isNetworkError(Object.assign(new Error('The contract function reverted'), { code: 3 }))).toBe(false);
    expect(isNetworkError(new Error('boom'))).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
  it('still counts as retryable for the deployment check (it may be a hiccup), unless we give up', () => {
    expect(isRetryableRpcError(chainErr({ name: 'HttpRequestError', status: NETWORK_FAILURE_STATUS }))).toBe(true);
  });
});

describe('RpcHealth', () => {
  it('blocked when several different hosts fail outright and none answers', () => {
    const h = new RpcHealth();
    h.recordFailure('app.example', 1_000);
    expect(h.isBlocked(1_500)).toBe(false);           // one host is not enough: could be one provider down
    h.recordFailure('rpc.mainnet.arc.io', 1_100);
    expect(h.isBlocked(1_500)).toBe(true);
  });
  it('a 429 or 5xx still counts as an answer, so the network is reachable', () => {
    const h = new RpcHealth();
    h.recordFailure('a', 1_000); h.recordFailure('b', 1_000);
    h.recordReach('c', 1_200);
    expect(h.isBlocked(1_500)).toBe(false);
  });
  it('forgets old failures', () => {
    const h = new RpcHealth();
    h.recordFailure('a', 0); h.recordFailure('b', 0);
    expect(h.isBlocked(59_000)).toBe(true);
    expect(h.isBlocked(61_000)).toBe(false);
  });
  it('notifies subscribers and can be reset', () => {
    const h = new RpcHealth();
    const cb = vi.fn();
    const off = h.subscribe(cb);
    h.recordFailure('a', 1);
    expect(cb).toHaveBeenCalledTimes(1);
    off(); h.recordFailure('b', 2);
    expect(cb).toHaveBeenCalledTimes(1);
    h.reset();
    expect(h.isBlocked(3)).toBe(false);
  });
});

describe('trackedFetch', () => {
  it('passes any HTTP answer through and marks the host reachable', async () => {
    const h = new RpcHealth();
    const f = trackedFetch(() => Promise.resolve(new Response('{}', { status: 429 })), h, () => 10);
    const res = await f('https://rpc.example/x', { method: 'POST' });
    expect(res.status).toBe(429);
    h.recordFailure('other', 11); h.recordFailure('another', 11);
    expect(h.isBlocked(12)).toBe(false);              // rpc.example answered
  });
  it('turns a thrown fetch into a 599 response and records the failure', async () => {
    const h = new RpcHealth();
    const f = trackedFetch(() => Promise.reject(new TypeError('Failed to fetch')), h, () => 10);
    const res = await f('https://rpc.mainnet.arc.io/', { method: 'POST' });
    expect(res.status).toBe(NETWORK_FAILURE_STATUS);
    await f('https://rpc.drpc.mainnet.arc.io/', { method: 'POST' });
    expect(h.isBlocked(11)).toBe(true);
  });
  it('re-throws an abort (viem\'s own timeout) untouched and does not count it as blocked', async () => {
    const h = new RpcHealth();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const f = trackedFetch(() => Promise.reject(abort), h, () => 10);
    await expect(f('https://a.example/', {})).rejects.toBe(abort);
    await expect(f('https://b.example/', {})).rejects.toBe(abort);
    expect(h.isBlocked(11)).toBe(false);
  });

  it('fails fast through viem: every URL is tried, nobody sits in retry backoff', async () => {
    const h = new RpcHealth();
    const failing = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const urls = ['https://app.example/rpc/arc', 'https://rpc.a.example', 'https://rpc.b.example'];
    const client = createPublicClient({
      chain: arc,
      transport: fallback(
        urls.map(url => http(url, { batch: true, retryCount: 2, retryDelay: 600, timeout: 10_000, fetchFn: trackedFetch(failing as unknown as typeof fetch, h, () => 5) })),
        { rank: false, retryCount: 1 },
      ),
    });
    const t0 = Date.now();
    let err: unknown;
    try { await client.getBlockNumber(); } catch (e) { err = e; }
    const elapsed = Date.now() - t0;
    expect(err).toBeDefined();
    expect(isNetworkError(err)).toBe(true);
    expect(elapsed).toBeLessThan(1_000);                 // with retries it would be seconds
    expect(failing.mock.calls.length).toBeLessThanOrEqual(urls.length * 2); // each URL at most once per pass
    expect(h.isBlocked(6)).toBe(true);
  });
});

describe('deployment check gives up when every RPC is blocked', () => {
  const dep = makeDeployment('arc', arc, { name: 'Arc', shortName: 'Arc', testnet: false }, { kitty: '0x965281605d34f7045cbef306fe690118e6626192', deployBlock: 28_763_168n });
  const down: MinimalPublicClient = {
    getBytecode: () => Promise.reject(new TypeError('Failed to fetch')),
    readContract: () => Promise.reject(new TypeError('Failed to fetch')),
    waitForTransactionReceipt: () => Promise.reject(new Error('unused')),
  };
  it('retries by default, stops at once when told to give up', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const onRetry = vi.fn();
    await validateWithRetry(down, dep, { sleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(3);
    const sleep2 = vi.fn(() => Promise.resolve());
    const onRetry2 = vi.fn();
    const r = await validateWithRetry(down, dep, { sleep: sleep2, onRetry: onRetry2, giveUp: () => true });
    expect(r.ok).toBe(false);
    expect(onRetry2).not.toHaveBeenCalled();
    expect(sleep2).not.toHaveBeenCalled();
  });
});

describe('stats timeout', () => {
  afterEach(() => vi.useRealTimers());
  it('is about 15 seconds', () => { expect(STATS_TIMEOUT_MS).toBe(15_000); });
  it('withTimeout passes a fast result through', async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000)).resolves.toBe(7);
  });
  it('withTimeout rejects with TimeoutError when the promise hangs', async () => {
    vi.useFakeTimers();
    const hung = new Promise<number>(() => undefined);
    const p = withTimeout(hung, STATS_TIMEOUT_MS);
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(STATS_TIMEOUT_MS + 1);
    await assertion;
  });
  it('withTimeout keeps the original error', async () => {
    const e = new Error('boom');
    await expect(withTimeout(Promise.reject(e), 1_000)).rejects.toBe(e);
  });
  it('skeleton while loading, hidden after the timeout or an error, numbers always win', () => {
    expect(statsPhase({ hasStats: false, failed: false, timedOut: false, loading: true })).toBe('loading');
    expect(statsPhase({ hasStats: false, failed: false, timedOut: true, loading: true })).toBe('hidden');
    expect(statsPhase({ hasStats: false, failed: true, timedOut: false, loading: false })).toBe('hidden');
    expect(statsPhase({ hasStats: true, failed: false, timedOut: true, loading: false })).toBe('ready');
    expect(statsPhase({ hasStats: false, failed: false, timedOut: false, loading: false })).toBe('hidden'); // nothing to wait for
  });
});

describe('content blocker notice', () => {
  it('says exactly what was asked, with a Reload button, and no dashes', () => {
    const html = renderToString(createElement(RpcBlockedNotice, { shortName: 'Arc', onReload: () => undefined }));
    expect(RPC_BLOCKED_TEXT('Arc')).toBe(
      "Can't reach the Arc network from this browser. A content blocker may be blocking arc.io. Allow this site in your blocker, then reload.");
    expect(html.replace(/&#x27;/g, "'")).toContain(RPC_BLOCKED_TEXT('Arc'));
    expect(html).toContain('Reload');
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });
});
