// ─── Kitty v2 – permit, pay for a friend, cancel, stats, requests, CSV ──────
import { describe, it, expect, beforeEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import {
  PERMIT_TYPES, PERMIT_VALID_SECONDS, buildPermitTypedData, chipInHelper, chooseChipInPath, domainMatches, isSignRejection,
  localDomainSeparator, permitDeadline, splitSignature, type PermitDomain,
} from '../permit';
import { checkPermitDomain, clearPermitCache, preparePermit } from '../permit-io';
import { approveAndChipIn, permitChipIn, type MinimalPublicClient, type MinimalWalletClient } from '../kitty-tx';
import { ACTIVE } from '../kitty-config';
import {
  FRIEND_WARNING, PHASE_PILL, ACTIVITY_VERB, SETTLE_GRACE_SECONDS, busyLabel, canCancel, dedupePaidFor, groupMine, kittyAction, kittyPhase,
  mineAction, parseKittyLog, parseRoute, readPhaseOf, routeTab, routeToSearch, timelineSteps, unpaidContributors,
} from '../kitty-core';
import {
  RECENT_PAYOUTS, STATS_TTL_MS, computeStats, groupRequests, parseStats, requestCsv, requestPhase, requestTotals, serializeStats,
  type RequestSummary,
} from '../kitty-requests';
import { csvCell, guardFormula, toCsv } from '../csv';
import { describeCancel, describeFundFor } from '../write-summary';
import type { ActivityItem, MineSummary } from '../kitty-types';
import type { TxStatus } from '../pt-types';

const U = 1_000_000n;
const ME = '0x1111111111111111111111111111111111111111' as const;
const FRIEND = '0x2222222222222222222222222222222222222222' as const;
const POT = `0x${'ab'.repeat(32)}` as const;
const USDC = ACTIVE.usdc;
// DOMAIN_SEPARATOR() read from live Arc Testnet USDC (name "USDC", version "2", chain 5042002).
const LIVE_SEPARATOR = '0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0';
const DOMAIN: PermitDomain = { name: 'USDC', version: '2', chainId: 5042002, verifyingContract: '0x3600000000000000000000000000000000000000' };

// ── Permit: typed data, domain check, path choice ────────────────────────────

describe('permit typed data', () => {
  it('builds the standard EIP-2612 payload for exactly the amount', () => {
    const t = buildPermitTypedData({ domain: DOMAIN, owner: ME, spender: ACTIVE.kitty, value: 25n * U, nonce: 7n, deadline: 1_900_000_000n });
    expect(t.primaryType).toBe('Permit');
    expect(t.domain).toEqual(DOMAIN);
    expect(t.types).toBe(PERMIT_TYPES);
    expect(PERMIT_TYPES.Permit.map(f => `${f.type} ${f.name}`)).toEqual([
      'address owner', 'address spender', 'uint256 value', 'uint256 nonce', 'uint256 deadline',
    ]);
    expect(t.message).toEqual({ owner: ME, spender: ACTIVE.kitty, value: 25n * U, nonce: 7n, deadline: 1_900_000_000n });
  });

  it('the domain we sign equals the live Arc USDC DOMAIN_SEPARATOR', () => {
    expect(localDomainSeparator(DOMAIN)).toBe(LIVE_SEPARATOR);
    expect(domainMatches(LIVE_SEPARATOR, DOMAIN)).toBe(true);
    expect(domainMatches(LIVE_SEPARATOR.toUpperCase().replace('0X', '0x'), DOMAIN)).toBe(true);
  });

  it('any wrong domain field fails the check', () => {
    expect(domainMatches(LIVE_SEPARATOR, { ...DOMAIN, version: '1' })).toBe(false);
    expect(domainMatches(LIVE_SEPARATOR, { ...DOMAIN, name: 'USD Coin' })).toBe(false);
    expect(domainMatches(LIVE_SEPARATOR, { ...DOMAIN, chainId: 5042 })).toBe(false);
    expect(domainMatches(LIVE_SEPARATOR, { ...DOMAIN, verifyingContract: '0x0000000000000000000000000000000000000001' })).toBe(false);
  });

  it('is valid for 20 minutes', () => {
    expect(PERMIT_VALID_SECONDS).toBe(1200n);
    expect(permitDeadline(1_800_000_000)).toBe(1_800_001_200n);
    expect(permitDeadline(1_800_000_000n)).toBe(1_800_001_200n);
  });

  it('a signature over it verifies, and splits into v (27 or 28), r and s', async () => {
    const acct = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const t = buildPermitTypedData({ domain: DOMAIN, owner: acct.address, spender: ACTIVE.kitty, value: 5n * U, nonce: 0n, deadline: 2_000_000_000n });
    const sig = await acct.signTypedData(t);
    expect(await verifyTypedData({ address: acct.address, signature: sig, ...t })).toBe(true);
    const { v, r, s } = splitSignature(sig);
    expect([27, 28]).toContain(v);
    expect(r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(s).toMatch(/^0x[0-9a-f]{64}$/);
    expect(`${r}${s.slice(2)}${v.toString(16)}`.toLowerCase()).toBe(sig.toLowerCase());
  });
});

describe('chip in path selection', () => {
  it('enough allowance: plain, no signature', () => {
    expect(chooseChipInPath({ allowanceRaw: 10n, amountRaw: 10n, permitUsable: true })).toBe('plain');
    expect(chooseChipInPath({ allowanceRaw: 99n, amountRaw: 10n, permitUsable: false })).toBe('plain');
  });
  it('not enough allowance: permit when usable, otherwise approve', () => {
    expect(chooseChipInPath({ allowanceRaw: 0n, amountRaw: 10n, permitUsable: true })).toBe('permit');
    expect(chooseChipInPath({ allowanceRaw: 9n, amountRaw: 10n, permitUsable: false })).toBe('approve');
  });
  it('helper copy', () => {
    expect(chipInHelper('permit')).toBe('One signature, one transaction');
    expect(chipInHelper('approve')).toBe('One signature, one transaction');
    expect(chipInHelper('plain')).toBe('One transaction');
  });
  it('tells a refusal from a wallet that cannot sign', () => {
    expect(isSignRejection({ code: 4001 })).toBe(true);
    expect(isSignRejection(new Error('User rejected the request.'))).toBe(true);
    expect(isSignRejection(new Error('User denied message signature'))).toBe(true);
    expect(isSignRejection(new Error('Method eth_signTypedData_v4 not supported'))).toBe(false);
    expect(isSignRejection(new Error('does not exist / is not available'))).toBe(false);
  });
});

// ── Permit I/O (mock token) ──────────────────────────────────────────────────

function tokenClient(over: { name?: unknown; version?: unknown; separator?: unknown; nonce?: unknown } = {}) {
  const calls: string[] = [];
  const client = {
    readContract: ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      const v: Record<string, unknown> = {
        name: over.name ?? 'USDC', version: over.version ?? '2', DOMAIN_SEPARATOR: over.separator ?? LIVE_SEPARATOR, nonces: over.nonce ?? 3n,
      };
      const r = v[functionName];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
  } as unknown as MinimalPublicClient;
  return { client, calls };
}

describe('permit domain check', () => {
  beforeEach(() => clearPermitCache());

  it('accepts the token domain when it matches DOMAIN_SEPARATOR', async () => {
    const { client } = tokenClient();
    const r = await checkPermitDomain(client, ACTIVE);
    expect(r).toEqual({ ok: true, domain: { name: 'USDC', version: '2', chainId: ACTIVE.chainId, verifyingContract: USDC } });
  });

  it('falls back to version 2 when version() cannot be read', async () => {
    const { client } = tokenClient({ version: new Error('no version()') });
    const r = await checkPermitDomain(client, ACTIVE);
    expect(r.ok).toBe(true);
  });

  it('rejects a domain that does not match, so the caller falls back to approve', async () => {
    const { client } = tokenClient({ version: '1' });
    const r = await checkPermitDomain(client, ACTIVE);
    expect(r).toEqual({ ok: false, reason: 'Permit domain does not match the token' });
  });

  it('rejects when the separator or name cannot be read', async () => {
    expect((await checkPermitDomain(tokenClient({ separator: new Error('x') }).client, ACTIVE)).ok).toBe(false);
    clearPermitCache();
    expect((await checkPermitDomain(tokenClient({ name: new Error('x') }).client, ACTIVE)).ok).toBe(false);
  });

  it('keeps a verified domain for the session but always reads a fresh nonce', async () => {
    const { client, calls } = tokenClient({ nonce: 9n });
    const a = await preparePermit(client, ACTIVE, ME);
    const b = await preparePermit(client, ACTIVE, ME);
    expect(a).toMatchObject({ ok: true, nonce: 9n });
    expect(b).toMatchObject({ ok: true, nonce: 9n });
    expect(calls.filter(c => c === 'DOMAIN_SEPARATOR')).toHaveLength(1);
    expect(calls.filter(c => c === 'nonces')).toHaveLength(2);
  });

  it('a nonce that is not a number means no permit', async () => {
    const r = await preparePermit(tokenClient({ nonce: 'oops' }).client, ACTIVE, ME);
    expect(r.ok).toBe(false);
  });
});

// ── permitChipIn / approveAndChipIn with a friend ────────────────────────────

interface Wallet extends MinimalWalletClient { writes: Array<{ functionName: string; args?: unknown[]; address: string }>; signed: unknown[] }

const fakeHash = (n: number): `0x${string}` => `0x${String(n).padStart(64, '0')}`;

function wallet(opts: { sign?: 'ok' | 'reject' | 'unsupported' | 'missing'; write?: 'ok' | 'reject' } = {}): Wallet {
  const sig = `0x${'aa'.repeat(32)}${'bb'.repeat(32)}1b` as const;
  const w: Wallet = {
    account: { address: ME },
    writes: [],
    signed: [],
    writeContract: (a): Promise<`0x${string}`> => {
      w.writes.push({ functionName: a.functionName, args: a.args, address: a.address });
      if (opts.write === 'reject') return Promise.reject(new Error('User rejected the request.'));
      return Promise.resolve(fakeHash(w.writes.length));
    },
  };
  if (opts.sign !== 'missing') {
    w.signTypedData = (a) => {
      w.signed.push(a);
      if (opts.sign === 'reject') return Promise.reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }));
      if (opts.sign === 'unsupported') return Promise.reject(new Error('eth_signTypedData_v4 is not supported'));
      return Promise.resolve(sig);
    };
  }
  return w;
}

const permitArgs = (w: MinimalWalletClient, statuses: TxStatus[], beneficiary?: `0x${string}`) => ({
  dep: ACTIVE, owner: ME, potId: POT, beneficiary, amountRaw: 12n * U, domain: DOMAIN, nonce: 4n, deadline: 1_900_000_000n,
  walletClient: w, onStatus: (s: TxStatus) => statuses.push(s),
});

describe('permitChipIn', () => {
  it('signs once, then sends fundWithPermit with the split signature', async () => {
    const w = wallet(); const statuses: TxStatus[] = [];
    const r = await permitChipIn(permitArgs(w, statuses));
    expect(r.kind).toBe('chip-in-submitted');
    expect(w.signed).toHaveLength(1);
    expect(w.signed[0]).toMatchObject({ primaryType: 'Permit', domain: DOMAIN, message: { owner: ME, spender: ACTIVE.kitty, value: 12n * U, nonce: 4n, deadline: 1_900_000_000n } });
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]).toMatchObject({ functionName: 'fundWithPermit', address: ACTIVE.kitty });
    expect(w.writes[0].args).toEqual([POT, 12n * U, 1_900_000_000n, 27, `0x${'aa'.repeat(32)}`, `0x${'bb'.repeat(32)}`]);
    expect(statuses.map(s => s.kind)).toEqual(['wallet-pending', 'wallet-pending', 'submitted']);
    expect(statuses.map(s => ('label' in s ? s.label : ''))).toEqual(['Sign permit', 'Chip in', 'Chip in']);
  });

  it('paying for a friend uses fundForWithPermit with the beneficiary', async () => {
    const w = wallet();
    await permitChipIn(permitArgs(w, [], FRIEND));
    expect(w.writes[0].functionName).toBe('fundForWithPermit');
    expect(w.writes[0].args?.slice(0, 3)).toEqual([POT, FRIEND, 12n * U]);
    expect(w.writes[0].args).toHaveLength(7);
  });

  it('a wallet without signTypedData is unsupported and nothing is sent', async () => {
    const w = wallet({ sign: 'missing' });
    expect((await permitChipIn(permitArgs(w, []))).kind).toBe('unsupported');
    expect(w.writes).toHaveLength(0);
  });

  it('a wallet that errors on typed data is unsupported (caller falls back), nothing is sent', async () => {
    const w = wallet({ sign: 'unsupported' }); const statuses: TxStatus[] = [];
    expect((await permitChipIn(permitArgs(w, statuses))).kind).toBe('unsupported');
    expect(w.writes).toHaveLength(0);
    expect(statuses.some(s => s.kind === 'rejected')).toBe(false);
  });

  it('declining the signature stops here: no fallback, no transaction', async () => {
    const w = wallet({ sign: 'reject' }); const statuses: TxStatus[] = [];
    expect((await permitChipIn(permitArgs(w, statuses))).kind).toBe('sign-rejected');
    expect(w.writes).toHaveLength(0);
    expect(statuses[statuses.length - 1]).toEqual({ kind: 'rejected', message: 'Wallet rejected the signature' });
  });

  it('a rejected transaction after signing is reported', async () => {
    const w = wallet({ write: 'reject' }); const statuses: TxStatus[] = [];
    expect((await permitChipIn(permitArgs(w, statuses))).kind).toBe('chip-in-rejected');
    expect(statuses[statuses.length - 1]).toEqual({ kind: 'rejected', message: 'Wallet rejected the transaction' });
  });
});

describe('approve fallback can pay for a friend', () => {
  const okClient = { waitForTransactionReceipt: () => Promise.resolve({ status: 'success', transactionHash: '0x' }) } as unknown as MinimalPublicClient;
  it('approve, wait for the receipt, then fundFor', async () => {
    const w = wallet();
    const r = await approveAndChipIn({ dep: ACTIVE, potId: POT, beneficiary: FRIEND, amountRaw: 5n * U, publicClient: okClient, walletClient: w, onStatus: () => undefined });
    expect(r.kind).toBe('chip-in-submitted');
    expect(w.writes.map(x => x.functionName)).toEqual(['approve', 'fundFor']);
    expect(w.writes[1].args).toEqual([POT, FRIEND, 5n * U]);
  });
  it('without a friend it is the plain fund', async () => {
    const w = wallet();
    await approveAndChipIn({ dep: ACTIVE, potId: POT, amountRaw: 5n * U, publicClient: okClient, walletClient: w, onStatus: () => undefined });
    expect(w.writes.map(x => x.functionName)).toEqual(['approve', 'fund']);
    expect(w.writes[1].args).toEqual([POT, 5n * U]);
  });
});

// ── Cancelled kitties ────────────────────────────────────────────────────────

describe('cancelled', () => {
  const base = { settled: false, totalFundedRaw: 4n * U, goalRaw: 10n * U, deadline: 10_000n, now: 100n };

  it('phase: cancelled while funding is still live, and it beats open', () => {
    expect(kittyPhase({ ...base })).toBe('open');
    expect(kittyPhase({ ...base, cancelled: true })).toBe('cancelled');
    expect(kittyPhase({ ...base, cancelled: true, now: 10n ** 12n })).toBe('cancelled');
    expect(kittyPhase({ ...base, settled: true, cancelled: true })).toBe('paid');
    expect(readPhaseOf({ settled: false, cancelled: true, totalFundedRaw: 0n, goalRaw: 1n, deadline: 99n, chainTimestamp: 1n })).toBe('cancelled');
  });

  it('pill says Cancelled', () => {
    expect(PHASE_PILL.cancelled).toEqual({ label: 'Cancelled', tone: 'neutral' });
  });

  it('contributors get Get refund at once; others see nothing', () => {
    const mine = { shareRaw: 0n, contributedRaw: 3n * U, refunded: false };
    const k = (my?: typeof mine) => kittyAction({ connected: true, correctChain: true, phase: 'cancelled', mode: 'open', my });
    expect(k(mine)).toBe('refund');
    expect(k({ ...mine, refunded: true })).toBe('refunded');
    expect(k({ ...mine, contributedRaw: 0n })).toBe('nothing');
    expect(k(undefined)).toBe('nothing');
  });

  it('timeline: Funding, Cancelled, then Refunds open', () => {
    const steps = timelineSteps({ phase: 'cancelled', deadline: 10_000n, now: 100n });
    expect(steps.map(s => s.id)).toEqual(['funding', 'cancelled', 'refunds']);
    expect(steps.map(s => s.state)).toEqual(['past', 'past', 'current']);
    expect(steps[2].title).toBe('Refunds open');
    expect(steps.map(s => s.text).join(' ')).not.toMatch(/[\u2013\u2014]/);
  });

  it('who may cancel: creator or recipient, only while open', () => {
    const o = { creator: ME, recipient: FRIEND };
    expect(canCancel({ phase: 'open', me: ME, ...o })).toBe(true);
    expect(canCancel({ phase: 'open', me: FRIEND.toUpperCase().replace('0X', '0x'), ...o })).toBe(true);
    expect(canCancel({ phase: 'open', me: '0x3333333333333333333333333333333333333333', ...o })).toBe(false);
    expect(canCancel({ phase: 'open', me: undefined, ...o })).toBe(false);
    for (const phase of ['ready', 'paid', 'expired', 'stuck', 'cancelled'] as const) {
      expect(canCancel({ phase, me: ME, ...o })).toBe(false);
    }
  });

  it('My kitties: a refund due is Needs your action, otherwise Completed', () => {
    const mk = (id: string, over: Partial<MineSummary>): MineSummary => ({
      id: `0x${id.repeat(32)}`, ref: id, mode: 'open', creator: ME, recipient: FRIEND, goalRaw: 10n * U, totalFundedRaw: 4n * U,
      deadline: 10_000n, settled: false, cancelled: true, myShareRaw: 0n, myContributedRaw: 0n, myRefunded: false, roles: [], ...over,
    });
    const due = mk('0a', { myContributedRaw: 3n * U });
    const done = mk('0b', { myContributedRaw: 3n * U, myRefunded: true });
    const never = mk('0c', {});
    expect(mineAction(due, 100n)).toBe('refund');
    expect(mineAction(done, 100n)).toBeNull();
    const g = groupMine([due, done, never], 100n);
    expect(g.needsAction.map(s => s.ref)).toEqual(['0a']);
    expect(g.completed.map(s => s.ref).sort()).toEqual(['0b', '0c']);
    expect(g.active).toHaveLength(0);
  });

  it('busy and confirm copy', () => {
    expect(busyLabel({ kind: 'wallet-pending', label: 'Cancel kitty' })).toBe('Cancelling');
    expect(busyLabel({ kind: 'wallet-pending', label: 'Sign permit' })).toBe('Sign permit');
    expect(busyLabel({ kind: 'wallet-pending', label: 'Chip in' })).toBe('Chipping in');
    expect(busyLabel({ kind: 'confirming', hash: '0x1', label: 'Chip in' })).toBe('Confirming');
    const c = describeCancel({ ref: 'Trip' });
    expect(c.warnings.join(' ')).toMatch(/take their own money back right away/);
  });
});

// ── Pay for a friend ─────────────────────────────────────────────────────────

describe('pay for a friend', () => {
  const people = [
    { address: ME, shareRaw: 10n * U, contributedRaw: 0n, refunded: false },
    { address: FRIEND, shareRaw: 10n * U, contributedRaw: 4n * U, refunded: false },
    { address: '0x3333333333333333333333333333333333333333', shareRaw: 10n * U, contributedRaw: 10n * U, refunded: false },
    { address: '0x4444444444444444444444444444444444444444', shareRaw: 10n * U, contributedRaw: 0n, refunded: true },
  ];

  it('lists only unpaid named people, not yourself, with what each still owes', () => {
    const list = unpaidContributors(people, ME);
    expect(list.map(c => c.address)).toEqual([FRIEND]);
    expect(list[0].remainingRaw).toBe(6n * U);
  });

  it('shows everyone who owes when you are not on the list', () => {
    expect(unpaidContributors(people, undefined).map(c => c.address)).toEqual([ME, FRIEND]);
  });

  it('warning and confirm copy name the friend, not the payer', () => {
    expect(FRIEND_WARNING('0x2222…2222')).toBe('If this kitty is refunded, the money goes to 0x2222…2222, not you.');
    const s = describeFundFor({ ref: 'Trip', amountText: '6.00 USDC', recipient: '0x3', friend: FRIEND });
    expect(s.rows.find(r => r.label === 'Credited to')?.value).toBe(FRIEND);
    expect(s.warnings.join(' ')).toMatch(/goes to your friend, not you/);
  });

  it('activity: one fundFor shows once, as "payer paid for friend"', () => {
    const tx = `0x${'01'.repeat(32)}` as const;
    const logs: Parameters<typeof parseKittyLog>[0][] = [
      { eventName: 'Funded', args: { potId: POT, contributor: FRIEND, amount: 6n * U, totalFunded: 6n * U }, blockNumber: 5n, logIndex: 1, transactionHash: tx },
      { eventName: 'FundedFor', args: { potId: POT, payer: ME, beneficiary: FRIEND, amount: 6n * U }, blockNumber: 5n, logIndex: 2, transactionHash: tx },
      { eventName: 'Funded', args: { potId: POT, contributor: ME, amount: 1n * U, totalFunded: 7n * U }, blockNumber: 6n, logIndex: 0, transactionHash: `0x${'02'.repeat(32)}` },
    ];
    const items = logs.map(parseKittyLog).filter((x): x is ActivityItem => x !== null);
    expect(items[1]).toMatchObject({ kind: 'paidFor', address: ME, other: FRIEND, amountRaw: 6n * U });
    const out = dedupePaidFor(items);
    expect(out.map(i => i.kind)).toEqual(['paidFor', 'chipped']);
    expect(out[1].address).toBe(ME);
    expect(ACTIVITY_VERB.paidFor).toBe('paid for');
  });

  it('a normal chip in of the same amount in another transaction is kept', () => {
    const mk = (kind: ActivityItem['kind'], address: string, tx: string, other?: string): ActivityItem =>
      ({ kind, address, other, amountRaw: 5n * U, blockNumber: 1n, logIndex: 0, txHash: `0x${tx.repeat(32)}` });
    const out = dedupePaidFor([mk('paidFor', ME, '01', FRIEND), mk('chipped', FRIEND, '01'), mk('chipped', FRIEND, '02')]);
    expect(out).toHaveLength(2);
  });

  it('Cancelled events become feed rows', () => {
    const a = parseKittyLog({ eventName: 'Cancelled', args: { potId: POT, by: ME }, blockNumber: 3n, logIndex: 1, transactionHash: `0x${'03'.repeat(32)}` });
    expect(a).toMatchObject({ kind: 'cancelled', address: ME });
    expect(ACTIVITY_VERB.cancelled).toBe('cancelled the kitty');
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

describe('requests route', () => {
  it('parses and round-trips ?view=requests', () => {
    expect(parseRoute('?view=requests')).toEqual({ view: 'requests' });
    expect(routeToSearch({ view: 'requests' })).toBe('?view=requests');
    expect(routeTab({ view: 'requests' })).toBe('requests');
  });
  it('mine and open still work', () => {
    expect(parseRoute('?view=mine')).toEqual({ view: 'mine' });
    expect(parseRoute('?view=open')).toEqual({ view: 'open' });
  });
});

// ── CSV ──────────────────────────────────────────────────────────────────────

describe('csv', () => {
  it('quotes cells with commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(12n)).toBe('12');
    expect(csvCell(3.5)).toBe('3.5');
  });

  it('defuses spreadsheet formulas', () => {
    for (const bad of ['=SUM(A1)', '+1', '-1+1', '@cmd', '\tx', '\rx']) {
      expect(guardFormula(bad).startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(guardFormula('safe =')).toBe('safe =');
    expect(guardFormula('')).toBe('');
  });

  it('builds rows with CRLF and a trailing newline', () => {
    expect(toCsv(['a', 'b'], [['1', 'x,y'], [2n, '=1']])).toBe('a,b\r\n1,"x,y"\r\n2,\'=1\r\n');
  });
});

// ── Seller requests ──────────────────────────────────────────────────────────

describe('seller requests', () => {
  const NOW = 5_000n;
  const mk = (id: string, over: Partial<RequestSummary>): RequestSummary => ({
    id: `0x${id.repeat(32)}`, ref: `Invoice ${id}`, goalRaw: 100n * U, totalFundedRaw: 0n, deadline: NOW + 1_000n,
    settled: false, cancelled: false, contributorCount: 0, createdBlock: BigInt(parseInt(id, 16)), ...over,
  });
  const list = [
    mk('01', { totalFundedRaw: 40n * U, contributorCount: 2 }),                                    // active, open
    mk('02', { totalFundedRaw: 100n * U, contributorCount: 3 }),                                   // active, ready
    mk('03', { settled: true, totalFundedRaw: 100n * U, contributorCount: 4, payoutTx: `0x${'ee'.repeat(32)}` }), // paid
    mk('04', { deadline: NOW - 10n, totalFundedRaw: 10n * U }),                                    // expired
    mk('05', { cancelled: true, totalFundedRaw: 20n * U }),                                        // cancelled
  ];

  it('phases', () => {
    expect(list.map(r => requestPhase(r, NOW))).toEqual(['open', 'ready', 'paid', 'expired', 'cancelled']);
  });

  it('groups: Active, Paid, Expired or cancelled', () => {
    const g = groupRequests(list, NOW);
    expect(g.active.map(r => r.id.slice(2, 4))).toEqual(['01', '02']);
    expect(g.paid.map(r => r.id.slice(2, 4))).toEqual(['03']);
    expect(g.closed.map(r => r.id.slice(2, 4))).toEqual(['05', '04']); // newest first
  });

  it('totals: requested, collected (settled goals), pending (held for open or ready)', () => {
    expect(requestTotals(list, NOW)).toEqual({ requestedRaw: 500n * U, collectedRaw: 100n * U, pendingRaw: 140n * U });
    expect(requestTotals([], NOW)).toEqual({ requestedRaw: 0n, collectedRaw: 0n, pendingRaw: 0n });
  });

  it('CSV: header, status labels, amounts, payout hash, and escaping of hostile names', () => {
    const rows = [
      mk('03', { ref: '=cmd|\' /C calc\'!A0', settled: true, totalFundedRaw: 100n * U, payoutTx: `0x${'ee'.repeat(32)}`, createdAt: 1_800_000_000 }),
      mk('04', { ref: 'Dinner, "the big one"\nround 2', deadline: NOW - 10n, totalFundedRaw: 10n * U }),
    ];
    const csv = requestCsv(rows, NOW);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Name,Kitty ID,Goal (USDC),Funded (USDC),Status,Created block,Created time (UTC),Payout transaction');
    expect(lines[1].startsWith("'=cmd|' /C calc'!A0,")).toBe(true);
    expect(lines[1]).toContain(',100,100,Paid out,3,2027-01-15T08:00:00.000Z,0x' + 'ee'.repeat(32));
    expect(csv).toContain('"Dinner, ""the big one""\nround 2"');
    expect(csv).toContain('"Expired, refunds open"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

// ── Live stats ───────────────────────────────────────────────────────────────

describe('live stats', () => {
  const tx = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`;
  const pot = (n: number): `0x${string}` => `0x${n.toString(16).padStart(64, '0')}`;
  type Lg = Parameters<typeof computeStats>[0][number];
  const created = (n: number, ref: string): Lg => ({ eventName: 'PotCreated', args: { potId: pot(n), ref }, blockNumber: BigInt(n), logIndex: 0, transactionHash: tx(n) });
  const funded = (n: number, who: string): Lg => ({ eventName: 'Funded', args: { potId: pot(1), contributor: who, amount: 1n }, blockNumber: BigInt(100 + n), logIndex: 0, transactionHash: tx(100 + n) });
  const settled = (n: number, amount: bigint): Lg => ({ eventName: 'Settled', args: { potId: pot(n), amount }, blockNumber: BigInt(200 + n), logIndex: 0, transactionHash: tx(200 + n) });

  it('an empty deployment is all zeros (the UI shows "Be the first kitty")', () => {
    expect(computeStats([])).toEqual({ created: 0, paidOutRaw: 0n, people: 0, recent: [] });
  });

  it('counts kitties, paid out USDC and unique people (case-insensitive)', () => {
    const s = computeStats([
      created(1, 'A'), created(2, 'B'), created(3, 'C'),
      funded(1, ME), funded(2, ME.toUpperCase().replace('0X', '0x')), funded(3, FRIEND),
      settled(1, 30n * U), settled(2, 12n * U),
    ]);
    expect(s.created).toBe(3);
    expect(s.paidOutRaw).toBe(42n * U);
    expect(s.people).toBe(2);
  });

  it('recent payouts: newest first, at most five, with the kitty name', () => {
    const logs = [
      ...Array.from({ length: 7 }, (_, i) => created(i + 1, `Kitty ${i + 1}`)),
      ...Array.from({ length: 7 }, (_, i) => settled(i + 1, BigInt(i + 1) * U)),
    ];
    const s = computeStats(logs);
    expect(s.recent).toHaveLength(RECENT_PAYOUTS);
    expect(s.recent.map(r => r.ref)).toEqual(['Kitty 7', 'Kitty 6', 'Kitty 5', 'Kitty 4', 'Kitty 3']);
    expect(s.recent[0].amountRaw).toBe(7n * U);
    expect(s.recent[0].txHash).toBe(tx(207));
  });

  it('the session cache keeps bigints and expires', () => {
    const stats = computeStats([created(1, 'A'), funded(1, ME), settled(1, 5n * U)]);
    const raw = serializeStats(stats, 1_000);
    expect(parseStats(raw, 1_000 + STATS_TTL_MS)).toEqual(stats);
    expect(parseStats(raw, 1_000 + STATS_TTL_MS + 1)).toBeUndefined();   // stale
    expect(parseStats(raw, 999)).toBeUndefined();                          // clock went backwards
    expect(parseStats('not json', 1_000)).toBeUndefined();
    expect(parseStats(null, 1_000)).toBeUndefined();
  });
});

describe('settle grace is still 30 days', () => {
  it('constant', () => { expect(SETTLE_GRACE_SECONDS).toBe(30n * 86_400n); });
});
