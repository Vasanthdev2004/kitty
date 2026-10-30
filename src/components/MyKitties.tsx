// ─── Kitty – My kitties (?view=mine) ────────────────────────────────────────
import { ConnectKitButton } from 'connectkit';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useNowMs } from '../hooks';
import { formatUsdcPlain, fundedPercent } from '../pt-share';
import { relativeFromNow } from '../pt-ui';
import {
  groupMine, kittyPhase, mineAction, routeToSearch, type MineAction, type Route,
} from '../kitty-core';
import type { MineSummary } from '../kitty-types';
import type { MineScan } from '../kitty-data';
import { Button, Card, EmptyState, IconButton, Skeleton } from './ui';

const ACTION_TEXT: Record<MineAction, string> = {
  'chip-in': 'Chip in your share',
  'pay-out': 'Ready to pay out',
  'refund': 'Get your refund',
};

function KittyCard({ s, now, onOpen }: { s: MineSummary; now: bigint; onOpen: () => void }) {
  const phase = kittyPhase({ settled: s.settled, totalFundedRaw: s.totalFundedRaw, goalRaw: s.goalRaw, deadline: s.deadline, now });
  const action = mineAction(s, now);
  const pct = fundedPercent(s.totalFundedRaw, s.goalRaw);
  const when = phase === 'paid' ? 'Paid out'
    : phase === 'open' ? `Closes ${relativeFromNow(Number(s.deadline - now))}`
    : phase === 'ready' ? 'Goal met'
    : 'Refunds open';
  return (
    <a
      href={routeToSearch({ view: 'kitty', id: s.id })}
      onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); onOpen(); } }}
      className="block rounded-card"
    >
      <Card interactive className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 title={s.ref} className="truncate text-[15px] font-semibold tracking-tight text-ink">{s.ref || 'Untitled kitty'}</h3>
            <p className="mt-0.5 text-xs text-ink-2">
              {s.mode === 'split' ? 'Split' : 'Open pool'}
              {s.roles.length > 0 && <>{' \u00b7 '}{s.roles.join(', ')}</>}
            </p>
          </div>
          {action && <span className="shrink-0 text-xs font-medium text-ink">{ACTION_TEXT[action]}</span>}
        </div>
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-s3" aria-hidden>
            <div className="h-full origin-left rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--ok)' }} />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-ink-2">
            <span className="tnum"><span className="text-ink">{formatUsdcPlain(s.totalFundedRaw)}</span> of {formatUsdcPlain(s.goalRaw)} USDC</span>
            <span>{when}</span>
          </div>
        </div>
      </Card>
    </a>
  );
}

function Group({ title, items, now, onNavigate }: { title: string; items: MineSummary[]; now: bigint; onNavigate: (r: Route) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map(s => <KittyCard key={s.id} s={s} now={now} onOpen={() => onNavigate({ view: 'kitty', id: s.id })} />)}
      </div>
    </section>
  );
}

export function MyKitties({
  me, scan, loading, refreshing, error, onRefresh, onNavigate,
}: {
  me: string | undefined;
  scan: MineScan | undefined;
  loading: boolean;
  refreshing: boolean;
  error: string | undefined;
  onRefresh: () => void;
  onNavigate: (r: Route) => void;
}) {
  const nowMs = useNowMs(60_000);

  if (!me) {
    return (
      <EmptyState
        title="Connect your wallet"
        action={<ConnectKitButton.Custom>{({ show }) => <Button onClick={show}>Connect wallet</Button>}</ConnectKitButton.Custom>}
      >
        Your kitties are the ones you started, chipped into, or were invited to. Connect to see them.
      </EmptyState>
    );
  }

  const now = scan ? scan.chainTimestamp + BigInt(Math.max(0, Math.floor((nowMs - scan.scannedAt) / 1000))) : 0n;
  const groups = scan ? groupMine(scan.items, now) : undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-3xl font-semibold leading-tight tracking-[-0.03em] text-ink md:text-4xl">My kitties</h1>
          <p className="text-base leading-relaxed text-ink-2">Everything you started, chipped into, receive, or were invited to.</p>
        </div>
        <IconButton icon={ArrowsClockwise} label="Refresh my kitties" onClick={onRefresh} disabled={refreshing} className="shrink-0" />
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border-l-2 border-l-err bg-err-soft px-4 py-3 text-[13px] text-ink-2" role="alert">
          <span>Could not scan for your kitties. {error}</span>
          <Button size="sm" variant="secondary" onClick={onRefresh}>Try again</Button>
        </div>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          {[0, 1].map(i => (
            <div key={i} className="card space-y-4 p-5">
              <Skeleton className="h-4 w-1/2 rounded-full" /><Skeleton className="h-2 w-full rounded-full" /><Skeleton className="h-3 w-2/3 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {groups && scan && scan.items.length === 0 && (
        <EmptyState title="No kitties yet">
          Start one, or open a link a friend sent you. Kitties you create, chip into or are invited to show up here.
          <span className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onNavigate({ view: 'new', kind: 'split' })}>Split a bill</Button>
            <Button variant="secondary" onClick={() => onNavigate({ view: 'new', kind: 'open' })}>Pool for a goal</Button>
            <Button variant="secondary" onClick={() => onNavigate({ view: 'new', kind: 'request' })}>Request payment</Button>
          </span>
        </EmptyState>
      )}

      {groups && (
        <>
          <Group title="Needs your action" items={groups.needsAction} now={now} onNavigate={onNavigate} />
          <Group title="Active" items={groups.active} now={now} onNavigate={onNavigate} />
          <Group title="Completed" items={groups.completed} now={now} onNavigate={onNavigate} />
        </>
      )}
    </div>
  );
}
