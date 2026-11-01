/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { arc, arcTestnet } from 'viem/chains'
import { realConnectors } from './wallets'
import { registerChain } from './tracing'
import { proxyUrlFor, transportUrls } from './rpc-proxy'
import { trackedFetch } from './rpc-health'

// The app's own origin. Undefined where there is no window (tests, server rendering): no proxy then.
const ORIGIN = typeof window === 'undefined' ? undefined : window.location.origin

// Pre-register chain RPC URLs (the same-origin proxy included) so trace events show correct chain names immediately
for (const chain of [arcTestnet, arc]) {
  registerChain(chain.id, chain.rpcUrls.default.http[0])
  const proxy = proxyUrlFor(chain.id, ORIGIN)
  if (proxy) registerChain(chain.id, proxy)
}

// Public RPCs rate-limit. Per URL: JSON-RPC batching (fewer HTTP requests) and two
// retries with exponential backoff (viem retries 429 and 5xx itself). Across URLs: fall back in order.
// `fetchFn` turns "the browser would not even send it" (a content blocker, offline) into a
// status viem does not retry, so a blocked URL costs milliseconds, not seconds of backoff.
/** Per chain, in the order they are tried: the same-origin proxy (when there is a window), then the direct RPCs. */
export const RPC_URLS: Readonly<Record<number, readonly string[]>> = {
  [arcTestnet.id]: transportUrls(arcTestnet.id, arcTestnet.rpcUrls.default.http, ORIGIN),
  [arc.id]: transportUrls(arc.id, arc.rpcUrls.default.http, ORIGIN),
}

const arcTransport = (chainId: number) =>
  fallback(
    // Same-origin proxy first (first-party, so blockers leave it alone), then the direct URLs.
    RPC_URLS[chainId].map(url =>
      http(url, { batch: true, retryCount: 2, retryDelay: 600 /* then 1.2s */, timeout: 10_000, fetchFn: trackedFetch() })),
    { rank: false, retryCount: 1 },
  )

// Both Arc chains are configured so the wallet can switch to whichever one this build uses
// (src/kitty-config.ts). Ethereum mainnet is not included: the app does no ENS lookups.
export const config = createConfig({
  chains: [arcTestnet, arc],
  // Injected wallets; plus WalletConnect when VITE_WALLETCONNECT_PROJECT_ID is set (see src/wallets.ts).
  connectors: realConnectors({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID, origin: ORIGIN }),
  // Calls made in the same moment become one eth_call through Multicall3.
  batch: { multicall: true },
  transports: {
    [arcTestnet.id]: arcTransport(arcTestnet.id),
    [arc.id]: arcTransport(arc.id),
  },
})
