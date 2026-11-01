// ─── Same-origin RPC proxy paths (pure) ─────────────────────────────────────
// Some content blockers block third-party requests to *.arc.io. Requests to the
// app's own origin are first-party, so the host rewrites these two paths to the
// public RPCs (vercel.json in production, vite.config.ts in dev and preview).
// The paths are origin-level (not under BASE_URL) so a build served from
// /testnet/ uses the same proxy as the main build.

export const RPC_PROXY_PATH: Readonly<Record<number, string>> = {
  5042: '/rpc/arc',
  5042002: '/rpc/arc-testnet',
};

/** The same-origin proxy URL for a chain, or undefined when there is no origin (tests, SSR) or no proxy. */
export function proxyUrlFor(chainId: number, origin: string | undefined): string | undefined {
  const path = RPC_PROXY_PATH[chainId];
  if (!path || !origin) return undefined;
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/** Proxy first (same-origin), then the direct URLs in their existing order. No proxy without an origin. */
export function transportUrls(chainId: number, directUrls: readonly string[], origin: string | undefined): string[] {
  const proxy = proxyUrlFor(chainId, origin);
  return proxy ? [proxy, ...directUrls] : [...directUrls];
}

// ── The logs path ────────────────────────────────────────────────────────────
// The official RPCs reject eth_getLogs spans of 10,000 blocks or more; the Blockdaemon mirrors accept
// up to 100,000. History is therefore read on its own path: a same-origin rewrite to Blockdaemon
// (first-party, so blockers leave it alone), then Blockdaemon directly. See src/log-scan.ts.

export const LOGS_PROXY_PATH: Readonly<Record<number, string>> = {
  5042: '/rpc/arc-logs',
  5042002: '/rpc/arc-testnet-logs',
};

export const BLOCKDAEMON_URL: Readonly<Record<number, string>> = {
  5042: 'https://rpc.blockdaemon.mainnet.arc.io',
  5042002: 'https://rpc.blockdaemon.testnet.arc.io',
};

/** Same-origin logs proxy first (only with an origin), then the direct Blockdaemon URL. */
export function logsTransportUrls(chainId: number, origin: string | undefined): string[] {
  const direct = BLOCKDAEMON_URL[chainId];
  const path = LOGS_PROXY_PATH[chainId];
  const out: string[] = [];
  if (path && origin) out.push(`${origin.replace(/\/+$/, '')}${path}`);
  if (direct) out.push(direct);
  return out;
}
