// ─── Kitty – pure helper tests ──────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  saltFromBytes, randomSalt, computePotId, potIdFromDecodedLogs,
  dustFloor, effectiveMin, kittyPhase, readPhaseOf, PHASE_PILL, SETTLE_GRACE_SECONDS,
  kittyAction, kittyActionHasDock, chipInBounds, validateChipIn,
  TEMPLATES, getTemplate, draftFromStart, validateKittyDraft, hasErrors, buildCreateCall,
  parseRoute, routeToSearch, routeTab, parseKittyInput,
  buildKittyUrl, buildKittyNudge, buildEmbedSnippet, embedStyleObject, escapeHtml,
  parseKittyLog, sortActivity, agoText, chunkRanges,
  deriveRoles, mineAction, groupMine, utf8Length,
  type KittyDraft,
} from '../kitty-core';
import { toLocalInputValue } from '../pt-ui';
import type { MineSummary } from '../kitty-types';

const U = 1_000_000n;
const ID = '0xbda9425ce58ad49f2bb13b6f1cb7e94f949a6c60e943979e47d4a2f3bce9e300' as const;
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';
const KITTY = '0x12840026bd9457b41ae104536f0917a19dd88611';
const USDC = '0x3600000000000000000000000000000000000000';

describe('salt and pot id', () => {
  it('turns 32 bytes into 0x hex and rejects other lengths', () => {
    expect(saltFromBytes(new Uint8Array(32).fill(255))).toBe(`0x${'ff'.repeat(32)}`);
    expect(() => saltFromBytes(new Uint8Array(31))).toThrow();
  });
  it('generates distinct random 32-byte salts', () => {
    const a = randomSalt();
    const b = randomSalt();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
  it('matches the contract formula keccak256(abi.encode(creator, salt)) (vector from cast)', () => {
    const salt = `0x${'00'.repeat(31)}aa` as const;
    expect(computePotId(A, salt)).toBe('0x997c86c1802ffe437273b1480d8a98ed237a0a4d3172ce0434914f9f82207af4');
  });
  it('gives different ids for the same salt from two creators, and for two salts', () => {
    const s = saltFromBytes(new Uint8Array(32).fill(7));
    expect(computePotId(A, s)).not.toBe(computePotId(B, s));
    expect(computePotId(A, s)).not.toBe(computePotId(A, saltFromBytes(new Uint8Array(32).fill(8))));
  });
  it('reads the id back from a decoded PotCreated log of our contract only', () => {
    const logs = [
      { address: USDC, eventName: 'PotCreated', args: { potId: '0x' + '11'.repeat(32) } },
      { address: KITTY, eventName: 'Funded', args: { potId: '0x' + '22'.repeat(32) } },
      { address: KITTY.toUpperCase().replace('0X', '0x'), eventName: 'PotCreated', args: { potId: ID } },
    ];
    expect(potIdFromDecodedLogs(logs, KITTY)).toBe(ID);
    expect(potIdFromDecodedLogs(logs.slice(0, 2), KITTY)).toBeUndefined();
  });
});

describe('effective minimum (mirrors the contract)', () => {
  it('is ceil(goal / 256)', () => {
    const cases: Array<[bigint, bigint]> = [[1n, 1n], [255n, 1n], [256n, 1n], [257n, 2n], [512n, 2n], [513n, 3n], [2560n, 10n], [2561n, 11n]];
    for (const [goal, want] of cases) expect(dustFloor(goal)).toBe(want);
  });
  it('takes the larger of the creator minimum and the floor', () => {
    expect(effectiveMin(100n * U, 0n)).toBe(390_625n);
    expect(effectiveMin(100n * U, 5n * U)).toBe(5n * U);
    expect(effectiveMin(100n * U, 1n)).toBe(390_625n);
  });
});

describe('phase', () => {
  const base = { goalRaw: 10n * U, deadline: 1_000n, now: 0n };
  it('is open before the deadline and expired after it when under goal', () => {
    expect(kittyPhase({ ...base, settled: false, totalFundedRaw: 3n * U, now: 999n })).toBe('open');
    expect(kittyPhase({ ...base, settled: false, totalFundedRaw: 3n * U, now: 1_000n })).toBe('expired');
  });
  it('is ready when fully funded, until deadline + 30 days, then stuck (refund-only)', () => {
    const full = { ...base, settled: false, totalFundedRaw: 10n * U };
    expect(kittyPhase({ ...full, now: 500n })).toBe('ready');
    expect(kittyPhase({ ...full, now: 1_000n + SETTLE_GRACE_SECONDS - 1n })).toBe('ready');
    expect(kittyPhase({ ...full, now: 1_000n + SETTLE_GRACE_SECONDS })).toBe('stuck');
  });
  it('is paid once settled, whatever the clock says', () => {
    expect(kittyPhase({ ...base, settled: true, totalFundedRaw: 10n * U, now: 10n ** 12n })).toBe('paid');
  });
  it('reads the phase from the last chain read', () => {
    expect(readPhaseOf({ settled: false, totalFundedRaw: 0n, goalRaw: 1n, deadline: 100n, chainTimestamp: 100n })).toBe('expired');
  });
  it('has plain pill labels without dashes', () => {
    for (const p of Object.values(PHASE_PILL)) expect(p.label).not.toMatch(/[\u2014\u2013]/);
    expect(PHASE_PILL.expired.label).toBe('Expired, refunds open');
  });
});

describe('action selection', () => {
  const on = { connected: true, correctChain: true } as const;
  const my = (share: bigint, contributed: bigint, refunded = false) => ({ shareRaw: share, contributedRaw: contributed, refunded });
  it('asks to connect, then to switch', () => {
    expect(kittyAction({ connected: false, correctChain: false, phase: 'open', mode: 'open' })).toBe('connect');
    expect(kittyAction({ connected: true, correctChain: false, phase: 'open', mode: 'open' })).toBe('switch');
  });
  it('split, open phase: chip in while a share remains', () => {
    expect(kittyAction({ ...on, phase: 'open', mode: 'split', my: my(10n, 4n) })).toBe('chip-in');
    expect(kittyAction({ ...on, phase: 'open', mode: 'split', my: my(10n, 10n) })).toBe('share-paid');
    expect(kittyAction({ ...on, phase: 'open', mode: 'split' })).toBe('not-invited');
    expect(kittyAction({ ...on, phase: 'open', mode: 'split', my: my(0n, 0n) })).toBe('not-invited');
  });
  it('open pool, open phase: anyone can chip in, even after chipping in before', () => {
    expect(kittyAction({ ...on, phase: 'open', mode: 'open' })).toBe('chip-in');
    expect(kittyAction({ ...on, phase: 'open', mode: 'open', my: my(0n, 5n) })).toBe('chip-in');
  });
  it('ready: anyone can pay out. paid: informational', () => {
    expect(kittyAction({ ...on, phase: 'ready', mode: 'split' })).toBe('pay-out');
    expect(kittyAction({ ...on, phase: 'ready', mode: 'open' })).toBe('pay-out');
    expect(kittyAction({ ...on, phase: 'paid', mode: 'open' })).toBe('paid');
  });
  it('expired and stuck (the 30-day window): refund only for people who chipped in', () => {
    for (const phase of ['expired', 'stuck'] as const) {
      expect(kittyAction({ ...on, phase, mode: 'open', my: my(0n, 5n) })).toBe('refund');
      expect(kittyAction({ ...on, phase, mode: 'split', my: my(10n, 5n, true) })).toBe('refunded');
      expect(kittyAction({ ...on, phase, mode: 'open', my: my(0n, 0n) })).toBe('nothing');
      expect(kittyAction({ ...on, phase, mode: 'open' })).toBe('nothing');
    }
  });
  it('docks only transaction cards on mobile', () => {
    expect(kittyActionHasDock('chip-in') && kittyActionHasDock('pay-out') && kittyActionHasDock('refund')).toBe(true);
    expect(kittyActionHasDock('paid') || kittyActionHasDock('connect') || kittyActionHasDock('nothing')).toBe(false);
  });
});

describe('chip in bounds', () => {
  it('split: up to your own remaining share, capped by what the kitty still needs', () => {
    const base = { mode: 'split' as const, goalRaw: 100n, totalFundedRaw: 40n, effectiveMinRaw: 0n };
    expect(chipInBounds({ ...base, my: { shareRaw: 30n, contributedRaw: 10n } })).toEqual({ min: 1n, max: 20n });
    expect(chipInBounds({ ...base, totalFundedRaw: 95n, my: { shareRaw: 30n, contributedRaw: 10n } })).toEqual({ min: 1n, max: 5n });
  });
  it('open, first-time: the floor applies, and the whole remainder is always allowed', () => {
    const base = { mode: 'open' as const, goalRaw: 100n * U, totalFundedRaw: 20n * U, effectiveMinRaw: 5n * U };
    expect(chipInBounds(base)).toEqual({ min: 5n * U, max: 80n * U });
  });
  it('open, first-time, remainder below the floor: only the completing amount works', () => {
    const b = chipInBounds({ mode: 'open', goalRaw: 100n * U, totalFundedRaw: 98n * U, effectiveMinRaw: 5n * U });
    expect(b).toEqual({ min: 2n * U, max: 2n * U });
  });
  it('open, repeat funder: any amount above zero', () => {
    const b = chipInBounds({ mode: 'open', goalRaw: 100n * U, totalFundedRaw: 20n * U, effectiveMinRaw: 5n * U, my: { shareRaw: 0n, contributedRaw: 1n } });
    expect(b).toEqual({ min: 1n, max: 80n * U });
  });
  it('validates amounts against the bounds', () => {
    const b = { min: 5n, max: 10n };
    expect(validateChipIn(7n, b, 'open')).toBeUndefined();
    expect(validateChipIn(4n, b, 'open')).toMatch(/minimum/);
    expect(validateChipIn(11n, b, 'open')).toMatch(/more than/);
    expect(validateChipIn(0n, b, 'open')).toMatch(/above zero/);
    expect(validateChipIn(1n, { min: 1n, max: 0n }, 'split')).toMatch(/Nothing left/);
    expect(validateChipIn(11n, b, 'split')).toMatch(/remaining share/);
  });
});

describe('templates', () => {
  it('has the six templates with the requested modes and deadlines', () => {
    const want: Record<string, [string, number]> = {
      'group-gift': ['open', 7], trip: ['split', 14], 'rent-deposit': ['split', 3],
      'group-buy': ['open', 5], 'event-tickets': ['split', 3], 'team-tool': ['split', 7],
    };
    expect(TEMPLATES).toHaveLength(6);
    for (const t of TEMPLATES) expect([t.mode, t.deadlineDays]).toEqual(want[t.id]);
  });
  it('has copy without em or en dashes', () => {
    for (const t of TEMPLATES) expect(`${t.label} ${t.helper} ${t.refPlaceholder}`).not.toMatch(/[\u2014\u2013]/);
  });
  it('prefills mode and default deadline from a template', () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    const d = draftFromStart({ kind: 'split', template: 'group-gift' }, now);
    expect(d.mode).toBe('open');
    expect(d.deadlineIso).toBe(toLocalInputValue(now + 7 * 86_400_000));
    expect(draftFromStart({ kind: 'split', template: 'trip' }, now).deadlineIso).toBe(toLocalInputValue(now + 14 * 86_400_000));
  });
  it('defaults by start kind when there is no template', () => {
    expect(draftFromStart({ kind: 'open' }, 0).mode).toBe('open');
    expect(draftFromStart({ kind: 'split' }, 0).mode).toBe('split');
    expect(draftFromStart({ kind: 'request' }, 0).mode).toBe('split');
    expect(getTemplate('nope')).toBeUndefined();
  });
});

describe('draft validation and create call', () => {
  const NOW = 1_800_000_000;
  const future = toLocalInputValue((NOW + 86_400 * 3) * 1000);
  const split: KittyDraft = {
    kind: 'split', mode: 'split', recipient: A, ref: 'Dinner', goal: '30', deadlineIso: future, minContribution: '',
    shares: [{ address: B, amount: '10' }, { address: C, amount: '20' }],
  };
  const open: KittyDraft = { ...split, kind: 'open', mode: 'open', shares: [], minContribution: '' };
  const ctx = { kitty: KITTY, usdc: USDC, account: B };

  it('accepts valid split and open drafts', () => {
    expect(hasErrors(validateKittyDraft(split, NOW, ctx))).toBe(false);
    expect(hasErrors(validateKittyDraft(open, NOW, ctx))).toBe(false);
  });
  it('rejects recipients the contract rejects', () => {
    expect(validateKittyDraft({ ...split, recipient: KITTY }, NOW, ctx).recipient).toMatch(/contract/);
    expect(validateKittyDraft({ ...split, recipient: USDC }, NOW, ctx).recipient).toMatch(/USDC/);
    expect(validateKittyDraft({ ...split, recipient: '0x0000000000000000000000000000000000000000' }, NOW, ctx).recipient).toMatch(/zero/);
    expect(validateKittyDraft({ ...split, recipient: 'nope' }, NOW, ctx).recipient).toBe('Invalid address');
  });
  it('a payment request needs a connected wallet', () => {
    expect(validateKittyDraft({ ...split, kind: 'request', recipient: '' }, NOW, { ...ctx, account: undefined }).recipient).toMatch(/Connect/);
    expect(validateKittyDraft({ ...split, kind: 'request', recipient: B }, NOW, ctx).recipient).toBeUndefined();
  });
  it('checks the name in bytes, the goal and the deadline', () => {
    expect(validateKittyDraft({ ...split, ref: '' }, NOW, ctx).ref).toBeDefined();
    expect(validateKittyDraft({ ...split, ref: 'a'.repeat(64) }, NOW, ctx).ref).toBeUndefined();
    expect(validateKittyDraft({ ...split, ref: 'a'.repeat(65) }, NOW, ctx).ref).toBeDefined();
    expect(utf8Length('\u00e9'.repeat(33))).toBe(66);
    expect(validateKittyDraft({ ...split, ref: '\u00e9'.repeat(33) }, NOW, ctx).ref).toBeDefined();
    expect(validateKittyDraft({ ...split, goal: '' }, NOW, ctx).goal).toBeDefined();
    expect(validateKittyDraft({ ...split, goal: '1e6' }, NOW, ctx).goal).toBeDefined();
    expect(validateKittyDraft({ ...split, deadlineIso: toLocalInputValue((NOW - 60) * 1000) }, NOW, ctx).deadline).toMatch(/future/);
  });
  it('split: shares must add up to the goal and addresses must be unique', () => {
    expect(validateKittyDraft({ ...split, goal: '31' }, NOW, ctx).sharesSum).toBeDefined();
    const dup = validateKittyDraft({ ...split, shares: [{ address: B, amount: '10' }, { address: B, amount: '20' }] }, NOW, ctx);
    expect(dup.shares?.[1]).toMatch(/Duplicate/);
    expect(validateKittyDraft({ ...split, shares: [] }, NOW, ctx).sharesSum).toBeDefined();
  });
  it('open: the minimum cannot exceed the goal', () => {
    expect(validateKittyDraft({ ...open, minContribution: '31' }, NOW, ctx).minContribution).toBeDefined();
    expect(validateKittyDraft({ ...open, minContribution: '5' }, NOW, ctx).minContribution).toBeUndefined();
  });
  it('builds createSplitPot args with the salt first', () => {
    const salt = `0x${'ab'.repeat(32)}` as const;
    const call = buildCreateCall(split, salt, A);
    expect(call.functionName).toBe('createSplitPot');
    expect(call.args[0]).toBe(salt);
    expect(call.args[1]).toBe(A);
    expect(call.args[2]).toBe(30n * U);
    expect(call.args[4]).toBe('Dinner');
    expect(call.args[5]).toEqual([B, C]);
    expect(call.args[6]).toEqual([10n * U, 20n * U]);
  });
  it('builds createOpenPot args with the optional minimum', () => {
    const salt = `0x${'cd'.repeat(32)}` as const;
    const call = buildCreateCall({ ...open, minContribution: '2.5' }, salt, A);
    expect(call.functionName).toBe('createOpenPot');
    expect(call.args[5]).toBe(2_500_000n);
    expect((buildCreateCall(open, salt, A).args as readonly unknown[])[5]).toBe(0n);
  });
});

describe('routes', () => {
  it('parses each view', () => {
    expect(parseRoute('')).toEqual({ view: 'home' });
    expect(parseRoute(`?kitty=${ID}`)).toEqual({ view: 'kitty', id: ID });
    expect(parseRoute('?view=mine')).toEqual({ view: 'mine' });
    expect(parseRoute('?view=open')).toEqual({ view: 'open' });
    expect(parseRoute('?new=split')).toEqual({ view: 'new', kind: 'split' });
    expect(parseRoute('?new=request')).toEqual({ view: 'new', kind: 'request' });
    expect(parseRoute('?new=group-gift')).toEqual({ view: 'new', kind: 'open', template: 'group-gift' });
    expect(parseRoute('?new=trip')).toEqual({ view: 'new', kind: 'split', template: 'trip' });
  });
  it('keeps the legacy ?order= link working', () => {
    expect(parseRoute(`?order=${ID}`)).toEqual({ view: 'kitty', id: ID });
  });
  it('sends a bad id to the open view with a flag, and unknown params home', () => {
    expect(parseRoute('?kitty=0x12')).toEqual({ view: 'open', invalid: true });
    expect(parseRoute('?new=banana')).toEqual({ view: 'home' });
    expect(parseRoute('?other=1')).toEqual({ view: 'home' });
  });
  it('round-trips through routeToSearch', () => {
    for (const s of [`?kitty=${ID}`, '?view=mine', '?view=open', '?new=split', '?new=trip', '?new=request']) {
      expect(routeToSearch(parseRoute(s))).toBe(s);
    }
    expect(routeToSearch({ view: 'home' })).toBe('');
  });
  it('maps routes to top bar tabs', () => {
    expect(routeTab({ view: 'home' })).toBe('new');
    expect(routeTab({ view: 'new', kind: 'open' })).toBe('new');
    expect(routeTab({ view: 'mine' })).toBe('mine');
    expect(routeTab({ view: 'kitty', id: ID })).toBe('open');
    expect(routeTab({ view: 'open' })).toBe('open');
  });
  it('accepts a bare id or a link carrying ?kitty= or ?order=', () => {
    expect(parseKittyInput(ID)).toEqual({ kind: 'valid', id: ID });
    expect(parseKittyInput(`  ${ID}  `)).toEqual({ kind: 'valid', id: ID });
    expect(parseKittyInput(`https://app.test/?kitty=${ID}`)).toEqual({ kind: 'valid', id: ID });
    expect(parseKittyInput(`https://app.test/?order=${ID}#x`)).toEqual({ kind: 'valid', id: ID });
    expect(parseKittyInput('')).toEqual({ kind: 'empty' });
    expect(parseKittyInput('0x1234')).toEqual({ kind: 'invalid' });
    expect(parseKittyInput('https://app.test/?view=mine')).toEqual({ kind: 'invalid' });
  });
});

describe('links, nudge and embed', () => {
  it('builds the kitty link', () => {
    expect(buildKittyUrl('https://x.test/', ID)).toBe(`https://x.test/?kitty=${ID}`);
  });
  it('writes a personal nudge for split and a general one for open', () => {
    const split = buildKittyNudge({ ref: 'Lisbon', mode: 'split', shareText: '40.00', goalText: '160.00', deadlineText: 'Nov 1', link: 'L' });
    expect(split).toBe("You're in on Lisbon: chip in 40.00 USDC by Nov 1. L");
    const open = buildKittyNudge({ ref: 'Gift', mode: 'open', goalText: '100.00', deadlineText: 'Nov 1', link: 'L' });
    expect(open).toBe('Chip in to Gift: 100.00 USDC goal, open until Nov 1. L');
    expect(`${split} ${open}`).not.toMatch(/[\u2014\u2013]/);
  });
  it('escapes HTML in the embed snippet', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
    const evil = buildEmbedSnippet('https://x.test/?kitty=1"><script>alert(1)</script>', '<b>"hi"</b>');
    expect(evil).not.toContain('<script');
    expect(evil).not.toContain('<b>');
    expect(evil).toContain('&quot;&gt;&lt;script&gt;');
    expect(evil).toContain('&lt;b&gt;&quot;hi&quot;&lt;/b&gt;');
  });
  it('is an inline-styled anchor with no script or external CSS', () => {
    const s = buildEmbedSnippet(`https://x.test/?kitty=${ID}`);
    expect(s.startsWith('<a href="https://x.test/?kitty=')).toBe(true);
    expect(s).toContain('rel="noopener noreferrer"');
    expect(s).toContain('target="_blank"');
    expect(s).toContain('style="');
    expect(s).toContain('>Split with friends</a>');
    expect(s).not.toMatch(/<script|<link|<style|onclick/i);
  });
  it('gives the preview the same style as the snippet', () => {
    const o = embedStyleObject();
    expect(o.borderRadius).toBe('999px');
    expect(o.textDecoration).toBe('none');
    expect(buildEmbedSnippet('u')).toContain('border-radius:999px');
  });
});

describe('activity', () => {
  const tx = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`;
  it('parses the four events', () => {
    const mk = (eventName: string, args: Record<string, unknown>) => parseKittyLog({ eventName, args, blockNumber: 5n, logIndex: 1, transactionHash: tx(1) });
    expect(mk('PotCreated', { creator: A })).toMatchObject({ kind: 'created', address: A });
    expect(mk('Funded', { contributor: B, amount: 5n })).toMatchObject({ kind: 'chipped', address: B, amountRaw: 5n });
    expect(mk('Settled', { recipient: C, amount: 9n })).toMatchObject({ kind: 'paid', address: C, amountRaw: 9n });
    expect(mk('Refunded', { contributor: B, amount: 2n })).toMatchObject({ kind: 'refunded', amountRaw: 2n });
    expect(mk('Other', {})).toBeNull();
    expect(parseKittyLog({ eventName: 'Funded', args: {}, blockNumber: null, logIndex: null, transactionHash: null })).toBeNull();
  });
  it('sorts newest first, using the log index within a block', () => {
    const it = (b: bigint, i: number) => ({ kind: 'chipped' as const, address: A, blockNumber: b, logIndex: i, txHash: tx(i) });
    const sorted = sortActivity([it(5n, 1), it(7n, 0), it(7n, 3), it(2n, 9)]);
    expect(sorted.map(x => `${x.blockNumber}:${x.logIndex}`)).toEqual(['7:3', '7:0', '5:1', '2:9']);
  });
  it('words relative time', () => {
    expect(agoText(10)).toBe('just now');
    expect(agoText(60)).toBe('1 minute ago');
    expect(agoText(5 * 60)).toBe('5 minutes ago');
    expect(agoText(2 * 3600)).toBe('2 hours ago');
    expect(agoText(3 * 86_400)).toBe('3 days ago');
    expect(agoText(-5)).toBe('just now');
  });
  it('splits a block range into inclusive chunks', () => {
    expect(chunkRanges(10n, 25n, 10n)).toEqual([[10n, 19n], [20n, 25n]]);
    expect(chunkRanges(5n, 5n, 100n)).toEqual([[5n, 5n]]);
    expect(chunkRanges(9n, 5n, 3n)).toEqual([]);
    expect(() => chunkRanges(0n, 5n, 0n)).toThrow();
  });
});

describe('my kitties', () => {
  const NOW = 10_000n;
  const mk = (over: Partial<MineSummary>): MineSummary => ({
    id: ID, ref: 'k', mode: 'split', creator: A, recipient: B, goalRaw: 100n, totalFundedRaw: 0n, deadline: NOW + 1_000n,
    settled: false, myShareRaw: 0n, myContributedRaw: 0n, myRefunded: false, roles: [], ...over,
  });

  it('derives roles', () => {
    const base = { me: A, creator: A, recipient: B, mode: 'split' as const, myShareRaw: 0n, myContributedRaw: 0n, myRefunded: false };
    expect(deriveRoles(base)).toEqual(['Created']);
    expect(deriveRoles({ ...base, me: B })).toEqual(['Recipient']);
    expect(deriveRoles({ ...base, me: C, myShareRaw: 10n })).toEqual(['Invited']);
    expect(deriveRoles({ ...base, me: C, myShareRaw: 10n, myContributedRaw: 5n })).toEqual(['Chipped in']);
    expect(deriveRoles({ ...base, me: A, recipient: A })).toEqual(['Created', 'Recipient']);
    expect(deriveRoles({ ...base, me: C, mode: 'open', myShareRaw: 0n })).toEqual([]);
  });

  it('flags the action each wallet needs', () => {
    expect(mineAction(mk({ myShareRaw: 50n, myContributedRaw: 20n }), NOW)).toBe('chip-in');
    expect(mineAction(mk({ myShareRaw: 50n, myContributedRaw: 50n }), NOW)).toBeNull();
    expect(mineAction(mk({ mode: 'open', myContributedRaw: 5n }), NOW)).toBeNull();
    expect(mineAction(mk({ totalFundedRaw: 100n }), NOW)).toBe('pay-out');
    expect(mineAction(mk({ deadline: 100n, myContributedRaw: 5n }), NOW)).toBe('refund');
    expect(mineAction(mk({ deadline: 100n, myContributedRaw: 5n, myRefunded: true }), NOW)).toBeNull();
    expect(mineAction(mk({ deadline: 100n, totalFundedRaw: 100n, myContributedRaw: 5n }), 100n + SETTLE_GRACE_SECONDS)).toBe('refund');
  });

  it('groups into needs action, active and completed', () => {
    const list = [
      mk({ id: `0x${'01'.repeat(32)}`, myShareRaw: 50n }),                                   // chip in
      mk({ id: `0x${'02'.repeat(32)}`, mode: 'open', roles: ['Created'], deadline: NOW + 500n }),// active
      mk({ id: `0x${'03'.repeat(32)}`, settled: true, totalFundedRaw: 100n }),                 // completed
      mk({ id: `0x${'04'.repeat(32)}`, deadline: 5n, myContributedRaw: 3n }),                  // refund
      mk({ id: `0x${'05'.repeat(32)}`, deadline: 5n }),                                        // expired, nothing to do
    ];
    const g = groupMine(list, NOW);
    expect(g.needsAction.map(x => x.id.slice(2, 4))).toEqual(['04', '01']);
    expect(g.active.map(x => x.id.slice(2, 4))).toEqual(['02']);
    expect(g.completed.map(x => x.id.slice(2, 4)).sort()).toEqual(['03', '05']);
  });

  it('sorts needs-action by soonest deadline and completed by most recent', () => {
    const a = mk({ id: `0x${'0a'.repeat(32)}`, myShareRaw: 9n, deadline: NOW + 900n });
    const b = mk({ id: `0x${'0b'.repeat(32)}`, myShareRaw: 9n, deadline: NOW + 100n });
    expect(groupMine([a, b], NOW).needsAction.map(x => x.id.slice(2, 4))).toEqual(['0b', '0a']);
    const c = mk({ id: `0x${'0c'.repeat(32)}`, settled: true, deadline: 10n });
    const d = mk({ id: `0x${'0d'.repeat(32)}`, settled: true, deadline: 20n });
    expect(groupMine([c, d], NOW).completed.map(x => x.id.slice(2, 4))).toEqual(['0d', '0c']);
  });
});
