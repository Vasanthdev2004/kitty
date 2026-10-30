// ─── Kitty – hero: title, recipient, funded amount, countdown ────────────────
import { ArrowSquareOut, ArrowsClockwise } from '@phosphor-icons/react';
import { formatDeadline, shortAddress } from '../pt-utils';
import { formatUsdcPlain, fundedPercent, paidSummary } from '../pt-share';
import { splitCountdown } from '../pt-ui';
import { PHASE_PILL, kittyPhase, type KittyPhase } from '../kitty-core';
import type { KittyData } from '../kitty-types';
import { Card, Chip, IconButton, PersonAvatar } from './ui';
import { AnimatedAmount } from './AnimatedAmount';
import { CopyButton } from './fields';

function DigitBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="tile min-w-[64px] flex-1 px-3 py-2.5 text-center sm:min-w-[76px] sm:flex-none">
      <p className="mono text-2xl font-medium leading-none text-ink" data-testid={`cd-${label}`}>{String(value).padStart(2, '0')}</p>
      <p className="mt-1.5 text-xs text-ink-3">{label}</p>
    </div>
  );
}

const NOTE: Record<KittyPhase, (deadline: bigint) => string> = {
  open: d => `Chip in before ${formatDeadline(d)}. If the goal is not met, everyone gets their money back.`,
  ready: () => 'The goal is met. Anyone can pay out, and the recipient gets the full amount in one payment.',
  paid: () => 'Paid out to the recipient in one payment.',
  expired: d => `The deadline passed on ${formatDeadline(d)}. Each person can get back what they put in.`,
  stuck: () => 'The goal was met but nobody paid out within 30 days of the deadline, so paying out is closed. Everyone can take back their own money.',
  cancelled: () => 'This kitty was cancelled. Nobody can chip in or be paid out, and everyone can take back their own money right away.',
};

/** `chainNow` is the page's single clock (see KittyPage), so the hero never runs its own timer. */
export function KittyHero({
  data, chainNow, onRefresh, explorerBase, me,
}: { data: KittyData; chainNow: bigint; onRefresh: () => void | Promise<void>; explorerBase: string; me?: string }) {
  const phase = kittyPhase({ settled: data.settled, cancelled: data.cancelled, totalFundedRaw: data.totalFundedRaw, goalRaw: data.goalRaw, deadline: data.deadline, now: chainNow });
  const pill = PHASE_PILL[phase];
  const parts = splitCountdown(Number(data.deadline - chainNow));
  const pct = fundedPercent(data.totalFundedRaw, data.goalRaw);
  const requested = data.creator.toLowerCase() === data.recipient.toLowerCase();
  const people = data.contributors.length;
  const count = data.mode === 'split'
    ? paidSummary(data.contributors)
    : `${people} ${people === 1 ? 'person' : 'people'} chipped in`;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={pill.tone}>{pill.label}</Chip>
            <span className="text-[13px] text-ink-2">{data.mode === 'split' ? 'Split' : 'Open pool'}</span>
            {requested && <span className="text-[13px] text-ink-2">Requested by the recipient</span>}
          </div>
          <h1 title={data.ref} className="line-clamp-2 break-words font-sans text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink text-balance">{data.ref || 'Untitled kitty'}</h1>
          <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
            <PersonAvatar address={data.recipient} me={me} size={22} />
            <span>Recipient</span>
            <span className="mono text-ink">{shortAddress(data.recipient)}</span>
            <span className="-my-1 flex items-center">
              <CopyButton value={data.recipient} label="Copy recipient address" successMessage="Address copied" />
              {explorerBase && (
                <a
                  href={`${explorerBase}/address/${data.recipient}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View recipient on the explorer"
                  title="View on explorer"
                  className="inline-flex h-9 w-9 max-sm:h-11 max-sm:w-11 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-s3 hover:text-ink"
                >
                  <ArrowSquareOut size={18} weight="regular" />
                </a>
              )}
            </span>
          </div>
        </div>
        <IconButton icon={ArrowsClockwise} label="Refresh kitty" onClick={() => void onRefresh()} className="shrink-0" />
      </div>

      <div className="mt-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-2">Chipped in</p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-ink" data-testid="progress-label">
            <span className="text-4xl font-medium tracking-[-0.03em] sm:text-5xl"><AnimatedAmount raw={data.totalFundedRaw} /></span>
            <span className="mono text-base text-ink-2 sm:text-lg">of {formatUsdcPlain(data.goalRaw)} USDC</span>
          </p>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
            <span className="tnum text-ink" data-testid="paid-summary">{count}</span>
            <span aria-hidden className="h-1 w-1 rounded-full bg-ink-3" />
            <span className="tnum" data-testid="progress-pct">{pct.toFixed(1)}%</span>
          </p>
        </div>

        {phase === 'open' && (
          <div className="w-full sm:w-auto" role="timer" aria-label="Time until deadline">
            <div className="flex gap-2">
              <DigitBox value={parts.days} label="days" />
              <DigitBox value={parts.hours} label="hrs" />
              <DigitBox value={parts.mins} label="min" />
              <DigitBox value={parts.secs} label="sec" />
            </div>
          </div>
        )}
      </div>

      <p className="mt-6 text-[13px] leading-relaxed text-ink-2 text-pretty">{NOTE[phase](data.deadline)}</p>
    </Card>
  );
}
