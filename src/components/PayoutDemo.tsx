// ─── Kitty – animated mini demo for the home hero ───────────────────────────
// Built from the real Avatar / Chip components. Ana, Ravi and Mei chip in one by
// one: each person's segment sits directly above their row, fills, their Paid
// pill appears and their check badge pops in, the total counts up, then the
// kitty pays out. Plays once when scrolled into view; under reduced motion it
// shows the finished state.
import { useEffect, useRef, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { Avatar, Card, Chip } from './ui';

const PEOPLE = [
  { name: 'Ana', amount: 40 },
  { name: 'Ravi', amount: 35 },
  { name: 'Mei', amount: 25 },
] as const;
const GOAL = PEOPLE.reduce((s, p) => s + p.amount, 0);
const STEPS = PEOPLE.length + 1; // 0..3 people paid, 4 = paid out

const money = (n: number) => n.toFixed(2);

export function PayoutDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [step, setStep] = useState(0);

  // Each tick is scheduled from a timeout, never set synchronously in the effect.
  useEffect(() => {
    if (reduce || !inView || step >= STEPS) return;
    const id = setTimeout(() => setStep(s => s + 1), step === 0 ? 600 : 900);
    return () => clearTimeout(id);
  }, [reduce, inView, step]);

  const shown = reduce ? STEPS : step;
  const paidCount = Math.min(shown, PEOPLE.length);
  const paidSum = PEOPLE.slice(0, paidCount).reduce((s, p) => s + p.amount, 0);
  const done = shown >= STEPS;

  return (
    <Card className="p-5 sm:p-6">
      <div ref={ref} className="space-y-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-semibold tracking-tight text-ink">Weekend in Lisbon</p>
          <p className="tnum text-xs text-ink-3">{paidCount} of {PEOPLE.length} paid</p>
        </div>

        <ul className="grid grid-cols-3 gap-2.5 sm:gap-3" aria-label="Who has paid">
          {PEOPLE.map((p, i) => {
            const paid = i < paidCount;
            return (
              <li key={p.name} className="min-w-0 space-y-2.5">
                {/* The segment sits right above its person. */}
                <div className="relative h-3.5 overflow-hidden rounded-full bg-s3" aria-hidden>
                  <motion.div
                    className="absolute inset-0 origin-left rounded-full bg-[var(--ok)]"
                    initial={false}
                    animate={{ scaleX: paid ? 1 : 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.55, ease: [0.3, 0.9, 0.3, 1] }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Avatar name={p.name} size={28} status={paid ? 'paid' : undefined} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium leading-tight text-ink">{p.name}</p>
                    <p className="tnum text-[11px] leading-tight text-ink-2">
                      {money(p.amount)} <span className="text-ink-3">USDC</span>
                    </p>
                  </div>
                </div>
                <Chip tone={paid ? 'ok' : 'neutral'}>{paid ? 'Paid' : 'Not paid'}</Chip>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="tnum text-[13px] text-ink-2">
            <NumberFlow
              value={paidSum}
              locales="en-US"
              format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
              className="font-medium text-ink"
            />{' '}
            of {money(GOAL)} <span className="text-ink-3">USDC</span>
          </p>
          <motion.span
            key={done ? 'done' : 'wait'}
            initial={reduce ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            <Chip tone={done ? 'ok' : 'neutral'}>{done ? 'Paid out' : 'Open'}</Chip>
          </motion.span>
        </div>
      </div>
    </Card>
  );
}
