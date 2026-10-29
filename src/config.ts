/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  // Calls made in the same moment become one eth_call through Multicall3.
  batch: { multicall: true },
  transports: {
    // Public RPCs rate-limit. Per URL: JSON-RPC batching (fewer HTTP requests) and two
    // retries with exponential backoff (viem retries 429 and 5xx itself). Across URLs: fall back in order.
    [arcTestnet.id]: fallback(
      arcTestnet.rpcUrls.default.http.map(url =>
        http(url, { batch: true, retryCount: 2, retryDelay: 600 /* then 1.2s */, timeout: 10_000 })),
      { rank: false, retryCount: 1 },
    ),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
