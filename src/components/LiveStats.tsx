// ─── Kitty – live stats on the home page ────────────────────────────────────
// Numbers come from onchain events since the deploy block. On a fresh deployment
// there is nothing to count, so the section invites the first kitty instead of
// showing zeros. If the scan fails the section simply is not shown.
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useNowMs } from '../hooks';
import { formatUsdcPlain } from '../pt-share';
import { agoText } from '../kitty-core';
import type { KittyStats } from '../kitty-requests';
import { AnimatedAmount } from './AnimatedAmount';
import { AnimatedCount } from './AnimatedCount';
import { Button, Card, Skeleton } from './ui';

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tile px-4 py-3.5">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5 text-2xl font-medium text-ink">{children}</p>
    </div>
  );
}

export function LiveStats({
  stats, loading, failed, explorerBase, onStart,
}: {
  stats: KittyStats | undefined;
  loading: boolean;
  failed: boolean;
  explorerBase: string;
  onStart: () => void;
}) {
  const nowMs = useNowMs(60_000);
  if (failed) return null; // hide quietly

  if (loading || !stats) {
    return (
      <section aria-label="Live stats" aria-busy="true" className="space-y-3">
        <Skeleton className="h-4 w-24 rounded-full" />
        <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[76px] rounded-[14px]" />)}</div>
      </section>
    );
  }

  if (stats.created === 0) {
    return (
      <section aria-label="Live stats">
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="space-y-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Be the first kitty</h2>
            <p className="text-sm text-ink-2">Nothing has been started here yet. Yours could be the first.</p>
          </div>
          <Button onClick={onStart}>Start a kitty</Button>
        </Card>
      </section>
    );
  }

  const nowSec = Math.floor(nowMs / 1000);
  return (
    <section aria-label="Live stats" className="space-y-4">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">Live on Kitty</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Paid out">
          <AnimatedAmount raw={stats.paidOutRaw} className="mono" />
          <span className="text-xs font-normal text-ink-3">USDC</span>
        </Figure>
        <Figure label="Kitties started"><AnimatedCount value={stats.created} className="mono" /></Figure>
        <Figure label="People chipped in"><AnimatedCount value={stats.people} className="mono" /></Figure>
      </div>

      {stats.recent.length > 0 && (
        <Card className="space-y-3 p-5 sm:p-6" role="region" aria-label="Recent payouts">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">Recent payouts</h3>
          <ul className="divide-y divide-[var(--line)]">
            {stats.recent.map(r => (
              <li key={r.txHash} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p title={r.ref} className="truncate text-[13px] text-ink">{r.ref || 'Untitled kitty'}</p>
                  <p className="mt-0.5 text-xs text-ink-3">{r.timestamp ? agoText(nowSec - r.timestamp) : 'Time unavailable'}</p>
                </div>
                <span className="tnum shrink-0 text-[13px] text-ink">{formatUsdcPlain(r.amountRaw)} <span className="text-ink-3">USDC</span></span>
                <a
                  href={`${explorerBase}/tx/${r.txHash}`} target="_blank" rel="noopener noreferrer"
                  aria-label="View payout transaction"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink max-sm:h-11 max-sm:w-11"
                >
                  <ArrowSquareOut size={16} weight="regular" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
