// ─── PayTogether – Transaction orchestration ─────────────────────────────────
//
// All state-mutating flows live here, extracted from App.tsx so they can be
// unit-tested with mock wallet/publicClient without a browser or wagmi provider.
//
// Rules enforced at this layer:
//  • Connected account + correct chain required before any write.
//  • Bytecode validation: contract must be deployed (non-empty code) on Arc Testnet.
//  • Token validation: contract.token() must equal canonical Arc USDC; decimals()==6.
//  • Approval receipt must be SUCCESS before fund proceeds; reverted approval aborts.
//  • On RPC timeout / uncertain receipt: preserve hash, set status 'uncertain', block
//    duplicate writes — never resubmit as a fresh transaction.
//  • Synchronous in-flight guard (ref): double clicks or tab switches cannot
//    start a second operation while one is in-flight.
//  • After a confirmed receipt, refresh balances + order state.
//  • Newly created order is only looked up after a successful receipt.

import { arcTestnet } from 'viem/chains';
import { PAY_TOGETHER_ABI, ERC20_APPROVE_ABI } from './pt-abi';
import { ARC_TESTNET_USDC, USDC_DECIMALS } from './pt-utils';
import type { TxStatus } from './pt-types';

// ── Chain constant ────────────────────────────────────────────────────────────
export const ARC_CHAIN_ID: number = arcTestnet.id;

// ── Minimal viem-compatible interface (injectable for tests) ──────────────────

export interface MinimalPublicClient {
  chain?: { id: number };
  getBytecode(args: { address: `0x${string}` }): Promise<`0x${string}` | undefined>;
  readContract(args: {
    address: `0x${string}`;
    abi: unknown;
    functionName: string;
    args?: unknown[];
  }): Promise<unknown>;
  waitForTransactionReceipt(args: {
    hash: `0x${string}`;
    timeout?: number;
  }): Promise<{ status: 'success' | 'reverted'; transactionHash: `0x${string}` }>;
}

export interface MinimalWalletClient {
  account?: { address: `0x${string}` };
  writeContract(args: {
    address: `0x${string}`;
    abi: unknown;
    functionName: string;
    args?: unknown[];
    chain?: unknown;
    account?: unknown;
  }): Promise<`0x${string}`>;
}

// ── Deployment validation result ──────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; tokenAddress: `0x${string}` }
  | { ok: false; reason: string };

/**
 * Validate that the contract is deployed on Arc and its token() equals the
 * canonical Arc Testnet USDC with decimals() == 6.
 * Returns ok:true with the token address, or ok:false with a human reason.
 */
export async function validateDeployment(
  publicClient: MinimalPublicClient,
  contractAddress: `0x${string}`
): Promise<ValidationResult> {
  // 1. Bytecode must be non-empty
  let code: `0x${string}` | undefined;
  try {
    code = await publicClient.getBytecode({ address: contractAddress });
  } catch (e) {
    return { ok: false, reason: `Bytecode check failed: ${String(e).slice(0, 80)}` };
  }
  if (!code || code === '0x') {
    return { ok: false, reason: 'No contract found at that address on Arc Testnet.' };
  }

  // 2. token() must equal canonical Arc USDC
  let tokenAddr: unknown;
  try {
    tokenAddr = await publicClient.readContract({
      address: contractAddress,
      abi: PAY_TOGETHER_ABI,
      functionName: 'token',
    });
  } catch (e) {
    return { ok: false, reason: `token() read failed: ${String(e).slice(0, 80)}` };
  }
  if (typeof tokenAddr !== 'string' || tokenAddr.toLowerCase() !== ARC_TESTNET_USDC.toLowerCase()) {
    return {
      ok: false,
      reason: `Contract token (${String(tokenAddr).slice(0, 20)}…) is not the canonical Arc USDC.`,
    };
  }

  // 3. decimals() on the token must be 6
  let decimals: unknown;
  try {
    decimals = await publicClient.readContract({
      address: ARC_TESTNET_USDC,
      abi: ERC20_APPROVE_ABI,
      functionName: 'decimals',
    });
  } catch (e) {
    return { ok: false, reason: `decimals() read failed: ${String(e).slice(0, 80)}` };
  }
  if (Number(decimals) !== USDC_DECIMALS) {
    return { ok: false, reason: `USDC decimals() returned ${String(decimals)}, expected 6.` };
  }

  return { ok: true, tokenAddress: tokenAddr as `0x${string}` };
}

// ── In-flight guard ───────────────────────────────────────────────────────────
//
// A single operation slot. Acquire before any write, release after.
// Returns false if already in-flight (caller should bail).

export type InflightRef = { current: boolean };

export function makeInflightRef(): InflightRef {
  return { current: false };
}

/** Returns true if acquired (was idle). Returns false if already in-flight. */
export function acquireInflight(ref: InflightRef): boolean {
  if (ref.current) return false;
  ref.current = true;
  return true;
}

export function releaseInflight(ref: InflightRef): void {
  ref.current = false;
}

// ── Pre-condition checks ──────────────────────────────────────────────────────

export type PreflightResult =
  | { ok: true; account: `0x${string}`; contractAddress: `0x${string}` }
  | { ok: false; reason: string };

export function checkPreflight(
  account: string | undefined,
  chainId: number | undefined,
  contractAddress: string | undefined
): PreflightResult {
  if (!account) return { ok: false, reason: 'Wallet not connected.' };
  if (chainId !== ARC_CHAIN_ID) {
    return { ok: false, reason: `Wrong chain (got ${chainId ?? 'unknown'}, need ${ARC_CHAIN_ID}).` };
  }
  if (!contractAddress) return { ok: false, reason: 'No contract address configured.' };
  return {
    ok: true,
    account: account as `0x${string}`,
    contractAddress: contractAddress as `0x${string}`,
  };
}

// ── Receipt outcome ───────────────────────────────────────────────────────────

export type ReceiptOutcome =
  | { kind: 'success'; hash: `0x${string}` }
  | { kind: 'reverted'; hash: `0x${string}` }
  | { kind: 'uncertain'; hash: `0x${string}`; reason: string };

/**
 * Wait for a transaction receipt with a timeout.
 * On timeout or RPC error: return 'uncertain' — preserving the hash so
 * the caller can show a "pending/uncertain" status and retry the lookup later.
 * Never resubmit a new transaction for an uncertain outcome.
 */
export async function waitForReceipt(
  publicClient: MinimalPublicClient,
  hash: `0x${string}`,
  timeoutMs = 60_000
): Promise<ReceiptOutcome> {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
    if (receipt.status === 'success') return { kind: 'success', hash };
    return { kind: 'reverted', hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out');
    return {
      kind: 'uncertain',
      hash,
      reason: isTimeout ? 'Receipt lookup timed out — transaction may still confirm.' : msg.slice(0, 120),
    };
  }
}

// ── Approve + Fund (two-step) ─────────────────────────────────────────────────
//
// approve() receipt MUST be SUCCESS before fund() is sent.
// A reverted or uncertain approval aborts immediately — no fund sent.

export interface ApproveAndFundParams {
  contractAddress: `0x${string}`;
  account: `0x${string}`;
  orderId: `0x${string}`;
  amountRaw: bigint;
  publicClient: MinimalPublicClient;
  walletClient: MinimalWalletClient;
  onStatus: (s: TxStatus) => void;
}

export type ApproveAndFundResult =
  | { kind: 'success'; fundHash: `0x${string}` }
  | { kind: 'approve-rejected'; message: string }
  | { kind: 'approve-reverted'; hash: `0x${string}` }
  | { kind: 'approve-uncertain'; hash: `0x${string}`; reason: string }
  | { kind: 'fund-rejected'; message: string }
  | { kind: 'fund-submitted'; hash: `0x${string}` };  // fund hash; caller awaits receipt

export async function approveAndFund(
  p: ApproveAndFundParams
): Promise<ApproveAndFundResult> {
  // Step 1: approve
  p.onStatus({ kind: 'wallet-pending', label: 'Approve USDC' });
  let approveHash: `0x${string}`;
  try {
    approveHash = await p.walletClient.writeContract({
      address: ARC_TESTNET_USDC,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [p.contractAddress, p.amountRaw],
      chain: { id: ARC_CHAIN_ID },
      account: p.walletClient.account,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.onStatus({ kind: 'rejected', message: `Approval rejected: ${msg.slice(0, 100)}` });
    return { kind: 'approve-rejected', message: msg };
  }

  p.onStatus({ kind: 'confirming', hash: approveHash, label: 'Approve USDC' });

  // Step 2: wait for approval receipt — must be SUCCESS
  const approvalOutcome = await waitForReceipt(p.publicClient, approveHash);
  if (approvalOutcome.kind === 'reverted') {
    p.onStatus({ kind: 'reverted', hash: approveHash, message: 'Approval reverted on-chain' });
    return { kind: 'approve-reverted', hash: approveHash };
  }
  if (approvalOutcome.kind === 'uncertain') {
    p.onStatus({
      kind: 'uncertain',
      hash: approveHash,
      label: 'Approve USDC',
      reason: approvalOutcome.reason,
    });
    return { kind: 'approve-uncertain', hash: approveHash, reason: approvalOutcome.reason };
  }

  // Step 3: fund
  p.onStatus({ kind: 'wallet-pending', label: 'Fund' });
  let fundHash: `0x${string}`;
  try {
    fundHash = await p.walletClient.writeContract({
      address: p.contractAddress,
      abi: PAY_TOGETHER_ABI,
      functionName: 'fund',
      args: [p.orderId, p.amountRaw],
      chain: { id: ARC_CHAIN_ID },
      account: p.walletClient.account,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.onStatus({ kind: 'rejected', message: `Fund rejected: ${msg.slice(0, 100)}` });
    return { kind: 'fund-rejected', message: msg };
  }

  p.onStatus({ kind: 'submitted', hash: fundHash, label: 'Fund' });
  return { kind: 'fund-submitted', hash: fundHash };
}

// ── Single write (fund with existing allowance, settle, refund, create) ───────

export interface SingleWriteParams {
  contractAddress: `0x${string}`;
  account: `0x${string}`;
  functionName: 'fund' | 'settle' | 'refund' | 'createOrder';
  args: unknown[];
  label: string;
  walletClient: MinimalWalletClient;
  onStatus: (s: TxStatus) => void;
}

export type SingleWriteResult =
  | { kind: 'submitted'; hash: `0x${string}` }
  | { kind: 'rejected'; message: string };

export async function singleWrite(p: SingleWriteParams): Promise<SingleWriteResult> {
  p.onStatus({ kind: 'wallet-pending', label: p.label });
  try {
    const hash = await p.walletClient.writeContract({
      address: p.contractAddress,
      abi: PAY_TOGETHER_ABI,
      functionName: p.functionName,
      args: p.args,
      chain: { id: ARC_CHAIN_ID },
      account: p.walletClient.account,
    });
    p.onStatus({ kind: 'submitted', hash, label: p.label });
    return { kind: 'submitted', hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rejected =
      msg.toLowerCase().includes('user rejected') ||
      msg.toLowerCase().includes('denied') ||
      msg.toLowerCase().includes('user denied');
    p.onStatus({ kind: 'rejected', message: rejected ? 'Wallet rejected the transaction' : msg.slice(0, 120) });
    return { kind: 'rejected', message: msg };
  }
}

// ── Receipt outcome handler ───────────────────────────────────────────────────
//
// Pure function: given a receipt outcome and the pending operation context,
// returns instructions for App to execute. Extracted so it can be unit-tested
// without React or wagmi.
//
// Key lifecycle rules:
//  • definitive (success / reverted): release lock, clear pending state, update status.
//  • uncertain (timeout / RPC error):  do NOT release lock, do NOT clear pending state.
//    The original hash and op context are preserved so retry re-polls the same hash.
//  • The caller (App) must only execute release/clear when told to by releaseLock/clearPending.

export interface PendingOp {
  kind: 'create' | 'fund' | 'settle' | 'refund';
  orderId?: string;
  label: string;
}

export interface ReceiptHandlerInstruction {
  /** Emit this TxStatus to React state. */
  newStatus: TxStatus;
  /** Release the in-flight lock (only on definitive outcomes). */
  releaseLock: boolean;
  /** Clear pendingHash + pendingOp (only on definitive outcomes). */
  clearPending: boolean;
  /** After a definitive success: if set, load this orderId from chain. */
  refreshOrderId?: string;
  /** Whether to refresh balances (after definitive success). */
  refreshBalances: boolean;
}

export function handleReceiptOutcome(
  outcome: ReceiptOutcome,
  op: PendingOp | null
): ReceiptHandlerInstruction {
  const label = op?.label ?? 'Transaction';

  if (outcome.kind === 'success') {
    const refreshOrderId =
      op?.kind === 'create' && op.orderId
        ? op.orderId   // newly created — look up after confirmed receipt
        : op?.orderId; // fund/settle/refund — refresh existing order
    return {
      newStatus: { kind: 'confirmed', hash: outcome.hash, label },
      releaseLock: true,
      clearPending: true,
      refreshOrderId,
      refreshBalances: true,
    };
  }

  if (outcome.kind === 'reverted') {
    return {
      newStatus: { kind: 'reverted', hash: outcome.hash, message: `${label} reverted on-chain` },
      releaseLock: true,
      clearPending: true,
      refreshBalances: false,
    };
  }

  // uncertain — preserve everything; caller must NOT release lock or clear pending
  return {
    newStatus: { kind: 'uncertain', hash: outcome.hash, label, reason: outcome.reason },
    releaseLock: false,
    clearPending: false,
    refreshBalances: false,
  };
}

// ── TxStatus helpers ──────────────────────────────────────────────────────────

/** Returns true while a write is pending (wallet prompt, submitted, or confirming) */
export function isTxBusy(s: TxStatus): boolean {
  return s.kind === 'wallet-pending' || s.kind === 'submitted' || s.kind === 'confirming' || s.kind === 'uncertain';
}

/** A submitted/confirming/uncertain status has a hash we should keep showing. */
export function txHash(s: TxStatus): `0x${string}` | undefined {
  if (
    s.kind === 'submitted' ||
    s.kind === 'confirming' ||
    s.kind === 'confirmed' ||
    s.kind === 'reverted' ||
    s.kind === 'uncertain'
  ) {
    return s.hash;
  }
  return undefined;
}
