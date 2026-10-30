// ─── Kitty – render smoke tests (server render, no browser) ─────────────────
// Catches components that throw on real-shaped data and keeps copy free of dashes.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Home } from '../components/Home';
import { CreateKitty } from '../components/CreateKitty';
import { KittyPage, type KittyPageProps } from '../components/KittyPage';
import { MyKitties } from '../components/MyKitties';
import { SegmentedTabs } from '../components/fields';
import { ContributorGrid } from '../components/SegmentedProgress';
import { ActivityFeed } from '../components/ActivityFeed';
import { KittyNotFound } from '../components/KittyNotFound';
import { Avatar, PersonAvatar } from '../components/ui';
import { ACTIVE } from '../kitty-config';
import { SETTLE_GRACE_SECONDS } from '../kitty-core';
import type { KittyData, MineSummary } from '../kitty-types';

const U = 1_000_000n;
const ME = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const SELLER = '0x3333333333333333333333333333333333333333';
const ID = `0x${'ab'.repeat(32)}` as const;
const NOW = 1_800_000_000n;

// React inserts <!-- --> between adjacent text nodes; drop them so assertions read like the page.
const clean = (html: string) => html.replace(/<!-- -->/g, '');
const noop = () => undefined;
const page = (data: KittyData, over: Partial<KittyPageProps> = {}): string =>
  clean(renderToString(createElement(KittyPage, {
    data, dep: ACTIVE, connectedAddress: ME, isCorrectChain: true, onSwitchChain: noop, txStatus: { kind: 'idle' },
    allowanceRaw: 0n, balanceRaw: 100n * U, onRefresh: noop, onChipIn: noop, onCancel: noop, onPayOut: noop, onGetRefund: noop,
    justCreated: false, activity: { items: [], loading: false, error: undefined, retry: noop }, ...over,
  })));

const base: KittyData = {
  id: ID, creator: BOB, recipient: SELLER, goalRaw: 100n * U, deadline: NOW + 86_400n, ref: 'Lisbon weekend', mode: 'split',
  settled: false, cancelled: false, totalFundedRaw: 40n * U, minContributionRaw: 0n, effectiveMinRaw: 0n, chainTimestamp: NOW,
  contributors: [
    { address: ME, shareRaw: 60n * U, contributedRaw: 20n * U, refunded: false },
    { address: BOB, shareRaw: 40n * U, contributedRaw: 20n * U, refunded: false },
  ],
};
const open: KittyData = {
  ...base, mode: 'open', ref: 'Gift for Sam', effectiveMinRaw: 390_625n,
  contributors: [{ address: BOB, shareRaw: 0n, contributedRaw: 40n * U, refunded: false }],
};

describe('render smoke', () => {
  it('home shows the headline, the three starts and the templates', () => {
    const html = clean(renderToString(createElement(Home, { onNavigate: noop })));
    for (const t of [
      'Nobody fronts the money.', 'Split a bill', 'Pool for a goal', 'Request payment', 'Group gift', 'Rent deposit', 'Team tool',
      // animated demo + the real-UI previews in the start cards
      'Weekend in Lisbon', 'Ana', 'Ravi', 'Mei', 'Not paid', 'Sam', '60.00', '12 people', 'Requested by the seller',
    ]) {
      expect(html).toContain(t);
    }
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });

  it('create flow adapts to the start kind', () => {
    const props = { dep: ACTIVE, connectedAddress: ME, isCorrectChain: true, deployBlocked: false, txBusy: false, onSubmit: noop };
    const split = renderToString(createElement(CreateKitty, { ...props, start: { kind: 'split' } }));
    expect(split).toContain('Split evenly');
    expect(split).toContain('Add person');
    const pool = renderToString(createElement(CreateKitty, { ...props, start: { kind: 'open', template: 'group-gift' } }));
    expect(pool).toContain('Group gift');
    expect(pool).toContain('Minimum (optional)');
    expect(pool).not.toContain('Split evenly');
    const req = renderToString(createElement(CreateKitty, { ...props, start: { kind: 'request' } }));
    expect(req).toContain('Requested by you');
    expect(req).toContain(ME);
    for (const html of [split, pool, req]) expect(html).not.toMatch(/[\u2014\u2013]/);
  });

  it('split kitty page: progress by person and a chip in card', () => {
    const html = page(base);
    expect(html).toContain('Lisbon weekend');
    expect(html).toContain('Progress by person');
    expect(html).toContain('Chip in');
    expect(html).toContain('Split');
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });

  it('open kitty page: people list, floor and remaining', () => {
    const html = page(open);
    expect(html).toContain('Gift for Sam');
    expect(html).toContain('Open pool');
    expect(html).toContain('1 person chipped in');
    expect(html).toContain('0.390625 USDC');
    expect(html).toContain('Chip in');
  });

  it('labels a payment request and shows the embed card', () => {
    const html = page({ ...open, creator: SELLER, recipient: SELLER });
    expect(html).toContain('Requested by the recipient');
    expect(html).toContain('Add to your site');
    expect(html).toContain('Copy HTML');
  });

  it('ready to pay out: pay out card and the 30-day rule', () => {
    const html = page({ ...base, totalFundedRaw: 100n * U });
    expect(html).toContain('Ready to pay out');
    expect(html).toContain('30 days');
  });

  it('paid out: receipt card', () => {
    const html = page({ ...base, totalFundedRaw: 100n * U, settled: true });
    expect(html).toContain('Paid out');
    expect(html).toContain('Receipt');
    expect(html).toContain('Print receipt');
  });

  it('expired and past the 30-day window: refund', () => {
    const expired = page({ ...base, deadline: NOW - 10n });
    expect(expired).toContain('Get refund');
    expect(expired).toContain('Expired, refunds open');
    const stuck = page({ ...base, totalFundedRaw: 100n * U, deadline: NOW - SETTLE_GRACE_SECONDS - 1n });
    expect(stuck).toContain('Refunds open');
    expect(stuck).toContain('Get refund');
    expect(stuck).not.toContain('>Pay out<');
  });

  it('wrong network and not-invited states', () => {
    expect(page(base, { isCorrectChain: false })).toContain('Wrong network');
    expect(page(base, { connectedAddress: '0x4444444444444444444444444444444444444444' })).toContain('You are not on the list');
  });

  it('my kitties groups cards', () => {
    const mk = (id: string, over: Partial<MineSummary>): MineSummary => ({
      id: `0x${id.repeat(32)}`, ref: `Kitty ${id}`, mode: 'split', creator: ME, recipient: SELLER, goalRaw: 100n * U,
      totalFundedRaw: 0n, deadline: NOW + 1000n, settled: false, cancelled: false, myShareRaw: 0n, myContributedRaw: 0n, myRefunded: false,
      roles: ['Created'], ...over,
    });
    const scan = {
      chainTimestamp: NOW, scannedAt: Date.now(),
      items: [
        mk('01', { myShareRaw: 50n * U }),
        mk('02', { mode: 'open' }),
        mk('03', { settled: true, totalFundedRaw: 100n * U }),
      ],
    };
    const html = renderToString(createElement(MyKitties, {
      me: ME, scan, loading: false, refreshing: false, error: undefined, onRefresh: noop, onNavigate: noop,
    }));
    expect(html).toContain('Needs your action');
    expect(html).toContain('Active');
    expect(html).toContain('Completed');
    expect(html).toContain('Chip in your share');
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });

  it('segmented controls keep their pill inside the control (no shared layout ids)', () => {
    const html = renderToString(createElement(SegmentedTabs, {
      ariaLabel: 'Who chips in', value: 'a', onChange: noop,
      tabs: [{ id: 'a', label: 'Named people' }, { id: 'b', label: 'Open pool' }],
    }));
    expect(html).toContain('data-pill-active="true"');
    expect(html).toContain('relative inline-flex');   // positioned track
    expect(html).toContain('absolute inset-y-1');      // pill sits inside it
    expect(html).not.toContain('layoutId');
  });

  it('my kitties empty state offers the three starts', () => {
    const html = renderToString(createElement(MyKitties, {
      me: ME, scan: { items: [], chainTimestamp: NOW, scannedAt: Date.now() }, loading: false, refreshing: false, error: undefined, onRefresh: noop, onNavigate: noop,
    }));
    expect(html).toContain('No kitties yet');
    expect(html).toContain('Split a bill');
    expect(html).toContain('Request payment');
  });

  it('a new kitty shows the share step first, with chat links and Save as image', () => {
    const html = page(base, { connectedAddress: BOB, justCreated: true });
    expect(html).toContain('Your kitty is live. Send the link.');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Telegram');
    expect(html).toContain('Save as image');
    expect(html).toContain('Dismiss');
    expect(html).toContain('id="share-message"');
  });

  it('the share step also greets the creator, but not a plain contributor, and not once the kitty is closed', () => {
    expect(page(base, { connectedAddress: BOB })).toContain('Your kitty is live. Send the link.');
    expect(page(base, { connectedAddress: ME })).not.toContain('Your kitty is live. Send the link.');
    expect(page({ ...base, deadline: NOW - 10n }, { connectedAddress: BOB, justCreated: true })).not.toContain('Your kitty is live');
  });

  it('what happens next follows the live phase', () => {
    expect(page(base)).toContain('What happens next');
    expect(page(base)).toContain('Chip in until');
    const ready = page({ ...base, totalFundedRaw: 100n * U });
    expect(ready).toContain('Paying out stays open until');
    const expired = page({ ...base, deadline: NOW - 10n });
    expect(expired).toContain('The deadline passed on');
    expect(expired).toContain('Each person can take back what they put in.');
  });

  it('reminders only for people who still owe, and only when the caller may send them', () => {
    const rows = [
      { address: ME, shareRaw: 60n * U, contributedRaw: 60n * U, refunded: false },   // paid
      { address: BOB, shareRaw: 40n * U, contributedRaw: 10n * U, refunded: false },  // partial
      { address: SELLER, shareRaw: 10n * U, contributedRaw: 0n, refunded: false },    // not paid
    ];
    const withRemind = clean(renderToString(createElement(ContributorGrid, {
      contributions: rows, connectedAddress: undefined, remindMessage: () => 'hello',
    })));
    expect(withRemind.match(/>Remind</g)?.length).toBe(2);
    expect(withRemind.match(/>WhatsApp</g)?.length).toBe(2);
    const without = clean(renderToString(createElement(ContributorGrid, { contributions: rows, connectedAddress: undefined })));
    expect(without).not.toContain('>Remind<');
    // The caller's own tile never offers a reminder to themselves.
    const asBob = clean(renderToString(createElement(ContributorGrid, { contributions: rows, connectedAddress: BOB, remindMessage: () => 'hi' })));
    expect(asBob.match(/>Remind</g)?.length).toBe(1);
  });

  it('activity: calm empty state', () => {
    const html = clean(renderToString(createElement(ActivityFeed, {
      items: [], loading: false, error: undefined, me: undefined, explorerBase: 'https://x', onRetry: noop, nowSec: 0,
    })));
    expect(html).toContain('No activity yet. Share the link to get the first chip in.');
  });

  it('not found: calm, with a way home and to the Open tab', () => {
    const html = clean(renderToString(createElement(KittyNotFound, { networkName: 'Arc Testnet', onNavigate: noop })));
    expect(html).toContain('We could not find that kitty');
    expect(html).toContain('Go home');
    expect(html).toContain('Open another kitty');
    expect(html).toContain('Arc Testnet');
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });

  it('avatars: address, initials, "You", and the paid badge', () => {
    const addr = clean(renderToString(createElement(Avatar, { address: ME, size: 24 })));
    expect(addr).toContain('<svg');
    const named = clean(renderToString(createElement(Avatar, { name: 'Ana', size: 32 })));
    expect(named).toContain('>A<');
    expect(named).toContain('font-size:12.8px');
    const you = clean(renderToString(createElement(PersonAvatar, { address: ME, me: ME.toUpperCase().replace('0X', '0x') })));
    expect(you).toContain('>Y<');
    const other = clean(renderToString(createElement(PersonAvatar, { address: ME, me: BOB })));
    expect(other).toContain('<svg');
    expect(clean(renderToString(createElement(Avatar, { name: 'Ana', size: 28, status: 'paid' })))).toContain('M2.4 6.3');
    expect(named).not.toContain('M2.4 6.3');
  });
});
