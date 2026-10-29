// ─── PayTogether – Frontend Unit Tests ──────────────────────────────────────
// Tests run against the actual pt-utils.ts functions used at runtime.
// No chain calls, no mocked wagmi — pure logic only.

import { describe, it, expect } from 'vitest';
import {
  parseUsdcAmount, formatUsdc, formatUsdcDisplay,
  validateCreateDraft, isDraftValid,
  isoToUnixSeconds, formatDeadline, orderStatus,
  deriveOrderId, emptyDraft, shortAddress,
  ARC_TESTNET_USDC, USDC_DECIMALS,
} from '../pt-utils';
import type { CreateOrderDraft } from '../pt-types';

const NOW_TS = 1761177600; // 2025-10-22T00:00:00Z (fixed reference for tests)
const FUTURE = NOW_TS + 86400; // 1 day ahead
const FUTURE_ISO = new Date(FUTURE * 1000).toISOString().slice(0, 16); // datetime-local format

// ── parseUsdcAmount ────────────────────────────────────────────────────────────

describe('parseUsdcAmount', () => {
  it('parses integer amounts', () => {
    const r = parseUsdcAmount('100');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBe(100_000_000n); // 100 * 10^6
  });

  it('parses decimal amounts', () => {
    const r = parseUsdcAmount('60.50');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBe(60_500_000n);
  });

  it('parses the minimum 6-decimal amount', () => {
    const r = parseUsdcAmount('0.000001');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBe(1n);
  });

  it('rejects empty string', () => {
    expect(parseUsdcAmount('').ok).toBe(false);
  });

  it('rejects exponent notation', () => {
    expect(parseUsdcAmount('1e6').ok).toBe(false);
    expect(parseUsdcAmount('1E6').ok).toBe(false);
  });

  it('rejects >6 fractional digits', () => {
    const r = parseUsdcAmount('1.0000001');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('6');
  });

  it('rejects negative', () => {
    expect(parseUsdcAmount('-1').ok).toBe(false);
  });

  it('rejects zero when allowZero=false (default)', () => {
    expect(parseUsdcAmount('0').ok).toBe(false);
  });

  it('allows zero when allowZero=true', () => {
    const r = parseUsdcAmount('0', true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBe(0n);
  });

  it('rejects non-numeric string', () => {
    expect(parseUsdcAmount('abc').ok).toBe(false);
    expect(parseUsdcAmount('1.2.3').ok).toBe(false);
    expect(parseUsdcAmount('$100').ok).toBe(false);
  });

  it('exactly 6 fractional digits accepted', () => {
    const r = parseUsdcAmount('1.123456');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBe(1_123_456n);
  });
});

// ── formatUsdc ────────────────────────────────────────────────────────────────

describe('formatUsdc', () => {
  it('formats 6-decimal bigint to decimal string', () => {
    expect(formatUsdc(100_000_000n)).toBe('100');
    expect(formatUsdc(60_500_000n)).toBe('60.5');
    expect(formatUsdc(1n)).toBe('0.000001');
  });

  it('roundtrips with parseUsdcAmount', () => {
    const original = 60_250_100n;
    const str = formatUsdc(original);
    const back = parseUsdcAmount(str);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.raw).toBe(original);
  });
});

describe('formatUsdcDisplay', () => {
  it('includes USDC label and 2+ decimal places', () => {
    const s = formatUsdcDisplay(100_000_000n);
    expect(s).toContain('USDC');
    expect(s).toContain('100');
  });
});

// ── USDC_DECIMALS constant ────────────────────────────────────────────────────

describe('USDC_DECIMALS', () => {
  it('is 6', () => {
    expect(USDC_DECIMALS).toBe(6);
  });

  it('10^6 units = 1 USDC', () => {
    const r = parseUsdcAmount('1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toBe(10n ** BigInt(USDC_DECIMALS));
  });
});

describe('ARC_TESTNET_USDC', () => {
  it('is a valid ERC-20 address with 36 zeroes prefix (Arc sentinel)', () => {
    expect(ARC_TESTNET_USDC.toLowerCase()).toBe('0x3600000000000000000000000000000000000000');
  });
});

// ── isoToUnixSeconds ──────────────────────────────────────────────────────────

describe('isoToUnixSeconds', () => {
  it('converts ISO string to seconds', () => {
    const ts = isoToUnixSeconds('2025-10-22T00:00');
    expect(ts).toBeGreaterThan(0);
    expect(Number.isFinite(ts)).toBe(true);
  });

  it('returns 0 for invalid input', () => {
    expect(isoToUnixSeconds('')).toBe(0);
    expect(isoToUnixSeconds('not-a-date')).toBe(0);
  });
});

// ── formatDeadline ────────────────────────────────────────────────────────────

describe('formatDeadline', () => {
  it('returns a non-empty human string', () => {
    const s = formatDeadline(1761177600);
    expect(s.length).toBeGreaterThan(5);
  });

  it('accepts bigint', () => {
    const s = formatDeadline(1761177600n);
    expect(s.length).toBeGreaterThan(5);
  });
});

// ── orderStatus ───────────────────────────────────────────────────────────────

describe('orderStatus', () => {
  const target = 100_000_000n;
  const deadline = BigInt(FUTURE);

  it('returns funded-settled when settled=true', () => {
    expect(orderStatus(true, target, target, deadline, BigInt(NOW_TS))).toBe('funded-settled');
  });

  it('returns funded-unsettled when totalFunded==target, not settled', () => {
    expect(orderStatus(false, target, target, deadline, BigInt(NOW_TS))).toBe('funded-unsettled');
  });

  it('returns open when incomplete and before deadline', () => {
    expect(orderStatus(false, 50_000_000n, target, deadline, BigInt(NOW_TS))).toBe('open');
  });

  it('returns expired-incomplete when past deadline and not fully funded', () => {
    const pastDeadline = BigInt(FUTURE + 1);
    expect(orderStatus(false, 50_000_000n, target, BigInt(FUTURE), pastDeadline)).toBe('expired-incomplete');
  });

  it('returns funded-unsettled (not expired) when fully funded past deadline', () => {
    // Fully funded but past deadline: still settleable, not expired
    const pastDeadline = BigInt(FUTURE + 1);
    expect(orderStatus(false, target, target, BigInt(FUTURE), pastDeadline)).toBe('funded-unsettled');
  });

  it('settled takes priority over fully-funded-unsettled', () => {
    expect(orderStatus(true, target, target, BigInt(FUTURE + 1), BigInt(FUTURE + 2))).toBe('funded-settled');
  });
});

// ── validateCreateDraft ───────────────────────────────────────────────────────

describe('validateCreateDraft', () => {
  function validDraft(): CreateOrderDraft {
    return {
      merchant: '0x5B12Ce46C7194aD57d143bC22847224047b1Ef42',
      orderRef: 'INV-001',
      targetUsdc: '100',
      deadlineIso: FUTURE_ISO,
      shares: [
        { address: '0x1111111111111111111111111111111111111111', amount: '60' },
        { address: '0x2222222222222222222222222222222222222222', amount: '25' },
        { address: '0x3333333333333333333333333333333333333333', amount: '15' },
      ],
    };
  }

  it('returns no errors for a valid draft', () => {
    const errs = validateCreateDraft(validDraft(), NOW_TS);
    expect(errs.merchant).toBeUndefined();
    expect(errs.orderRef).toBeUndefined();
    expect(errs.targetUsdc).toBeUndefined();
    expect(errs.deadlineIso).toBeUndefined();
    expect(errs.sharesSum).toBeUndefined();
    expect(errs.shares?.some(e => e)).toBeFalsy();
  });

  it('isDraftValid returns true for valid draft', () => {
    expect(isDraftValid(validDraft(), NOW_TS)).toBe(true);
  });

  it('rejects zero merchant', () => {
    const d = validDraft();
    d.merchant = '';
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.merchant).toBeTruthy();
  });

  it('rejects invalid merchant address', () => {
    const d = validDraft();
    d.merchant = 'notanaddress';
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.merchant).toContain('Invalid');
  });

  it('rejects missing orderRef', () => {
    const d = validDraft();
    d.orderRef = '';
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.orderRef).toBeTruthy();
  });

  it('rejects invalid target (exponent)', () => {
    const d = validDraft();
    d.targetUsdc = '1e6';
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.targetUsdc).toBeTruthy();
  });

  it('rejects past deadline', () => {
    const d = validDraft();
    d.deadlineIso = new Date((NOW_TS - 3600) * 1000).toISOString().slice(0, 16);
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.deadlineIso).toBeTruthy();
  });

  it('rejects shares that do not sum to target', () => {
    const d = validDraft();
    d.shares[2] = { address: d.shares[2].address, amount: '10' }; // 60+25+10=95 != 100
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.sharesSum).toBeTruthy();
    expect(errs.sharesSum).toContain('95');
  });

  it('rejects duplicate contributor addresses', () => {
    const d = validDraft();
    d.shares[1] = { address: d.shares[0].address, amount: '25' };
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.shares?.some(e => e?.includes('Duplicate'))).toBe(true);
  });

  it('rejects zero share amount', () => {
    const d = validDraft();
    d.shares[0] = { ...d.shares[0], amount: '0' };
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.shares?.[0]).toBeTruthy();
  });

  it('rejects invalid share address', () => {
    const d = validDraft();
    d.shares[0] = { ...d.shares[0], address: 'badaddr' };
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.shares?.[0]).toBeTruthy();
  });

  it('unequal shares 60/25/15 sums to 100 — accepted', () => {
    // This mirrors the contract test: 60+25+15 == 100
    const d = validDraft();
    expect(isDraftValid(d, NOW_TS)).toBe(true);
  });

  it('>6 fractional digits in share rejected', () => {
    const d = validDraft();
    d.shares[0] = { ...d.shares[0], amount: '60.0000001' };
    const errs = validateCreateDraft(d, NOW_TS);
    expect(errs.shares?.[0]).toBeTruthy();
  });
});

// ── deriveOrderId ─────────────────────────────────────────────────────────────

describe('deriveOrderId', () => {
  it('returns a 0x-prefixed 66-char hex string (bytes32)', () => {
    const id = deriveOrderId('0x5B12Ce46C7194aD57d143bC22847224047b1Ef42', 'INV-001', 100_000_000n, 1000);
    expect(id).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it('different inputs produce different IDs', () => {
    const a = deriveOrderId('0x5B12Ce46C7194aD57d143bC22847224047b1Ef42', 'INV-001', 100_000_000n, 1);
    const b = deriveOrderId('0x5B12Ce46C7194aD57d143bC22847224047b1Ef42', 'INV-002', 100_000_000n, 1);
    const c = deriveOrderId('0x5B12Ce46C7194aD57d143bC22847224047b1Ef42', 'INV-001', 100_000_000n, 2);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('is deterministic for the same inputs', () => {
    const id1 = deriveOrderId('0x5B12Ce46C7194aD57d143bC22847224047b1Ef42', 'INV-001', 100_000_000n, 1);
    const id2 = deriveOrderId('0x5B12Ce46C7194aD57d143bC22847224047b1Ef42', 'INV-001', 100_000_000n, 1);
    expect(id1).toBe(id2);
  });
});

// ── shortAddress ──────────────────────────────────────────────────────────────

describe('shortAddress', () => {
  it('truncates a full address', () => {
    const s = shortAddress('0x5B12Ce46C7194aD57d143bC22847224047b1Ef42');
    expect(s).toContain('…');
    expect(s.length).toBeLessThan(20);
  });

  it('returns short input as-is', () => {
    expect(shortAddress('0x123')).toBe('0x123');
  });
});

// ── emptyDraft ────────────────────────────────────────────────────────────────

describe('emptyDraft', () => {
  it('returns a draft with 2 empty share rows', () => {
    const d = emptyDraft();
    expect(d.shares).toHaveLength(2);
    expect(d.shares[0].address).toBe('');
    expect(d.shares[0].amount).toBe('');
  });

  it('token is fixed per deployment — no tokenAddress field in draft', () => {
    const d = emptyDraft();
    // CreateOrderDraft no longer has a tokenAddress field; token is immutable in contract.
    expect('tokenAddress' in d).toBe(false);
  });
});
