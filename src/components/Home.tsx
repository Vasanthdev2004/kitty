// ─── Kitty – Home: hero, three ways to start, templates ─────────────────────
import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { TEMPLATES, type Route, type StartKind } from '../kitty-core';
import { Card, Notice } from './ui';
import { ProofStrip } from './ProofStrip';
import type { KittyDeployment } from '../kitty-config';
import type { SiteUrls } from '../network-switch';
import { PayoutDemo } from './PayoutDemo';
import { PoolPreview, RequestPreview, SplitPreview } from './StartPreviews';
import { LiveStats } from './LiveStats';
import type { KittyStats } from '../kitty-requests';
import { FEATURED_LABEL } from '../featured';

const STARTS: ReadonlyArray<{ kind: StartKind; title: string; line: string; Preview: () => ReactNode }> = [
  { kind: 'split', title: 'Split a bill', line: 'Name each person and their share. The recipient is paid once everyone is in.', Preview: SplitPreview },
  { kind: 'open', title: 'Pool for a goal', line: 'Share a link. Anyone can chip in until the goal is reached.', Preview: PoolPreview },
  { kind: 'request', title: 'Request payment', line: 'Sellers ask a group to pay together and get paid in one go.', Preview: RequestPreview },
];

const PROMISES = [
  'Locked until the goal is met.',
  'The recipient is paid once, in full.',
  'If the deadline passes, everyone gets their own money back.',
];

export interface HomeStats { stats: KittyStats | undefined; loading: boolean; failed: boolean; explorerBase: string }

const LINK = 'font-medium text-accent-text underline-offset-2 hover:underline';

export function Home({
  onNavigate, live, dep, site, onGetUsdc, featuredId,
}: {
  onNavigate: (r: Route) => void;
  live?: HomeStats;
  /** The active deployment: drives the testnet banner and the proof strip. */
  dep?: KittyDeployment;
  /** The two site URLs (mainnet, testnet). A link is shown only when its URL is set. */
  site?: SiteUrls;
  onGetUsdc?: () => void;
  /** One real, paid-out kitty the host chose (VITE_FEATURED_KITTIES). Nothing is shown without it. */
  featuredId?: `0x${string}`;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-12 pt-10 md:space-y-14 md:pt-16">
      {dep?.testnet && (
        <Notice>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span>You're on {dep.networkLabel}. Test USDC is free and has no value.</span>
            <span className="flex flex-wrap gap-x-5 gap-y-1">
              {dep.faucetUrl && <a className={LINK} href={dep.faucetUrl} target="_blank" rel="noopener noreferrer">Get test USDC</a>}
              {site?.mainnet && <a className={LINK} href={site.mainnet}>Back to mainnet</a>}
            </span>
          </div>
        </Notice>
      )}

      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div className="max-w-2xl space-y-5">
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-ink text-balance md:text-5xl">
            Nobody fronts the money.
          </h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-ink-2 text-pretty md:text-lg">
            Start a kitty for a bill or a gift. Money stays locked until everyone chips in, then pays out once.
          </p>
          {((dep && !dep.testnet && site?.testnet) || featuredId) && (
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
              {dep && !dep.testnet && site?.testnet && <a className={LINK} href={site.testnet}>Try it free on testnet</a>}
              {featuredId && (
                <a
                  className={LINK}
                  href={`?kitty=${featuredId}`}
                  onClick={e => { e.preventDefault(); onNavigate({ view: 'kitty', id: featuredId }); }}
                >{FEATURED_LABEL}</a>
              )}
            </p>
          )}
        </div>
        <PayoutDemo />
      </section>

      {dep && <ProofStrip dep={dep} onGetUsdc={onGetUsdc} featuredId={featuredId} onOpenKitty={id => onNavigate({ view: 'kitty', id })} />}

      <section aria-label="Start a kitty" className="grid gap-4 md:grid-cols-3">
        {STARTS.map((s, i) => (
          <div key={s.kind} className="relative rounded-card">
            <Card
              interactive
              className="flex h-full flex-col justify-between gap-6 p-5 sm:p-6"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28, delay: i * 0.06 }}
            >
              <div className="space-y-1.5">
                <h2 className="text-[17px] font-semibold tracking-tight text-ink">{s.title}</h2>
                <p className="text-sm leading-relaxed text-ink-2 text-pretty">{s.line}</p>
              </div>
              <div className="space-y-4">
                <s.Preview />
                <span className="text-[13px] font-medium text-accent-text">Start</span>
              </div>
            </Card>
            {/* The whole card starts the kitty; the links below sit above it so they stay clickable. */}
            <button
              type="button"
              aria-label={s.title}
              onClick={() => onNavigate({ view: 'new', kind: s.kind })}
              className="absolute inset-0 rounded-card"
            />
            {s.kind === 'request' && (
              <p className="pointer-events-none absolute bottom-5 right-5 text-[13px] sm:bottom-6 sm:right-6">
                <a
                  href="?view=sell"
                  onClick={e => { e.preventDefault(); onNavigate({ view: 'sell' }); }}
                  className="pointer-events-auto relative font-medium text-ink underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-ink"
                >For sellers</a>
                <span className="text-ink-3">{' \u00b7 '}</span>
                <a
                  href="?view=shop"
                  onClick={e => { e.preventDefault(); onNavigate({ view: 'shop' }); }}
                  className="pointer-events-auto relative font-medium text-ink underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-ink"
                >Demo store</a>
              </p>
            )}
          </div>
        ))}
      </section>

      {live && <LiveStats {...live} onStart={() => onNavigate({ view: 'new', kind: 'split' })} />}

      <section aria-label="Templates" className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">Or start from a template</h2>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onNavigate({ view: 'new', kind: t.mode, template: t.id })}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-s1 px-4 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-line-strong"
            >
              {t.label}
              <span className="text-xs font-normal text-ink-3">{t.mode === 'split' ? 'Split' : 'Pool'}</span>
            </button>
          ))}
        </div>
      </section>

      <ul className="grid max-w-3xl gap-x-8 gap-y-2 border-t border-line pt-6 text-[13px] leading-relaxed text-ink-2 sm:grid-cols-3">
        {PROMISES.map(p => <li key={p} className="text-pretty">{p}</li>)}
      </ul>
    </div>
  );
}
