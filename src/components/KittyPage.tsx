// ─── Kitty – the kitty page (?kitty=) ───────────────────────────────────────
import { formatDeadline } from '../pt-utils';
import { formatUsdcPlain } from '../pt-share';
import { buildKittyNudge, readPhaseOf } from '../kitty-core';
import type { KittyDeployment } from '../kitty-config';
import type { ActivityItem, KittyData } from '../kitty-types';
import type { TxStatus } from '../pt-types';
import { cn } from '../cn';
import { kittyAction, kittyActionHasDock } from '../kitty-core';
import { Skeleton } from './ui';
import { KittyHero } from './KittyHero';
import { KittyAction } from './KittyAction';
import { OpenContributors, OpenProgress } from './OpenPeople';
import { ContributorGrid, SegmentedProgress } from './SegmentedProgress';
import { ActivityFeed } from './ActivityFeed';
import { EmbedCard, KittyDetails, ReceiptCard } from './KittyExtras';
import { ShareCard } from './ShareCard';

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
  onChipIn: (amountRaw: bigint, hasAllowance: boolean) => void | Promise<void>;
  onPayOut: () => void | Promise<void>;
  onGetRefund: () => void | Promise<void>;
  justCreated: boolean;
  activity: { items: ActivityItem[] | undefined; loading: boolean; error: string | undefined; retry: () => void };
}

export function KittyPage(p: KittyPageProps) {
  const { data, dep, connectedAddress: me } = p;
  const readPhase = readPhaseOf(data);
  const row = me ? data.contributors.find(c => c.address.toLowerCase() === me.toLowerCase()) : undefined;
  // Open kitties list everyone who chipped in, so "not listed" means zero so far.
  const my = row
    ? { shareRaw: row.shareRaw, contributedRaw: row.contributedRaw, refunded: row.refunded }
    : data.mode === 'open' && me ? { shareRaw: 0n, contributedRaw: 0n, refunded: false } : undefined;

  const action = kittyAction({ connected: !!me, correctChain: p.isCorrectChain, phase: readPhase, mode: data.mode, my });
  const docked = kittyActionHasDock(action);
  const requested = data.creator.toLowerCase() === data.recipient.toLowerCase();
  const paid = p.activity.items?.find(a => a.kind === 'paid');

  const share = (
    <ShareCard
      potId={data.id}
      title={data.ref || 'this kitty'}
      justCreated={p.justCreated}
      buildNudge={link => buildKittyNudge({
        ref: data.ref || 'this kitty',
        mode: data.mode,
        shareText: data.mode === 'split' && my && my.shareRaw > 0n ? formatUsdcPlain(my.shareRaw) : undefined,
        goalText: formatUsdcPlain(data.goalRaw),
        deadlineText: formatDeadline(data.deadline),
        link,
      })}
    />
  );

  return (
    <div className={cn('space-y-4', docked ? 'pb-[calc(18rem+env(safe-area-inset-bottom))] lg:pb-0' : 'pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0')}>
      {p.justCreated && share}

      <KittyHero data={data} readPhase={readPhase} onRefresh={p.onRefresh} explorerBase={dep.explorerBase} />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {data.mode === 'split' ? (
            <>
              <SegmentedProgress contributions={data.contributors} connectedAddress={me} totalFundedRaw={data.totalFundedRaw} targetRaw={data.goalRaw} />
              <ContributorGrid contributions={data.contributors} connectedAddress={me} />
            </>
          ) : (
            <>
              <OpenProgress data={data} me={me} phaseIsOpen={readPhase === 'open'} />
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
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <KittyAction
            data={data} phase={readPhase} connectedAddress={me} isCorrectChain={p.isCorrectChain}
            onSwitchChain={p.onSwitchChain} networkName={dep.name} txStatus={p.txStatus}
            allowanceRaw={p.allowanceRaw} balanceRaw={p.balanceRaw} my={my}
            onChipIn={p.onChipIn} onPayOut={p.onPayOut} onGetRefund={p.onGetRefund}
          />
          {data.settled && <ReceiptCard data={data} dep={dep} paid={paid} />}
          {!p.justCreated && share}
          {requested && <EmbedCard potId={data.id} />}
          <KittyDetails data={data} dep={dep} />
        </div>
      </div>
    </div>
  );
}

export function KittySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading kitty">
      <div className="card space-y-5 p-5 sm:p-6">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-8 w-2/3 rounded-full" />
        <Skeleton className="h-14 w-1/2 rounded-[14px]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="card space-y-4 p-5 sm:p-6"><Skeleton className="h-4 w-1/3 rounded-full" /><Skeleton className="h-3.5 w-full rounded-full" /><Skeleton className="h-20 w-full rounded-[14px]" /></div>
        <div className="card space-y-4 p-5 sm:p-6"><Skeleton className="h-4 w-1/3 rounded-full" /><Skeleton className="h-12 w-full rounded-full" /></div>
      </div>
    </div>
  );
}
