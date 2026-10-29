// ─── PayTogether – Segmented progress bar + contributor tiles ───────────────
import { motion, useReducedMotion } from 'motion/react';
import { shortAddress } from '../pt-utils';
import {
  contributorStatus, formatUsdcPlain, fundedPercent, CONTRIBUTOR_STATUS_LABEL, type ContributorStatus,
} from '../pt-share';
import { formatPercent, segmentFillPct, segmentWidths } from '../pt-ui';
import type { ContributionInfo } from '../pt-types';
import { cn } from '../cn';
import { Avatar, Card, StatusPill, YouChip } from './ui';

const FILL: Record<ContributorStatus, string> = {
  'paid': 'var(--ok)',
  'partial': 'var(--warn)',
  'not-paid': 'transparent',
  'refunded': 'transparent',
};

export function SegmentedProgress({
  contributions, connectedAddress, totalFundedRaw, targetRaw,
}: {
  contributions: ContributionInfo[];
  connectedAddress: string | undefined;
  totalFundedRaw: bigint;
  targetRaw: bigint;
}) {
  const reduce = useReducedMotion();
  const widths = segmentWidths(contributions.map(c => c.shareRaw));
  const last = contributions.length - 1;

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Progress by person</h2>
        <p className="tnum text-[13px] text-ink-2">{formatPercent(fundedPercent(totalFundedRaw, targetRaw))} funded</p>
      </div>

      <div className="flex gap-[3px]" role="list" aria-label="Contribution progress">
        {contributions.map((c, i) => {
          const status = contributorStatus(c);
          const fill = segmentFillPct(c.contributedRaw, c.shareRaw);
          const isMe = connectedAddress?.toLowerCase() === c.address.toLowerCase();
          const align = i === 0 ? 'left-0' : i === last ? 'right-0' : 'left-1/2 -translate-x-1/2';
          return (
            <div
              key={c.address}
              role="listitem"
              tabIndex={0}
              aria-label={`${shortAddress(c.address)}${isMe ? ' (you)' : ''}: ${formatUsdcPlain(c.contributedRaw)} of ${formatUsdcPlain(c.shareRaw)} USDC, ${CONTRIBUTOR_STATUS_LABEL[status]}`}
              className="group relative min-w-[6px] rounded-full"
              style={{ flexGrow: widths[i], flexBasis: 0 }}
            >
              <div className="h-3.5 overflow-hidden rounded-full bg-s3">
                <motion.div
                  className="h-full origin-left rounded-full"
                  style={{ background: isMe && fill > 0 ? 'var(--accent)' : FILL[status] }}
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: fill / 100 }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 20, delay: 0.1 + Math.min(i, 12) * 0.05 }}
                />
              </div>
              <div
                role="tooltip"
                className={cn(
                  'pointer-events-none absolute bottom-full z-20 mb-2.5 w-max max-w-[220px] rounded-[12px] border border-line-strong bg-s2 px-3 py-2',
                  'opacity-0 shadow-[var(--highlight),var(--shadow-pop)] transition-opacity duration-150',
                  'group-hover:opacity-100 group-focus-visible:opacity-100',
                  align,
                )}
              >
                <p className="mono text-xs text-ink">{shortAddress(c.address)}{isMe ? ' (you)' : ''}</p>
                <p className="tnum mt-0.5 text-xs text-ink-2">
                  {formatUsdcPlain(c.contributedRaw)} of {formatUsdcPlain(c.shareRaw)} USDC
                </p>
                <p className="mt-0.5 text-xs text-ink-3">{CONTRIBUTOR_STATUS_LABEL[status]}</p>
              </div>
            </div>
          );
        })}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
        {([['paid', 'var(--ok)'], ['partial', 'var(--warn)'], ['not-paid', 'var(--text-3)']] as const).map(([k, color]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-[1px]" style={{ background: color }} />
            {CONTRIBUTOR_STATUS_LABEL[k]}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Contributor tiles inside one card, so the column can stretch to match its neighbor. */
export function ContributorGrid({
  contributions, connectedAddress,
}: { contributions: ContributionInfo[]; connectedAddress: string | undefined }) {
  const reduce = useReducedMotion();
  return (
    <Card className="space-y-4 p-5 sm:p-6" aria-label="Contributors" role="region">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">Contributors</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {contributions.map((c, i) => {
          const isMe = connectedAddress?.toLowerCase() === c.address.toLowerCase();
          const status = contributorStatus(c);
          const fill = segmentFillPct(c.contributedRaw, c.shareRaw);
          return (
            <Card
              key={c.address}
              variant="tile"
              interactive
              className={cn('space-y-3.5 p-4', isMe && 'border-line-strong')}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28, delay: Math.min(i, 12) * 0.04 }}
            >
              <div className="flex items-center gap-3">
                <Avatar address={c.address} size={36} />
                <p className="mono min-w-0 flex-1 truncate text-[13px] text-ink">{shortAddress(c.address)}</p>
                {isMe && <YouChip />}
              </div>

              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-s3" aria-hidden>
                  <motion.div
                    className="h-full origin-left rounded-full"
                    style={{ background: FILL[status] }}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: fill / 100 }}
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 20, delay: 0.15 + Math.min(i, 12) * 0.04 }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="tnum text-xs text-ink-2">
                    <span className="text-ink">{formatUsdcPlain(c.contributedRaw)}</span> of {formatUsdcPlain(c.shareRaw)} USDC
                  </p>
                  <StatusPill status={status} />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </Card>
  );
}
