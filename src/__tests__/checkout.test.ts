// ─── "Pay together" checkout: links, prefill, For sellers, demo store, dashboard ──
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { arc, arcTestnet } from 'viem/chains';
import {
  MAX_DAYS, MAX_REF_BYTES, MAX_SHOP_CHARS, buildCheckoutLink, buildCheckoutSearch, ignoredNote, parseCheckout, sellerFormToParams,
  utf8Bytes, type CheckoutParams, type SellerForm,
} from '../checkout';
import {
  applyCheckout, buildCheckoutRoute, buildPayTogetherSnippet, draftFromStart, parseRoute, routeTab, routeToSearch,
} from '../kitty-core';
import { toLocalInputValue } from '../pt-ui';
import { KITTY_DEPLOYMENTS } from '../kitty-config';
import { switchModel, readSiteUrls } from '../network-switch';
import {
  groupRequests, requestCsv, requestTotals, requestType, REQUEST_CSV_HEADER, type RequestSummary,
} from '../kitty-requests';
import { DEMO_ITEMS, DEMO_SHOP_NAME, DemoStore, demoCheckoutParams } from '../components/DemoStore';
import { SellerSetup } from '../components/SellerSetup';
import { SellerRequests } from '../components/SellerRequests';
import { CreateKitty } from '../components/CreateKitty';
import { Home } from '../components/Home';

const U = 1_000_000n;
const SHOP = '0x3333333333333333333333333333333333333333';
const KITTY = '0x621b7aadfbc5870b95d4d95245529059536da7e5';
const USDC = '0x3600000000000000000000000000000000000000';
const ZERO = '0x0000000000000000000000000000000000000000';
const CTX = { kitty: KITTY, usdc: USDC };
const clean = (html: string) => html.replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const noop = () => undefined;
const testnet = KITTY_DEPLOYMENTS[arcTestnet.id];
const mainnet = KITTY_DEPLOYMENTS[arc.id];

const full: CheckoutParams = { mode: 'open', to: SHOP, amount: '240.50', ref: 'Espresso machine', days: 7, lock: true, shop: 'Acme Coffee' };

// ── 1. Link format: build -> parse ───────────────────────────────────────────

describe('checkout link round trip', () => {
  it('every field survives build -> parse', () => {
    const parsed = parseCheckout(buildCheckoutSearch(full), CTX)!;
    expect(parsed.ignored).toEqual([]);
    expect(parsed.params).toEqual(full);
  });
  it.each(['open', 'split', 'request'] as const)('mode %s', mode => {
    expect(parseCheckout(buildCheckoutSearch({ ...full, mode }), CTX)?.params.mode).toBe(mode);
  });
  it('each field alone', () => {
    const only = (p: Partial<CheckoutParams>) => parseCheckout(buildCheckoutSearch({ mode: 'split', ...p }), CTX)!.params;
    expect(only({ to: SHOP })).toEqual({ mode: 'split', to: SHOP });
    expect(only({ amount: '12' })).toEqual({ mode: 'split', amount: '12' });
    expect(only({ ref: 'Lunch' })).toEqual({ mode: 'split', ref: 'Lunch' });
    expect(only({ days: 3 })).toEqual({ mode: 'split', days: 3 });
    expect(only({ shop: 'Acme' })).toEqual({ mode: 'split', shop: 'Acme' });
  });
  it('unicode, emoji, &, #, = and newlines in ref and shop come back exactly', () => {
    const ref = 'Trip 🏖️ & fun #1 = yes\nday 2 · café';
    const shop = 'Café "Ünï" & Co\n#1 🎉';
    expect(utf8Bytes(ref)).toBeLessThanOrEqual(MAX_REF_BYTES);
    const search = buildCheckoutSearch({ mode: 'open', to: SHOP, ref, shop });
    expect(search).not.toContain('#');
    expect(search.slice(1).split('&').every(kv => /^[a-z]+=/.test(kv))).toBe(true); // the & inside values is encoded
    const p = parseCheckout(search, CTX)!;
    expect(p.ignored).toEqual([]);
    expect(p.params.ref).toBe(ref);
    expect(p.params.shop).toBe(shop);
  });
  it('is not a checkout link without new=open|split|request or without any checkout field', () => {
    expect(parseCheckout('?new=open', CTX)).toBeUndefined();
    expect(parseCheckout('?new=trip&amount=5', CTX)).toBeUndefined();
    expect(parseCheckout('?amount=5&to=' + SHOP, CTX)).toBeUndefined();
    expect(parseCheckout('', CTX)).toBeUndefined();
  });
});

describe('strict validation: bad values are ignored, named, and never throw', () => {
  const parse = (extra: string) => parseCheckout(`?new=open&${extra}`, CTX)!;
  const ignoredNames = (extra: string) => parse(extra).ignored.map(i => i.param);

  it('to: zero, the Kitty contract, the USDC token, junk, bad checksum', () => {
    for (const bad of [ZERO, KITTY, USDC.toUpperCase().replace('0X', '0x'), 'nope', '0x123', '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01']) {
      const r = parse(`to=${encodeURIComponent(bad)}&amount=5`);
      expect(r.params.to).toBeUndefined();
      expect(r.ignored.map(i => i.param)).toContain('to');
      expect(r.params.amount).toBe('5'); // the rest is kept
    }
  });
  it('to: lowercase and a correct checksum are fine', () => {
    expect(parse(`to=${SHOP}`).params.to).toBe(SHOP);
    expect(parse('to=0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed').params.to).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  });
  it('amount: zero, negative, 7 decimals, exponent, words', () => {
    for (const bad of ['0', '0.000000', '-1', '1.1234567', '1e3', 'abc', '', ' ']) expect(ignoredNames(`amount=${encodeURIComponent(bad)}`)).toContain('amount');
    for (const ok of ['0.000001', '12', '12.5', '240.123456']) expect(parse(`amount=${ok}`).params.amount).toBe(ok);
  });
  it('ref: empty, over 64 bytes (counted in UTF-8, not characters)', () => {
    expect(ignoredNames('ref=')).toContain('ref');
    expect(ignoredNames('ref=' + 'a'.repeat(65))).toContain('ref');
    expect(parse('ref=' + 'a'.repeat(64)).params.ref).toBe('a'.repeat(64));
    const emoji22 = '🎉'.repeat(22); // 22 characters, 88 bytes
    expect(emoji22.length).toBeLessThan(64);
    expect(ignoredNames('ref=' + encodeURIComponent(emoji22))).toContain('ref');
    expect(parse('ref=' + encodeURIComponent('🎉'.repeat(16))).params.ref).toBe('🎉'.repeat(16)); // exactly 64 bytes
  });
  it('shop: over 40 characters (code points)', () => {
    expect(ignoredNames('shop=' + 'x'.repeat(MAX_SHOP_CHARS + 1))).toContain('shop');
    expect(parse('shop=' + 'x'.repeat(MAX_SHOP_CHARS)).params.shop).toBe('x'.repeat(MAX_SHOP_CHARS));
    expect(parse('shop=' + encodeURIComponent('🎉'.repeat(MAX_SHOP_CHARS))).params.shop).toBe('🎉'.repeat(MAX_SHOP_CHARS));
    expect(ignoredNames('shop=')).toContain('shop');
  });
  it('days: integer 1 to 90 only', () => {
    for (const bad of ['0', '91', '1.5', 'x', '-3', '', '1e1', '1000']) expect(ignoredNames(`days=${encodeURIComponent(bad)}`)).toContain('days');
    for (const ok of [1, 7, MAX_DAYS]) expect(parse(`days=${ok}`).params.days).toBe(ok);
  });
  it('names what it ignored, in one calm sentence', () => {
    const r = parse(`to=nope&amount=-1&days=99&ref=ok`);
    const note = ignoredNote(r.ignored)!;
    expect(note.startsWith('Ignored from the link:')).toBe(true);
    for (const p of ['to', 'amount', 'days']) expect(note).toContain(p);
    expect(note).not.toContain('ref');
    expect(ignoredNote([])).toBeUndefined();
    expect(note).not.toMatch(/[\u2014\u2013]/);
  });
  it('never throws on garbage', () => {
    for (const s of ['?new=open&to=%ZZ&amount=%E0%A4%A', '?new=split&ref=%00%01', `?new=open&shop=${'%F0%9F%8E'}`, '?new=open&lock=%', '?new=open&days=NaN&amount=Infinity']) {
      expect(() => parseCheckout(s, CTX)).not.toThrow();
    }
  });
});

describe('lock', () => {
  it('lock=1 with a valid to or amount locks', () => {
    expect(parseCheckout(`?new=open&to=${SHOP}&lock=1`, CTX)!.params.lock).toBe(true);
    expect(parseCheckout('?new=open&amount=5&lock=1', CTX)!.params.lock).toBe(true);
  });
  it('lock=1 with nothing valid to lock is dropped and named', () => {
    const r = parseCheckout('?new=open&to=nope&amount=0&lock=1', CTX)!;
    expect(r.params.lock).toBeUndefined();
    expect(r.ignored.map(i => i.param)).toEqual(expect.arrayContaining(['to', 'amount', 'lock']));
  });
  it('lock=0 means not locked and is not an error; anything else is named', () => {
    const zero = parseCheckout(`?new=open&to=${SHOP}&lock=0`, CTX)!;
    expect(zero.params.lock).toBeUndefined();
    expect(zero.ignored).toEqual([]);
    expect(parseCheckout(`?new=open&to=${SHOP}&lock=yes`, CTX)!.ignored.map(i => i.param)).toEqual(['lock']);
  });
});

describe('route integration', () => {
  it('parseRoute carries the checkout, routeToSearch rebuilds the same query', () => {
    const search = buildCheckoutSearch(full);
    const r = parseRoute(search, CTX);
    expect(r).toMatchObject({ view: 'new', kind: 'open' });
    expect(r.view === 'new' && r.checkout?.params).toEqual(full);
    expect(routeToSearch(r)).toBe(search);
    expect(routeTab(r)).toBe('new');
  });
  it('the contract and token are rejected when the app passes them, and plain starts are unchanged', () => {
    const r = parseRoute(`?new=open&to=${KITTY}&amount=5`, CTX);
    expect(r.view === 'new' && r.checkout?.ignored.map(i => i.param)).toEqual(['to']);
    expect(parseRoute('?new=split')).toEqual({ view: 'new', kind: 'split' });
    expect(parseRoute('?new=open&foo=1')).toEqual({ view: 'new', kind: 'open' });
    expect(parseRoute('?new=trip')).toMatchObject({ view: 'new', template: 'trip' });
  });
  it('the sell and shop views route and highlight the Requests tab', () => {
    expect(parseRoute('?view=sell')).toEqual({ view: 'sell' });
    expect(parseRoute('?view=shop')).toEqual({ view: 'shop' });
    expect(routeToSearch({ view: 'sell' })).toBe('?view=sell');
    expect(routeToSearch({ view: 'shop' })).toBe('?view=shop');
    expect(routeTab({ view: 'sell' })).toBe('requests');
    expect(routeTab({ view: 'shop' })).toBe('requests');
  });
});

describe('prefill', () => {
  const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
  const base = (kind: 'open' | 'split' | 'request') => draftFromStart({ kind }, NOW);

  it('open: recipient, goal, name and deadline; locked when lock=1; mode fixed', () => {
    const c = parseCheckout(buildCheckoutSearch(full), CTX)!;
    const p = applyCheckout(base('open'), c, NOW);
    expect(p.draft).toMatchObject({ kind: 'open', mode: 'open', recipient: SHOP, goal: '240.50', ref: 'Espresso machine' });
    expect(p.draft.deadlineIso).toBe(toLocalInputValue(NOW + 7 * 86_400_000));
    expect(p).toMatchObject({ lockRecipient: true, lockGoal: true, modeFixed: true, shop: 'Acme Coffee', toAddress: SHOP });
  });
  it('split is fixed too', () => {
    const p = applyCheckout(base('split'), parseCheckout(buildCheckoutSearch({ ...full, mode: 'split' }), CTX)!, NOW);
    expect(p.draft.mode).toBe('split');
    expect(p.modeFixed).toBe(true);
  });
  it('request with a shop address: the buyer picks the mode, the recipient is the shop (not the buyer)', () => {
    const p = applyCheckout(base('request'), parseCheckout(buildCheckoutSearch({ ...full, mode: 'request', lock: undefined }), CTX)!, NOW);
    expect(p.modeFixed).toBe(false);
    expect(p.draft.kind).toBe('open');
    expect(p.draft.recipient).toBe(SHOP);
    expect(p.lockRecipient).toBe(false);
    expect(p.lockGoal).toBe(false);
  });
  it('request without a usable address stays a "pay myself" start', () => {
    const p = applyCheckout(base('request'), parseCheckout('?new=request&amount=5', CTX)!, NOW);
    expect(p.draft.kind).toBe('request');
    expect(p.draft.goal).toBe('5');
  });
  it('lock only covers what the link gave: amount without a recipient locks just the goal', () => {
    const p = applyCheckout(base('open'), parseCheckout('?new=open&amount=9&lock=1', CTX)!, NOW);
    expect(p).toMatchObject({ lockGoal: true, lockRecipient: false });
  });
  it('without days it keeps the default deadline', () => {
    const b = base('open');
    expect(applyCheckout(b, parseCheckout(`?new=open&to=${SHOP}`, CTX)!, NOW).draft.deadlineIso).toBe(b.deadlineIso);
  });
});

// ── The checkout form ────────────────────────────────────────────────────────

describe('create form from a checkout link', () => {
  const form = (params: CheckoutParams, ignored: Parameters<typeof ignoredNote>[0] = []) => clean(renderToString(createElement(CreateKitty, {
    start: { kind: params.mode }, checkout: { params, ignored }, dep: testnet, connectedAddress: '0x1111111111111111111111111111111111111111',
    isCorrectChain: true, deployBlocked: false, txBusy: false, onSubmit: noop,
  })));

  it('locked: header from the shop, recipient and total read-only, mode fixed', () => {
    const html = form(full);
    expect(html).toContain('Checkout from');
    expect(html).toContain('Acme Coffee');
    expect(html).toContain('data-testid="locked-recipient"');
    expect(html).toContain(SHOP);
    expect(html).toContain('data-testid="locked-goal"');
    expect(html).toContain('240.50');
    expect(html).toContain('Set by the shop');
    expect(html).toContain('Open pool');
    expect(html).toContain('data-testid="mode-fixed"');
    expect(html).not.toContain('aria-label="Goal in USDC"');
    expect(html).not.toContain('aria-label="Recipient address"');
  });
  it('without a shop name the header uses the short address', () => {
    expect(form({ ...full, shop: undefined })).toContain('Checkout from <span class="text-ink">0x3333…3333');
  });
  it('not locked: still prefilled, still editable', () => {
    const html = form({ ...full, lock: undefined });
    expect(html).toContain('Checkout from');
    expect(html).not.toContain('data-testid="locked-recipient"');
    expect(html).not.toContain('data-testid="locked-goal"');
    expect(html).toContain('aria-label="Goal in USDC"');
    expect(html).toContain('value="240.50"');
    expect(html).toContain(SHOP);
  });
  it('request mode leaves the mode switch to the buyer', () => {
    const html = form({ ...full, mode: 'request' });
    expect(html).not.toContain('data-testid="mode-fixed"');
    expect(html).toContain('Named people');
  });
  it('says what it ignored, calmly', () => {
    const html = form({ mode: 'open', to: SHOP }, [{ param: 'amount', why: 'must be a USDC amount above zero with at most 6 decimals' }]);
    expect(html).toContain('Ignored from the link: amount (must be a USDC amount above zero with at most 6 decimals).');
  });
  it('has no dashes', () => { expect(form(full)).not.toMatch(/[\u2014\u2013]/); });
});

// ── 2. For sellers ───────────────────────────────────────────────────────────

describe('For sellers: link and button', () => {
  const f: SellerForm = { recipient: SHOP, shop: 'Acme Coffee', ref: 'Espresso machine', amount: '240', days: '7', mode: 'open', lock: true };

  it('turns a valid form into checkout params', () => {
    const r = sellerFormToParams(f, CTX);
    expect(r.errors).toEqual({});
    expect(r.params).toEqual({ mode: 'open', to: SHOP, amount: '240', ref: 'Espresso machine', days: 7, lock: true, shop: 'Acme Coffee' });
  });
  it('lock off and no shop name leave those out', () => {
    expect(sellerFormToParams({ ...f, lock: false, shop: ' ' }, CTX).params).toEqual({ mode: 'open', to: SHOP, amount: '240', ref: 'Espresso machine', days: 7 });
  });
  it('reports every bad field with the same rules the buyer page uses', () => {
    const r = sellerFormToParams({ recipient: KITTY, shop: 'x'.repeat(41), ref: '', amount: '0', days: '91', mode: 'split', lock: true }, CTX);
    expect(r.params).toBeUndefined();
    expect(Object.keys(r.errors).sort()).toEqual(['amount', 'days', 'recipient', 'ref', 'shop']);
  });
  it('a form that makes a link makes one the buyer page accepts, unchanged', () => {
    const params = sellerFormToParams(f, CTX).params!;
    const link = buildCheckoutLink('https://kitty-five-mu.vercel.app', params);
    const back = parseCheckout(new URL(link).search, CTX)!;
    expect(back.ignored).toEqual([]);
    expect(back.params).toEqual(params);
  });
  it('renders the form with the lock on by default and the explanation', () => {
    const html = clean(renderToString(createElement(SellerSetup, { me: SHOP, dep: testnet, onNavigate: noop })));
    for (const t of ['For sellers', 'Shop name (optional)', 'Item or order', 'Deadline in days', 'Pool', 'Split', 'Lock the recipient and amount.', 'Your buyer sees the order already filled in', 'You are paid once, in full', 'Try the demo store']) {
      expect(html).toContain(t);
    }
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain(SHOP); // recipient defaults to the connected wallet
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('the button snippet', () => {
  const link = buildCheckoutLink('https://kitty-five-mu.vercel.app', { mode: 'open', to: SHOP, amount: '5', ref: '"><script>alert(1)</script>', shop: `' onmouseover='alert(1)` });
  const snippet = buildPayTogetherSnippet(link);

  it('is a single inline-styled anchor with no script', () => {
    expect(snippet).toMatch(/^<a href="[^"]*" target="_blank" rel="noopener noreferrer" style="[^"]*">Pay together<\/a>$/);
    expect(snippet.toLowerCase()).not.toContain('<script');
    expect(snippet.match(/<a /g)).toHaveLength(1);
    expect(snippet).not.toContain('onmouseover=');
    expect(snippet).toContain('style="display:inline-block;');
  });
  it('shop and item text cannot break out: it is percent-encoded in the link', () => {
    expect(link).toContain('%3Cscript%3E');
    expect(link).not.toContain('<');
    expect(link).not.toContain('"');
  });
  it('even a hostile link is HTML-escaped', () => {
    const hostile = buildPayTogetherSnippet('https://x.test/?a="><script>alert(1)</script>');
    expect(hostile.toLowerCase()).not.toContain('<script');
    expect(hostile).toContain('&quot;&gt;&lt;script&gt;');
  });
});

// ── Base path ────────────────────────────────────────────────────────────────

describe('links keep the base path', () => {
  const params = demoCheckoutParams(DEMO_ITEMS[1], SHOP);
  it('checkout link, snippet and QR target made on the testnet build keep /testnet/', () => {
    for (const base of ['https://kitty-five-mu.vercel.app/testnet', 'https://kitty-five-mu.vercel.app/testnet/']) {
      const link = buildCheckoutLink(base, params);
      expect(link.startsWith('https://kitty-five-mu.vercel.app/testnet/?new=open&to=')).toBe(true);
      expect(buildPayTogetherSnippet(link)).toContain('href="https://kitty-five-mu.vercel.app/testnet/?new=open&amp;to=');
      expect(link).not.toContain('/testnet//');
    }
  });
  it('the mainnet build links at the root', () => {
    expect(buildCheckoutLink('https://kitty-five-mu.vercel.app', params).startsWith('https://kitty-five-mu.vercel.app/?new=open&to=')).toBe(true);
  });
});

// ── 3. Demo store ────────────────────────────────────────────────────────────

describe('demo store', () => {
  const store = (dep = testnet, me: string | undefined = SHOP) => clean(renderToString(createElement(DemoStore, { me, dep, onNavigate: noop })));

  it('three items at the stated prices, labelled as a demo', () => {
    const html = store();
    expect(DEMO_ITEMS.map(i => [i.name, i.price])).toEqual([['Team lunch box', '12.00'], ['Group gift: espresso machine', '240.00'], ['Concert tickets x4', '180.00']]);
    for (const t of [DEMO_SHOP_NAME, 'A demo store. Nothing here is for sale.', 'Team lunch box', 'Group gift: espresso machine', 'Concert tickets x4', '12.00', '240.00', '180.00']) {
      expect(html).toContain(t);
    }
    expect(html).toContain('You are the shop owner in this demo, so payouts come back to you.');
    expect(html.match(/>Pay together</g)).toHaveLength(3);
  });
  it('each button is a checkout link to the connected wallet, locked, from the demo shop', () => {
    const html = store();
    for (const item of DEMO_ITEMS) {
      const p = demoCheckoutParams(item, SHOP);
      expect(p).toMatchObject({ to: SHOP, amount: item.price, ref: item.name, lock: true, shop: DEMO_SHOP_NAME });
      const href = buildCheckoutSearch(p).replace(/&/g, '&amp;');
      expect(renderToString(createElement(DemoStore, { me: SHOP, dep: testnet, onNavigate: noop }))).toContain(`href="${href}"`);
      // and it is a link the buyer page accepts as is
      const back = parseCheckout(buildCheckoutSearch(p), CTX)!;
      expect(back.ignored).toEqual([]);
      expect(utf8Bytes(item.name)).toBeLessThanOrEqual(MAX_REF_BYTES);
    }
    expect(html).not.toContain('Connect your wallet first');
  });
  it('the buttons open the in-app checkout route', () => {
    const r = buildCheckoutRoute(demoCheckoutParams(DEMO_ITEMS[0], SHOP));
    expect(r).toMatchObject({ view: 'new', kind: 'split' });
    expect(routeToSearch(r)).toBe(buildCheckoutSearch(demoCheckoutParams(DEMO_ITEMS[0], SHOP)));
  });
  it('mainnet shows the real-USDC caution next to the buttons; testnet does not', () => {
    expect(store(mainnet)).toContain('Payouts cannot be reversed. Only chip in to kitties you trust.');
    expect(store(testnet)).not.toContain('Only chip in to kitties you trust');
  });
  it('has no dashes', () => { expect(store(mainnet)).not.toMatch(/[\u2014\u2013]/); });
});

// ── 4. Seller dashboard ──────────────────────────────────────────────────────

describe('seller dashboard: checkout kitties', () => {
  const NOW = 1_800_000_000n;
  const mk = (id: string, over: Partial<RequestSummary>): RequestSummary => ({
    id: `0x${id.repeat(32)}`, type: 'request', ref: `Order ${id}`, goalRaw: 100n * U, totalFundedRaw: 0n, deadline: NOW + 1_000n,
    settled: false, cancelled: false, contributorCount: 0, createdBlock: BigInt(parseInt(id, 16)), ...over,
  });
  const list = [
    mk('01', { totalFundedRaw: 40n * U, contributorCount: 2 }),
    mk('02', { type: 'checkout', totalFundedRaw: 100n * U, settled: true, contributorCount: 4 }),
    mk('03', { type: 'checkout', totalFundedRaw: 30n * U, contributorCount: 1 }),
  ];

  it('tells a request from a buyer\'s checkout by who created it', () => {
    expect(requestType(SHOP, SHOP)).toBe('request');
    expect(requestType('0x1111111111111111111111111111111111111111', SHOP)).toBe('checkout');
    expect(requestType(SHOP.toUpperCase().replace('0X', '0x'), SHOP)).toBe('request');
  });
  it('the same groups hold both kinds, and totals count them', () => {
    const g = groupRequests(list, NOW);
    expect(g.active.map(r => r.id.slice(2, 4))).toEqual(['01', '03']);
    expect(g.paid.map(r => r.id.slice(2, 4))).toEqual(['02']);
    const t = requestTotals(list, NOW);
    expect(t.requestedRaw).toBe(300n * U);
    expect(t.collectedRaw).toBe(100n * U);
    expect(t.pendingRaw).toBe(70n * U);
  });
  it('the CSV has a Type column: request | checkout', () => {
    expect(REQUEST_CSV_HEADER[REQUEST_CSV_HEADER.length - 1]).toBe('Type');
    const lines = requestCsv(list, NOW).trim().split('\r\n');
    expect(lines[0].endsWith(',Type')).toBe(true);
    expect(lines[1].endsWith(',request')).toBe(true);
    expect(lines[2].endsWith(',checkout')).toBe(true);
    expect(lines[3].endsWith(',checkout')).toBe(true);
  });
  it('the page tags checkout kitties and links to For sellers', () => {
    const html = clean(renderToString(createElement(SellerRequests, {
      me: SHOP, scan: { items: list, chainTimestamp: NOW, scannedAt: Date.now() }, loading: false, refreshing: false, error: undefined, onRefresh: noop, onNavigate: noop,
    })));
    expect(html.match(/>Checkout</g)).toHaveLength(2);
    expect(html).toContain('For sellers');
    expect(html).toContain('checkout kitties your buyers started for you');
  });
});

// ── Home links ───────────────────────────────────────────────────────────────

describe('home', () => {
  it('the Request payment card links to For sellers and the demo store', () => {
    const html = clean(renderToString(createElement(Home, { onNavigate: noop })));
    expect(html).toContain('href="?view=sell"');
    expect(html).toContain('href="?view=shop"');
    expect(html).toContain('For sellers');
    expect(html).toContain('Demo store');
    expect(html).toContain('aria-label="Request payment"');
  });
});

// ── 6. The network switch keeps sell and shop, never checkout params ─────────

describe('network switch allow-list', () => {
  const urls = readSiteUrls({ VITE_MAINNET_URL: 'https://kitty-five-mu.vercel.app', VITE_TESTNET_URL: 'https://kitty-five-mu.vercel.app/testnet/' });
  it.each([['sell', '?view=sell'], ['shop', '?view=shop']] as const)('keeps view=%s on both builds', (view, search) => {
    expect(switchModel({ activeTestnet: false, urls, route: { view } })![1].href).toBe(`https://kitty-five-mu.vercel.app/testnet/${search}`);
    expect(switchModel({ activeTestnet: true, urls, route: { view } })![0].href).toBe(`https://kitty-five-mu.vercel.app/${search}`);
  });
  it('never carries checkout params, from either build', () => {
    const route = parseRoute(buildCheckoutSearch(full), CTX);
    for (const activeTestnet of [false, true]) {
      const m = switchModel({ activeTestnet, urls, route })!;
      const other = m.find(o => !o.current)!;
      expect(other.href).toBe(activeTestnet ? 'https://kitty-five-mu.vercel.app/' : 'https://kitty-five-mu.vercel.app/testnet/');
      for (const k of ['new', 'to', 'amount', 'ref', 'days', 'lock', 'shop', 'kitty']) expect(other.href).not.toContain(`${k}=`);
    }
  });
});
