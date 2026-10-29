// ─── Kitty – animated mini demo for the home hero ───────────────────────────
// Built from the real Avatar / Chip components. Three people chip in one by one,
// the bar fills, then the kitty pays out. Plays once when scrolled into view;
// under reduced motion it renders the finished state.
import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { Avatar, Card, Chip } from './ui';

const PEOPLE = [
  '0x1d2f6a8b3c4e5f60718293a4b5c6d7e8f9a0b1c2',
  '0x7a3b9c1d2e4f60718293a4b5c6d7e8f9a0b1c2d3',
  '0xc4e8f1a2b3d4e5f60718293a4b5c6d7e8f9a0b1c4',
] as const;
const AMOUNTS = ['40.00', '35.00', '25.00'] as const;
const STEPS = PEOPLE.length + 1;

export function PayoutDemo() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [step, setStep] = useState(0);

  // 0..3 = people paid, 4 = paid out. Each tick is scheduled from a timeout, never set synchronously.
  useEffect(() => {
    if (reduce || !inView || step >= STEPS) return;
    const id = setTimeout(() => setStep(s => s + 1), step === 0 ? 600 : 850);
    return () => clearTimeout(id);
  }, [reduce, inView, step]);

  const shown = reduce ? STEPS : step;
  const paid = Math.min(shown, PEOPLE.length);
  const done = shown >= STEPS;

  return (
    <Card className="p-5 sm:p-6">
      <div ref={ref} className="space-y-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-semibold tracking-tight text-ink">Weekend in Lisbon</p>
          <p className="tnum text-xs text-ink-3">{paid} of {PEOPLE.length} paid</p>
        </div>

        <div className="grid grid-cols-3 gap-2" aria-hidden>
          {PEOPLE.map((p, i) => (
            <div key={p} className="space-y-2">
              <div className="relative h-3.5 overflow-hidden rounded-full bg-s3">
                <motion.div
                  className="absolute inset-0 origin-left rounded-full bg-[var(--ok)]"
                  initial={false}
                  animate={{ scaleX: i < paid ? 1 : 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.55, ease: [0.3, 0.9, 0.3, 1] }}
                />
              </div>
              <div className="flex items-center gap-2">
                <Avatar address={p} size={24} />
                <span className="tnum text-xs text-ink-2">{AMOUNTS[i]}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[13px] text-ink-2">
            {done ? 'The recipient was paid in one go.' : 'Locked until everyone chips in.'}
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
