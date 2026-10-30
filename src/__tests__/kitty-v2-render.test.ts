// ─── Kitty v2 – render smoke tests (server render, no browser) ──────────────
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Home } from '../components/Home';
import { KittyPage, type KittyPageProps } from '../components/KittyPage';
import { FriendChipIn } from '../components/FriendChipIn';
import { ActivityFeed } from '../components/ActivityFeed';
import { LiveStats } from '../components/LiveStats';
import { SellerRequests } from '../components/SellerRequests';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ACTIVE } from '../kitty-config';
import type { ActivityItem, KittyData } from '../kitty-types';
import type { KittyStats, RequestSummary } from '../kitty-requests';

const U = 1_000_000n;
const ME = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const SELLER = '0x3333333333333333333333333333333333333333';
const ID = `0x${'ab'.repeat(32)}` as const;
const NOW = 1_800_000_000n;

const clean = (html: string) => html.replace(/<!-- -->/g, '');
const noop = () => undefined;
const page = (data: KittyData, over: Partial<KittyPageProps> = {}): string =>
  clean(renderToString(createElement(KittyPage, {
    data, dep: ACTIVE, connectedAddress: ME, isCorrectChain: true, onSwitchChain: noop, txStatus: { kind: 'idle' },
    allowanceRaw: 0n, balanceRaw: 100n * U, onRefresh: noop, onChipIn: noop, onCancel: noop, onPayOut: noop, onGetRefund: noop,
    justCreated: false, activity: { items: [], loading: false, error: undefined, retry: noop }, ...over,
  })));

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
const cancelled: KittyData = {
  ...split, cancelled: true,
  contributors: [{ address: ME, shareRaw: 0n, contributedRaw: 20n * U, refunded: false }, { address: BOB, shareRaw: 0n, contributedRaw: 20n * U, refunded: false }],
};

describe('one-tap chip in copy', () => {
  it('says Chip in with the one-signature helper when the allowance is short', () => {
    const html = page(split, { allowanceRaw: 0n });
    expect(html).toContain('One signature, one transaction');
    expect(html).not.toContain('Approve and chip in');
    expect(html).not.toContain('Two steps');
  });
  it('says One transaction when the allowance already covers it', () => {
    const html = page(split, { allowanceRaw: 1_000n * U });
    expect(html).toContain('One transaction');
    expect(html).not.toContain('One signature, one transaction');
  });
  it('offers Pay for someone else on an open kitty and on a split with people who owe', () => {
    expect(page(split)).toContain('Pay for someone else');
    expect(page(open)).toContain('Pay for someone else');
  });
  it('a named person who is already paid up can still cover someone else', () => {
    const paidUp: KittyData = { ...split, contributors: [{ ...split.contributors[0], contributedRaw: 60n * U }, split.contributors[1]] };
    const html = page(paidUp);
    expect(html).toContain('Your share is in');
    expect(html).toContain('Pay for someone else');
  });
});

describe('pay for someone else form', () => {
  const form = (data: KittyData, me = ME) => clean(renderToString(createElement(FriendChipIn, {
    data, me, allowanceRaw: 0n, balanceRaw: 100n * U, txStatus: { kind: 'idle' }, onChipIn: noop, onBack: noop,
  })));

  it('split: lists who owes with the amount left, and warns the refund goes to them', () => {
    const html = form(split);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('0x2222');                       // Bob, not me
    expect(html).not.toContain('0x1111…1111');               // I am excluded
    expect(html).toContain('20.00');                         // Bob's 20 left
    expect(html).toContain('If this kitty is refunded, the money goes to 0x2222');
    expect(html).toContain(', not you.');
    expect(html).toMatch(/Pay for 0x2222/);
    expect(html).toContain('Chip in for myself');
  });

  it('open: asks for an address and shows no warning until one is valid', () => {
    const html = form(open);
    expect(html).toContain("Friend&#x27;s wallet address");
    expect(html).not.toContain('If this kitty is refunded');
    expect(html).toContain('Pay for them');
  });

  it('says so when everyone named has paid', () => {
    const allPaid: KittyData = { ...split, contributors: split.contributors.map(c => ({ ...c, contributedRaw: c.shareRaw })) };
    expect(form(allPaid)).toContain('Everyone named on this kitty has paid their share.');
  });
});

describe('cancel', () => {
  it('the creator and the recipient see Cancel kitty while funding is open', () => {
    expect(page(split, { connectedAddress: BOB })).toContain('Cancel kitty');
    expect(page(split, { connectedAddress: SELLER })).toContain('Cancel kitty');
  });
  it('a contributor who is neither does not', () => {
    expect(page(split, { connectedAddress: ME })).not.toContain('Cancel kitty');
  });
  it('nobody sees it once the kitty is fully funded or after the deadline', () => {
    expect(page({ ...split, totalFundedRaw: 100n * U }, { connectedAddress: BOB })).not.toContain('Cancel kitty');
    expect(page({ ...split, deadline: NOW - 10n }, { connectedAddress: BOB })).not.toContain('Cancel kitty');
  });
  it('a cancelled kitty says Cancelled, offers Get refund at once, and lists the steps', () => {
    const html = page(cancelled, { connectedAddress: ME });
    expect(html).toContain('Cancelled');
    expect(html).toContain('Get refund');
    expect(html).toContain('refunds are open right away');
    expect(html).toContain('The creator or recipient cancelled it');
    expect(html).toContain('Refunds open');
    expect(html).not.toContain('Cancel kitty');
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });
  it('the confirm dialog explains that everyone gets their money back right away', () => {
    const html = clean(renderToString(createElement(ConfirmDialog, {
      title: 'Cancel this kitty?', danger: true, confirmLabel: 'Cancel kitty', cancelLabel: 'Keep kitty', onConfirm: noop, onCancel: noop,
      children: 'Everyone can take their own money back right away.',
    })));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Keep kitty');
    expect(html).toContain('right away');
  });
});

describe('activity feed v2 rows', () => {
  const at = (over: Partial<ActivityItem>): ActivityItem => ({
    kind: 'paidFor', address: ME, other: BOB, amountRaw: 6n * U, blockNumber: 1n, logIndex: 0, txHash: `0x${'01'.repeat(32)}`, timestamp: Number(NOW) - 120, ...over,
  });
  const feed = (items: ActivityItem[], me?: string) => clean(renderToString(createElement(ActivityFeed, {
    items, loading: false, error: undefined, me, explorerBase: ACTIVE.explorerBase, onRetry: noop, nowSec: Number(NOW),
  })));

  it('shows "payer paid for friend" once', () => {
    const html = feed([at({})], BOB);
    expect(html).toContain('paid for');
    expect(html).toContain('0x1111');           // the payer
    expect(html).toContain('you');               // the friend is me
    expect(html).toContain('6.00 USDC');
  });
  it('shows a cancel row', () => {
    expect(feed([at({ kind: 'cancelled', other: undefined, amountRaw: undefined })])).toContain('cancelled the kitty');
  });
  it('keeps the empty-state copy', () => {
    expect(feed([])).toContain('No activity yet. Share the link to get the first chip in.');
  });
});

describe('live stats', () => {
  const stats: KittyStats = {
    created: 12, paidOutRaw: 1_234_500_000n, people: 31,
    recent: [{ id: ID, ref: 'Lisbon weekend', amountRaw: 240n * U, blockNumber: 9n, txHash: `0x${'ee'.repeat(32)}`, timestamp: Number(NOW) - 3_600 }],
  };
  const el = (over: Partial<Parameters<typeof LiveStats>[0]>) => clean(renderToString(createElement(LiveStats, {
    stats, loading: false, failed: false, explorerBase: ACTIVE.explorerBase, onStart: noop, ...over,
  })));

  it('shows the numbers and recent payouts', () => {
    const html = el({});
    for (const t of ['Paid out', 'Kitties started', 'People chipped in', 'Recent payouts', 'Lisbon weekend', '240.00']) expect(html).toContain(t);
    expect(html).toContain(`${ACTIVE.explorerBase}/tx/0x${'ee'.repeat(32)}`);
  });
  it('skeleton while loading', () => {
    const html = el({ stats: undefined, loading: true });
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('Recent payouts');
  });
  it('a fresh deployment invites the first kitty instead of zeros', () => {
    const html = el({ stats: { created: 0, paidOutRaw: 0n, people: 0, recent: [] } });
    expect(html).toContain('Be the first kitty');
    expect(html).not.toContain('Kitties started');
  });
  it('hides quietly on error', () => {
    expect(el({ failed: true, stats: undefined })).toBe('');
  });
  it('is part of Home', () => {
    const html = clean(renderToString(createElement(Home, {
      onNavigate: noop, live: { stats, loading: false, failed: false, explorerBase: ACTIVE.explorerBase },
    })));
    expect(html).toContain('Live on Kitty');
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('seller requests', () => {
  const scan = (items: RequestSummary[]) => ({ items, chainTimestamp: NOW, scannedAt: Date.now() });
  const mk = (id: string, over: Partial<RequestSummary>): RequestSummary => ({
    id: `0x${id.repeat(32)}`, ref: `Invoice ${id}`, goalRaw: 100n * U, totalFundedRaw: 0n, deadline: NOW + 1_000n,
    settled: false, cancelled: false, contributorCount: 0, createdBlock: 1n, ...over,
  });
  const el = (s: ReturnType<typeof scan> | undefined, over: Partial<Parameters<typeof SellerRequests>[0]> = {}) =>
    clean(renderToString(createElement(SellerRequests, {
      me: SELLER, scan: s, loading: false, refreshing: false, error: undefined, onRefresh: noop, onNavigate: noop, ...over,
    })));

  it('empty state offers Request payment', () => {
    const html = el(scan([]));
    expect(html).toContain('No payment requests yet');
    expect(html).toContain('Request payment');
    expect(html).toContain('disabled');   // Export CSV has nothing to export
  });
  it('groups, totals and actions', () => {
    const html = el(scan([
      mk('01', { totalFundedRaw: 40n * U, contributorCount: 3 }),
      mk('02', { settled: true, totalFundedRaw: 100n * U, contributorCount: 5 }),
      mk('03', { cancelled: true }),
    ]));
    for (const t of ['Requested', 'Collected', 'Pending', 'Active', 'Paid', 'Expired or cancelled', 'Export CSV', 'Copy link', 'Copy embed snippet', 'Open', '3 people chipped in', 'Cancelled']) {
      expect(html).toContain(t);
    }
    expect(html).not.toMatch(/[\u2014\u2013]/);
  });
  it('skeleton while loading', () => {
    expect(el(undefined, { loading: true })).toContain('aria-busy="true"');
  });
  it('shows an error with a retry', () => {
    const html = el(undefined, { error: 'rate limited' });
    expect(html).toContain('Could not load your requests.');
    expect(html).toContain('Try again');
  });
});
