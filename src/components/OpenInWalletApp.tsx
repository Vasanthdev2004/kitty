// ─── Kitty – "Open in wallet app" (phones without a wallet extension) ────────
import { useState } from 'react';
import { coinbaseDeepLink, metamaskDeepLink, shouldShowWalletLinks } from '../wallet-links';

/**
 * Shown only on a mobile browser with no injected wallet. The links reopen THIS page
 * (path such as /testnet/ and query such as ?kitty=...) inside the wallet's own browser.
 */
export function OpenInWalletApp({ className }: { className?: string }) {
  const [show] = useState(() =>
    typeof navigator !== 'undefined' && typeof window !== 'undefined'
    && shouldShowWalletLinks({ userAgent: navigator.userAgent, hasInjectedWallet: !!(window as { ethereum?: unknown }).ethereum }));
  if (!show) return null;
  const url = window.location.href;
  return (
    <p className={className ?? 'text-xs leading-relaxed text-ink-2'}>
      No wallet in this browser? Open in wallet app:{' '}
      <a className="font-medium text-accent-text underline-offset-2 hover:underline" href={metamaskDeepLink(url)}>MetaMask</a>
      {' or '}
      <a className="font-medium text-accent-text underline-offset-2 hover:underline" href={coinbaseDeepLink(url)}>Coinbase Wallet</a>.
    </p>
  );
}
