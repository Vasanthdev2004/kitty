// ─── Kitty – transaction hook ───────────────────────────────────────────────
// One in-flight write at a time, the approval receipt gates chip-in, and an
// uncertain receipt keeps both the lock and the hash so Retry re-polls the SAME
// transaction. The lifecycle rules live in kitty-tx.ts / pt-tx.ts; this hook
// only wires them to React state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseEventLogs, type PublicClient } from 'viem';
import { toast } from 'sonner';
import { KITTY_ABI } from './kitty-abi';
import type { KittyDeployment } from './kitty-config';
import {
  buildCreateCall, computePotId, potIdFromDecodedLogs, randomSalt, type KittyDraft,
} from './kitty-core';
import {
  acquireInflight, approveAndChipIn, checkKittyPreflight, handleReceiptOutcome, isTxBusy, kittyWrite,
  makeInflightRef, permitChipIn, releaseInflight, waitForReceipt,
  type MinimalPublicClient, type MinimalWalletClient, type PendingOp,
} from './kitty-tx';
import { chooseChipInPath, permitDeadline } from './permit';
import { preparePermit, type PreparedPermit } from './permit-io';
import type { TxStatus } from './pt-types';
import { plain } from './pt-ui';
import { formatUsdcPlain } from './pt-share';
import { formatDeadline } from './pt-utils';
import {
  describeCancel, describeChipIn, describeCreate, describeFundFor, describePayOut, describeRefund, type WriteSummary,
} from './write-summary';

const notifyError = (m: string) => toast.error(plain(m));

export interface TxDone {
  op: PendingOp;
  /** Pot id read back from the PotCreated event (falls back to the derived id). */
  createdId?: `0x${string}`;
}

export function useKittyTx(p: {
  dep: KittyDeployment;
  publicClient: PublicClient | undefined;
  walletClient: MinimalWalletClient | undefined;
  account: string | undefined;
  chainId: number | undefined;
  /** True once the deployment passed bytecode, token() and decimals checks. */
  deploymentValid: boolean;
  /** Mainnet: resolves true once the user has seen exactly what is about to happen. Testnet: omit. */
  confirmWrite?: (summary: WriteSummary) => Promise<boolean>;
  onDone: (d: TxDone) => void;
}) {
  const { dep, publicClient, walletClient, account, chainId, deploymentValid, confirmWrite, onDone } = p;
  const [txStatus, setTxStatus] = useState<TxStatus>({ kind: 'idle' });
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const pendingOpRef = useRef<PendingOp | null>(null);
  const inflightRef = useRef(makeInflightRef());
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  const minimal = publicClient as unknown as MinimalPublicClient | undefined;

  // Receipt poller. Definitive outcomes release the lock; uncertain keeps everything.
  useEffect(() => {
    if (!pendingHash || !minimal || !publicClient) return;
    let cancelled = false;
    void waitForReceipt(minimal, pendingHash, 90_000).then(async outcome => {
      if (cancelled) return;
      const op = pendingOpRef.current;
      const inst = handleReceiptOutcome(outcome, op);
      setTxStatus(inst.newStatus);
      if (inst.releaseLock) releaseInflight(inflightRef.current);
      if (inst.clearPending) { setPendingHash(undefined); pendingOpRef.current = null; }

      if (inst.newStatus.kind === 'confirmed' && op) {
        toast.success(plain(`${op.label} confirmed`));
        let createdId: `0x${string}` | undefined;
        if (op.kind === 'create') {
          createdId = op.orderId as `0x${string}` | undefined;
          try {
            const receipt = await publicClient.getTransactionReceipt({ hash: pendingHash });
            const decoded = parseEventLogs({ abi: KITTY_ABI, eventName: 'PotCreated', logs: receipt.logs });
            createdId = potIdFromDecodedLogs(decoded, dep.kitty) ?? createdId;
          } catch { /* the derived id is used */ }
        }
        onDoneRef.current({ op, createdId });
      } else if (inst.newStatus.kind === 'reverted') {
        notifyError(`${op?.label ?? 'Transaction'} reverted`);
      } else if (inst.newStatus.kind === 'uncertain') {
        notifyError(`${op?.label ?? 'Transaction'}: receipt uncertain. Use Retry lookup.`);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHash]);

  /** Shared gate for every write. Returns the account, or undefined after telling the user why not. */
  const gate = useCallback((): `0x${string}` | undefined => {
    const pre = checkKittyPreflight(account, chainId, dep);
    if (!pre.ok) { notifyError(pre.reason); return undefined; }
    if (!walletClient) { notifyError('Wallet client unavailable'); return undefined; }
    if (!deploymentValid) { notifyError('Contract not validated'); return undefined; }
    if (!acquireInflight(inflightRef.current)) { notifyError('A transaction is already in progress'); return undefined; }
    return pre.account;
  }, [account, chainId, dep, walletClient, deploymentValid]);

  /**
   * Called right after `gate()` (so the lock is already held and nothing else can start).
   * Declining releases the lock and sends nothing.
   */
  const confirmed = useCallback(async (summary: WriteSummary): Promise<boolean> => {
    const ok = confirmWrite ? await confirmWrite(summary) : true;
    if (!ok) releaseInflight(inflightRef.current);
    return ok;
  }, [confirmWrite]);

  const submit = useCallback((op: PendingOp, hash: `0x${string}`) => {
    pendingOpRef.current = op;
    setPendingHash(hash);
  }, []);

  const createKitty = useCallback(async (draft: KittyDraft, recipient: string) => {
    const acct = gate();
    if (!acct || !walletClient) return;
    const salt = randomSalt();
    const potId = computePotId(acct, salt);
    let call: ReturnType<typeof buildCreateCall>;
    try { call = buildCreateCall(draft, salt, recipient); } catch (e) {
      releaseInflight(inflightRef.current);
      notifyError(e instanceof Error ? e.message : 'Invalid details');
      return;
    }
    const args = call.args as unknown as readonly [unknown, unknown, bigint, bigint, string];
    const ok = await confirmed(describeCreate({
      ref: args[4], goalText: `${formatUsdcPlain(args[2])} USDC`, recipient,
      deadlineText: formatDeadline(args[3]), modeLabel: draft.mode === 'split' ? 'Split between named people' : 'Open pool',
    }));
    if (!ok) return;
    const r = await kittyWrite({ dep, functionName: call.functionName, args: call.args, label: 'Start kitty', walletClient, onStatus: setTxStatus });
    if (r.kind === 'submitted') { submit({ kind: 'create', orderId: potId, label: 'Start kitty' }, r.hash); toast.success('Kitty submitted. Waiting for confirmation.'); }
    else releaseInflight(inflightRef.current);
  }, [gate, confirmed, walletClient, dep, submit]);

  /**
   * Chip in, for yourself or (with `friend`) for someone else.
   * Path: allowance already covers it -> one plain transaction. Otherwise sign a permit
   * and send one transaction. If the wallet cannot sign typed data, or the token's permit
   * domain does not check out, fall back to approve, wait for the receipt, then chip in.
   * A signature the person declines stops everything; it never silently becomes an approval.
   */
  const chipIn = useCallback(async (
    potId: `0x${string}`, amountRaw: bigint, allowanceRaw: bigint,
    ctx?: { ref: string; recipient: string }, friend?: `0x${string}`,
  ) => {
    const acct = gate();
    if (!acct || !walletClient) return;
    const ref = ctx?.ref ?? potId;
    const recipient = ctx?.recipient ?? 'the recipient';
    const amountText = `${formatUsdcPlain(amountRaw)} USDC`;
    const ok = await confirmed(friend
      ? describeFundFor({ ref, amountText, recipient, friend })
      : describeChipIn({ ref, amountText, recipient }));
    if (!ok) return;
    const done = (hash: `0x${string}`, label: string) => submit({ kind: 'fund', orderId: potId, label }, hash);

    if (allowanceRaw >= amountRaw) {
      const r = await kittyWrite({
        dep, functionName: friend ? 'fundFor' : 'fund', args: friend ? [potId, friend, amountRaw] : [potId, amountRaw],
        label: 'Chip in', walletClient, onStatus: setTxStatus,
      });
      if (r.kind === 'submitted') done(r.hash, 'Chip in'); else releaseInflight(inflightRef.current);
      return;
    }
    if (!minimal) { releaseInflight(inflightRef.current); return; }

    // Reading the token's domain takes a moment; show the first step right away.
    setTxStatus({ kind: 'wallet-pending', label: 'Sign permit' });
    const prepared: PreparedPermit = await preparePermit(minimal, dep, acct);
    const path = chooseChipInPath({ allowanceRaw, amountRaw, permitUsable: prepared.ok });
    if (path === 'permit' && prepared.ok) {
      const r = await permitChipIn({
        dep, owner: acct, potId, beneficiary: friend, amountRaw, domain: prepared.domain, nonce: prepared.nonce,
        deadline: permitDeadline(Math.floor(Date.now() / 1000)), walletClient, onStatus: setTxStatus,
      });
      if (r.kind === 'chip-in-submitted') { done(r.hash, 'Chip in'); return; }
      if (r.kind !== 'unsupported') { releaseInflight(inflightRef.current); return; }
      // unsupported: fall through to approve + chip in
    }
    const r = await approveAndChipIn({ dep, potId, beneficiary: friend, amountRaw, publicClient: minimal, walletClient, onStatus: setTxStatus });
    if (r.kind === 'chip-in-submitted') done(r.hash, 'Chip in');
    else if (r.kind === 'approve-uncertain') {
      // The approval may still land. Keep the lock and the hash; Retry re-polls it.
      done(r.hash, 'Approve USDC');
      notifyError('Approval uncertain. Do not resubmit. Use Retry lookup.');
    } else releaseInflight(inflightRef.current);
  }, [gate, confirmed, walletClient, dep, minimal, submit]);

  const simple = useCallback(async (
    fn: 'settle' | 'refund' | 'cancel', kind: PendingOp['kind'], label: string, potId: `0x${string}`, summary: WriteSummary,
  ) => {
    const acct = gate();
    if (!acct || !walletClient) return;
    if (!(await confirmed(summary))) return;
    const r = await kittyWrite({ dep, functionName: fn, args: [potId], label, walletClient, onStatus: setTxStatus });
    if (r.kind === 'submitted') submit({ kind, orderId: potId, label }, r.hash);
    else releaseInflight(inflightRef.current);
  }, [gate, confirmed, walletClient, dep, submit]);

  const payOut = useCallback((potId: `0x${string}`, ctx?: { ref: string; recipient: string; goalRaw: bigint }) =>
    simple('settle', 'settle', 'Pay out', potId, describePayOut({
      ref: ctx?.ref ?? potId, amountText: ctx ? `${formatUsdcPlain(ctx.goalRaw)} USDC` : 'the full goal', recipient: ctx?.recipient ?? 'the recipient',
    })), [simple]);
  const getRefund = useCallback((potId: `0x${string}`, ctx?: { ref: string; amountRaw: bigint }) =>
    simple('refund', 'refund', 'Get refund', potId, describeRefund({
      ref: ctx?.ref ?? potId, amountText: ctx ? `${formatUsdcPlain(ctx.amountRaw)} USDC` : 'your contribution',
    })), [simple]);

  const cancelKitty = useCallback((potId: `0x${string}`, ctx?: { ref: string }) =>
    simple('cancel', 'cancel', 'Cancel kitty', potId, describeCancel({ ref: ctx?.ref ?? potId })), [simple]);

  /** Re-polls the same hash. Never submits a new transaction. */
  const retry = useCallback(() => {
    if (txStatus.kind !== 'uncertain' || !publicClient) return;
    if (!pendingOpRef.current) { notifyError('Cannot retry: operation context lost. Check the explorer.'); return; }
    const hash = txStatus.hash;
    setTxStatus({ kind: 'confirming', hash, label: pendingOpRef.current.label });
    setPendingHash(undefined);
    setTimeout(() => setPendingHash(hash), 0);
  }, [txStatus, publicClient]);

  return { txStatus, busy: isTxBusy(txStatus), createKitty, chipIn, payOut, getRefund, cancelKitty, retry };
}
