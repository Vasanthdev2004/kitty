// ─── Kitty – transaction orchestration ──────────────────────────────────────
// The same safety rules as pt-tx.ts, generalized for the Kitty contract and a
// per-chain deployment config. The lock, receipt and retry primitives are
// shared with pt-tx.ts (acquireInflight, waitForReceipt, handleReceiptOutcome),
// so there is a single implementation of "uncertain keeps the lock".
//
//  - Connected account + correct chain before any write.
//  - Bytecode at the Kitty address, token() == the deployment's USDC, decimals == 6.
//  - The approval receipt must be SUCCESS before chip-in is sent.
//  - Uncertain receipt: keep the hash and the lock, never resubmit.
import { erc20Abi } from 'viem';
import { KITTY_ABI } from './kitty-abi';
import type { KittyDeployment } from './kitty-config';
import type { TxStatus } from './pt-types';
import { isRetryableRpcError, jitteredDelay, VALIDATION_DELAYS_MS } from './rpc';
import {
  waitForReceipt,
  type MinimalPublicClient, type MinimalWalletClient,
} from './pt-tx';

export {
  acquireInflight, releaseInflight, makeInflightRef, isTxBusy, waitForReceipt, handleReceiptOutcome,
} from './pt-tx';
export type { MinimalPublicClient, MinimalWalletClient, PendingOp, InflightRef } from './pt-tx';

// ── Deployment validation ────────────────────────────────────────────────────
//
// Three outcomes, and the difference matters:
//   ok                      the contract is what this app expects
//   !ok, no `transient`     a definitive mismatch (no bytecode, wrong token, wrong decimals). Final.
//   !ok, transient: true    the network could not answer (429, 5xx, timeout). Worth retrying.

export type KittyValidation =
  | { ok: true; tokenAddress: `0x${string}` }
  | { ok: false; reason: string; transient?: boolean; cause?: unknown };

export async function validateKittyDeployment(
  client: MinimalPublicClient, dep: KittyDeployment,
): Promise<KittyValidation> {
  const failed = (reason: string, e: unknown): KittyValidation =>
    ({ ok: false, reason, transient: isRetryableRpcError(e), cause: e });

  // The three reads are independent, so issue them together: they travel as one
  // JSON-RPC batch / one multicall. Results are then judged in a fixed order.
  const [codeR, tokenR, decimalsR] = await Promise.allSettled([
    client.getBytecode({ address: dep.kitty }),
    client.readContract({ address: dep.kitty, abi: KITTY_ABI, functionName: 'token' }),
    client.readContract({ address: dep.usdc, abi: erc20Abi, functionName: 'decimals' }),
  ]);

  if (codeR.status === 'rejected') return failed('Could not read the contract from the network.', codeR.reason);
  const code = codeR.value;
  if (!code || code === '0x') {
    return { ok: false, reason: `No Kitty contract found at that address on ${dep.name}.` };
  }

  if (tokenR.status === 'rejected') return failed('The contract does not answer like a Kitty contract.', tokenR.reason);
  const tokenAddr: unknown = tokenR.value;
  if (typeof tokenAddr !== 'string' || tokenAddr.toLowerCase() !== dep.usdc.toLowerCase()) {
    return { ok: false, reason: `Contract token (${String(tokenAddr).slice(0, 20)}…) is not the canonical USDC.` };
  }

  if (decimalsR.status === 'rejected') return failed('Could not read the USDC token from the network.', decimalsR.reason);
  const decimals: unknown = decimalsR.value;
  if (Number(decimals) !== dep.usdcDecimals) {
    return { ok: false, reason: `USDC decimals() returned ${String(decimals)}, expected ${dep.usdcDecimals}.` };
  }
  return { ok: true, tokenAddress: tokenAddr as `0x${string}` };
}

export interface RetryOptions {
  /** Waits between attempts, in ms. Default 1s, 3s, 7s (so up to 4 attempts). */
  delaysMs?: readonly number[];
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each wait with the 1-based retry number. */
  onRetry?: (retry: number, error: unknown) => void;
}

/** Validate, retrying transient network failures with backoff and jitter. Mismatches are final. */
export async function validateWithRetry(
  client: MinimalPublicClient, dep: KittyDeployment, opts: RetryOptions = {},
): Promise<KittyValidation> {
  const delays = opts.delaysMs ?? VALIDATION_DELAYS_MS;
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let result = await validateKittyDeployment(client, dep);
  for (let i = 0; i < delays.length; i++) {
    if (result.ok || !result.transient) return result;
    opts.onRetry?.(i + 1, result.cause);
    await sleep(jitteredDelay(delays[i], random));
    result = await validateKittyDeployment(client, dep);
  }
  return result;
}

// ── Validation cache ─────────────────────────────────────────────────────────
// A successful check is remembered for the browser session (so reloads skip it)
// and shared between callers (so a re-render never repeats the three reads).

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const cacheKey = (dep: KittyDeployment) => `kitty:validated:${dep.chainId}:${dep.kitty.toLowerCase()}`;

export function sessionStore(): StorageLike | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; }
}

export function hasCachedValidation(dep: KittyDeployment, store: StorageLike | undefined = sessionStore()): boolean {
  try { return store?.getItem(cacheKey(dep)) === '1'; } catch { return false; }
}

function rememberValidation(dep: KittyDeployment, store: StorageLike | undefined = sessionStore()): void {
  try { store?.setItem(cacheKey(dep), '1'); } catch { /* private mode: just skip the cache */ }
}

const inflight = new Map<string, Promise<KittyValidation>>();

/** One shared validation per chain + contract. Cached success short-circuits with no network call. */
export function ensureDeploymentValid(
  client: MinimalPublicClient, dep: KittyDeployment, opts: RetryOptions & { store?: StorageLike } = {},
): Promise<KittyValidation> {
  const store = opts.store ?? sessionStore();
  if (hasCachedValidation(dep, store)) return Promise.resolve({ ok: true, tokenAddress: dep.usdc });
  const key = cacheKey(dep);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = validateWithRetry(client, dep, opts).then(r => {
    if (r.ok) rememberValidation(dep, store);
    return r;
  }).finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

/** For the Retry button: forget any cached result so the next check hits the network. */
export function resetDeploymentValidation(dep: KittyDeployment, store: StorageLike | undefined = sessionStore()): void {
  inflight.delete(cacheKey(dep));
  try { store?.removeItem(cacheKey(dep)); } catch { /* ignore */ }
}

// ── Preflight ────────────────────────────────────────────────────────────────

export type KittyPreflight =
  | { ok: true; account: `0x${string}` }
  | { ok: false; reason: string };

export function checkKittyPreflight(
  account: string | undefined, chainId: number | undefined, dep: KittyDeployment,
): KittyPreflight {
  if (!dep.deployed) return { ok: false, reason: `Kitty is not deployed on ${dep.shortName} yet.` };
  if (!account) return { ok: false, reason: 'Wallet not connected.' };
  if (chainId !== dep.chainId) {
    return { ok: false, reason: `Wrong chain (got ${chainId ?? 'unknown'}, need ${dep.chainId}).` };
  }
  return { ok: true, account: account as `0x${string}` };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type KittyFn = 'createSplitPot' | 'createOpenPot' | 'fund' | 'settle' | 'refund';

export interface KittyWriteParams {
  dep: KittyDeployment;
  functionName: KittyFn;
  args: readonly unknown[];
  label: string;
  walletClient: MinimalWalletClient;
  onStatus: (s: TxStatus) => void;
}

export type KittyWriteResult =
  | { kind: 'submitted'; hash: `0x${string}` }
  | { kind: 'rejected'; message: string };

const isUserRejection = (msg: string) => /user rejected|user denied|denied/i.test(msg);

export async function kittyWrite(p: KittyWriteParams): Promise<KittyWriteResult> {
  p.onStatus({ kind: 'wallet-pending', label: p.label });
  try {
    const hash = await p.walletClient.writeContract({
      address: p.dep.kitty,
      abi: KITTY_ABI,
      functionName: p.functionName,
      args: [...p.args],
      chain: { id: p.dep.chainId },
      account: p.walletClient.account,
    });
    p.onStatus({ kind: 'submitted', hash, label: p.label });
    return { kind: 'submitted', hash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.onStatus({ kind: 'rejected', message: isUserRejection(msg) ? 'Wallet rejected the transaction' : msg.slice(0, 120) });
    return { kind: 'rejected', message: msg };
  }
}

export type ApproveAndChipInResult =
  | { kind: 'approve-rejected'; message: string }
  | { kind: 'approve-reverted'; hash: `0x${string}` }
  | { kind: 'approve-uncertain'; hash: `0x${string}`; reason: string }
  | { kind: 'chip-in-rejected'; message: string }
  | { kind: 'chip-in-submitted'; hash: `0x${string}` };

/**
 * approve(amount) -> wait for a SUCCESS receipt -> fund(potId, amount).
 * A reverted or uncertain approval stops here: nothing else is sent.
 */
export async function approveAndChipIn(p: {
  dep: KittyDeployment;
  potId: `0x${string}`;
  amountRaw: bigint;
  publicClient: MinimalPublicClient;
  walletClient: MinimalWalletClient;
  onStatus: (s: TxStatus) => void;
}): Promise<ApproveAndChipInResult> {
  p.onStatus({ kind: 'wallet-pending', label: 'Approve USDC' });
  let approveHash: `0x${string}`;
  try {
    approveHash = await p.walletClient.writeContract({
      address: p.dep.usdc,
      abi: erc20Abi,
      functionName: 'approve',
      args: [p.dep.kitty, p.amountRaw],
      chain: { id: p.dep.chainId },
      account: p.walletClient.account,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.onStatus({ kind: 'rejected', message: `Approval rejected: ${msg.slice(0, 100)}` });
    return { kind: 'approve-rejected', message: msg };
  }

  p.onStatus({ kind: 'confirming', hash: approveHash, label: 'Approve USDC' });
  const outcome = await waitForReceipt(p.publicClient, approveHash);
  if (outcome.kind === 'reverted') {
    p.onStatus({ kind: 'reverted', hash: approveHash, message: 'Approval reverted onchain' });
    return { kind: 'approve-reverted', hash: approveHash };
  }
  if (outcome.kind === 'uncertain') {
    p.onStatus({ kind: 'uncertain', hash: approveHash, label: 'Approve USDC', reason: outcome.reason });
    return { kind: 'approve-uncertain', hash: approveHash, reason: outcome.reason };
  }

  p.onStatus({ kind: 'wallet-pending', label: 'Chip in' });
  let fundHash: `0x${string}`;
  try {
    fundHash = await p.walletClient.writeContract({
      address: p.dep.kitty,
      abi: KITTY_ABI,
      functionName: 'fund',
      args: [p.potId, p.amountRaw],
      chain: { id: p.dep.chainId },
      account: p.walletClient.account,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.onStatus({ kind: 'rejected', message: `Chip in rejected: ${msg.slice(0, 100)}` });
    return { kind: 'chip-in-rejected', message: msg };
  }
  p.onStatus({ kind: 'submitted', hash: fundHash, label: 'Chip in' });
  return { kind: 'chip-in-submitted', hash: fundHash };
}
