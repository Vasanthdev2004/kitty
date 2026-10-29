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
  makeInflightRef, releaseInflight, waitForReceipt,
  type MinimalPublicClient, type MinimalWalletClient, type PendingOp,
} from './kitty-tx';
import type { TxStatus } from './pt-types';
import { plain } from './pt-ui';

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
  onDone: (d: TxDone) => void;
}) {
  const { dep, publicClient, walletClient, account, chainId, deploymentValid, onDone } = p;
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
    const r = await kittyWrite({ dep, functionName: call.functionName, args: call.args, label: 'Start kitty', walletClient, onStatus: setTxStatus });
    if (r.kind === 'submitted') { submit({ kind: 'create', orderId: potId, label: 'Start kitty' }, r.hash); toast.success('Kitty submitted. Waiting for confirmation.'); }
    else releaseInflight(inflightRef.current);
  }, [gate, walletClient, dep, submit]);

  const chipIn = useCallback(async (potId: `0x${string}`, amountRaw: bigint, hasAllowance: boolean) => {
    const acct = gate();
    if (!acct || !walletClient) return;
    if (hasAllowance) {
      const r = await kittyWrite({ dep, functionName: 'fund', args: [potId, amountRaw], label: 'Chip in', walletClient, onStatus: setTxStatus });
      if (r.kind === 'submitted') submit({ kind: 'fund', orderId: potId, label: 'Chip in' }, r.hash);
      else releaseInflight(inflightRef.current);
      return;
    }
    if (!minimal) { releaseInflight(inflightRef.current); return; }
    const r = await approveAndChipIn({ dep, potId, amountRaw, publicClient: minimal, walletClient, onStatus: setTxStatus });
    if (r.kind === 'chip-in-submitted') submit({ kind: 'fund', orderId: potId, label: 'Chip in' }, r.hash);
    else if (r.kind === 'approve-uncertain') {
      // The approval may still land. Keep the lock and the hash; Retry re-polls it.
      submit({ kind: 'fund', orderId: potId, label: 'Approve USDC' }, r.hash);
      notifyError('Approval uncertain. Do not resubmit. Use Retry lookup.');
    } else releaseInflight(inflightRef.current);
  }, [gate, walletClient, dep, minimal, submit]);

  const simple = useCallback(async (fn: 'settle' | 'refund', kind: PendingOp['kind'], label: string, potId: `0x${string}`) => {
    const acct = gate();
    if (!acct || !walletClient) return;
    const r = await kittyWrite({ dep, functionName: fn, args: [potId], label, walletClient, onStatus: setTxStatus });
    if (r.kind === 'submitted') submit({ kind, orderId: potId, label }, r.hash);
    else releaseInflight(inflightRef.current);
  }, [gate, walletClient, dep, submit]);

  const payOut = useCallback((potId: `0x${string}`) => simple('settle', 'settle', 'Pay out', potId), [simple]);
  const getRefund = useCallback((potId: `0x${string}`) => simple('refund', 'refund', 'Get refund', potId), [simple]);

  /** Re-polls the same hash. Never submits a new transaction. */
  const retry = useCallback(() => {
    if (txStatus.kind !== 'uncertain' || !publicClient) return;
    if (!pendingOpRef.current) { notifyError('Cannot retry: operation context lost. Check the explorer.'); return; }
    const hash = txStatus.hash;
    setTxStatus({ kind: 'confirming', hash, label: pendingOpRef.current.label });
    setPendingHash(undefined);
    setTimeout(() => setPendingHash(hash), 0);
  }, [txStatus, publicClient]);

  return { txStatus, busy: isTxBusy(txStatus), createKitty, chipIn, payOut, getRefund, retry };
}
