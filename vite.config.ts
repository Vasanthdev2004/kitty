import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { isTestnetBuild, retitleHtml } from './src/site-html'

/**
 * Social previews need an absolute image URL. Set VITE_SITE_URL (for example https://kitty.example)
 * in the hosted build; without it the tags use a root-relative path, which works in the browser
 * but not for every chat app's link preview.
 */
function siteUrlInHtml(siteUrl: string): Plugin {
  return {
    name: 'kitty-site-url-in-html',
    transformIndexHtml: html => html.replaceAll('__SITE_URL__', siteUrl.replace(/\/+$/, '')),
  }
}

/** The testnet build (served under /testnet/) gets its own page title and og:title. Mainnet is unchanged. */
function chainTitleInHtml(viteKittyChain: string | undefined): Plugin {
  return {
    name: 'kitty-chain-title-in-html',
    transformIndexHtml: html => retitleHtml(html, isTestnetBuild(viteKittyChain)),
  }
}

/**
 * Same-origin RPC proxy for dev, `vite preview` and the Studio preview. Production gets the same
 * paths from vercel.json. Regex keys are exact: a plain '/rpc/arc' key would also match
 * '/rpc/arc-testnet'.
 */
const rpcProxy = {
  '^/rpc/arc$': { target: 'https://rpc.mainnet.arc.io', changeOrigin: true, rewrite: () => '/' },
  '^/rpc/arc-testnet$': { target: 'https://rpc.testnet.arc.io', changeOrigin: true, rewrite: () => '/' },
  // History (eth_getLogs) goes to Blockdaemon, which accepts spans up to 100,000 blocks.
  '^/rpc/arc-logs$': { target: 'https://rpc.blockdaemon.mainnet.arc.io', changeOrigin: true, rewrite: () => '/' },
  '^/rpc/arc-testnet-logs$': { target: 'https://rpc.blockdaemon.testnet.arc.io', changeOrigin: true, rewrite: () => '/' },
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
  plugins: [react(), nodePolyfills(), siteUrlInHtml(env.VITE_SITE_URL ?? ''), chainTitleInHtml(env.VITE_KITTY_CHAIN)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    proxy: rpcProxy,
  },
  preview: {
    proxy: rpcProxy,
  },
}
})
