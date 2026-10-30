import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

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

export default defineConfig(({ mode }) => ({
  plugins: [react(), nodePolyfills(), siteUrlInHtml(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL ?? '')],
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
  },
}))
