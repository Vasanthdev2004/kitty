// ─── Kitty – the kitty page (?kitty=) ───────────────────────────────────────
// One clock for the whole page (useChainNow, one interval, paused while the tab
// is hidden). The phase it yields drives the countdown, the timeline AND the
// action card, so when the deadline passes the page re-evaluates by itself:
// Chip in goes away and Get refund appears, then a re-read confirms it onchain.
import { useEffect, useRef, useState } from 'react';
import { useChainNow, useShareBase } from '../hooks';
import { buildKittyNudge, buildKittyUrl, canCancel, kittyAction, kittyActionHasDock, kittyPhase, readPhaseOf } from '../kitty-core';
import { canRemind, dismissShareStep, isShareStepDismissed, localStore, remindMessageFor } from '../share-messages';
import { formatDeadline } from '../pt-utils';
import { formatUsdcPlain } from '../pt-share';
import type { KittyDeployment } from '../kitty-config';
import type { ActivityItem, KittyData } from '../kitty-types';
import type { TxStatus } from '../pt-types';
import { cn } from '../cn';
import { Button, Skeleton } from './ui';
import { ConfirmDialog } from './ConfirmDialog';
import { KittyHero } from './KittyHero';
import { KittyAction } from './KittyAction';
import { OpenContributors, OpenProgress } from './OpenPeople';
import { ContributorGrid, SegmentedProgress } from './SegmentedProgress';
import { ActivityFeed } from './ActivityFeed';
import { EmbedCard, KittyDetails, ReceiptCard } from './KittyExtras';
import { ShareCard } from './ShareCard';
import { ShareStep } from './ShareStep';
import { WhatHappensNext } from './WhatHappensNext';

export interface KittyPageProps {
  data: KittyData;
  dep: KittyDeployment;
  connectedAddress: string | undefined;
  isCorrectChain: boolean;
  onSwitchChain: () => void;
  txStatus: TxStatus;
  allowanceRaw: bigint | undefined;
  balanceRaw: bigint | undefined;
  onRefresh: () => void | Promise<void>;
  /** `friend` set: pay for that person (fundFor). */
  onChipIn: (amountRaw: bigint, friend?: `0x${string}`) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onPayOut: () => void | Promise<void>;
  onGetRefund: () => void | Promise<void>;
  /** This browser just created this kitty. */
  justCreated: boolean;
  activity: { items: ActivityItem[] | undefined; loading: boolean; error: string | undefined; retry: () => void };
}

export function KittyPage(p: KittyPageProps) {
  const { data, dep, connectedAddress: me } = p;

  // The page clock. Everything time-dependent below reads `chainNow`.
  const chainNow = useChainNow(data.chainTimestamp);
  const readPhase = readPhaseOf(data);
  const phase = kittyPhase({ settled: data.settled, cancelled: data.cancelled, totalFundedRaw: data.totalFundedRaw, goalRaw: data.goalRaw, deadline: data.deadline, now: chainNow });

  // When the clock moves the phase past the last read, re-read once (a moment later, so the
  // chain clock has caught up). The action card already follows the live phase meanwhile.
  const refreshedFor = useRef<string>('');
  useEffect(() => {
    if (phase === readPhase) return;
    const key = `${data.id}:${phase}`;
    if (refreshedFor.current === key) return;
    refreshedFor.current = key;
    const id = setTimeout(() => void p.onRefresh(), 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, readPhase, data.id]);

  const row = me ? data.contributors.find(c => c.address.toLowerCase() === me.toLowerCase()) : undefined;
  // Open kitties list everyone who chipped in, so "not listed" means zero so far.
  const my = row
    ? { shareRaw: row.shareRaw, contributedRaw: row.contributedRaw, refunded: row.refunded }
    : data.mode === 'open' && me ? { shareRaw: 0n, contributedRaw: 0n, refunded: false } : undefined;

  const action = kittyAction({ connected: !!me, correctChain: p.isCorrectChain, phase, mode: data.mode, my });
  const docked = kittyActionHasDock(action);
  const requested = data.creator.toLowerCase() === data.recipient.toLowerCase();
  const paid = p.activity.items?.find(a => a.kind === 'paid');
  const isCreator = !!me && data.creator.toLowerCase() === me.toLowerCase();
  const mayCancel = canCancel({ phase, me, creator: data.creator, recipient: data.recipient }) && p.isCorrectChain;
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Share step: prominent for a new kitty and for its creator until dismissed (remembered per kitty).
  const [dismissed, setDismissed] = useState(() => isShareStepDismissed(dep.chainId, data.id, localStore()));
  const showStep = !dismissed && phase === 'open' && (p.justCreated || isCreator);

  // Reminders (split kitties): the creator and the recipient can nudge anyone who still owes.
  const base = useShareBase();
  const link = base ? buildKittyUrl(base, data.id) : undefined;
  const remind = data.mode === 'split' && phase === 'open' && canRemind(data, me) && link
    ? (c: { shareRaw: bigint; contributedRaw: bigint }) => remindMessageFor(data, c.shareRaw, c.contributedRaw, link)
    : undefined;

  const shareCard = (
    <ShareCard
      potId={data.id}
      title={data.ref || 'this kitty'}
      buildNudge={l => buildKittyNudge({
        ref: data.ref || 'this kitty',
        mode: data.mode,
        shareText: data.mode === 'split' && my && my.shareRaw > 0n ? formatUsdcPlain(my.shareRaw) : undefined,
        goalText: formatUsdcPlain(data.goalRaw),
        deadlineText: formatDeadline(data.deadline),
        link: l,
      })}
    />
  );

  return (
    <div className={cn('space-y-4', docked ? 'pb-[calc(18rem+env(safe-area-inset-bottom))] lg:pb-0' : 'pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0')}>
      {showStep && (
        <ShareStep
          data={data}
          me={me}
          onDismiss={() => { dismissShareStep(dep.chainId, data.id, localStore()); setDismissed(true); }}
        />
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel this kitty?" danger confirmLabel="Cancel kitty" cancelLabel="Keep kitty"
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => { setConfirmCancel(false); void p.onCancel(); }}
        >
          <p>Nobody will be able to chip in or be paid out. Everyone who already chipped in can take their own money back right away.</p>
          <p>This cannot be undone.</p>
        </ConfirmDialog>
      )}

      <KittyHero data={data} chainNow={chainNow} onRefresh={p.onRefresh} explorerBase={dep.explorerBase} me={me} />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {data.mode === 'split' ? (
            <>
              <SegmentedProgress contributions={data.contributors} connectedAddress={me} totalFundedRaw={data.totalFundedRaw} targetRaw={data.goalRaw} />
              <ContributorGrid contributions={data.contributors} connectedAddress={me} remindMessage={remind} />
            </>
          ) : (
            <>
              <OpenProgress data={data} me={me} phaseIsOpen={phase === 'open'} />
              <OpenContributors data={data} me={me} />
            </>
          )}
          <ActivityFeed
            items={p.activity.items}
            loading={p.activity.loading}
            error={p.activity.error}
            me={me}
            explorerBase={dep.explorerBase}
            onRetry={p.activity.retry}
            nowSec={Number(chainNow)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <KittyAction
            data={data} phase={phase} connectedAddress={me} isCorrectChain={p.isCorrectChain}
            onSwitchChain={p.onSwitchChain} networkName={dep.name} shortName={dep.shortName} faucetUrl={dep.faucetUrl} txStatus={p.txStatus}
            allowanceRaw={p.allowanceRaw} balanceRaw={p.balanceRaw} my={my}
            onChipIn={p.onChipIn} onPayOut={p.onPayOut} onGetRefund={p.onGetRefund}
          />
          {mayCancel && (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-xs leading-relaxed text-ink-3">You started or receive this kitty, so you can stop it.</p>
              <Button variant="ghost" size="sm" className="shrink-0 text-err-text hover:text-err-text" onClick={() => setConfirmCancel(true)}>
                Cancel kitty
              </Button>
            </div>
          )}
          <WhatHappensNext phase={phase} deadline={data.deadline} now={chainNow} />
          {data.settled && <ReceiptCard data={data} dep={dep} paid={paid} />}
          {!showStep && shareCard}
          {requested && <EmbedCard potId={data.id} />}
          <KittyDetails data={data} dep={dep} />
        </div>
      </div>
    </div>
  );
}

/** Same shape as the loaded page: header card, progress, tiles, activity, and the right column. */
export function KittySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading kitty">
      <div className="card space-y-5 p-5 sm:p-6">
        <div className="flex items-center gap-2"><Skeleton className="h-6 w-20 rounded-full" /><Skeleton className="h-4 w-16 rounded-full" /></div>
        <Skeleton className="h-8 w-2/3 rounded-full" />
        <Skeleton className="h-5 w-1/2 rounded-full" />
        <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
          <Skeleton className="h-12 w-56 rounded-[14px]" />
          <div className="flex gap-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-[64px] rounded-[14px]" />)}</div>
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <div className="card space-y-4 p-5 sm:p-6">
            <Skeleton className="h-4 w-1/3 rounded-full" />
            <Skeleton className="h-3.5 w-full rounded-full" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-28 rounded-[14px]" />
              <Skeleton className="h-28 rounded-[14px]" />
            </div>
          </div>
          <div className="card space-y-4 p-5 sm:p-6">
            <Skeleton className="h-4 w-1/4 rounded-full" />
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-2/3 rounded-full" /><Skeleton className="h-3 w-1/4 rounded-full" /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="card space-y-4 p-5 sm:p-6"><Skeleton className="h-4 w-1/3 rounded-full" /><Skeleton className="h-12 w-full rounded-field" /><Skeleton className="h-12 w-full rounded-full" /></div>
          <div className="card space-y-3 p-5 sm:p-6"><Skeleton className="h-4 w-1/2 rounded-full" /><Skeleton className="h-10 w-full rounded-[14px]" /><Skeleton className="h-10 w-full rounded-[14px]" /></div>
        </div>
      </div>
    </div>
  );
}
