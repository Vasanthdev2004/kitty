// ─── Judge-ready: one site, two networks, proof strip, Get USDC, wallets ────
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { arc, arcTestnet } from 'viem/chains';
import {
  KITTY_DEPLOYMENTS, makeDeployment, otherDeployment, switchLabel, type KittyDeployment,
} from '../kitty-config';
import { buildKittyUrl, routeToSearch, type Route } from '../kitty-core';
import {
  otherNetworkHref, otherNetworkKittyHref, parseSiteUrl, readSiteUrls, switchModel, type SiteUrls,
} from '../network-switch';
import { kittyExistsOn } from '../kitty-data';
import { hasCachedValidation, ensureDeploymentValid, type MinimalPublicClient } from '../kitty-tx';
import { needsMainnetConfirm } from '../mainnet-ack';
import { ARC_BRIDGES_DOC_URL, ARC_PORTAL_DEPOSIT_URL, ARC_PORTAL_FIAT_URL, APP_TESTS, CONTRACT_TESTS, FAUCET_URL, STUDIO_APP_URL, factsDrift, testFactsText } from '../project-facts';
import { buildEmbedSnippet } from '../kitty-core';
import { openRefundPromise, refundPromise, remindMessageFor, shareMessageFor, splitRefundPromise } from '../share-messages';
import { FEATURED_LABEL, firstFeatured, parseFeaturedKitties } from '../featured';
import { MAINNET_TITLE, TESTNET_TITLE, isTestnetBuild, retitleHtml } from '../site-html';
import { PayoutDemo } from '../components/PayoutDemo';
import { formatDeadline } from '../pt-utils';
import { buildConnectors, normalizeProjectId, realConnectors, walletConnectMetadata, type ConnectorFactories } from '../wallets';
import { coinbaseDeepLink, isMobileUserAgent, metamaskDeepLink, shouldShowWalletLinks } from '../wallet-links';
import { NetworkSwitch } from '../components/NetworkSwitch';
import { OtherNetworkHint } from '../components/OtherNetworkHint';
import { ProofStrip } from '../components/ProofStrip';
import { GetUsdcSheet } from '../components/GetUsdcSheet';
import { Home } from '../components/Home';
import { OpenInWalletApp } from '../components/OpenInWalletApp';
import { KittyPage, type KittyPageProps } from '../components/KittyPage';
import type { KittyData } from '../kitty-types';

const U = 1_000_000n;
const ME = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const SELLER = '0x3333333333333333333333333333333333333333';
const ID = `0x${'ab'.repeat(32)}` as const;
const NOW = 1_800_000_000n;
const MAIN_URL = 'https://kitty-five-mu.vercel.app';
const TEST_URL = 'https://kitty-five-mu.vercel.app/testnet/';
const BOTH: SiteUrls = readSiteUrls({ VITE_MAINNET_URL: MAIN_URL, VITE_TESTNET_URL: TEST_URL });
const clean = (html: string) => html.replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
const noop = () => undefined;

const mainnet = KITTY_DEPLOYMENTS[arc.id];
const testnet = KITTY_DEPLOYMENTS[arcTestnet.id];

// ── 1. Switch targets ────────────────────────────────────────────────────────

describe('site urls', () => {
  it('accepts absolute http(s) urls only', () => {
    expect(parseSiteUrl(MAIN_URL)).toBe(`${MAIN_URL}/`);
    expect(parseSiteUrl(TEST_URL)).toBe(TEST_URL);
    for (const bad of [undefined, '', '   ', '/testnet/', 'testnet', 'javascript:alert(1)', 'ftp://x.y']) expect(parseSiteUrl(bad)).toBeUndefined();
  });
  it('reads both from the env', () => {
    expect(readSiteUrls({ VITE_MAINNET_URL: MAIN_URL, VITE_TESTNET_URL: TEST_URL })).toEqual({ mainnet: `${MAIN_URL}/`, testnet: TEST_URL });
    expect(readSiteUrls({})).toEqual({ mainnet: undefined, testnet: undefined });
  });
});

describe('Mainnet | Testnet switch', () => {
  const routes: Array<[string, Route, string]> = [
    ['home', { view: 'home' }, ''],
    ['new', { view: 'new', kind: 'split' }, ''],
    ['mine', { view: 'mine' }, '?view=mine'],
    ['requests', { view: 'requests' }, '?view=requests'],
    ['open', { view: 'open' }, '?view=open'],
    ['kitty', { view: 'kitty', id: ID }, ''],
  ];

  it.each(routes)('mainnet build, %s: testnet link keeps the view and never a kitty id', (_n, route, search) => {
    const m = switchModel({ activeTestnet: false, urls: BOTH, route })!;
    expect(m.map(o => o.label)).toEqual(['Mainnet', 'Testnet']);
    expect(m[0]).toMatchObject({ current: true, href: `${MAIN_URL}/` });
    expect(m[1].current).toBe(false);
    expect(m[1].href).toBe(`${TEST_URL}${search}`);
    expect(m[1].href).not.toContain('kitty=');
  });

  it.each(routes)('testnet build, %s: mainnet link keeps the view and never a kitty id', (_n, route, search) => {
    const m = switchModel({ activeTestnet: true, urls: BOTH, route })!;
    expect(m[1]).toMatchObject({ current: true, href: TEST_URL });
    expect(m[0].current).toBe(false);
    expect(m[0].href).toBe(`${MAIN_URL}/${search}`);
    expect(m[0].href).not.toContain('kitty=');
  });

  it('is hidden when the OTHER network url is not set', () => {
    expect(switchModel({ activeTestnet: false, urls: { mainnet: MAIN_URL }, route: { view: 'home' } })).toBeUndefined();
    expect(switchModel({ activeTestnet: true, urls: { testnet: TEST_URL }, route: { view: 'home' } })).toBeUndefined();
    expect(switchModel({ activeTestnet: false, urls: {}, route: { view: 'home' } })).toBeUndefined();
  });

  it('otherNetworkHref only ever carries mine, requests or open', () => {
    expect(otherNetworkHref(TEST_URL, { view: 'kitty', id: ID })).toBe(TEST_URL);
    expect(otherNetworkHref(TEST_URL, { view: 'mine' })).toBe(`${TEST_URL}?view=mine`);
  });

  it('renders two links; only the current one is aria-current; keyboard reachable', () => {
    const html = renderToString(createElement(NetworkSwitch, { options: switchModel({ activeTestnet: false, urls: BOTH, route: { view: 'mine' } })! }));
    expect(html.match(/<a /g)?.length).toBe(2);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Network"');
    expect(html.indexOf('Mainnet')).toBeLessThan(html.indexOf('Testnet'));
    expect(html).toContain(`href="${TEST_URL}?view=mine"`);
  });
});

describe('wrong-network hint', () => {
  it('links to the other network with the kitty id', () => {
    expect(otherNetworkKittyHref(TEST_URL, ID)).toBe(`${TEST_URL}?kitty=${ID}`);
    expect(otherNetworkKittyHref(MAIN_URL, ID)).toBe(`${MAIN_URL}/?kitty=${ID}`);
  });
  it('says which network and offers "Open it there"', () => {
    const html = clean(renderToString(createElement(OtherNetworkHint, { networkLabel: 'Arc Testnet', href: otherNetworkKittyHref(TEST_URL, ID) })));
    expect(html).toContain('This kitty is on');
    expect(html).toContain('Arc Testnet');
    expect(html).toContain('Open it there');
    expect(html).toContain(`href="${TEST_URL}?kitty=${ID}"`);
    expect(clean(renderToString(createElement(OtherNetworkHint, { networkLabel: 'Arc mainnet', href: '#' })))).toContain('Arc mainnet');
  });
  it('the other deployment is the other chain', () => {
    expect(otherDeployment(testnet)).toBe(mainnet);
    expect(otherDeployment(mainnet)).toBe(testnet);
  });
  it('ONE read decides it: exists, not found, a real error, or not deployed', async () => {
    const client = (impl: () => Promise<unknown>) => ({ readContract: vi.fn(impl) }) as unknown as Parameters<typeof kittyExistsOn>[0];
    const ok = client(() => Promise.resolve([]));
    await expect(kittyExistsOn(ok, testnet, ID)).resolves.toBe(true);
    expect((ok as unknown as { readContract: { mock: { calls: unknown[] } } }).readContract.mock.calls.length).toBe(1);
    await expect(kittyExistsOn(client(() => Promise.reject(new Error('reverted: PotNotFound(0xab)'))), testnet, ID)).resolves.toBe(false);
    await expect(kittyExistsOn(client(() => Promise.reject(new Error('HTTP request failed'))), testnet, ID)).rejects.toThrow('HTTP request failed');
    const undeployed = makeDeployment('arc', arc, { name: 'Arc', shortName: 'Arc', testnet: false }, {});
    const never = client(() => Promise.reject(new Error('must not be called')));
    await expect(kittyExistsOn(never, undeployed, ID)).resolves.toBe(false);
  });
});

describe('network names', () => {
  it('the switch-chain buttons name the network unambiguously', () => {
    expect(switchLabel(testnet)).toBe('Switch to Arc Testnet');
    expect(switchLabel(mainnet)).toBe('Switch to Arc mainnet');
    expect(switchLabel(testnet)).not.toBe(switchLabel(mainnet));
    expect(testnet.networkLabel).toBe('Arc Testnet');
    expect(mainnet.networkLabel).toBe('Arc mainnet');
  });
  it('the action card button uses it', () => {
    const html = clean(renderToString(createElement(KittyPage, pageProps(split, { isCorrectChain: false }))));
    expect(html).toContain('Switch to Arc Testnet');
  });
});

describe('storage stays scoped by chain id (both builds share one origin)', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  const ok: MinimalPublicClient = {
    getBytecode: () => Promise.resolve('0x6080'),
    readContract: ({ functionName }) => Promise.resolve(functionName === 'decimals' ? 6 : testnet.usdc),
    waitForTransactionReceipt: () => Promise.reject(new Error('unused')),
  };
  it('a validation cached for one chain does not satisfy the other', async () => {
    const store = mem();
    await ensureDeploymentValid(ok, testnet, { store });
    expect(hasCachedValidation(testnet, store)).toBe(true);
    expect(hasCachedValidation(mainnet, store)).toBe(false);
  });
  it('the mainnet confirmation never appears on testnet', () => {
    expect(needsMainnetConfirm(testnet, mem())).toBe(false);
    expect(needsMainnetConfirm(mainnet, mem())).toBe(true);
  });
});

// ── Base path: links keep /testnet ───────────────────────────────────────────

describe('base path', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
  const win = (origin: string) => { const w: Record<string, unknown> = { location: { origin } }; w.self = w; w.top = w; return w; };

  const baseFor = async (basePath: string) => {
    vi.stubEnv('BASE_URL', basePath);
    vi.stubGlobal('window', win(MAIN_URL));
    vi.resetModules();
    const { getShareBase } = await import('../lib/share');
    return getShareBase();
  };

  it('a /testnet/ build shares links under /testnet', async () => {
    const base = await baseFor('/testnet/');
    expect(base).toBe(`${MAIN_URL}/testnet`);
    const link = buildKittyUrl(base, ID);
    expect(link).toBe(`${MAIN_URL}/testnet/?kitty=${ID}`);
  });
  it('the mainnet build shares links at the root', async () => {
    const base = await baseFor('/');
    expect(base).toBe(MAIN_URL);
    expect(buildKittyUrl(base, ID)).toBe(`${MAIN_URL}/?kitty=${ID}`);
  });

  const link = `${MAIN_URL}/testnet/?kitty=${ID}`;
  it('QR target, share message, reminder and embed snippet all keep the base', () => {
    // The QR code encodes exactly this link (ShareStep / ShareCard pass it to the QR encoder).
    expect(link.startsWith(`${MAIN_URL}/testnet/`)).toBe(true);
    expect(shareMessageFor(split, link, ME)).toContain(link);
    expect(shareMessageFor(open, link)).toContain(link);
    expect(remindMessageFor(split, 60n * U, 20n * U, link)).toContain(link);
    const snippet = buildEmbedSnippet(link);
    expect(snippet).toContain(`href="${MAIN_URL}/testnet/?kitty=${ID}"`);
  });
  it('in-app hrefs are query-only, so they resolve under whatever path the page is on', () => {
    for (const r of [{ view: 'mine' }, { view: 'requests' }, { view: 'open' }, { view: 'kitty', id: ID }, { view: 'new', kind: 'open' }] as Route[]) {
      expect(routeToSearch(r).startsWith('?')).toBe(true);
    }
  });
});

// ── 2. Proof strip ───────────────────────────────────────────────────────────

describe('proof strip', () => {
  const strip = (dep: KittyDeployment, onGetUsdc?: () => void) => clean(renderToString(createElement(ProofStrip, { dep, onGetUsdc })));

  it('mainnet: every fact comes from the config', () => {
    const html = strip(mainnet);
    expect(html).toContain('Live on Arc mainnet');
    expect(html).toContain('0x9652…6192');
    expect(html).toContain('href="https://explorer.arc.io/address/0x965281605d34f7045cbef306fe690118e6626192"');
    expect(html).toContain('href="https://explorer.arc.io/tx/0xd95a3e960d9ea9ac953ae4a45be14c48eff6d8eed83f0123b0f3982a7dafb86f"');
    expect(html).toContain('Deploy tx');
    expect(html).toContain('No owner, no admin keys, no upgrades');
    expect(html).toContain(testFactsText());
    expect(html).toContain(`href="${STUDIO_APP_URL}"`);
    expect(html).toContain('Built with Arc Studio');
  });
  it('testnet: its own address, explorer and deploy tx', () => {
    const html = strip(testnet);
    expect(html).toContain('Live on Arc Testnet');
    expect(html).toContain(`https://explorer.testnet.arc.io/address/${testnet.kitty}`);
    expect(html).toContain('https://explorer.testnet.arc.io/tx/0xb88d8d84eb45570c317a048d4b863eb5636bf2e0aad25e73fc8f2ea9dbcbff2c');
  });
  it('no Deploy tx link without a tx; nothing at all when not deployed; Get USDC only with a handler', () => {
    expect(strip({ ...mainnet, deployTx: undefined })).not.toContain('Deploy tx');
    expect(strip(makeDeployment('arc', arc, { name: 'Arc', shortName: 'Arc', testnet: false }, {}))).toBe('');
    expect(strip(mainnet)).not.toContain('Get USDC');
    expect(strip(mainnet, noop)).toContain('Get USDC');
  });
  it('has no dashes', () => { expect(strip(mainnet, noop)).not.toMatch(/[\u2014\u2013]/); });
});

describe('project facts', () => {
  it('flags which count drifted', () => {
    expect(factsDrift({ contractTests: CONTRACT_TESTS, appTests: APP_TESTS })).toEqual([]);
    expect(factsDrift({ contractTests: CONTRACT_TESTS + 1, appTests: APP_TESTS })).toEqual(['contractTests']);
    expect(factsDrift({ contractTests: CONTRACT_TESTS, appTests: APP_TESTS + 1 })).toEqual(['appTests']);
  });
  it('the README quotes the same numbers', () => {
    const readme = readFileSync('README.md', 'utf8');
    const forge = /forge test\s+# (\d+) tests pass/.exec(readme);
    const app = /bun run test\s+# (\d+) tests pass/.exec(readme);
    expect(forge).not.toBeNull();
    expect(app).not.toBeNull();
    expect(factsDrift({ contractTests: Number(forge?.[1]), appTests: Number(app?.[1]) })).toEqual([]);
  });
  it('the deploy txs are in the config', () => {
    expect(mainnet.deployTx).toBe('0xd95a3e960d9ea9ac953ae4a45be14c48eff6d8eed83f0123b0f3982a7dafb86f');
    expect(testnet.deployTx).toBe('0xb88d8d84eb45570c317a048d4b863eb5636bf2e0aad25e73fc8f2ea9dbcbff2c');
  });
});

// ── Home banners ─────────────────────────────────────────────────────────────

describe('home banners', () => {
  const home = (dep: KittyDeployment, site: SiteUrls) => clean(renderToString(createElement(Home, { onNavigate: noop, dep, site, onGetUsdc: noop })));

  it('testnet: calm banner with the faucet and a way back to mainnet', () => {
    const html = home(testnet, BOTH);
    expect(html).toContain("You're on Arc Testnet. Test USDC is free and has no value.");
    expect(html).toContain(`href="${FAUCET_URL}"`);
    expect(html).toContain('Get test USDC');
    expect(html).toContain('Back to mainnet');
    expect(html).toContain(`href="${MAIN_URL}/"`);
    expect(html).not.toContain('Try it free on testnet');
  });
  it('testnet without a mainnet url: no way-back link', () => {
    expect(home(testnet, {})).not.toContain('Back to mainnet');
  });
  it('mainnet: a small "Try it free on testnet" link, only when the url is set', () => {
    expect(home(mainnet, BOTH)).toContain(`href="${TEST_URL}"`);
    expect(home(mainnet, BOTH)).toContain('Try it free on testnet');
    expect(home(mainnet, { mainnet: MAIN_URL })).not.toContain('Try it free on testnet');
    expect(home(mainnet, BOTH)).not.toContain('Test USDC is free');
  });
  it('shows the proof strip', () => { expect(home(mainnet, BOTH)).toContain('No owner, no admin keys, no upgrades'); });
});

// ── 3. Get USDC ──────────────────────────────────────────────────────────────

describe('Get USDC sheet', () => {
  const sheet = (dep: KittyDeployment, address: string = ME) =>
    clean(renderToString(createElement(GetUsdcSheet, { dep, address, onClose: noop, onAddNetwork: noop })));
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);

  it('mainnet: native USDC that also pays the fee, CCTP bridges, exchanges; no faucet', () => {
    const html = sheet(mainnet);
    expect(html).toContain('native USDC');
    expect(html).toContain('pays the network fee');
    expect(html).toContain('about 0.1 USDC');
    expect(html).toContain('Circle CCTP');
    expect(html).toContain('Withdraw USDC from an exchange and choose the Arc network. Check first that your exchange supports Arc.');
    expect(html).toContain(`href="${ARC_BRIDGES_DOC_URL}"`);
    // Circle's Arc Portal, named as Circle's and not Kitty's
    expect(html).toContain("Circle's Arc Portal");
    expect(html).toContain('The Arc Portal is run by Circle, not by Kitty.');
    expect(html).toContain(`href="${ARC_PORTAL_DEPOSIT_URL}" target="_blank" rel="noopener noreferrer">Bring USDC from another chain<`);
    expect(html).toContain(`href="${ARC_PORTAL_FIAT_URL}" target="_blank" rel="noopener noreferrer">Buy USDC with a card (where available)<`);
    expect(html).not.toContain('faucet');
  });
  it('testnet: the faucet link instead', () => {
    const html = sheet(testnet);
    expect(html).toContain(`href="${FAUCET_URL}"`);
    expect(html).toContain('free test USDC');
    expect(html).not.toContain(ARC_BRIDGES_DOC_URL);
    expect(html).not.toContain('portal.arc.io');
  });
  it('both: the address, copy, add network; and no other third-party url', () => {
    for (const dep of [mainnet, testnet]) {
      const html = sheet(dep);
      expect(html).toContain(ME);
      expect(html).toContain('Copy address');
      expect(html).toContain('Add Arc to my wallet');
      for (const h of hrefs(html)) expect([FAUCET_URL, ARC_BRIDGES_DOC_URL, ARC_PORTAL_DEPOSIT_URL, ARC_PORTAL_FIAT_URL]).toContain(h);
      expect(html).not.toMatch(/[\u2014\u2013]/);
    }
  });
  it('without a wallet it asks to connect and shows no address', () => {
    const html = sheet(mainnet, '');
    expect(html).toContain('Connect your wallet to see your address.');
    expect(html).not.toContain('Copy address');
  });
  it('the chip-in card offers it when the balance is too low, and not otherwise', () => {
    expect(clean(renderToString(createElement(KittyPage, pageProps(split, { balanceRaw: 5n }))))).toContain('Get USDC');
    expect(clean(renderToString(createElement(KittyPage, pageProps(split, { balanceRaw: 100n * U }))))).not.toContain('Get USDC');
    expect(clean(renderToString(createElement(KittyPage, pageProps(split, { balanceRaw: 5n }))))).not.toContain('Need test USDC');
  });
});

// ── 4. Wallets ───────────────────────────────────────────────────────────────

describe('connector list', () => {
  const fake = () => {
    const wc = vi.fn((p: object) => ({ wc: p }));
    const f: ConnectorFactories<unknown> = {
      injected: () => 'injected',
      walletConnect: wc,
    };
    return { wc, f };
  };
  it('normalizes the project id', () => {
    expect(normalizeProjectId(undefined)).toBeUndefined();
    expect(normalizeProjectId('')).toBeUndefined();
    expect(normalizeProjectId('   ')).toBeUndefined();
    expect(normalizeProjectId(' abc123 ')).toBe('abc123');
  });
  it('without a project id: injected only, exactly as before, WalletConnect never touched', () => {
    for (const projectId of [undefined, '', '  ']) {
      const { wc, f } = fake();
      expect(buildConnectors({ projectId, origin: MAIN_URL }, f)).toEqual(['injected']);
      expect(wc).not.toHaveBeenCalled();
    }
  });
  it('with a project id: injected first, then WalletConnect with Kitty metadata', () => {
    const { wc, f } = fake();
    const list = buildConnectors({ projectId: ' pid ', origin: `${MAIN_URL}/` }, f);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe('injected');
    expect(wc).toHaveBeenCalledWith({
      projectId: 'pid', showQrModal: false,
      metadata: { name: 'Kitty', description: expect.stringContaining('Nobody fronts the money') as string, url: MAIN_URL, icons: [`${MAIN_URL}/og-image.png`] },
    });
  });
  it('metadata copes with no origin', () => {
    expect(walletConnectMetadata(undefined)).toMatchObject({ name: 'Kitty', url: '', icons: [] });
  });
  it('the real list has one connector without an id and two with one', () => {
    expect(realConnectors({ origin: MAIN_URL })).toHaveLength(1);
    expect(realConnectors({ projectId: '', origin: MAIN_URL })).toHaveLength(1);
    expect(realConnectors({ projectId: 'pid', origin: MAIN_URL })).toHaveLength(2);
  });
});

describe('open in a wallet app', () => {
  const page = `${MAIN_URL}/testnet/?kitty=${ID}&view=mine`;
  it('MetaMask: host + path + query, no scheme', () => {
    expect(metamaskDeepLink(page)).toBe(`https://metamask.app.link/dapp/kitty-five-mu.vercel.app/testnet/?kitty=${ID}&view=mine`);
    expect(metamaskDeepLink(`${MAIN_URL}/`)).toBe('https://metamask.app.link/dapp/kitty-five-mu.vercel.app/');
    expect(metamaskDeepLink(page)).not.toContain('https://kitty');
  });
  it('Coinbase Wallet: the whole url, encoded', () => {
    expect(coinbaseDeepLink(page)).toBe(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(page)}`);
    expect(coinbaseDeepLink(page)).toContain('%2Ftestnet%2F%3Fkitty%3D');
    expect(coinbaseDeepLink(page)).toContain('%26view%3Dmine');
  });
  it('encodes awkward characters in the query', () => {
    const odd = `${MAIN_URL}/testnet/?note=a b&x=1#frag`;
    expect(coinbaseDeepLink(odd)).toBe(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(new URL(odd).href)}`);
    expect(metamaskDeepLink(odd)).toContain('note=a%20b');
  });
  it('only on a phone without an injected wallet', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
    const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
    expect(isMobileUserAgent(iphone)).toBe(true);
    expect(isMobileUserAgent(android)).toBe(true);
    expect(isMobileUserAgent(desktop)).toBe(false);
    expect(isMobileUserAgent(undefined)).toBe(false);
    expect(shouldShowWalletLinks({ userAgent: iphone, hasInjectedWallet: false })).toBe(true);
    expect(shouldShowWalletLinks({ userAgent: iphone, hasInjectedWallet: true })).toBe(false);
    expect(shouldShowWalletLinks({ userAgent: desktop, hasInjectedWallet: false })).toBe(false);
  });
  it('renders nothing on the server or a desktop', () => {
    expect(renderToString(createElement(OpenInWalletApp))).toBe('');
  });
});

// ── Fix turn: refund promise, featured kitty, polish ────────────────────────

describe('refund promise in copy', () => {
  const dl = formatDeadline(split.deadline);
  const LINK = 'https://kitty-five-mu.vercel.app/?kitty=0x1';

  it('the two sentences', () => {
    expect(openRefundPromise('Nov 5')).toBe("If the goal isn't reached by Nov 5, you pull your money back.");
    expect(splitRefundPromise('Nov 5')).toBe('If not everyone pays by Nov 5, everyone pulls their money back.');
    expect(refundPromise('open', 'Nov 5')).toBe(openRefundPromise('Nov 5'));
    expect(refundPromise('split', 'Nov 5')).toBe(splitRefundPromise('Nov 5'));
  });
  it('open pool share message ends with the open promise, after the link', () => {
    const m = shareMessageFor(open, LINK);
    expect(m.endsWith(`\n${openRefundPromise(dl)}`)).toBe(true);
    expect(m).toContain(`: ${LINK}\n`);
    expect(m).not.toContain('everyone pulls');
  });
  it('split share message ends with the split promise, for a named person and for the group', () => {
    for (const m of [shareMessageFor(split, LINK, ME), shareMessageFor(split, LINK)]) {
      expect(m.endsWith(`\n${splitRefundPromise(dl)}`)).toBe(true);
      expect(m).toContain(LINK);
      expect(m).not.toContain("isn't reached");
    }
  });
  it('a payment request message and a per-person reminder are unchanged', () => {
    expect(shareMessageFor({ ...open, creator: SELLER, recipient: SELLER }, LINK, ME)).toBe(`Gift for Sam: 100.00 USDC requested, split it with friends: ${LINK}`);
    expect(remindMessageFor(split, 60n * U, 20n * U, LINK)).not.toContain('pull');
  });
  it('the chip-in card says it, per mode', () => {
    const o = clean(renderToString(createElement(KittyPage, pageProps(open))));
    expect(o).toContain(`data-testid="refund-promise">${openRefundPromise(dl)}<`);
    const sp = clean(renderToString(createElement(KittyPage, pageProps(split))));
    expect(sp).toContain(`data-testid="refund-promise">${splitRefundPromise(dl)}<`);
    expect(o).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('featured kitty', () => {
  const A = `0x${'ab'.repeat(32)}`;
  const B = `0x${'cd'.repeat(32)}`;

  it('parses ids, ignores invalid entries, dedupes, lowercases', () => {
    expect(parseFeaturedKitties(`${A}, ${B}`)).toEqual([A, B]);
    expect(parseFeaturedKitties(`nope, 0x123, ${A.toUpperCase().replace('0X', '0x')} ${A}`)).toEqual([A]);
    expect(parseFeaturedKitties(`0x${'g'.repeat(64)},${B}`)).toEqual([B]);
    expect(parseFeaturedKitties(`${A}extra`)).toEqual([]);
  });
  it('empty, blank and unset all mean nothing', () => {
    for (const raw of [undefined, '', '   ', ',,,']) expect(parseFeaturedKitties(raw)).toEqual([]);
    expect(firstFeatured([])).toBeUndefined();
    expect(firstFeatured([A as `0x${string}`, B as `0x${string}`])).toBe(A);
  });
  it('home hero and proof strip show the link when set, and nothing when unset', () => {
    const withId = clean(renderToString(createElement(Home, { onNavigate: noop, dep: mainnet, featuredId: A as `0x${string}` })));
    expect(withId.split(FEATURED_LABEL)).toHaveLength(3); // hero + proof strip
    expect(withId).toContain(`href="?kitty=${A}"`);
    const without = clean(renderToString(createElement(Home, { onNavigate: noop, dep: mainnet })));
    expect(without).not.toContain(FEATURED_LABEL);
    expect(without).not.toContain('?kitty=');
    expect(clean(renderToString(createElement(ProofStrip, { dep: mainnet })))).not.toContain(FEATURED_LABEL);
    expect(clean(renderToString(createElement(ProofStrip, { dep: mainnet, featuredId: B as `0x${string}` })))).toContain(`href="?kitty=${B}"`);
  });
  it('the hero demo card says Example', () => {
    expect(renderToString(createElement(PayoutDemo))).toContain('data-testid="example-label">Example<');
  });
});

describe('page titles per build', () => {
  const html = '<head><title>Kitty: Nobody fronts the money</title><meta property="og:title" content="Kitty: Nobody fronts the money" /><meta name="twitter:title" content="Kitty: Nobody fronts the money" /><meta property="og:description" content="Keep" /></head>';
  it('the testnet build gets its own title, og:title and twitter:title', () => {
    expect(TESTNET_TITLE).toBe('Kitty on Arc Testnet: try group payments free');
    const out = retitleHtml(html, true);
    expect(out).toContain(`<title>${TESTNET_TITLE}</title>`);
    expect(out).toContain(`property="og:title" content="${TESTNET_TITLE}"`);
    expect(out).toContain(`name="twitter:title" content="${TESTNET_TITLE}"`);
    expect(out).toContain('content="Keep"');
    expect(out).not.toContain(MAINNET_TITLE);
  });
  it('mainnet is untouched', () => { expect(retitleHtml(html, false)).toBe(html); });
  it('chooses the build the same way the app does: only "arc" is mainnet', () => {
    expect(isTestnetBuild('arc')).toBe(false);
    expect(isTestnetBuild(' ARC ')).toBe(false);
    for (const v of ['arcTestnet', '', undefined, 'mainnet']) expect(isTestnetBuild(v)).toBe(true);
  });
  it('index.html ships the mainnet title and links the icons', () => {
    const src = readFileSync('index.html', 'utf8');
    expect(src).toContain(`<title>${MAINNET_TITLE}</title>`);
    expect(src).toContain('href="/favicon.svg"');
    expect(src).toContain('href="/apple-touch-icon.png"');
  });
  it('robots.txt allows everything', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toBe('User-agent: *\nAllow: /\n');
  });
});

describe('docs are not stale', () => {
  const readme = readFileSync('README.md', 'utf8');
  const agents = readFileSync('AGENTS.md', 'utf8');
  it('README makes no stale claims', () => {
    expect(readme).not.toContain('supported environment for now');
    expect(readme).not.toContain('0xffa6');
    expect(readme).not.toMatch(/deployed to Arc Testnet from Studio\.(?! )/);
    expect(readme).toContain("deployed from the builder's own wallet, outside Studio");
    expect(readme).toContain('/rpc/arc-logs');
    expect(readme).toContain('VITE_FEATURED_KITTIES');
    expect(readme).not.toMatch(/[\u2014\u2013]/);
  });
  it('AGENTS.md describes Kitty, not the old PayTogether order app', () => {
    expect(agents.startsWith('# Kitty')).toBe(true);
    expect(agents).not.toContain('0xffa6');
    expect(agents).not.toContain('CONTRACT_ADDRESS');
    expect(agents).toContain('0x965281605d34f7045cbef306fe690118e6626192');
    expect(agents).toContain('0x621b7aadfbc5870b95d4d95245529059536da7e5');
    expect(agents).toContain('src/log-scan.ts');
  });
});

// ── fixtures ─────────────────────────────────────────────────────────────────

const split: KittyData = {
  id: ID, creator: BOB, recipient: SELLER, goalRaw: 100n * U, deadline: NOW + 86_400n, ref: 'Lisbon weekend', mode: 'split',
  settled: false, cancelled: false, totalFundedRaw: 40n * U, minContributionRaw: 0n, effectiveMinRaw: 0n, chainTimestamp: NOW,
  contributors: [
    { address: ME, shareRaw: 60n * U, contributedRaw: 20n * U, refunded: false },
    { address: BOB, shareRaw: 40n * U, contributedRaw: 20n * U, refunded: false },
  ],
};
const open: KittyData = {
  ...split, mode: 'open', ref: 'Gift for Sam', effectiveMinRaw: 390_625n,
  contributors: [{ address: BOB, shareRaw: 0n, contributedRaw: 40n * U, refunded: false }],
};

function pageProps(data: KittyData, over: Partial<KittyPageProps> = {}): KittyPageProps {
  return {
    data, dep: testnet, connectedAddress: ME, isCorrectChain: true, onSwitchChain: noop, txStatus: { kind: 'idle' },
    allowanceRaw: 0n, balanceRaw: 100n * U, onRefresh: noop, onChipIn: noop, onCancel: noop, onGetUsdc: noop, onPayOut: noop, onGetRefund: noop,
    justCreated: false, activity: { items: [], loading: false, error: undefined, retry: noop }, ...over,
  };
}
