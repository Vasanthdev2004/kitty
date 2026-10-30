// ─── PayTogether – small React hooks ────────────────────────────────────────
import { useEffect, useState } from 'react';
import { chainOffsetSeconds, estimateChainNow } from './pt-share';
import { getShareBase } from './lib/share';

/**
 * Wall-clock ms, refreshed on an interval. The interval is cleared while the tab is
 * hidden (no wasted wake-ups) and restarts, with an immediate refresh, when it is shown again.
 */
export function useNowMs(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => { if (id === undefined) id = setInterval(() => setNow(Date.now()), intervalMs); };
    const stop = () => { if (id !== undefined) { clearInterval(id); id = undefined; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { setNow(Date.now()); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [intervalMs]);
  return now;
}

/**
 * Estimated chain time (unix seconds), ticking every second. Anchored to the
 * block timestamp of the last read so the countdown follows the chain clock.
 */
export function useChainNow(chainTimestamp: bigint): bigint {
  const nowMs = useNowMs(1000);
  const [anchor, setAnchor] = useState(() => ({
    ts: chainTimestamp,
    offset: chainOffsetSeconds(chainTimestamp, nowMs),
  }));
  if (anchor.ts !== chainTimestamp) {
    setAnchor({ ts: chainTimestamp, offset: chainOffsetSeconds(chainTimestamp, nowMs) });
  }
  return estimateChainNow(anchor.offset, nowMs);
}

/** The share-safe base URL (resolves once; stays undefined until the handshake finishes). */
export function useShareBase(): string | undefined {
  const [base, setBase] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    void getShareBase().then(b => { if (!cancelled) setBase(b); });
    return () => { cancelled = true; };
  }, []);
  return base;
}
