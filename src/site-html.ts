// ─── index.html tweaks per build (pure) ─────────────────────────────────────
// The Arc Testnet build is served from the same site as mainnet, so it needs its own title: someone
// with the tab open (or a chat preview) must be able to tell the two apart.

export const MAINNET_TITLE = 'Kitty: Nobody fronts the money';
export const TESTNET_TITLE = 'Kitty on Arc Testnet: try group payments free';

/** True when the build being made is NOT Arc mainnet (testnet is the default, as in the app config). */
export const isTestnetBuild = (viteKittyChain: string | undefined): boolean => (viteKittyChain ?? '').trim().toLowerCase() !== 'arc';

/** Swaps the page title and the og:title / twitter:title for the testnet build. Mainnet html is returned untouched. */
export function retitleHtml(html: string, testnet: boolean): string {
  if (!testnet) return html;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${TESTNET_TITLE}</title>`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, `$1${TESTNET_TITLE}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, `$1${TESTNET_TITLE}$2`);
}
