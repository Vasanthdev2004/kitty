// ─── Kitty – open pool: progress and the growing list of people ─────────────
import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { shortAddress } from '../pt-utils';
import { formatUsdcPlain, fundedPercent } from '../pt-share';
import { formatPercent } from '../pt-ui';
import type { KittyData } from '../kitty-types';
import { Avatar, Button, Card, YouChip } from './ui';

const SHOW_FIRST = 12;

export function OpenProgress({ data, me, phaseIsOpen }: { data: KittyData; me?: string; phaseIsOpen: boolean }) {
  const reduce = useReducedMotion();
  const remaining = data.goalRaw - data.totalFundedRaw;
  const people = data.contributors;
  const goal = data.goalRaw > 0n ? data.goalRaw : 1n;
  const isMe = (a: string) => !!me && me.toLowerCase() === a.toLowerCase();

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Progress</h2>
        <p className="tnum text-[13px] text-ink-2">{formatPercent(fundedPercent(data.totalFundedRaw, data.goalRaw))} of the goal</p>
      </div>

      <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-full bg-s3" role="img" aria-label={`${people.length} people chipped in`}>
        {people.map((c, i) => (
          <motion.div
            key={c.address}
            className="h-full origin-left"
            style={{ width: `${Number((c.contributedRaw * 10000n) / goal) / 100}%`, background: isMe(c.address) ? 'var(--accent)' : 'var(--ok)' }}
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 20, delay: 0.1 + Math.min(i, 12) * 0.04 }}
          />
        ))}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
        <div><dt className="text-ink-3">People</dt><dd className="tnum mt-0.5 text-ink">{people.length}</dd></div>
        <div><dt className="text-ink-3">Still needed</dt><dd className="tnum mt-0.5 text-ink">{formatUsdcPlain(remaining)} USDC</dd></div>
        {phaseIsOpen && (
          <div>
            <dt className="text-ink-3">New people chip in at least</dt>
            <dd className="tnum mt-0.5 text-ink" data-testid="open-min">
              {formatUsdcPlain(data.effectiveMinRaw < remaining ? data.effectiveMinRaw : remaining)} USDC
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

export function OpenContributors({ data, me }: { data: KittyData; me?: string }) {
  const [all, setAll] = useState(false);
  const reduce = useReducedMotion();
  const people = [...data.contributors].reverse();
  const shown = all ? people : people.slice(0, SHOW_FIRST);
  const isMe = (a: string) => !!me && me.toLowerCase() === a.toLowerCase();

  return (
    <Card className="space-y-4 p-5 sm:p-6" role="region" aria-label="People who chipped in">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">
        {people.length === 0 ? 'Nobody has chipped in yet' : `${people.length} ${people.length === 1 ? 'person' : 'people'} chipped in`}
      </h2>
      {people.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-2">Share the link below to get the first chip in.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {shown.map((c, i) => (
            <motion.li
              key={c.address}
              className="tile flex items-center gap-3 px-3 py-2.5"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28, delay: Math.min(i, 10) * 0.03 }}
            >
              <Avatar address={c.address} size={32} />
              <p className="mono min-w-0 flex-1 truncate text-[13px] text-ink">{shortAddress(c.address)}</p>
              {isMe(c.address) && <YouChip />}
              <p className="tnum shrink-0 text-[13px] text-ink-2">{formatUsdcPlain(c.contributedRaw)}</p>
            </motion.li>
          ))}
        </ul>
      )}
      {people.length > SHOW_FIRST && (
        <Button variant="ghost" size="sm" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${people.length}`}
        </Button>
      )}
    </Card>
  );
}
