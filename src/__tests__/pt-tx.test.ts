// ─── PayTogether – Transaction orchestration tests ───────────────────────────
// Tests the pure orchestration functions from pt-tx.ts.
// Mock wallet/publicClient only — no wagmi, no browser, no RPC.

import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  validateDeployment,
  checkPreflight,
  waitForReceipt,
  approveAndFund,
  singleWrite,
  isTxBusy,
  acquireInflight,
  releaseInflight,
  makeInflightRef,
  handleReceiptOutcome,
  ARC_CHAIN_ID,
  type MinimalPublicClient,
  type MinimalWalletClient,
  type PendingOp,
} from '../pt-tx';
import { ARC_TESTNET_USDC } from '../pt-utils';
import type { TxStatus } from '../pt-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_ADDR  = '0x1111111111111111111111111111111111111111' as const;
const FAKE_HASH  = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
const FAKE_HASH2 = '0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe' as const;

function makePublicClient(overrides: Partial<MinimalPublicClient> = {}): MinimalPublicClient {
  return {
    chain: { id: ARC_CHAIN_ID },
    getBytecode: vi.fn().mockResolvedValue('0x6001'),
    readContract: vi.fn().mockResolvedValue(ARC_TESTNET_USDC),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', transactionHash: FAKE_HASH }),
    ...overrides,
  };
}

function makeWalletClient(hash: `0x${string}` = FAKE_HASH): MinimalWalletClient {
  return {
    account: { address: FAKE_ADDR },
    writeContract: vi.fn().mockResolvedValue(hash),
  };
}

function captureStatus(): { statuses: TxStatus[]; onStatus: (s: TxStatus) => void } {
  const statuses: TxStatus[] = [];
  return { statuses, onStatus: (s) => statuses.push(s) };
}

// ── validateDeployment ────────────────────────────────────────────────────────

describe('validateDeployment', () => {
  it('returns ok:true when bytecode exists, token==USDC, decimals==6', async () => {
    const pc = makePublicClient({
      getBytecode: vi.fn().mockResolvedValue('0x6001'),
      readContract: vi.fn()
        .mockResolvedValueOnce(ARC_TESTNET_USDC)  // token()
        .mockResolvedValueOnce(6),                 // decimals()
    });
    const r = await validateDeployment(pc, FAKE_ADDR);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokenAddress.toLowerCase()).toBe(ARC_TESTNET_USDC.toLowerCase());
  });

  it('returns ok:false when bytecode is 0x (no contract)', async () => {
    const pc = makePublicClient({ getBytecode: vi.fn().mockResolvedValue('0x') });
    const r = await validateDeployment(pc, FAKE_ADDR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('No contract');
  });

  it('returns ok:false when bytecode is undefined', async () => {
    const pc = makePublicClient({ getBytecode: vi.fn().mockResolvedValue(undefined) });
    const r = await validateDeployment(pc, FAKE_ADDR);
    expect(r.ok).toBe(false);
  });

  it('returns ok:false when token() != canonical Arc USDC', async () => {
    const WRONG = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const pc = makePublicClient({
      getBytecode: vi.fn().mockResolvedValue('0x6001'),
      readContract: vi.fn().mockResolvedValueOnce(WRONG),
    });
    const r = await validateDeployment(pc, FAKE_ADDR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not the canonical Arc USDC');
  });

  it('returns ok:false when decimals() != 6', async () => {
    const pc = makePublicClient({
      getBytecode: vi.fn().mockResolvedValue('0x6001'),
      readContract: vi.fn()
        .mockResolvedValueOnce(ARC_TESTNET_USDC)
        .mockResolvedValueOnce(18),   // wrong decimals
    });
    const r = await validateDeployment(pc, FAKE_ADDR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('decimals');
  });

  it('returns ok:false when getBytecode throws', async () => {
    const pc = makePublicClient({ getBytecode: vi.fn().mockRejectedValue(new Error('RPC fail')) });
    const r = await validateDeployment(pc, FAKE_ADDR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Bytecode check failed');
  });
});

// ── checkPreflight ────────────────────────────────────────────────────────────

describe('checkPreflight', () => {
  it('returns ok:true with correct account + chain + address', () => {
    const r = checkPreflight(FAKE_ADDR, ARC_CHAIN_ID, FAKE_ADDR);
    expect(r.ok).toBe(true);
  });

  it('returns ok:false when account is undefined', () => {
    const r = checkPreflight(undefined, ARC_CHAIN_ID, FAKE_ADDR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('not connected');
  });

  it('returns ok:false when chainId is wrong', () => {
    const r = checkPreflight(FAKE_ADDR, 1, FAKE_ADDR); // Ethereum mainnet
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Wrong chain');
  });

  it('returns ok:false when contractAddress is undefined', () => {
    const r = checkPreflight(FAKE_ADDR, ARC_CHAIN_ID, undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('No contract');
  });
});

// ── waitForReceipt ────────────────────────────────────────────────────────────

describe('waitForReceipt', () => {
  it('returns success on success receipt', async () => {
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', transactionHash: FAKE_HASH }),
    });
    const r = await waitForReceipt(pc, FAKE_HASH);
    expect(r.kind).toBe('success');
    expect(r.hash).toBe(FAKE_HASH);
  });

  it('returns reverted on reverted receipt', async () => {
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'reverted', transactionHash: FAKE_HASH }),
    });
    const r = await waitForReceipt(pc, FAKE_HASH);
    expect(r.kind).toBe('reverted');
    expect(r.hash).toBe(FAKE_HASH);
  });

  it('returns uncertain and preserves hash on timeout', async () => {
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('Transaction timed out')),
    });
    const r = await waitForReceipt(pc, FAKE_HASH);
    expect(r.kind).toBe('uncertain');
    expect(r.hash).toBe(FAKE_HASH);
    if (r.kind === 'uncertain') expect(r.reason).toBeTruthy();
  });

  it('returns uncertain and preserves hash on RPC error', async () => {
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('RPC connection refused')),
    });
    const r = await waitForReceipt(pc, FAKE_HASH);
    expect(r.kind).toBe('uncertain');
    expect(r.hash).toBe(FAKE_HASH);
  });
});

// ── approveAndFund ────────────────────────────────────────────────────────────

describe('approveAndFund', () => {
  const baseParams = () => ({
    contractAddress: FAKE_ADDR,
    account: FAKE_ADDR,
    orderId: FAKE_HASH as `0x${string}`,
    amountRaw: 50_000_000n,
    publicClient: makePublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', transactionHash: FAKE_HASH }),
    }),
    walletClient: makeWalletClient(FAKE_HASH),
    onStatus: vi.fn() as (s: TxStatus) => void,
  });

  it('returns fund-submitted when approval succeeds', async () => {
    const p = baseParams();
    const r = await approveAndFund(p);
    expect(r.kind).toBe('fund-submitted');
    if (r.kind === 'fund-submitted') expect(r.hash).toBe(FAKE_HASH);
    // writeContract called twice: approve + fund
    expect((p.walletClient.writeContract as Mock).mock.calls).toHaveLength(2);
  });

  it('emits wallet-pending then confirming then wallet-pending (fund) status sequence', async () => {
    const { statuses, onStatus } = captureStatus();
    const p = { ...baseParams(), onStatus };
    await approveAndFund(p);
    const kinds = statuses.map(s => s.kind);
    expect(kinds).toContain('wallet-pending');
    expect(kinds).toContain('confirming');
    // Second wallet-pending is for the fund step
    expect(kinds.filter(k => k === 'wallet-pending')).toHaveLength(2);
    expect(kinds).toContain('submitted');
  });

  it('returns approve-rejected and does NOT send fund when approval wallet rejects', async () => {
    const p = {
      ...baseParams(),
      walletClient: {
        account: { address: FAKE_ADDR },
        writeContract: vi.fn().mockRejectedValue(new Error('user rejected')),
      } as MinimalWalletClient,
    };
    const r = await approveAndFund(p);
    expect(r.kind).toBe('approve-rejected');
    expect((p.walletClient.writeContract as Mock).mock.calls).toHaveLength(1); // only approve, no fund
  });

  it('returns approve-reverted and does NOT send fund when approval reverts on-chain', async () => {
    const p = {
      ...baseParams(),
      publicClient: makePublicClient({
        waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'reverted', transactionHash: FAKE_HASH }),
      }),
    };
    const r = await approveAndFund(p);
    expect(r.kind).toBe('approve-reverted');
    // writeContract called only once (approve only, not fund)
    expect((p.walletClient.writeContract as Mock).mock.calls).toHaveLength(1);
  });

  it('returns approve-uncertain and does NOT send fund when approval receipt is uncertain', async () => {
    const p = {
      ...baseParams(),
      publicClient: makePublicClient({
        waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timeout')),
      }),
    };
    const r = await approveAndFund(p);
    expect(r.kind).toBe('approve-uncertain');
    // writeContract called only once (approve only, not fund)
    expect((p.walletClient.writeContract as Mock).mock.calls).toHaveLength(1);
  });

  it('approve-uncertain result preserves the approval hash', async () => {
    const APPROVE_HASH = FAKE_HASH;
    const p = {
      ...baseParams(),
      walletClient: makeWalletClient(APPROVE_HASH),
      publicClient: makePublicClient({
        waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timed out')),
      }),
    };
    const r = await approveAndFund(p);
    expect(r.kind).toBe('approve-uncertain');
    if (r.kind === 'approve-uncertain') expect(r.hash).toBe(APPROVE_HASH);
  });
});

// ── singleWrite ───────────────────────────────────────────────────────────────

describe('singleWrite', () => {
  it('returns submitted with hash on success', async () => {
    const wc = makeWalletClient(FAKE_HASH2);
    const { statuses, onStatus } = captureStatus();
    const r = await singleWrite({
      contractAddress: FAKE_ADDR,
      account: FAKE_ADDR,
      functionName: 'settle',
      args: [FAKE_HASH],
      label: 'Settle',
      walletClient: wc,
      onStatus,
    });
    expect(r.kind).toBe('submitted');
    if (r.kind === 'submitted') expect(r.hash).toBe(FAKE_HASH2);
    expect(statuses.map(s => s.kind)).toEqual(['wallet-pending', 'submitted']);
  });

  it('returns rejected when wallet rejects', async () => {
    const wc: MinimalWalletClient = {
      account: { address: FAKE_ADDR },
      writeContract: vi.fn().mockRejectedValue(new Error('User denied transaction signature')),
    };
    const { statuses, onStatus } = captureStatus();
    const r = await singleWrite({
      contractAddress: FAKE_ADDR,
      account: FAKE_ADDR,
      functionName: 'refund',
      args: [FAKE_HASH],
      label: 'Refund',
      walletClient: wc,
      onStatus,
    });
    expect(r.kind).toBe('rejected');
    const rejectedStatus = statuses.find(s => s.kind === 'rejected');
    expect(rejectedStatus).toBeDefined();
    if (rejectedStatus?.kind === 'rejected') {
      expect(rejectedStatus.message).toContain('rejected');
    }
  });
});

// ── In-flight guard ───────────────────────────────────────────────────────────

describe('in-flight guard', () => {
  it('acquires when idle, blocks when in-flight, releases', () => {
    const ref = makeInflightRef();
    expect(acquireInflight(ref)).toBe(true);  // first acquire: succeeds
    expect(acquireInflight(ref)).toBe(false); // second acquire: blocked
    releaseInflight(ref);
    expect(acquireInflight(ref)).toBe(true);  // after release: succeeds again
    releaseInflight(ref);
  });

  it('double-click scenario: second operation is blocked', () => {
    const ref = makeInflightRef();
    // First click acquires
    expect(acquireInflight(ref)).toBe(true);
    // Second click (double-click) is blocked — no transaction sent
    expect(acquireInflight(ref)).toBe(false);
    releaseInflight(ref);
  });
});

// ── isTxBusy ─────────────────────────────────────────────────────────────────

describe('isTxBusy', () => {
  it('returns true for wallet-pending, submitted, confirming, uncertain', () => {
    expect(isTxBusy({ kind: 'wallet-pending', label: 'x' })).toBe(true);
    expect(isTxBusy({ kind: 'submitted', hash: FAKE_HASH, label: 'x' })).toBe(true);
    expect(isTxBusy({ kind: 'confirming', hash: FAKE_HASH, label: 'x' })).toBe(true);
    expect(isTxBusy({ kind: 'uncertain', hash: FAKE_HASH, label: 'x', reason: 'r' })).toBe(true);
  });

  it('returns false for idle, confirmed, reverted, rejected', () => {
    expect(isTxBusy({ kind: 'idle' })).toBe(false);
    expect(isTxBusy({ kind: 'confirmed', hash: FAKE_HASH, label: 'x' })).toBe(false);
    expect(isTxBusy({ kind: 'reverted', hash: FAKE_HASH, message: 'm' })).toBe(false);
    expect(isTxBusy({ kind: 'rejected', message: 'm' })).toBe(false);
  });
});

// ── handleReceiptOutcome ──────────────────────────────────────────────────────
// These tests exercise the exact lifecycle logic used by App's receipt effect.
// They verify the lock/clear semantics that prevent duplicate writes on uncertain.

describe('handleReceiptOutcome', () => {
  const fundOp: PendingOp = { kind: 'fund', orderId: '0xabc', label: 'Fund' };
  const createOp: PendingOp = { kind: 'create', orderId: '0xdef', label: 'Create order' };

  // ── success ──────────────────────────────────────────────────────────────

  it('success: releaseLock=true, clearPending=true, newStatus=confirmed', () => {
    const inst = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, fundOp);
    expect(inst.releaseLock).toBe(true);
    expect(inst.clearPending).toBe(true);
    expect(inst.newStatus.kind).toBe('confirmed');
    if (inst.newStatus.kind === 'confirmed') {
      expect(inst.newStatus.hash).toBe(FAKE_HASH);
      expect(inst.newStatus.label).toBe('Fund');
    }
  });

  it('success: refreshBalances=true', () => {
    const inst = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, fundOp);
    expect(inst.refreshBalances).toBe(true);
  });

  it('success with fund op: refreshOrderId equals orderId', () => {
    const inst = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, fundOp);
    expect(inst.refreshOrderId).toBe('0xabc');
  });

  it('success with create op: refreshOrderId equals the created orderId', () => {
    const inst = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, createOp);
    // App uses op.kind==='create' to navigate — refreshOrderId must carry the orderId
    expect(inst.refreshOrderId).toBe('0xdef');
  });

  it('success with null op: still releases lock and clears pending', () => {
    const inst = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, null);
    expect(inst.releaseLock).toBe(true);
    expect(inst.clearPending).toBe(true);
    expect(inst.newStatus.kind).toBe('confirmed');
  });

  // ── reverted ─────────────────────────────────────────────────────────────

  it('reverted: releaseLock=true, clearPending=true, newStatus=reverted', () => {
    const inst = handleReceiptOutcome({ kind: 'reverted', hash: FAKE_HASH }, fundOp);
    expect(inst.releaseLock).toBe(true);
    expect(inst.clearPending).toBe(true);
    expect(inst.newStatus.kind).toBe('reverted');
    if (inst.newStatus.kind === 'reverted') expect(inst.newStatus.hash).toBe(FAKE_HASH);
  });

  it('reverted: refreshBalances=false', () => {
    const inst = handleReceiptOutcome({ kind: 'reverted', hash: FAKE_HASH }, fundOp);
    expect(inst.refreshBalances).toBe(false);
  });

  // ── uncertain — the critical case ────────────────────────────────────────

  it('uncertain: releaseLock=false — lock must be preserved', () => {
    const inst = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout' },
      fundOp
    );
    expect(inst.releaseLock).toBe(false);
  });

  it('uncertain: clearPending=false — hash + op context must be preserved for retry', () => {
    const inst = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout' },
      fundOp
    );
    expect(inst.clearPending).toBe(false);
  });

  it('uncertain: newStatus=uncertain with original hash and reason', () => {
    const inst = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'RPC connection refused' },
      fundOp
    );
    expect(inst.newStatus.kind).toBe('uncertain');
    if (inst.newStatus.kind === 'uncertain') {
      expect(inst.newStatus.hash).toBe(FAKE_HASH);
      expect(inst.newStatus.reason).toBe('RPC connection refused');
    }
  });

  it('uncertain: refreshBalances=false', () => {
    const inst = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout' },
      fundOp
    );
    expect(inst.refreshBalances).toBe(false);
  });

  // ── lifecycle integration: lock + pending semantics ───────────────────────

  it('uncertain does NOT release lock — duplicate write is blocked', () => {
    const ref = makeInflightRef();
    expect(acquireInflight(ref)).toBe(true); // acquire for first operation

    const inst = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout' },
      fundOp
    );
    // Simulate what App does: only release if releaseLock
    if (inst.releaseLock) releaseInflight(ref);

    // Lock must still be held — a second write attempt is blocked
    expect(acquireInflight(ref)).toBe(false);
  });

  it('success releases lock — subsequent write is allowed', () => {
    const ref = makeInflightRef();
    expect(acquireInflight(ref)).toBe(true);

    const inst = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, fundOp);
    if (inst.releaseLock) releaseInflight(ref);

    // Lock released — next operation can proceed
    expect(acquireInflight(ref)).toBe(true);
    releaseInflight(ref);
  });

  it('reverted releases lock — subsequent write is allowed', () => {
    const ref = makeInflightRef();
    expect(acquireInflight(ref)).toBe(true);

    const inst = handleReceiptOutcome({ kind: 'reverted', hash: FAKE_HASH }, fundOp);
    if (inst.releaseLock) releaseInflight(ref);

    expect(acquireInflight(ref)).toBe(true);
    releaseInflight(ref);
  });

  it('uncertain then retry then confirmed: lock held through uncertain, released on confirmed', () => {
    const ref = makeInflightRef();
    expect(acquireInflight(ref)).toBe(true); // original write acquires

    // First receipt: uncertain — lock must stay
    const uncertain = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout' },
      fundOp
    );
    if (uncertain.releaseLock) releaseInflight(ref);
    expect(acquireInflight(ref)).toBe(false); // still blocked

    // Retry fires: another uncertain — still locked
    const uncertain2 = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout again' },
      fundOp
    );
    if (uncertain2.releaseLock) releaseInflight(ref);
    expect(acquireInflight(ref)).toBe(false); // still blocked

    // Retry fires: now confirmed — lock is released
    const confirmed = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, fundOp);
    if (confirmed.releaseLock) releaseInflight(ref);
    expect(acquireInflight(ref)).toBe(true); // now free
    releaseInflight(ref);
  });

  it('uncertain then retry then reverted: lock held through uncertain, released on reverted', () => {
    const ref = makeInflightRef();
    expect(acquireInflight(ref)).toBe(true);

    const uncertain = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'rpc error' },
      fundOp
    );
    if (uncertain.releaseLock) releaseInflight(ref);
    expect(acquireInflight(ref)).toBe(false); // still locked

    const reverted = handleReceiptOutcome({ kind: 'reverted', hash: FAKE_HASH }, fundOp);
    if (reverted.releaseLock) releaseInflight(ref);
    expect(acquireInflight(ref)).toBe(true); // released
    releaseInflight(ref);
  });

  it('create uncertain preserves original orderId in op context', () => {
    // Simulate: App sets pendingOpRef = { kind:'create', orderId:'0xdef', label:'Create order' }
    // then receipt returns uncertain. pendingOpRef must not be cleared.
    const op: PendingOp = { kind: 'create', orderId: '0xdef', label: 'Create order' };
    let pendingOp: PendingOp | null = op;

    const inst = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout' },
      pendingOp
    );

    // App only nuls pendingOp if clearPending
    if (inst.clearPending) pendingOp = null;

    // pendingOp must still carry the original create orderId
    expect(pendingOp).not.toBeNull();
    expect(pendingOp?.kind).toBe('create');
    expect(pendingOp?.orderId).toBe('0xdef');
  });

  it('create success does NOT look up order before confirmed receipt (clearPending only on success)', () => {
    // Before success: clearPending is false for uncertain → order lookup must not happen
    const uncertainInst = handleReceiptOutcome(
      { kind: 'uncertain', hash: FAKE_HASH, reason: 'timeout' },
      createOp
    );
    expect(uncertainInst.clearPending).toBe(false);
    expect(uncertainInst.refreshOrderId).toBeUndefined();

    // After success: refreshOrderId carries the orderId → App can navigate
    const successInst = handleReceiptOutcome({ kind: 'success', hash: FAKE_HASH }, createOp);
    expect(successInst.refreshOrderId).toBe('0xdef');
  });
});
