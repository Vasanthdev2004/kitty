// ─── PayTogether – polish pass tests ────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { AnimatedAmount } from '../components/AnimatedAmount';
import {
  parseThemeChoice, resolveTheme, nextThemeChoice, THEME_KEY,
} from '../theme';
import {
  toLocalInputValue, presetDeadlineIso, splitIso, joinIso, describeDeadline,
  formatPercent, shortenShareUrl, DEADLINE_PRESETS,
} from '../pt-ui';
import { isoToUnixSeconds } from '../pt-utils';

describe('AnimatedAmount shows the real value with no animation frame', () => {
  const html = (raw: bigint) => renderToString(createElement(AnimatedAmount, { raw }));

  it('renders 0.10 for a settled 0.10 USDC order (the reported bug)', () => {
    const out = html(100_000n);
    expect(out).toContain('aria-label="0.10"');
    expect(out).not.toContain('aria-label="0.00"');
  });
  it('renders the exact target, not zero', () => {
    const out = html(128_500_000n);
    expect(out).toContain('aria-label="128.50"');
  });
  it('renders zero only for a zero amount', () => {
    expect(html(0n)).toContain('aria-label="0.00"');
  });
});

describe('theme helpers', () => {
  it('stores under pt-theme', () => {
    expect(THEME_KEY).toBe('pt-theme');
  });
  it('parses stored values, defaulting to system', () => {
    expect(parseThemeChoice('light')).toBe('light');
    expect(parseThemeChoice('dark')).toBe('dark');
    expect(parseThemeChoice('system')).toBe('system');
    expect(parseThemeChoice(null)).toBe('system');
    expect(parseThemeChoice(undefined)).toBe('system');
    expect(parseThemeChoice('purple')).toBe('system');
  });
  it('resolves system from the OS preference and honors explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('cycles system, light, dark', () => {
    expect(nextThemeChoice('system')).toBe('light');
    expect(nextThemeChoice('light')).toBe('dark');
    expect(nextThemeChoice('dark')).toBe('system');
  });
});

describe('deadline helpers', () => {
  it('formats a local datetime-local value', () => {
    const ms = new Date(2026, 10, 1, 18, 5, 33).getTime();
    expect(toLocalInputValue(ms)).toBe('2026-11-01T18:05');
  });
  it('builds presets in the future, parseable by the form validator', () => {
    const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
    for (const p of DEADLINE_PRESETS) {
      const iso = presetDeadlineIso(p.id, now);
      expect(isoToUnixSeconds(iso)).toBeGreaterThan(Math.floor(now / 1000));
    }
    expect(presetDeadlineIso('24h', now)).toBe('2026-10-30T12:00');
    expect(presetDeadlineIso('3d', now)).toBe('2026-11-01T12:00');
    expect(presetDeadlineIso('1w', now)).toBe('2026-11-05T12:00');
  });
  it('splits and joins date and time', () => {
    expect(splitIso('2026-11-01T18:00')).toEqual({ date: '2026-11-01', time: '18:00' });
    expect(splitIso('')).toEqual({ date: '', time: '' });
    expect(joinIso('2026-11-01', '09:30')).toBe('2026-11-01T09:30');
    expect(joinIso('2026-11-01', '')).toBe('2026-11-01T18:00');
    expect(joinIso('', '09:30')).toBe('');
  });
  it('describes a deadline in plain words', () => {
    const now = Math.floor(new Date(2026, 9, 29, 18, 0, 0).getTime() / 1000);
    const at = Math.floor(new Date(2026, 10, 1, 18, 0, 0).getTime() / 1000);
    const d = describeDeadline(at, now);
    expect(d.when).toBe('Sun, 1 Nov at 6:00 PM');
    expect(d.rel).toBe('in 3 days');
    expect(`Closes ${d.when} (${d.rel})`).not.toMatch(/[\u2014\u2013]/);
  });
  it('says already passed for past deadlines', () => {
    expect(describeDeadline(1000, 2000).rel).toBe('already passed');
  });
});

describe('display helpers', () => {
  it('formats percents', () => {
    expect(formatPercent(33.3)).toBe('33.3%');
    expect(formatPercent(50)).toBe('50%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(100)).toBe('100%');
  });
  it('shortens a share URL in the middle and drops the protocol', () => {
    const id = '0xbda9425ce58ad49f2bb13b6f1cb7e94f949a6c60e943979e47d4a2f3bce9e300';
    expect(shortenShareUrl(`http://localhost:5173/?order=${id}`)).toBe('localhost:5173/?order=0xbda9\u2026e300');
    expect(shortenShareUrl(`https://studio.arc.io/share/ab?order=${id}`)).toBe('studio.arc.io/share/ab?order=0xbda9\u2026e300');
  });
  it('leaves URLs without an order ID alone', () => {
    expect(shortenShareUrl('https://x.test/path')).toBe('x.test/path');
  });
});
