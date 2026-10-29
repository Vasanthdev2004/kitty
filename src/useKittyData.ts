// ─── Kitty – data hooks (kitty, activity, my kitties) ───────────────────────
// Loading is always derived ("no result for this key yet"), and results are
// stored only from promise callbacks, so no state is set synchronously in effects.
import { useEffect, useRef, useState } from 'react';
import type { PublicClient } from 'viem';
import type { KittyDeployment } from './kitty-config';
import { isPotNotFound, readActivity, readKitty, scanMine, type MineScan } from './kitty-data';
import type { ActivityItem, KittyData } from './kitty-types';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

/**
 * `expectExisting`: the kitty was just created by this browser, so a "not found"
 * is probably an RPC node that has not caught up yet. Retry a few times first.
 */
export function useKittyData(
  client: PublicClient | undefined, dep: KittyDeployment, id: `0x${string}` | undefined, expectExisting = false,
) {
  const [tick, setTick] = useState(0);
  const attempts = useRef(0);
  const [result, setResult] = useState<{ id: string; data?: KittyData; error?: string } | undefined>();

  useEffect(() => {
    if (!client || !id) return;
    let cancelled = false;
    readKitty(client, dep, id)
      .then(data => { if (!cancelled) setResult({ id, data }); })
      .catch(e => {
        if (cancelled) return;
        if (expectExisting && isPotNotFound(e) && attempts.current < 1) {
          attempts.current += 1;
          setTimeout(() => { if (!cancelled) setTick(t => t + 1); }, 1500);
          return;
        }
        setResult({ id, error: isPotNotFound(e) ? `No kitty with that ID on ${dep.name}.` : `Could not load this kitty. ${msg(e)}` });
      });
    return () => { cancelled = true; };
  }, [client, dep, id, tick, expectExisting]);

  const current = result && result.id === id ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!id && !current,
    /** Re-reads the kitty. The previous data stays on screen until the new read lands. */
    refresh: () => { setTick(t => t + 1); return Promise.resolve(); },
  };
}

/** `enabled` is false until the kitty itself has loaded, so a missing kitty never triggers a log scan. */
export function useActivity(
  client: PublicClient | undefined, dep: KittyDeployment, id: `0x${string}` | undefined, refreshKey: number, enabled = true,
) {
  const [attempt, setAttempt] = useState(0);
  const key = `${id ?? ''}:${refreshKey}:${attempt}`;
  const [result, setResult] = useState<{ key: string; items?: ActivityItem[]; error?: string } | undefined>();

  useEffect(() => {
    if (!client || !id || !enabled) return;
    let cancelled = false;
    readActivity(client, dep, id)
      .then(items => { if (!cancelled) setResult({ key, items }); })
      .catch(e => { if (!cancelled) setResult({ key, error: msg(e) }); });
    return () => { cancelled = true; };
  }, [client, dep, id, key, enabled]);

  // Keep showing the last good list while a refresh is in flight.
  const shown = result && result.key.startsWith(`${id ?? ''}:`) ? result : undefined;
  return {
    items: shown?.items,
    error: shown?.error,
    loading: enabled && !!id && (!result || result.key !== key),
    retry: () => setAttempt(a => a + 1),
  };
}

const mineCache = new Map<string, MineScan>();

/** Scans once per wallet, caches in memory, and re-scans on demand. */
export function useMine(client: PublicClient | undefined, dep: KittyDeployment, me: string | undefined) {
  const cacheKey = me ? `${dep.chainId}:${me.toLowerCase()}` : '';
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<{ key: string; tick: number; scan?: MineScan; error?: string } | undefined>();

  useEffect(() => {
    if (!client || !me) return;
    if (tick === 0 && mineCache.has(cacheKey)) return; // cached: nothing to fetch
    let cancelled = false;
    scanMine(client, dep, me)
      .then(scan => { mineCache.set(cacheKey, scan); if (!cancelled) setResult({ key: cacheKey, tick, scan }); })
      .catch(e => { if (!cancelled) setResult(r => ({ key: cacheKey, tick, scan: r?.key === cacheKey ? r.scan : undefined, error: msg(e) })); });
    return () => { cancelled = true; };
  }, [client, dep, me, cacheKey, tick]);

  const current = result && result.key === cacheKey ? result : undefined;
  const scan = current?.scan ?? (cacheKey ? mineCache.get(cacheKey) : undefined);
  const settled = current !== undefined && current.tick === tick;
  return {
    scan,
    error: current?.error,
    loading: !!me && !scan && !settled,
    refreshing: !!me && tick > 0 && !settled,
    refresh: () => setTick(t => t + 1),
  };
}
