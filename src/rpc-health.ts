// ─── RPC reachability tracker ───────────────────────────────────────────────
// Records, per RPC host, whether a request got any HTTP answer or failed outright
// (fetch threw). If several different hosts all fail outright and none answers,
// the browser is blocking them (a content blocker) or is offline. A 429 or 5xx
// counts as "answered": the network is reachable, it is just busy.
import { NETWORK_FAILURE_STATUS } from './rpc';

interface HostState { lastFailAt?: number; lastReachAt?: number }

export class RpcHealth {
  private hosts = new Map<string, HostState>();
  private listeners = new Set<() => void>();
  private version = 0;

  private touch(host: string, patch: HostState): void {
    this.hosts.set(host, { ...this.hosts.get(host), ...patch });
    this.version++;
    this.listeners.forEach(l => l());
  }
  recordFailure(host: string, now: number): void { this.touch(host, { lastFailAt: now }); }
  recordReach(host: string, now: number): void { this.touch(host, { lastReachAt: now }); }
  reset(): void { this.hosts.clear(); this.version++; this.listeners.forEach(l => l()); }

  /**
   * Blocked: at least `minHosts` different hosts failed outright within `windowMs`,
   * and no host has answered in that window.
   */
  isBlocked(now: number, windowMs = 60_000, minHosts = 2): boolean {
    let failing = 0;
    for (const s of this.hosts.values()) {
      if (s.lastReachAt !== undefined && now - s.lastReachAt <= windowMs) return false;
      if (s.lastFailAt !== undefined && now - s.lastFailAt <= windowMs) failing++;
    }
    return failing >= minHosts;
  }

  subscribe = (cb: () => void): (() => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
  getVersion = (): number => this.version;
}

export const rpcHealth = new RpcHealth();

const hostOf = (input: RequestInfo | URL): string => {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, typeof location === 'undefined' ? 'http://localhost' : location.href).host;
  } catch { return 'unknown'; }
};

/**
 * fetch for the RPC transports.
 *  - an HTTP answer of any status is passed through (and marks the host reachable)
 *  - fetch throwing (blocked / offline) becomes a 599 response, which viem does not retry,
 *    so the fallback list moves to the next URL immediately instead of sitting in backoff
 *  - an aborted request (viem's own timeout) is re-thrown untouched
 */
export function trackedFetch(
  fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a),
  health: RpcHealth = rpcHealth,
  now: () => number = Date.now,
): typeof fetch {
  return async (input, init) => {
    const host = hostOf(input);
    try {
      const res = await fetchImpl(input, init);
      health.recordReach(host, now());
      return res;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      health.recordFailure(host, now());
      return new Response('{"error":"network"}', { status: NETWORK_FAILURE_STATUS, statusText: 'Network error' });
    }
  };
}

/** Blocked right now, by the wall clock. */
export const isRpcBlockedNow = (): boolean => rpcHealth.isBlocked(Date.now());
