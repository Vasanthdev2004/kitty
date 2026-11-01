/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which Kitty deployment this build uses: "arc" (mainnet) or "arcTestnet" (default). */
  readonly VITE_KITTY_CHAIN?: string;
  /** Absolute URL of the mainnet build, e.g. https://kitty-five-mu.vercel.app . Both builds read it. */
  readonly VITE_MAINNET_URL?: string;
  /** Absolute URL of the testnet build, e.g. https://kitty-five-mu.vercel.app/testnet/ . Both builds read it. */
  readonly VITE_TESTNET_URL?: string;
  /** Enables the WalletConnect connector (phones, QR). Optional. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  /** Optional: comma-separated kitty ids (0x + 64 hex). The first is linked as "See a real paid-out kitty". */
  readonly VITE_FEATURED_KITTIES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
