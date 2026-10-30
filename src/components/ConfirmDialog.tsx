// ─── Kitty – small confirm dialog (used before cancelling a kitty) ──────────
import { useEffect, useRef, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from './ui';
import { cn } from '../cn';

export function ConfirmDialog({
  title, children, confirmLabel, cancelLabel = 'Keep it', danger = false, onConfirm, onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const reduce = useReducedMotion();
  const keepRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; });

  // Focus the safe choice first; Escape also takes the safe choice.
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(10,10,12,0.55)] p-4 backdrop-blur-sm sm:items-center"
      role="presentation"
    >
      <motion.div
        role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
        initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
        className="card w-full max-w-md space-y-4 p-6"
      >
        <h2 id="confirm-title" className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">{children}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={keepRef} variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} className={cn(danger && 'font-semibold')} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </motion.div>
    </div>
  );
}
