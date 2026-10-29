// ─── PayTogether – Transaction "island" ──────────────────────────────────────
// Floating pill that morphs between transaction states. Same TxStatus
// semantics as before: uncertain never dismisses and always offers a retry.
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowSquareOut, X } from '@phosphor-icons/react';
import type { TxStatus } from '../pt-types';
import { plain } from '../pt-ui';
import { cn } from '../cn';
import { Button } from './ui';

const shortHash = (h: string) => `${h.slice(0, 8)}\u2026${h.slice(-4)}`;

function statusKey(s: TxStatus): string {
  if (s.kind === 'rejected') return `rejected:${s.message}`;
  if ('hash' in s) return `${s.kind === 'submitted' ? 'confirming' : s.kind}:${s.hash}`;
  return s.kind;
}

interface View {
  tone: string;
  title: string;
  detail?: ReactNode;
  dismissible: boolean;
  busy: boolean;
  action?: ReactNode;
}

export function TxIsland({
  status, explorerBase, onRetry,
}: { status: TxStatus; explorerBase: string; onRetry: () => void }) {
  const reduce = useReducedMotion();
  const key = statusKey(status);
  const [dismissed, setDismissed] = useState<string | undefined>();

  // Confirmed fades away on its own.
  useEffect(() => {
    if (status.kind !== 'confirmed') return;
    const id = setTimeout(() => setDismissed(key), 4500);
    return () => clearTimeout(id);
  }, [status.kind, key]);

  const hashLink = (hash: `0x${string}`) => (
    <a
      href={`${explorerBase}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mono inline-flex items-center gap-1 text-ink underline underline-offset-2 hover:text-accent-text"
    >
      {shortHash(hash)}
      <ArrowSquareOut size={12} weight="regular" />
    </a>
  );

  let view: View | null = null;
  switch (status.kind) {
    case 'wallet-pending':
      view = { tone: 'text-ink', title: 'Waiting for wallet', detail: status.label, dismissible: false, busy: true };
      break;
    case 'submitted':
    case 'confirming':
      view = { tone: 'text-ink', title: 'Confirming', detail: <>{status.label} {hashLink(status.hash)}</>, dismissible: false, busy: true };
      break;
    case 'confirmed':
      view = { tone: 'text-ok-text', title: 'Confirmed', detail: <>{status.label} {hashLink(status.hash)}</>, dismissible: true, busy: false };
      break;
    case 'rejected':
      view = { tone: 'text-err-text', title: 'Rejected', detail: plain(status.message).slice(0, 90), dismissible: true, busy: false };
      break;
    case 'reverted':
      view = { tone: 'text-err-text', title: 'Reverted', detail: hashLink(status.hash), dismissible: true, busy: false };
      break;
    case 'uncertain':
      view = {
        tone: 'text-warn-text', title: 'Receipt uncertain',
        detail: <>{hashLink(status.hash)} Do not resubmit.</>,
        dismissible: false, busy: false,
        action: <Button size="sm" variant="secondary" onClick={onRetry} className="h-8">Retry lookup</Button>,
      };
      break;
    default:
      view = null;
  }

  const visible = view !== null && dismissed !== key;
  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 34 };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[76px] z-50 flex justify-center px-3">
      <AnimatePresence>
        {visible && view && (
          <motion.div
            key="island"
            layout
            role="status"
            aria-live="polite"
            initial={reduce ? false : { opacity: 0, y: -12, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -8, scale: 0.94 }}
            transition={spring}
            style={{ borderRadius: 999 }}
            className="pointer-events-auto relative flex max-w-full items-center gap-3 overflow-hidden border border-line-strong bg-s2 py-2 pl-3 pr-3 shadow-[var(--highlight),var(--shadow-pop)]"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={view.title}
                layout="position"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: reduce ? 0 : 0.18 }}
                className="flex min-w-0 items-center gap-3"
              >
                <div className="min-w-0 py-0.5 pl-1 leading-tight">
                  <p className={cn('text-[13px] font-medium', view.tone)}>{view.title}</p>
                  {view.detail && <p className="truncate text-xs text-ink-2">{view.detail}</p>}
                </div>
              </motion.div>
            </AnimatePresence>
            {view.action}
            {view.dismissible && (
              <button
                type="button"
                onClick={() => setDismissed(key)}
                aria-label="Dismiss"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-s3 hover:text-ink"
              >
                <X size={14} weight="regular" />
              </button>
            )}
            {view.busy && <span aria-hidden className="btn-progress text-ink-2" />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
