/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arc.id, arc.rpcUrls.default.http[0])

// Public RPCs rate-limit. Per URL: JSON-RPC batching (fewer HTTP requests) and two
// retries with exponential backoff (viem retries 429 and 5xx itself). Across URLs: fall back in order.
const arcTransport = (urls: readonly string[]) =>
  fallback(
    urls.map(url => http(url, { batch: true, retryCount: 2, retryDelay: 600 /* then 1.2s */, timeout: 10_000 })),
    { rank: false, retryCount: 1 },
  )

// Both Arc chains are configured so the wallet can switch to whichever one this build uses
// (src/kitty-config.ts). Ethereum mainnet is not included: the app does no ENS lookups.
export const config = createConfig({
  chains: [arcTestnet, arc],
  connectors: [injected()],
  // Calls made in the same moment become one eth_call through Multicall3.
  batch: { multicall: true },
  transports: {
    [arcTestnet.id]: arcTransport(arcTestnet.rpcUrls.default.http),
    [arc.id]: arcTransport(arc.rpcUrls.default.http),
  },
})
