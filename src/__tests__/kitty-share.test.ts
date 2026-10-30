// ─── Share messages, chat links, timeline, busy wording ─────────────────────
import { describe, it, expect } from 'vitest';
import {
  canRemind, cardImageModel, dismissShareStep, isShareStepDismissed, openMessage, remindMessageFor, requestMessage,
  safeEncode, shareMessageFor, splitGroupMessage, splitMessage, telegramUrl, truncateText, whatsappUrl,
} from '../share-messages';
import { SETTLE_GRACE_SECONDS, busyLabel, relativeTo, timelineSteps } from '../kitty-core';
import { formatDeadline } from '../pt-utils';
import type { KittyData } from '../kitty-types';

const U = 1_000_000n;
const ME = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const SELLER = '0x3333333333333333333333333333333333333333';
const LINK = `https://kitty.example/?kitty=0x${'ab'.repeat(32)}`;
const NOW = 1_800_000_000n;
const DEADLINE = NOW + 3n * 86_400n;

const split: KittyData = {
  id: `0x${'ab'.repeat(32)}`, creator: BOB, recipient: SELLER, goalRaw: 100n * U, deadline: DEADLINE, ref: 'Lisbon weekend',
  mode: 'split', settled: false, cancelled: false, totalFundedRaw: 40n * U, minContributionRaw: 0n, effectiveMinRaw: 0n, chainTimestamp: NOW,
  contributors: [
    { address: ME, shareRaw: 60n * U, contributedRaw: 20n * U, refunded: false },
    { address: BOB, shareRaw: 40n * U, contributedRaw: 20n * U, refunded: false },
  ],
};
const open: KittyData = {
  ...split, mode: 'open', ref: 'Gift for Sam', effectiveMinRaw: 390_625n,
  contributors: [{ address: BOB, shareRaw: 0n, contributedRaw: 40n * U, refunded: false }],
};
const dl = formatDeadline(DEADLINE);

describe('safeEncode', () => {
  it('percent-encodes emoji as UTF-8', () => {
    expect(safeEncode('\u{1F3D6}')).toBe('%F0%9F%8F%96');
    expect(decodeURIComponent(safeEncode('Trip \u{1F3D6}\uFE0F to Lisbon'))).toBe('Trip \u{1F3D6}\uFE0F to Lisbon');
  });
  it('encodes & # ? = and spaces so they cannot break the query', () => {
    expect(safeEncode('a&b#c?d=e f')).toBe('a%26b%23c%3Fd%3De%20f');
  });
  it('encodes newlines, normalising CRLF', () => {
    expect(safeEncode('one\ntwo')).toBe('one%0Atwo');
    expect(safeEncode('one\r\ntwo\rthree')).toBe('one%0Atwo%0Athree');
  });
  it('never throws on a lone surrogate (half an emoji)', () => {
    expect(() => safeEncode('bad \uD83D end')).not.toThrow();
    expect(safeEncode('x\uD83Dy')).toBe('x%EF%BF%BDy');
    expect(safeEncode('x\uDC00y')).toBe('x%EF%BF%BDy');
    expect(() => encodeURIComponent('x\uD83Dy')).toThrow(); // the thing we are protecting against
  });
});

describe('chat links', () => {
  it('WhatsApp: wa.me with the whole message in text', () => {
    const msg = 'Trip \u{1F3D6}\uFE0F & friends #1\nPay: ' + LINK;
    const url = whatsappUrl(msg);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(new URL(url).searchParams.get('text')).toBe(msg);
  });
  it('Telegram: link in url, message without the link in text', () => {
    const msg = splitMessage({ ref: 'Trip & fun #1', amountText: '25.00', deadlineText: dl, link: LINK });
    const u = new URL(telegramUrl(msg, LINK));
    expect(u.origin + u.pathname).toBe('https://t.me/share/url');
    expect(u.searchParams.get('url')).toBe(LINK);
    const text = u.searchParams.get('text') ?? '';
    expect(text).toBe(`Your share for Trip & fun #1 is 25.00 USDC. Chip in before ${dl}`);
    expect(text).not.toContain(LINK);
  });
  it('Telegram: if the user deleted the link from the text, the whole text is kept', () => {
    const u = new URL(telegramUrl('Hello \u{1F600} & bye', LINK));
    expect(u.searchParams.get('text')).toBe('Hello \u{1F600} & bye');
    expect(u.searchParams.get('url')).toBe(LINK);
  });
});

describe('message templates', () => {
  it('split', () => {
    expect(splitMessage({ ref: 'Lisbon weekend', amountText: '25.00', deadlineText: 'Nov 5', link: LINK }))
      .toBe(`Your share for Lisbon weekend is 25.00 USDC. Chip in before Nov 5: ${LINK}`);
  });
  it('open', () => {
    expect(openMessage({ ref: 'Gift for Sam', remainingText: '60.00', floorText: '0.390625', deadlineText: 'Nov 5', link: LINK }))
      .toBe(`Chipping in for Gift for Sam. 60.00 USDC to go, minimum 0.390625 USDC, by Nov 5: ${LINK}`);
  });
  it('payment request', () => {
    expect(requestMessage({ ref: 'Invoice 42', goalText: '240.00', link: LINK }))
      .toBe(`Invoice 42: 240.00 USDC requested, split it with friends: ${LINK}`);
  });
  it('split kitty with no known share falls back to a group message', () => {
    expect(splitGroupMessage({ ref: 'Trip', deadlineText: 'Nov 5', link: LINK }))
      .toBe(`Chip in for Trip before Nov 5. Your share is on the page: ${LINK}`);
  });
  it('shareMessageFor picks the right template', () => {
    expect(shareMessageFor(split, LINK, ME)).toBe(`Your share for Lisbon weekend is 60.00 USDC. Chip in before ${dl}: ${LINK}`);
    expect(shareMessageFor(split, LINK, '0x4444444444444444444444444444444444444444')).toContain('Your share is on the page');
    expect(shareMessageFor(open, LINK, ME)).toBe(`Chipping in for Gift for Sam. 60.00 USDC to go, minimum 0.390625 USDC, by ${dl}: ${LINK}`);
    expect(shareMessageFor({ ...open, creator: SELLER, recipient: SELLER }, LINK, ME)).toBe(`Gift for Sam: 100.00 USDC requested, split it with friends: ${LINK}`);
  });
  it('has no dashes', () => {
    for (const m of [shareMessageFor(split, LINK, ME), shareMessageFor(open, LINK), splitGroupMessage({ ref: 'x', deadlineText: dl, link: LINK })]) {
      expect(m).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe('remind', () => {
  it('carries the exact remaining share of that person', () => {
    expect(remindMessageFor(split, 60n * U, 20n * U, LINK)).toBe(`Your share for Lisbon weekend is 40.00 USDC. Chip in before ${dl}: ${LINK}\nOr anyone can pay it for you.`);
    expect(remindMessageFor(split, 25n * U + 500_000n, 0n, LINK)).toContain('25.50 USDC');
  });
  it('is for the creator and the recipient only', () => {
    expect(canRemind(split, BOB)).toBe(true);        // creator
    expect(canRemind(split, SELLER)).toBe(true);     // recipient
    expect(canRemind(split, ME)).toBe(false);        // a contributor
    expect(canRemind(split, undefined)).toBe(false);
    expect(canRemind(split, BOB.toUpperCase().replace('0X', '0x'))).toBe(true);
  });
});

describe('share step memory', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('is remembered per kitty and per chain', () => {
    const s = mem();
    expect(isShareStepDismissed(5042002, split.id, s)).toBe(false);
    dismissShareStep(5042002, split.id, s);
    expect(isShareStepDismissed(5042002, split.id, s)).toBe(true);
    expect(isShareStepDismissed(5042002, `0x${'cd'.repeat(32)}`, s)).toBe(false);
    expect(isShareStepDismissed(5042, split.id, s)).toBe(false);
  });
  it('survives blocked storage', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => dismissShareStep(1, 'x', bad)).not.toThrow();
    expect(isShareStepDismissed(1, 'x', bad)).toBe(false);
    expect(isShareStepDismissed(1, 'x', undefined)).toBe(false);
  });
});

describe('card image text', () => {
  it('truncates by code point and keeps the full title', () => {
    expect(truncateText('short', 10)).toBe('short');
    expect(truncateText('abcdefghij', 5)).toBe('abcd\u2026');
    const emoji = '\u{1F3D6}'.repeat(8);
    expect(truncateText(emoji, 4)).toBe('\u{1F3D6}\u{1F3D6}\u{1F3D6}\u2026');
  });
  it('summarises progress', () => {
    const m = cardImageModel({ ...split, ref: 'x'.repeat(60) });
    expect(m.title.length).toBeLessThanOrEqual(36);
    expect(m.fullTitle).toHaveLength(60);
    expect(m.amountLine).toBe('40.00 of 100.00 USDC');
    expect(m.percent).toBe(40);
    expect(m.kindLabel).toBe('Split');
    expect(cardImageModel({ ...open, creator: SELLER, recipient: SELLER }).kindLabel).toBe('Payment request');
  });
});

describe('timeline', () => {
  const steps = (phase: Parameters<typeof timelineSteps>[0]['phase']) => timelineSteps({ phase, deadline: DEADLINE, now: NOW });
  const states = (phase: Parameters<typeof timelineSteps>[0]['phase']) => steps(phase).map(s => s.state);

  it('open: funding is current, then paid out or refunds', () => {
    expect(states('open')).toEqual(['current', 'upcoming', 'upcoming']);
    expect(steps('open')[0].text).toContain(`Chip in until ${dl} (in 3 days)`);
  });
  it('ready: shows when the 30-day pay-out window ends', () => {
    expect(states('ready')).toEqual(['past', 'current', 'upcoming']);
    expect(steps('ready')[1].text).toContain(formatDeadline(DEADLINE + SETTLE_GRACE_SECONDS));
    expect(steps('ready')[1].text).toContain('in 33 days');
  });
  it('paid, expired and stuck', () => {
    expect(states('paid')).toEqual(['past', 'current', 'skipped']);
    expect(states('expired')).toEqual(['past', 'skipped', 'current']);
    expect(states('stuck')).toEqual(['past', 'skipped', 'current']);
    expect(steps('stuck')[1].text).toContain('nobody did it in time');
  });
  it('past dates read as "ago"', () => {
    const t = timelineSteps({ phase: 'expired', deadline: NOW - 2n * 86_400n, now: NOW });
    expect(t[0].text).toContain('2 days ago');
  });
  it('titles and copy have no dashes', () => {
    for (const ph of ['open', 'ready', 'paid', 'expired', 'stuck'] as const) {
      expect(JSON.stringify(steps(ph))).not.toMatch(/[\u2013\u2014]/);
    }
  });
  it('relativeTo', () => {
    expect(relativeTo(NOW, NOW + 7200n)).toBe('in 2 hours');
    expect(relativeTo(NOW, NOW - 7200n)).toBe('2 hours ago');
  });
});

describe('busyLabel', () => {
  const h = `0x${'1'.repeat(64)}` as const;
  it('names the step that is happening', () => {
    expect(busyLabel({ kind: 'wallet-pending', label: 'Approve USDC' })).toBe('Approving USDC');
    expect(busyLabel({ kind: 'wallet-pending', label: 'Chip in' })).toBe('Chipping in');
    expect(busyLabel({ kind: 'wallet-pending', label: 'Pay out' })).toBe('Paying out');
    expect(busyLabel({ kind: 'wallet-pending', label: 'Something else' })).toBe('Waiting for wallet');
    expect(busyLabel({ kind: 'submitted', hash: h, label: 'Approve USDC' })).toBe('Confirming approval');
    expect(busyLabel({ kind: 'confirming', hash: h, label: 'Chip in' })).toBe('Confirming');
    expect(busyLabel({ kind: 'uncertain', hash: h, label: 'Chip in', reason: 'x' })).toBe('Pending');
  });
});
