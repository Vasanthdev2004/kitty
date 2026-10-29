// ─── Kitty – receipt, embed snippet and details ─────────────────────────────
import { ArrowSquareOut, CaretDown } from '@phosphor-icons/react';
import { useShareBase } from '../hooks';
import { formatDeadline, shortAddress } from '../pt-utils';
import { formatUsdcPlain } from '../pt-share';
import { EMBED_LABEL, buildEmbedSnippet, buildKittyUrl, embedStyleObject } from '../kitty-core';
import type { ActivityItem, KittyData } from '../kitty-types';
import type { KittyDeployment } from '../kitty-config';
import { Button, Card } from './ui';
import { CopyButton } from './fields';

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title="View on explorer"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-s3 hover:text-ink"
    >
      <ArrowSquareOut size={18} weight="regular" />
    </a>
  );
}

// ── Receipt (shown once paid out; print friendly) ────────────────────────────

export function ReceiptCard({
  data, dep, paid,
}: { data: KittyData; dep: KittyDeployment; paid: ActivityItem | undefined }) {
  const base = useShareBase();
  const link = base ? buildKittyUrl(base, data.id) : undefined;
  const when = paid?.timestamp ? formatDeadline(BigInt(paid.timestamp)) : 'Not available';
  const rows: Array<[string, string]> = [
    ['Kitty', data.ref || 'Untitled kitty'],
    ['Recipient', data.recipient],
    ['Total paid', `${formatUsdcPlain(data.totalFundedRaw)} USDC`],
    ['Paid on', when],
    ['People', String(data.contributors.length)],
  ];
  return (
    <Card className="print-area space-y-5 p-5 sm:p-6" role="region" aria-label="Receipt">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">Receipt</h2>
      <dl className="space-y-3 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-2">{k}</dt>
            <dd className={`min-w-0 break-all text-right text-ink ${k === 'Recipient' ? 'mono text-xs' : ''}`}>{v}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-ink-2">Payout transaction</dt>
          <dd className="min-w-0 text-right">
            {paid ? (
              <a
                className="mono text-xs text-ink underline underline-offset-2 hover:text-accent-text"
                href={`${dep.explorerBase}/tx/${paid.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shortAddress(paid.txHash)}
              </a>
            ) : <span className="text-ink-3">Not available</span>}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2 print:hidden">
        <CopyButton variant="pill" value={link} label="Copy receipt link" successMessage="Receipt link copied" />
        <Button variant="secondary" onClick={() => window.print()}>Print receipt</Button>
      </div>
    </Card>
  );
}

// ── Seller embed ─────────────────────────────────────────────────────────────

export function EmbedCard({ potId }: { potId: string }) {
  const base = useShareBase();
  const url = base ? buildKittyUrl(base, potId) : undefined;
  const snippet = url ? buildEmbedSnippet(url) : '';
  return (
    <Card className="space-y-4 p-5 sm:p-6" role="region" aria-label="Add to your site">
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Add to your site</h2>
        <p className="text-[13px] leading-relaxed text-ink-2 text-pretty">
          Paste this button into your checkout page. It opens this kitty so a group can pay you together.
        </p>
      </div>
      <div className="tile space-y-2 p-4">
        <p className="text-xs text-ink-3">Preview</p>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" style={embedStyleObject()}>{EMBED_LABEL}</a>
        ) : <span className="text-xs text-ink-3">Preparing</span>}
      </div>
      <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[12px] border border-line bg-s2 p-3 text-xs leading-relaxed text-ink-2" data-testid="embed-snippet">
        {snippet || 'Preparing'}
      </pre>
      <CopyButton variant="pill" value={snippet || undefined} label="Copy HTML" successMessage="Snippet copied" />
    </Card>
  );
}

// ── Details ──────────────────────────────────────────────────────────────────

function DetailRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <div className="flex items-center gap-1">
        <p className="mono min-w-0 flex-1 break-all text-xs leading-relaxed text-ink">{value}</p>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} successMessage="Copied" />
        {href && <ExplorerLink href={href} label={`View ${label.toLowerCase()} on the explorer`} />}
      </div>
    </div>
  );
}

export function KittyDetails({ data, dep }: { data: KittyData; dep: KittyDeployment }) {
  const addr = (a: string) => `${dep.explorerBase}/address/${a}`;
  return (
    <Card className="px-5 sm:px-6">
      <details className="group">
        <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold tracking-tight text-ink marker:hidden [&::-webkit-details-marker]:hidden">
          Details
          <CaretDown size={16} weight="regular" className="text-ink-2 transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="space-y-5 pb-5">
          <div className="hairline" />
          <DetailRow label="Kitty ID" value={data.id} />
          <DetailRow label="Started by" value={data.creator} href={addr(data.creator)} />
          <DetailRow label="Recipient" value={data.recipient} href={addr(data.recipient)} />
          <DetailRow label="Contract" value={dep.kitty} href={addr(dep.kitty)} />
          <DetailRow label="Token" value={dep.usdc} href={addr(dep.usdc)} />
          <p className="text-xs leading-relaxed text-ink-3">
            USDC on {dep.name}, 6 decimals. Payments and gas use the same balance.
          </p>
        </div>
      </details>
    </Card>
  );
}
