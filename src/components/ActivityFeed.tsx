// ─── Kitty – activity feed (Funded / Settled / Refunded / PotCreated) ───────
import { ArrowSquareOut } from '@phosphor-icons/react';
import { shortAddress } from '../pt-utils';
import { formatUsdcPlain } from '../pt-share';
import { ACTIVITY_VERB, agoText } from '../kitty-core';
import type { ActivityItem } from '../kitty-types';
import { Avatar, Button, Card, Skeleton } from './ui';

export function ActivityFeed({
  items, loading, error, me, explorerBase, onRetry, nowSec,
}: {
  /** The page clock in seconds, so the feed runs no timer of its own. */
  nowSec: number;
  items: ActivityItem[] | undefined;
  loading: boolean;
  error: string | undefined;
  me: string | undefined;
  explorerBase: string;
  onRetry: () => void;
}) {
  return (
    <Card className="space-y-4 p-5 sm:p-6" role="region" aria-label="Activity">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">Activity</h2>

      {loading && !items && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-2/3 rounded-full" /><Skeleton className="h-3 w-1/4 rounded-full" /></div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-ink-2">Could not load activity. {error}</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>
        </div>
      )}

      {items && items.length === 0 && !error && <p className="text-[13px] leading-relaxed text-ink-2">No activity yet. Share the link to get the first chip in.</p>}

      {items && items.length > 0 && (
        <ul className="divide-y divide-[var(--line)]">
          {items.map(a => {
            const mine = !!me && me.toLowerCase() === a.address.toLowerCase();
            return (
              <li key={`${a.txHash}-${a.logIndex}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {mine ? <Avatar name="You" size={32} /> : <Avatar address={a.address} size={32} />}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-ink">
                    <span className={mine ? 'font-medium' : 'mono'}>{mine ? 'You' : shortAddress(a.address)}</span>{' '}
                    <span className="text-ink-2">{ACTIVITY_VERB[a.kind]}</span>
                    {a.kind === 'paidFor' && a.other && (
                      <>
                        {' '}
                        {me && me.toLowerCase() === a.other.toLowerCase()
                          ? <span className="font-medium">you</span>
                          : <span className="mono">{shortAddress(a.other)}</span>}
                      </>
                    )}
                    {a.amountRaw !== undefined && <span className="tnum"> {formatUsdcPlain(a.amountRaw)} USDC</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">{a.timestamp ? agoText(nowSec - a.timestamp) : 'Time unavailable'}</p>
                </div>
                <a
                  href={`${explorerBase}/tx/${a.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View transaction on the explorer"
                  title="View on explorer"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-s3 hover:text-ink"
                >
                  <ArrowSquareOut size={18} weight="regular" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
