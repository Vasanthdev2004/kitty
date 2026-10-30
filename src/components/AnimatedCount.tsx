// ─── Kitty – animated whole number ──────────────────────────────────────────
import NumberFlow from '@number-flow/react';

/** Real value on first paint; later changes animate (and respect reduced motion). */
export function AnimatedCount({ value, className }: { value: number; className?: string }) {
  return <NumberFlow value={value} locales="en-US" format={{ maximumFractionDigits: 0 }} className={className ?? 'mono'} />;
}
