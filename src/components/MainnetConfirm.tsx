// ─── Kitty – one-time mainnet confirmation ──────────────────────────────────
// Shown before the first write of a session on mainnet: exactly what will be
// sent, to whom, and that the payout cannot be reversed. Continue is disabled
// until "Got it" is ticked. Esc or Cancel sends nothing.
import { useEffect, useRef, useState } from 'react';
import { Button, Card } from './ui';
import type { WriteSummary } from '../write-summary';

export function MainnetConfirm({
  summary, networkName, onCancel, onContinue,
}: {
  summary: WriteSummary;
  networkName: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const [gotIt, setGotIt] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; });

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(10,10,12,0.55)] p-4 backdrop-blur-sm sm:items-center">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="mainnet-confirm-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-5 overflow-y-auto p-6"
      >
        <div className="space-y-1">
          <h2 id="mainnet-confirm-title" className="text-[17px] font-semibold tracking-tight text-ink">{summary.title}</h2>
          <p className="text-[13px] text-ink-2">This uses real USDC on {networkName}. Check the details before you continue.</p>
        </div>

        <dl className="space-y-2.5 rounded-tile bg-s2 p-4 text-sm">
          {summary.rows.map(r => (
            <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <dt className="text-ink-3">{r.label}</dt>
              <dd className={r.mono ? 'mono break-all text-[12.5px] text-ink' : 'tnum text-right text-ink'}>{r.value}</dd>
            </div>
          ))}
        </dl>

        <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-2">
          {summary.warnings.map(w => <li key={w} className="text-pretty">{w}</li>)}
        </ul>

        <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-snug text-ink">
          <input
            ref={boxRef}
            type="checkbox"
            checked={gotIt}
            onChange={e => setGotIt(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span>Got it. This moves real USDC and a payout cannot be reversed.</span>
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onContinue} disabled={!gotIt}>Continue</Button>
        </div>
      </Card>
    </div>
  );
}
