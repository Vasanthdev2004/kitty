// ─── Kitty – transaction layer tests (mock clients, no wagmi) ───────────────
import { describe, it, expect } from 'vitest';
import {
  validateKittyDeployment, checkKittyPreflight, kittyWrite, approveAndChipIn,
  acquireInflight, releaseInflight, makeInflightRef, handleReceiptOutcome, isTxBusy,
  type MinimalPublicClient, type MinimalWalletClient,
} from '../kitty-tx';
import { ACTIVE, ACTIVE_CHAIN_ID, KITTY_DEPLOYMENTS, getDeployment } from '../kitty-config';
import type { TxStatus } from '../pt-types';

const dep = ACTIVE;
const POT = `0x${'ab'.repeat(32)}` as const;
const H1 = `0x${'11'.repeat(32)}` as const;
const H2 = `0x${'22'.repeat(32)}` as const;
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const;

function publicMock(over: Partial<{ code: string | undefined; token: string; decimals: number; receipts: Array<'success' | 'reverted' | 'timeout'> }> = {}) {
  const receipts = [...(over.receipts ?? ['success'])];
  const client: MinimalPublicClient = {
    getBytecode() { return Promise.resolve(('code' in over ? over.code : '0x6080') as `0x${string}` | undefined); },
    readContract(a) {
      if (a.functionName === 'token') return Promise.resolve(over.token ?? dep.usdc);
      if (a.functionName === 'decimals') return Promise.resolve(over.decimals ?? 6);
      return Promise.reject(new Error('unexpected read ' + a.functionName));
    },
    waitForTransactionReceipt({ hash }) {
      const next = receipts.shift() ?? 'success';
      if (next === 'timeout') return Promise.reject(new Error('Timed out while waiting for transaction'));
      return Promise.resolve({ status: next, transactionHash: hash });
    },
  };
  return client;
}

function walletMock(opts: { reject?: 'approve' | 'fund'; hashes?: `0x${string}`[] } = {}) {
  const calls: Array<{ address: string; fn: string; args: unknown[] }> = [];
  const hashes = [...(opts.hashes ?? [H1, H2])];
  const w: MinimalWalletClient = {
    account: { address: ACCOUNT },
    writeContract(a) {
      calls.push({ address: a.address, fn: a.functionName, args: a.args ?? [] });
      if (opts.reject === a.functionName) return Promise.reject(new Error('User rejected the request'));
      return Promise.resolve(hashes.shift() ?? H2);
    },
  };
  return { w, calls };
}

describe('deployment config', () => {
  it('is keyed by chain id and the active chain has a deployment', () => {
    expect(KITTY_DEPLOYMENTS[ACTIVE_CHAIN_ID]).toBe(dep);
    expect(getDeployment()).toBe(dep);
    expect(() => getDeployment(1)).toThrow();
  });
  it('points at the deployed Kitty and Arc USDC, scanning from the deploy block (never 0)', () => {
    expect(dep.kitty).toBe('0x12840026bd9457b41ae104536f0917a19dd88611');
    expect(dep.usdc.toLowerCase()).toBe('0x3600000000000000000000000000000000000000');
    expect(dep.usdcDecimals).toBe(6);
    expect(dep.deployBlock).toBeGreaterThan(0n);
  });
});

describe('validateKittyDeployment', () => {
  it('accepts code + canonical token + 6 decimals', async () => {
    expect(await validateKittyDeployment(publicMock(), dep)).toEqual({ ok: true, tokenAddress: dep.usdc });
  });
  it('rejects no bytecode', async () => {
    const r = await validateKittyDeployment(publicMock({ code: '0x' }), dep);
    expect(r.ok).toBe(false);
    expect((await validateKittyDeployment(publicMock({ code: undefined }), dep)).ok).toBe(false);
  });
  it('rejects a different token', async () => {
    const r = await validateKittyDeployment(publicMock({ token: '0x2222222222222222222222222222222222222222' }), dep);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/canonical USDC/);
  });
  it('rejects wrong decimals', async () => {
    const r = await validateKittyDeployment(publicMock({ decimals: 18 }), dep);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/decimals/);
  });
  it('reports read failures instead of throwing', async () => {
    const bad: MinimalPublicClient = { ...publicMock(), getBytecode: () => Promise.reject(new Error('rpc down')) };
    const r = await validateKittyDeployment(bad, dep);
    expect(r.ok).toBe(false);
  });
});

describe('preflight and lock', () => {
  it('needs a wallet and the right chain', () => {
    expect(checkKittyPreflight(undefined, dep.chainId, dep)).toMatchObject({ ok: false });
    expect(checkKittyPreflight(ACCOUNT, 1, dep)).toMatchObject({ ok: false });
    expect(checkKittyPreflight(ACCOUNT, dep.chainId, dep)).toEqual({ ok: true, account: ACCOUNT });
  });
  it('allows one in-flight write at a time', () => {
    const ref = makeInflightRef();
    expect(acquireInflight(ref)).toBe(true);
    expect(acquireInflight(ref)).toBe(false);
    releaseInflight(ref);
    expect(acquireInflight(ref)).toBe(true);
  });
});

describe('kittyWrite', () => {
  it('walks wallet-pending then submitted and targets the Kitty contract', async () => {
    const seen: TxStatus[] = [];
    const { w, calls } = walletMock();
    const r = await kittyWrite({ dep, functionName: 'settle', args: [POT], label: 'Pay out', walletClient: w, onStatus: s => seen.push(s) });
    expect(r).toEqual({ kind: 'submitted', hash: H1 });
    expect(calls).toEqual([{ address: dep.kitty, fn: 'settle', args: [POT] }]);
    expect(seen.map(s => s.kind)).toEqual(['wallet-pending', 'submitted']);
  });
  it('reports a rejected wallet prompt plainly', async () => {
    const seen: TxStatus[] = [];
    const { w } = walletMock({ reject: 'fund' });
    const r = await kittyWrite({ dep, functionName: 'fund', args: [POT, 1n], label: 'Chip in', walletClient: w, onStatus: s => seen.push(s) });
    expect(r.kind).toBe('rejected');
    expect(seen[seen.length - 1]).toEqual({ kind: 'rejected', message: 'Wallet rejected the transaction' });
  });
});

describe('approveAndChipIn', () => {
  const run = (pub: MinimalPublicClient, w: MinimalWalletClient, seen: TxStatus[] = []) =>
    approveAndChipIn({ dep, potId: POT, amountRaw: 5_000_000n, publicClient: pub, walletClient: w, onStatus: s => seen.push(s) });

  it('approves the exact amount, waits for the receipt, then chips in', async () => {
    const { w, calls } = walletMock();
    const r = await run(publicMock({ receipts: ['success'] }), w);
    expect(r).toEqual({ kind: 'chip-in-submitted', hash: H2 });
    expect(calls).toEqual([
      { address: dep.usdc, fn: 'approve', args: [dep.kitty, 5_000_000n] },
      { address: dep.kitty, fn: 'fund', args: [POT, 5_000_000n] },
    ]);
  });
  it('a rejected approval sends nothing else', async () => {
    const { w, calls } = walletMock({ reject: 'approve' });
    const r = await run(publicMock(), w);
    expect(r.kind).toBe('approve-rejected');
    expect(calls).toHaveLength(1);
  });
  it('a reverted approval aborts before chip in', async () => {
    const { w, calls } = walletMock();
    const seen: TxStatus[] = [];
    const r = await run(publicMock({ receipts: ['reverted'] }), w, seen);
    expect(r).toEqual({ kind: 'approve-reverted', hash: H1 });
    expect(calls.map(c => c.fn)).toEqual(['approve']);
    expect(seen[seen.length - 1].kind).toBe('reverted');
  });
  it('an uncertain approval receipt aborts, keeps the hash and never resubmits', async () => {
    const { w, calls } = walletMock();
    const seen: TxStatus[] = [];
    const r = await run(publicMock({ receipts: ['timeout'] }), w, seen);
    expect(r.kind).toBe('approve-uncertain');
    if (r.kind === 'approve-uncertain') expect(r.hash).toBe(H1);
    expect(calls.map(c => c.fn)).toEqual(['approve']);
    const last = seen[seen.length - 1];
    expect(last.kind).toBe('uncertain');
    expect(isTxBusy(last)).toBe(true);
  });
  it('a rejected chip in after a good approval is reported', async () => {
    const { w } = walletMock({ reject: 'fund' });
    const r = await run(publicMock({ receipts: ['success'] }), w);
    expect(r.kind).toBe('chip-in-rejected');
  });
});

describe('receipt outcomes (shared with the legacy layer)', () => {
  const op = { kind: 'fund' as const, orderId: POT, label: 'Chip in' };
  it('releases the lock on a definitive result', () => {
    const ok = handleReceiptOutcome({ kind: 'success', hash: H1 }, op);
    expect(ok).toMatchObject({ releaseLock: true, clearPending: true, refreshOrderId: POT });
    expect(handleReceiptOutcome({ kind: 'reverted', hash: H1 }, op)).toMatchObject({ releaseLock: true, clearPending: true });
  });
  it('keeps the lock and the pending hash when uncertain', () => {
    const r = handleReceiptOutcome({ kind: 'uncertain', hash: H1, reason: 'timeout' }, op);
    expect(r).toMatchObject({ releaseLock: false, clearPending: false });
    expect(r.newStatus).toMatchObject({ kind: 'uncertain', hash: H1 });
  });
});
