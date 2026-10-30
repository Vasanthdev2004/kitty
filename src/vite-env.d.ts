/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which Kitty deployment this build uses: "arc" (mainnet) or "arcTestnet" (default). */
  readonly VITE_KITTY_CHAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
