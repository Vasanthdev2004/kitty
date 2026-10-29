// ─── PayTogether – share & progress helper tests ────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  isValidOrderId, parseOrderParam, withOrderParam, buildShareUrl,
  formatUsdcPlain, buildNudgeMessage, fundedPercent, progressLabel,
  contributorStatus, paidCount, paidSummary,
  chainOffsetSeconds, estimateChainNow, formatCountdown, LIFECYCLE_LABEL,
} from '../pt-share';
import { orderStatus } from '../pt-utils';

const ID = '0x' + 'ab'.repeat(32);
const U = 1_000_000n; // 1 USDC

describe('orderId param parsing', () => {
  it('accepts 0x + 64 hex (any case)', () => {
    expect(isValidOrderId(ID)).toBe(true);
    expect(isValidOrderId('0x' + 'AB'.repeat(32))).toBe(true);
  });
  it('rejects wrong length, missing prefix, non-hex', () => {
    expect(isValidOrderId('0x' + 'ab'.repeat(31))).toBe(false);
    expect(isValidOrderId('0x' + 'ab'.repeat(33))).toBe(false);
    expect(isValidOrderId('ab'.repeat(32))).toBe(false);
    expect(isValidOrderId('0x' + 'zz'.repeat(32))).toBe(false);
    expect(isValidOrderId('')).toBe(false);
  });
  it('parses ?order= when valid', () => {
    expect(parseOrderParam(`?order=${ID}`)).toEqual({ kind: 'valid', orderId: ID });
    expect(parseOrderParam(`?x=1&order=${ID}`)).toEqual({ kind: 'valid', orderId: ID });
  });
  it('trims whitespace around the value', () => {
    expect(parseOrderParam(`?order=%20${ID}%20`)).toEqual({ kind: 'valid', orderId: ID });
  });
  it('returns none when absent or blank', () => {
    expect(parseOrderParam('')).toEqual({ kind: 'none' });
    expect(parseOrderParam('?foo=bar')).toEqual({ kind: 'none' });
    expect(parseOrderParam('?order=')).toEqual({ kind: 'none' });
  });
  it('returns invalid for malformed values (never loaded)', () => {
    expect(parseOrderParam('?order=0x1234')).toEqual({ kind: 'invalid', raw: '0x1234' });
    expect(parseOrderParam('?order=hello').kind).toBe('invalid');
  });
  it('withOrderParam sets order and preserves other params and hash', () => {
    expect(withOrderParam('/', '', '', ID)).toBe(`/?order=${ID}`);
    expect(withOrderParam('/app', '?a=1', '#h', ID)).toBe(`/app?a=1&order=${ID}#h`);
  });
  it('withOrderParam replaces an existing order param', () => {
    const other = '0x' + 'cd'.repeat(32);
    expect(withOrderParam('/', `?order=${other}`, '', ID)).toBe(`/?order=${ID}`);
  });
});

describe('buildShareUrl', () => {
  it('appends ?order= to the base', () => {
    expect(buildShareUrl('https://app.example', ID)).toBe(`https://app.example/?order=${ID}`);
  });
  it('trims trailing slashes on the base', () => {
    expect(buildShareUrl('https://app.example/', ID)).toBe(`https://app.example/?order=${ID}`);
    expect(buildShareUrl('https://app.example/sub//', ID)).toBe(`https://app.example/sub/?order=${ID}`);
  });
  it('round-trips through parseOrderParam', () => {
    const url = new URL(buildShareUrl('https://app.example', ID));
    expect(parseOrderParam(url.search)).toEqual({ kind: 'valid', orderId: ID });
  });
});

describe('formatUsdcPlain / nudge message', () => {
  it('strips decoration', () => {
    expect(formatUsdcPlain(25n * U)).toBe('25.00');
    expect(formatUsdcPlain(1_234_500_000n)).toBe('1,234.50');
  });
  it('uses the contributor share when provided', () => {
    const msg = buildNudgeMessage({
      ref: 'Team lunch', shareRaw: 25n * U, targetRaw: 100n * U,
      deadlineText: 'Nov 1, 2026, 5:00 PM', link: 'https://x.test/?order=1',
    });
    expect(msg).toBe(
      "You're in on Team lunch: your share is 25.00 USDC, deadline Nov 1, 2026, 5:00 PM. Pay here: https://x.test/?order=1",
    );
  });
  it('uses a generic message when not a contributor', () => {
    const msg = buildNudgeMessage({
      ref: 'Team lunch', targetRaw: 100n * U, deadlineText: 'Nov 1', link: 'https://x.test/?order=1',
    });
    expect(msg).toContain("You're in on Team lunch");
    expect(msg).toContain('100.00 USDC total');
    expect(msg).not.toContain('your share is');
    expect(msg.endsWith('Pay here: https://x.test/?order=1')).toBe(true);
  });
  it('treats a zero share as a real share, not as generic', () => {
    const msg = buildNudgeMessage({ ref: 'r', shareRaw: 0n, targetRaw: U, deadlineText: 'd', link: 'l' });
    expect(msg).toContain('your share is 0.00 USDC');
  });
});

describe('progress', () => {
  it('fundedPercent floors to one decimal and clamps', () => {
    expect(fundedPercent(0n, 100n * U)).toBe(0);
    expect(fundedPercent(50n * U, 100n * U)).toBe(50);
    expect(fundedPercent(1n * U, 3n * U)).toBe(33.3);
    expect(fundedPercent(99_999_999n, 100n * U)).toBe(99.9); // never rounds up to 100
    expect(fundedPercent(150n * U, 100n * U)).toBe(100);
  });
  it('fundedPercent is 0 for a zero target', () => {
    expect(fundedPercent(10n * U, 0n)).toBe(0);
  });
  it('progressLabel reads "<funded> of <target> USDC"', () => {
    expect(progressLabel(75n * U, 100n * U)).toBe('75.00 of 100.00 USDC');
  });
});

describe('contributorStatus', () => {
  const c = (share: bigint, contributed: bigint, refunded = false) => ({ shareRaw: share, contributedRaw: contributed, refunded });
  it('paid when contributed == share', () => {
    expect(contributorStatus(c(25n * U, 25n * U))).toBe('paid');
  });
  it('partial when 0 < contributed < share', () => {
    expect(contributorStatus(c(25n * U, 10n * U))).toBe('partial');
  });
  it('not-paid when nothing contributed', () => {
    expect(contributorStatus(c(25n * U, 0n))).toBe('not-paid');
  });
  it('refunded wins over everything else', () => {
    expect(contributorStatus(c(25n * U, 25n * U, true))).toBe('refunded');
    expect(contributorStatus(c(25n * U, 0n, true))).toBe('refunded');
  });
  it('a zero share with nothing contributed is not "paid"', () => {
    expect(contributorStatus(c(0n, 0n))).toBe('not-paid');
  });
  it('counts only fully paid contributors', () => {
    const list = [c(10n * U, 10n * U), c(10n * U, 5n * U), c(10n * U, 0n), c(10n * U, 10n * U, true), c(10n * U, 10n * U)];
    expect(paidCount(list)).toBe(2);
    expect(paidSummary(list)).toBe('2 of 5 paid');
    expect(paidSummary([])).toBe('0 of 0 paid');
  });
});

describe('countdown', () => {
  it('formats days, hours, minutes', () => {
    expect(formatCountdown(2 * 86400 + 3 * 3600 + 15 * 60 + 59)).toBe('2d 3h 15m');
  });
  it('drops days under 24h', () => {
    expect(formatCountdown(3 * 3600 + 5 * 60)).toBe('3h 5m');
  });
  it('shows seconds under an hour', () => {
    expect(formatCountdown(12 * 60 + 5)).toBe('12m 05s');
    expect(formatCountdown(7)).toBe('0m 07s');
  });
  it('reports a passed deadline for zero, negative or non-finite input', () => {
    expect(formatCountdown(0)).toBe('Deadline passed');
    expect(formatCountdown(-30)).toBe('Deadline passed');
    expect(formatCountdown(NaN)).toBe('Deadline passed');
  });
  it('estimates chain time from the offset captured at read time', () => {
    const readAt = 1_800_000_000_000; // ms
    const chainTs = 1_800_000_100n;   // chain is 100s ahead of local clock
    const off = chainOffsetSeconds(chainTs, readAt);
    expect(off).toBe(100);
    expect(estimateChainNow(off, readAt)).toBe(chainTs);
    expect(estimateChainNow(off, readAt + 30_000)).toBe(chainTs + 30n);
  });
});

describe('lifecycle labels', () => {
  const now = 1000n;
  it('maps each state to its label', () => {
    expect(LIFECYCLE_LABEL[orderStatus(false, 0n, 10n, 2000n, now)]).toBe('Open');
    expect(LIFECYCLE_LABEL[orderStatus(false, 10n, 10n, 2000n, now)]).toBe('Fully funded — ready to settle');
    expect(LIFECYCLE_LABEL[orderStatus(true, 10n, 10n, 2000n, now)]).toBe('Settled (paid to merchant)');
    expect(LIFECYCLE_LABEL[orderStatus(false, 5n, 10n, 1000n, now)]).toBe('Expired — refunds open');
  });
  it('flips from Open to Expired as the estimated chain clock crosses the deadline', () => {
    const deadline = 2000n;
    expect(orderStatus(false, 5n, 10n, deadline, 1999n)).toBe('open');
    expect(orderStatus(false, 5n, 10n, deadline, 2000n)).toBe('expired-incomplete');
  });
});
