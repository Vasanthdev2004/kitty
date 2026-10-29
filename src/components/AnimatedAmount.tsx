// ─── PayTogether – animated amount ──────────────────────────────────────────
import NumberFlow from '@number-flow/react';
import { rawToDisplayNumber } from '../pt-ui';

/**
 * Renders the real value immediately. NumberFlow animates later changes only,
 * so the number is correct even in a background tab where no animation frame
 * ever fires.
 */
export function AnimatedAmount({ raw, className }: { raw: bigint; className?: string }) {
  return (
    <NumberFlow
      value={rawToDisplayNumber(raw)}
      locales="en-US"
      format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
      className={className ?? 'mono'}
    />
  );
}
