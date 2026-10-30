// ─── Kitty – seller dashboard (?view=requests) ──────────────────────────────
// Payment requests where the connected wallet is both creator and recipient.
import { ConnectKitButton } from 'connectkit';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useNowMs, useShareBase } from '../hooks';
import { formatDeadline } from '../pt-utils';
import { formatUsdcPlain, fundedPercent } from '../pt-share';
import { PHASE_PILL, buildEmbedSnippet, buildKittyUrl, type Route } from '../kitty-core';
import {
  groupRequests, requestCsv, requestPhase, requestTotals, type RequestSummary,
} from '../kitty-requests';
import type { RequestsScan } from '../kitty-scan';
import { downloadText } from '../lib/download';
import { AnimatedAmount } from './AnimatedAmount';
import { CopyButton } from './fields';
import { Button, Card, Chip, EmptyState, IconButton, Skeleton } from './ui';

function Total({ label, raw }: { label: string; raw: bigint }) {
  return (
    <div className="tile px-4 py-3.5">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <AnimatedAmount raw={raw} className="mono text-2xl font-medium text-ink" />
        <span className="text-xs text-ink-3">USDC</span>
      </p>
    </div>
  );
}

function RequestCard({ r, now, base, onOpen }: { r: RequestSummary; now: bigint; base: string | undefined; onOpen: () => void }) {
  const phase = requestPhase(r, now);
  const pill = PHASE_PILL[phase];
  const pct = fundedPercent(r.totalFundedRaw, r.goalRaw);
  const link = base ? buildKittyUrl(base, r.id) : undefined;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 title={r.ref} className="truncate text-[15px] font-semibold tracking-tight text-ink">{r.ref || 'Untitled request'}</h3>
          <p className="mt-0.5 text-xs text-ink-2">
            {r.contributorCount} {r.contributorCount === 1 ? 'person' : 'people'} chipped in
            {' \u00b7 '}Closes {formatDeadline(r.deadline)}
          </p>
        </div>
        <Chip tone={pill.tone}>{pill.label}</Chip>
      </div>
      <div className="space-y-2">
        <div className="h-2 overflow-hidden rounded-full bg-s3" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--ok)' }} />
        </div>
        <p className="tnum text-xs text-ink-2">
          <span className="text-ink">{formatUsdcPlain(r.totalFundedRaw)}</span> of {formatUsdcPlain(r.goalRaw)} USDC
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton variant="pill" label="Copy link" value={link} successMessage="Link copied" disabled={!link} />
        <CopyButton
          variant="pill" label="Copy embed snippet" value={link ? buildEmbedSnippet(link) : undefined}
          successMessage="Snippet copied" disabled={!link}
        />
        <Button size="sm" variant="secondary" onClick={onOpen}>Open</Button>
      </div>
    </Card>
  );
}

function Group({ title, items, now, base, onNavigate }: {
  title: string; items: RequestSummary[]; now: bigint; base: string | undefined; onNavigate: (r: Route) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map(r => <RequestCard key={r.id} r={r} now={now} base={base} onOpen={() => onNavigate({ view: 'kitty', id: r.id })} />)}
      </div>
    </section>
  );
}

export function SellerRequests({
  me, scan, loading, refreshing, error, onRefresh, onNavigate,
}: {
  me: string | undefined;
  scan: RequestsScan | undefined;
  loading: boolean;
  refreshing: boolean;
  error: string | undefined;
  onRefresh: () => void;
  onNavigate: (r: Route) => void;
}) {
  const nowMs = useNowMs(60_000);
  const base = useShareBase();

  if (!me) {
    return (
      <EmptyState
        title="Connect your wallet"
        action={<ConnectKitButton.Custom>{({ show }) => <Button onClick={show}>Connect wallet</Button>}</ConnectKitButton.Custom>}
      >
        Payment requests you started for yourself show up here, with totals and a CSV export.
      </EmptyState>
    );
  }

  const now = scan ? scan.chainTimestamp + BigInt(Math.max(0, Math.floor((nowMs - scan.scannedAt) / 1000))) : 0n;
  const groups = scan ? groupRequests(scan.items, now) : undefined;
  const totals = scan ? requestTotals(scan.items, now) : undefined;

  const exportCsv = () => {
    if (!scan || scan.items.length === 0) return;
    downloadText('kitty-requests.csv', requestCsv(scan.items, now));
    toast.success('CSV saved');
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-3xl font-semibold leading-tight tracking-[-0.03em] text-ink md:text-4xl">Requests</h1>
          <p className="text-base leading-relaxed text-ink-2">Payment requests you started for yourself, and where each one stands.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!scan || scan.items.length === 0}>Export CSV</Button>
          <IconButton icon={ArrowsClockwise} label="Refresh requests" onClick={onRefresh} disabled={refreshing} />
        </div>
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border-l-2 border-l-err bg-err-soft px-4 py-3 text-[13px] text-ink-2" role="alert">
          <span>Could not load your requests. {error}</span>
          <Button size="sm" variant="secondary" onClick={onRefresh}>Try again</Button>
        </div>
      )}

      {loading && (
        <div className="space-y-4" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[76px] rounded-[14px]" />)}</div>
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map(i => (
              <div key={i} className="card space-y-4 p-5">
                <Skeleton className="h-4 w-1/2 rounded-full" /><Skeleton className="h-2 w-full rounded-full" /><Skeleton className="h-8 w-2/3 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {totals && scan && scan.items.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Total label="Requested" raw={totals.requestedRaw} />
          <Total label="Collected" raw={totals.collectedRaw} />
          <Total label="Pending" raw={totals.pendingRaw} />
        </div>
      )}

      {scan && scan.items.length === 0 && (
        <EmptyState
          title="No payment requests yet"
          action={<Button onClick={() => onNavigate({ view: 'new', kind: 'request' })}>Request payment</Button>}
        >
          Ask friends or customers to pay you together. You get one payment, in full, when the goal is met.
        </EmptyState>
      )}

      {groups && (
        <>
          <Group title="Active" items={groups.active} now={now} base={base} onNavigate={onNavigate} />
          <Group title="Paid" items={groups.paid} now={now} base={base} onNavigate={onNavigate} />
          <Group title="Expired or cancelled" items={groups.closed} now={now} base={base} onNavigate={onNavigate} />
        </>
      )}
    </div>
  );
}
