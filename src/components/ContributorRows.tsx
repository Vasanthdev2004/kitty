// ─── PayTogether – Contributor rows (create form) ────────────────────────────
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Trash } from '@phosphor-icons/react';
import type { DraftShare } from '../pt-types';
import { parseUsdcAmount } from '../pt-utils';
import { fundedPercent } from '../pt-share';
import { formatPercent } from '../pt-ui';
import { AddressInput, AmountInput, FieldError } from './fields';
import { IconButton } from './ui';

export type RowError = { message: string; part: 'address' | 'amount' } | undefined;

interface Props {
  shares: DraftShare[];
  rowIds: number[];
  /** Total the percentages are measured against (target if set, else the sum of shares). */
  totalRaw: bigint;
  /** Already filtered: only errors the user should see now. */
  rowErrors: RowError[];
  onTouch: (rowId: number, part: 'address' | 'amount') => void;
  onChange: (i: number, p: Partial<DraftShare>) => void;
  onRemove: (i: number) => void;
}

export function ContributorRows({ shares, rowIds, totalRaw, rowErrors, onTouch, onChange, onRemove }: Props) {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {shares.map((s, i) => {
          const err = rowErrors[i];
          const parsed = parseUsdcAmount(s.amount);
          const pct = parsed.ok && totalRaw > 0n ? formatPercent(fundedPercent(parsed.raw, totalRaw)) : '';
          return (
            <motion.div
              key={rowIds[i]}
              layout={reduce ? false : 'position'}
              initial={reduce ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 360, damping: 32 }}
              className="tile p-3 sm:p-4"
            >
              <div className="grid items-start gap-3 sm:grid-cols-[28px_minmax(0,1fr)_44px]">
                <div className="flex items-center justify-between sm:col-start-1 sm:row-start-1 sm:block sm:pt-3">
                  <span className="tnum text-xs font-medium text-ink-3" aria-hidden>{i + 1}</span>
                  <IconButton
                    icon={Trash}
                    label={`Remove person ${i + 1}`}
                    disabled={shares.length <= 1}
                    onClick={() => onRemove(i)}
                    className="sm:hidden"
                  />
                </div>

                <AddressInput
                  ariaLabel={`Person ${i + 1} address`}
                  value={s.address}
                  invalid={err?.part === 'address'}
                  onChange={v => onChange(i, { address: v })}
                  onBlur={() => onTouch(rowIds[i], 'address')}
                />
                <IconButton
                  icon={Trash}
                  label={`Remove person ${i + 1}`}
                  disabled={shares.length <= 1}
                  onClick={() => onRemove(i)}
                  className="mt-0.5 hidden sm:col-start-3 sm:row-start-1 sm:inline-flex"
                />

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:col-start-2 sm:row-start-2">
                  <AmountInput
                    ariaLabel={`Person ${i + 1} share in USDC`}
                    value={s.amount}
                    invalid={err?.part === 'amount'}
                    onChange={v => onChange(i, { amount: v })}
                    onBlur={() => onTouch(rowIds[i], 'amount')}
                    className="w-full sm:w-[240px]"
                  />
                  <p className="tnum min-h-4 text-xs text-ink-3" aria-live="polite">
                    {pct && <>{pct} of total</>}
                  </p>
                </div>
              </div>
              {err && <div className="mt-2 sm:pl-[40px]"><FieldError>{err.message}</FieldError></div>}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
