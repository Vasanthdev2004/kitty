// ─── PayTogether – UI helper tests ──────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  plain, hashString, avatarColors, parseOrderInput,
  segmentWidths, segmentFillPct, splitEvenly,
  splitCountdown, relativeFromNow, STATUS_PILL, rawToDisplayNumber,
  actionKind, actionHasDock,
} from '../pt-ui';

const ID = '0x' + 'ab'.repeat(32);
const U = 1_000_000n;

describe('plain', () => {
  it('replaces em and en dashes with a comma', () => {
    expect(plain('Receipt lookup timed out \u2014 transaction may still confirm.')).toBe(
      'Receipt lookup timed out, transaction may still confirm.',
    );
    expect(plain('a\u2013b')).toBe('a, b');
  });
  it('leaves clean text and hyphens alone', () => {
    expect(plain('INV-2026-001')).toBe('INV-2026-001');
  });
});

describe('avatarColors', () => {
  const A = '0x1111111111111111111111111111111111111111';
  const B = '0x2222222222222222222222222222222222222222';
  it('is deterministic', () => {
    expect(avatarColors(A)).toEqual(avatarColors(A));
  });
  it('is case-insensitive', () => {
    const mixed = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    expect(avatarColors(mixed)).toEqual(avatarColors(mixed.toLowerCase()));
    expect(hashString(mixed)).toBe(hashString(mixed.toLowerCase()));
  });
  it('differs between addresses', () => {
    expect(avatarColors(A).from).not.toBe(avatarColors(B).from);
  });
  it('gives two different tones', () => {
    const c = avatarColors(A);
    expect(c.from).not.toBe(c.to);
    expect(c.hueA).not.toBe(c.hueB);
  });
  it('never uses the violet / magenta hue band', () => {
    for (let i = 0; i < 400; i++) {
      const c = avatarColors(`0x${i.toString(16).padStart(40, '0')}`);
      expect(c.hueA).toBeGreaterThanOrEqual(0);
      expect(c.hueA).toBeLessThan(255);
      expect(c.hueB).toBeGreaterThanOrEqual(0);
      expect(c.hueB).toBeLessThan(255);
    }
  });
});

describe('parseOrderInput', () => {
  it('accepts a bare order ID', () => {
    expect(parseOrderInput(ID)).toEqual({ kind: 'valid', orderId: ID });
    expect(parseOrderInput(`  ${ID}  `)).toEqual({ kind: 'valid', orderId: ID });
  });
  it('extracts the ID from a full share URL', () => {
    expect(parseOrderInput(`https://app.example/?order=${ID}`)).toEqual({ kind: 'valid', orderId: ID });
    expect(parseOrderInput(`https://app.example/x?a=1&order=${ID}#top`)).toEqual({ kind: 'valid', orderId: ID });
  });
  it('accepts query fragments', () => {
    expect(parseOrderInput(`?order=${ID}`)).toEqual({ kind: 'valid', orderId: ID });
    expect(parseOrderInput(`order=${ID}`)).toEqual({ kind: 'valid', orderId: ID });
  });
  it('reports empty input', () => {
    expect(parseOrderInput('')).toEqual({ kind: 'empty' });
    expect(parseOrderInput('   ')).toEqual({ kind: 'empty' });
  });
  it('rejects malformed IDs and URLs without a valid order param', () => {
    expect(parseOrderInput('0x1234')).toEqual({ kind: 'invalid' });
    expect(parseOrderInput('hello world')).toEqual({ kind: 'invalid' });
    expect(parseOrderInput('https://app.example/?order=0x12')).toEqual({ kind: 'invalid' });
    expect(parseOrderInput('https://app.example/')).toEqual({ kind: 'invalid' });
  });
});

describe('segmentWidths', () => {
  it('is proportional to share', () => {
    expect(segmentWidths([25n * U, 25n * U, 50n * U])).toEqual([25, 25, 50]);
  });
  it('always sums to exactly 100', () => {
    for (const shares of [[1n, 1n, 1n], [10n * U, 3n * U, 7n * U], [1n, 999_999n], [5n, 5n, 5n, 5n, 5n, 5n, 5n]]) {
      const sum = segmentWidths(shares).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 100) / 100).toBe(100);
    }
  });
  it('handles empty and zero totals', () => {
    expect(segmentWidths([])).toEqual([]);
    expect(segmentWidths([0n, 0n])).toEqual([0, 0]);
  });
  it('gives a single contributor the whole bar', () => {
    expect(segmentWidths([40n * U])).toEqual([100]);
  });
});

describe('segmentFillPct', () => {
  it('is the contributed ratio, floored to one decimal', () => {
    expect(segmentFillPct(0n, 10n * U)).toBe(0);
    expect(segmentFillPct(5n * U, 10n * U)).toBe(50);
    expect(segmentFillPct(1n * U, 3n * U)).toBe(33.3);
    expect(segmentFillPct(9_999_999n, 10n * U)).toBe(99.9);
  });
  it('clamps over-contribution and ignores zero shares', () => {
    expect(segmentFillPct(12n * U, 10n * U)).toBe(100);
    expect(segmentFillPct(5n * U, 0n)).toBe(0);
  });
});

describe('splitEvenly', () => {
  it('splits exactly when divisible', () => {
    expect(splitEvenly(100n * U, 4)).toEqual([25n * U, 25n * U, 25n * U, 25n * U]);
  });
  it('splits in whole cents and gives the remainder to the first people', () => {
    const out = splitEvenly(100n * U, 3);
    expect(out).toEqual([33_340_000n, 33_330_000n, 33_330_000n]);
    expect(out.reduce((a, b) => a + b, 0n)).toBe(100n * U);
  });
  it('falls back to raw units for sub-cent targets and still sums exactly', () => {
    const out = splitEvenly(10n, 3);
    expect(out).toEqual([4n, 3n, 3n]);
    expect(out.reduce((a, b) => a + b, 0n)).toBe(10n);
  });
  it('returns nothing for invalid input', () => {
    expect(splitEvenly(0n, 3)).toEqual([]);
    expect(splitEvenly(10n * U, 0)).toEqual([]);
  });
});

describe('countdown parts and relative time', () => {
  it('splits seconds into parts', () => {
    expect(splitCountdown(2 * 86400 + 3 * 3600 + 15 * 60 + 9)).toEqual({ days: 2, hours: 3, mins: 15, secs: 9, done: false });
  });
  it('is done at zero, negative and non-finite', () => {
    expect(splitCountdown(0).done).toBe(true);
    expect(splitCountdown(-5).done).toBe(true);
    expect(splitCountdown(NaN).done).toBe(true);
  });
  it('describes deadlines in plain words', () => {
    expect(relativeFromNow(3 * 86400 + 100)).toBe('in 3 days');
    expect(relativeFromNow(86400)).toBe('in 1 day');
    expect(relativeFromNow(5 * 3600)).toBe('in 5 hours');
    expect(relativeFromNow(12 * 60)).toBe('in 12 minutes');
    expect(relativeFromNow(20)).toBe('in under a minute');
    expect(relativeFromNow(-1)).toBe('already passed');
  });
});

describe('status copy', () => {
  it('has no dashes in any visible label', () => {
    for (const v of Object.values(STATUS_PILL)) {
      expect(v.label).not.toMatch(/[\u2014\u2013]/);
    }
  });
  it('uses the agreed labels', () => {
    expect(STATUS_PILL['open'].label).toBe('Open');
    expect(STATUS_PILL['funded-unsettled'].label).toBe('Ready to settle');
    expect(STATUS_PILL['funded-settled'].label).toBe('Settled');
    expect(STATUS_PILL['expired-incomplete'].label).toBe('Expired, refunds open');
  });
});

describe('rawToDisplayNumber', () => {
  it('converts 6-decimal raw to a display number', () => {
    expect(rawToDisplayNumber(128_500_000n)).toBe(128.5);
    expect(rawToDisplayNumber(0n)).toBe(0);
  });
});


describe('actionKind', () => {
  const mine = (share: bigint, contributed: bigint, refunded = false) => ({ shareRaw: share, contributedRaw: contributed, refunded });
  const base = { connected: true, correctChain: true } as const;

  it('asks to connect, then to switch chain', () => {
    expect(actionKind({ connected: false, correctChain: false, status: 'open' })).toBe('connect');
    expect(actionKind({ connected: true, correctChain: false, status: 'open' })).toBe('switch');
  });
  it('open: fund while a share remains, otherwise nothing to do', () => {
    expect(actionKind({ ...base, status: 'open', my: mine(10n * U, 4n * U) })).toBe('fund');
    expect(actionKind({ ...base, status: 'open', my: mine(10n * U, 10n * U) })).toBe('share-paid');
    expect(actionKind({ ...base, status: 'open' })).toBe('not-listed');
  });
  it('funded and unsettled: anyone can settle', () => {
    expect(actionKind({ ...base, status: 'funded-unsettled' })).toBe('settle');
    expect(actionKind({ ...base, status: 'funded-unsettled', my: mine(1n, 1n) })).toBe('settle');
  });
  it('settled is informational', () => {
    expect(actionKind({ ...base, status: 'funded-settled' })).toBe('settled');
  });
  it('expired: refund only for a contributor who paid and has not been refunded', () => {
    expect(actionKind({ ...base, status: 'expired-incomplete', my: mine(10n * U, 4n * U) })).toBe('refund');
    expect(actionKind({ ...base, status: 'expired-incomplete', my: mine(10n * U, 4n * U, true) })).toBe('refunded');
    expect(actionKind({ ...base, status: 'expired-incomplete', my: mine(10n * U, 0n) })).toBe('no-contribution');
    expect(actionKind({ ...base, status: 'expired-incomplete' })).toBe('not-listed');
  });
  it('only transaction cards dock to the bottom on mobile', () => {
    expect(actionHasDock('fund')).toBe(true);
    expect(actionHasDock('settle')).toBe(true);
    expect(actionHasDock('refund')).toBe(true);
    expect(actionHasDock('connect')).toBe(false);
    expect(actionHasDock('settled')).toBe(false);
  });
});
