// ─── Open this page inside a wallet app (pure) ──────────────────────────────
// A phone browser has no wallet extension. MetaMask and Coinbase Wallet both ship
// an in-app browser that does; these links reopen the SAME page there: path
// (for example /testnet/) and query (?kitty=...) included.

/** MetaMask: https://metamask.app.link/dapp/<host + path + query, no scheme>. */
export function metamaskDeepLink(pageUrl: string): string {
  const u = new URL(pageUrl);
  return `https://metamask.app.link/dapp/${u.host}${u.pathname}${u.search}`;
}

/** Coinbase Wallet: https://go.cb-w.com/dapp?cb_url=<the whole URL, encoded>. */
export function coinbaseDeepLink(pageUrl: string): string {
  return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(new URL(pageUrl).href)}`;
}

const MOBILE_UA = /android|iphone|ipad|ipod|mobile/i;
export const isMobileUserAgent = (ua: string | undefined): boolean => !!ua && MOBILE_UA.test(ua);

/** Only on a phone that has no injected wallet of its own. */
export function shouldShowWalletLinks(i: { userAgent: string | undefined; hasInjectedWallet: boolean }): boolean {
  return isMobileUserAgent(i.userAgent) && !i.hasInjectedWallet;
}
