// ─── Kitty – Home: hero, three ways to start, templates ─────────────────────
import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { TEMPLATES, type Route, type StartKind } from '../kitty-core';
import { Card } from './ui';
import { PayoutDemo } from './PayoutDemo';
import { PoolPreview, RequestPreview, SplitPreview } from './StartPreviews';

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

export function Home({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-12 pt-10 md:space-y-14 md:pt-16">
      <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div className="max-w-2xl space-y-5">
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-ink text-balance md:text-5xl">
            Nobody fronts the money.
          </h1>
          <p className="max-w-[46ch] text-base leading-relaxed text-ink-2 text-pretty md:text-lg">
            Start a kitty for a bill or a gift. Money stays locked until everyone chips in, then pays out once.
          </p>
        </div>
        <PayoutDemo />
      </section>

      <section aria-label="Start a kitty" className="grid gap-4 md:grid-cols-3">
        {STARTS.map((s, i) => (
          <button
            key={s.kind}
            type="button"
            onClick={() => onNavigate({ view: 'new', kind: s.kind })}
            className="rounded-card text-left"
          >
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
          </button>
        ))}
      </section>

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
