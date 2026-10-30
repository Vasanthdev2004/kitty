// ─── Kitty – "What happens next" ────────────────────────────────────────────
// Funding, then Paid out OR Refunds open. The current step is highlighted, past
// and skipped steps are muted. Driven by the same phase the action card uses.
import { timelineSteps, type KittyPhase, type StepState } from '../kitty-core';
import { cn } from '../cn';
import { Card, Chip } from './ui';

const RAIL: Record<StepState, string> = {
  current: 'border-ink',
  upcoming: 'border-line-strong',
  past: 'border-line',
  skipped: 'border-line',
};
const TEXT: Record<StepState, string> = {
  current: 'text-ink-2',
  upcoming: 'text-ink-2',
  past: 'text-ink-3',
  skipped: 'text-ink-3',
};

export function WhatHappensNext({ phase, deadline, now }: { phase: KittyPhase; deadline: bigint; now: bigint }) {
  const steps = timelineSteps({ phase, deadline, now });
  return (
    <Card className="space-y-4 p-5 sm:p-6" role="region" aria-label="What happens next">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">What happens next</h2>
      <ol className="space-y-1">
        {steps.map(step => (
          <li
            key={step.id}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={cn('border-l-2 py-1.5 pl-4', RAIL[step.state])}
          >
            <div className="flex items-center gap-2">
              <p className={cn('text-[13px] font-medium', step.state === 'current' ? 'text-ink' : step.state === 'upcoming' ? 'text-ink-2' : 'text-ink-3')}>
                {step.title}
              </p>
              {step.state === 'current' && <Chip tone="neutral">Now</Chip>}
              {step.state === 'past' && <span className="text-xs text-ink-3">Done</span>}
              {step.state === 'skipped' && <span className="text-xs text-ink-3">Not happening</span>}
            </div>
            <p className={cn('mt-0.5 text-[13px] leading-relaxed text-pretty', TEXT[step.state])}>{step.text}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
