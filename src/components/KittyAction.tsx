// ─── Kitty – the one action card for the current wallet and state ────────────
import { useState, type ReactNode } from 'react';
import { ConnectKitButton } from 'connectkit';
import { formatUsdc, parseUsdcAmount } from '../pt-utils';
import { formatUsdcPlain } from '../pt-share';
import {
  THIRTY_DAY_RULE, chipInBounds, kittyAction, kittyActionHasDock, validateChipIn, type KittyPhase,
} from '../kitty-core';
import type { KittyData } from '../kitty-types';
import type { TxStatus } from '../pt-types';
import { cn } from '../cn';
import { Button, Card } from './ui';
import { AmountInput } from './fields';

// uncertain counts as busy: the original tx may still confirm, never allow a duplicate write.
const isBusy = (s: TxStatus) =>
  s.kind === 'wallet-pending' || s.kind === 'submitted' || s.kind === 'confirming' || s.kind === 'uncertain';

function busyText(s: TxStatus): string {
  switch (s.kind) {
    case 'wallet-pending': return 'Waiting for wallet';
    case 'submitted': return 'Submitted';
    case 'confirming': return 'Confirming';
    case 'uncertain': return 'Pending';
    default: return 'Working';
  }
}

function Shell({ title, dock, children }: { title: string; dock: boolean; children: ReactNode }) {
  return (
    <Card
      className={cn(
        'space-y-4 p-5 sm:p-6',
        dock && 'max-md:fixed max-md:inset-x-3 max-md:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] max-md:z-30 max-md:space-y-3 max-md:p-4',
      )}
    >
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </Card>
  );
}

const Body = ({ children }: { children: ReactNode }) => (
  <p className="text-[13px] leading-relaxed text-ink-2 text-pretty">{children}</p>
);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile px-3 py-2.5">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mono mt-1 text-sm text-ink">{value}</p>
    </div>
  );
}

// ── Chip in ──────────────────────────────────────────────────────────────────

function ChipInForm({
  data, my, allowanceRaw, balanceRaw, txStatus, onChipIn,
}: {
  data: KittyData;
  my: { shareRaw: bigint; contributedRaw: bigint } | undefined;
  allowanceRaw: bigint | undefined;
  balanceRaw: bigint | undefined;
  txStatus: TxStatus;
  onChipIn: (amountRaw: bigint, hasAllowance: boolean) => void | Promise<void>;
}) {
  const bounds = chipInBounds({
    mode: data.mode, goalRaw: data.goalRaw, totalFundedRaw: data.totalFundedRaw, effectiveMinRaw: data.effectiveMinRaw, my,
  });
  const [input, setInput] = useState(() => formatUsdc(data.mode === 'split' ? bounds.max : bounds.min));
  const parsed = parseUsdcAmount(input);
  const amountRaw = parsed.ok ? parsed.raw : 0n;
  const busy = isBusy(txStatus);
  const hasAllowance = allowanceRaw !== undefined && allowanceRaw >= amountRaw && amountRaw > 0n;
  const hasFunds = balanceRaw !== undefined && balanceRaw >= amountRaw && amountRaw > 0n;
  const amountErr = !input.trim() ? '' : !parsed.ok ? parsed.error : validateChipIn(amountRaw, bounds, data.mode) ?? '';
  const err = amountErr || (balanceRaw !== undefined && amountRaw > 0n && !hasFunds ? 'Not enough USDC in your wallet.' : '');
  const disabled = busy || !parsed.ok || !!amountErr || amountRaw === 0n || !hasFunds;
  const set = (raw: bigint) => setInput(formatUsdc(raw));

  return (
    <>
      {data.mode === 'split' && my ? (
        <div className="grid grid-cols-3 gap-2 max-md:hidden">
          <Stat label="Your share" value={formatUsdcPlain(my.shareRaw)} />
          <Stat label="Chipped in" value={formatUsdcPlain(my.contributedRaw)} />
          <Stat label="Left" value={formatUsdcPlain(my.shareRaw - my.contributedRaw)} />
        </div>
      ) : (
        <p className="tnum text-[13px] text-ink-2 max-md:text-xs" data-testid="chip-in-hint">
          {my && my.contributedRaw > 0n
            ? 'You are already in. Add any amount up to what is still needed.'
            : <>Chip in at least <span className="text-ink">{formatUsdcPlain(bounds.min)} USDC</span>, up to <span className="text-ink">{formatUsdcPlain(bounds.max)} USDC</span>.</>}
        </p>
      )}

      <div className="space-y-2">
        <AmountInput
          value={input}
          onChange={setInput}
          invalid={!!err}
          disabled={busy}
          ariaLabel="Amount to chip in, in USDC"
          describedBy={err ? 'chip-err' : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {data.mode === 'open' && bounds.min < bounds.max && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => set(bounds.min)}>Minimum</Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => set(bounds.max)}>
            {data.mode === 'split' ? 'Full share' : 'Remaining'}
          </Button>
        </div>
        {err && <p id="chip-err" role="alert" className="text-[12.5px] text-err-text">{err}</p>}
        {(balanceRaw !== undefined || allowanceRaw !== undefined) && (
          <p className="tnum text-xs text-ink-3">
            {balanceRaw !== undefined && <>Balance {formatUsdcPlain(balanceRaw)}</>}
            {balanceRaw !== undefined && allowanceRaw !== undefined && <span aria-hidden> / </span>}
            {allowanceRaw !== undefined && <>Allowance {formatUsdcPlain(allowanceRaw)}</>}
          </p>
        )}
      </div>

      <Button
        size="lg" className="w-full" disabled={disabled} loading={busy} loadingText={busyText(txStatus)}
        onClick={() => { if (parsed.ok && !amountErr) void onChipIn(parsed.raw, hasAllowance); }}
      >
        {!hasAllowance && amountRaw > 0n ? 'Approve and chip in' : 'Chip in'}
      </Button>
      {!hasAllowance && amountRaw > 0n && !busy && <p className="text-xs text-ink-3 max-md:hidden">Two steps: approve USDC, then chip in.</p>}
    </>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export interface KittyActionProps {
  data: KittyData;
  phase: KittyPhase;
  connectedAddress: string | undefined;
  isCorrectChain: boolean;
  onSwitchChain: () => void;
  networkName: string;
  txStatus: TxStatus;
  allowanceRaw: bigint | undefined;
  balanceRaw: bigint | undefined;
  /** The wallet's own row. For open kitties this is read separately when not in the list. */
  my: { shareRaw: bigint; contributedRaw: bigint; refunded: boolean } | undefined;
  onChipIn: (amountRaw: bigint, hasAllowance: boolean) => void | Promise<void>;
  onPayOut: () => void | Promise<void>;
  onGetRefund: () => void | Promise<void>;
}

export function KittyAction(p: KittyActionProps) {
  const kind = kittyAction({
    connected: !!p.connectedAddress, correctChain: p.isCorrectChain, phase: p.phase, mode: p.data.mode, my: p.my,
  });
  const dock = kittyActionHasDock(kind);
  const busy = isBusy(p.txStatus);

  switch (kind) {
    case 'connect':
      return (
        <Shell title="Join this kitty" dock={false}>
          <Body>Connect your wallet to chip in, pay out, or get a refund.</Body>
          <ConnectKitButton.Custom>
            {({ show }) => <Button size="lg" className="w-full" onClick={show}>Connect wallet</Button>}
          </ConnectKitButton.Custom>
        </Shell>
      );
    case 'switch':
      return (
        <Shell title="Wrong network" dock={false}>
          <Body>Switch to {p.networkName} to use this kitty.</Body>
          <Button size="lg" className="w-full" onClick={p.onSwitchChain}>Switch to Arc</Button>
        </Shell>
      );
    case 'chip-in':
      return (
        <Shell title="Chip in" dock={dock}>
          <ChipInForm
            key={`${p.data.totalFundedRaw}-${p.my?.contributedRaw ?? 0n}`}
            data={p.data} my={p.my} allowanceRaw={p.allowanceRaw} balanceRaw={p.balanceRaw}
            txStatus={p.txStatus} onChipIn={p.onChipIn}
          />
        </Shell>
      );
    case 'share-paid':
      return (
        <Shell title="Your share is in" dock={false}>
          <Body>Nothing left for you to do. The money stays locked until everyone has chipped in.</Body>
        </Shell>
      );
    case 'not-invited':
      return (
        <Shell title="You are not on the list" dock={false}>
          <Body>Only the people named on this kitty can chip in. You can still follow the progress here.</Body>
        </Shell>
      );
    case 'pay-out':
      return (
        <Shell title="Pay out" dock={dock}>
          <Body>The goal is met. Anyone can pay out, you do not need to be on the kitty. The recipient gets the full amount in one payment.</Body>
          <Button size="lg" className="w-full" onClick={() => void p.onPayOut()} disabled={busy} loading={busy} loadingText={busyText(p.txStatus)}>
            Pay out
          </Button>
          <p className="text-xs leading-relaxed text-ink-3">{THIRTY_DAY_RULE}</p>
        </Shell>
      );
    case 'paid':
      return (
        <Shell title="Paid out" dock={false}>
          <Body>The recipient has been paid. Delivery is between the people involved, not the contract.</Body>
        </Shell>
      );
    case 'refund':
      return (
        <Shell title="Get refund" dock={dock}>
          <Body>
            {p.phase === 'stuck'
              ? 'The goal was met but nobody paid out within 30 days of the deadline, so everyone can take their own money back. '
              : 'The deadline passed before the goal was met. '}
            You can take back your own{' '}
            <span className="tnum text-ink">{formatUsdcPlain(p.my?.contributedRaw ?? 0n)} USDC</span>.
          </Body>
          <Button size="lg" className="w-full" onClick={() => void p.onGetRefund()} disabled={busy} loading={busy} loadingText={busyText(p.txStatus)}>
            Get refund
          </Button>
          <p className="text-xs leading-relaxed text-ink-3">{THIRTY_DAY_RULE}</p>
        </Shell>
      );
    case 'refunded':
      return (
        <Shell title="Refund received" dock={false}>
          <Body>Your money is back in your wallet.</Body>
        </Shell>
      );
    case 'nothing':
      return (
        <Shell title="Nothing to do" dock={false}>
          <Body>You did not chip into this kitty, so there is nothing to take back.</Body>
        </Shell>
      );
  }
}
