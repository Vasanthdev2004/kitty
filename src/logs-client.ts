// ─── The client for history reads (eth_getLogs) ─────────────────────────────
// [same-origin logs proxy, direct Blockdaemon]. Blockdaemon accepts spans up to 100,000 blocks, which
// the regular Arc RPCs do not (see src/log-scan.ts). One client per chain, built on first use.
import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { logsTransportUrls } from './rpc-proxy';
import { trackedFetch } from './rpc-health';
import type { KittyDeployment } from './kitty-config';

const clients = new Map<number, PublicClient>();

export function logsClientFor(dep: KittyDeployment): PublicClient {
  const have = clients.get(dep.chainId);
  if (have) return have;
  const origin = typeof window === 'undefined' ? undefined : window.location.origin;
  const urls = logsTransportUrls(dep.chainId, origin);
  const client = createPublicClient({
    chain: dep.chain,
    // Big responses, so no JSON-RPC batching and a longer timeout than the regular reads.
    transport: fallback(
      urls.map(url => http(url, { batch: false, retryCount: 1, retryDelay: 600, timeout: 30_000, fetchFn: trackedFetch() })),
      { rank: false, retryCount: 0 },
    ),
  });
  clients.set(dep.chainId, client);
  return client;
}
