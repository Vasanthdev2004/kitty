// ─── RPC resilience helpers (pure) ──────────────────────────────────────────
// Public RPCs rate-limit (HTTP 429) and hiccup (5xx, timeouts). These helpers
// decide what is worth retrying and how long to wait. A definitive answer from
// the chain (a revert, "no bytecode") is never retried.

type Loose = { name?: unknown; message?: unknown; shortMessage?: unknown; status?: unknown; code?: unknown; cause?: unknown; headers?: unknown };

/** Every error in a `cause` chain (viem wraps errors several levels deep). */
function chain(e: unknown): Loose[] {
  const out: Loose[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur && typeof cur === 'object'; i++) {
    out.push(cur);
    cur = (cur as Loose).cause;
  }
  return out;
}

const TRANSIENT_TEXT =
  /\b429\b|too many requests|rate.?limit|limit exceeded|timed? ?out|timeout|network|fetch failed|failed to fetch|econn|etimedout|enotfound|socket|bad gateway|service unavailable|gateway time|http request failed|\b50[0234]\b/i;
const DEFINITIVE_TEXT = /revert|invalid opcode|execution reverted|abi|function selector/i;
const TRANSIENT_STATUS = new Set([408, 413, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([-32005, -32008, -32015, -32097]);

/** True for 429, 5xx, timeouts and network failures; false for reverts and anything else. */
export function isRetryableRpcError(e: unknown): boolean {
  const links = chain(e);
  for (const l of links) {
    if (typeof l.status === 'number' && TRANSIENT_STATUS.has(l.status)) return true;
    if (typeof l.code === 'number' && TRANSIENT_CODES.has(l.code)) return true;
    if (l.name === 'TimeoutError') return true;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const text = links.map(l => `${str(l.name)} ${str(l.shortMessage)} ${str(l.message)}`).join(' ');
  const httpish = /http request failed|status: ?\d{3}|fetch|network/i.test(text);
  if (DEFINITIVE_TEXT.test(text) && !httpish) return false;
  return TRANSIENT_TEXT.test(text);
}

/** Default schedule for the one-shot deployment check: about 1s, 3s, 7s, each +/-25%. */
export const VALIDATION_DELAYS_MS = [1000, 3000, 7000] as const;

export function jitteredDelay(baseMs: number, random: () => number = Math.random): number {
  return Math.round(baseMs * (0.75 + random() * 0.5));
}
