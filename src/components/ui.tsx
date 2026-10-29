// ─── PayTogether – UI primitives ─────────────────────────────────────────────
// Button, Card, Chip/StatusPill, Avatar, Skeleton, EmptyState, Notice.
// Form controls live in fields.tsx. All shapes: cards 20, tiles 14, pills full.
import { forwardRef, type ReactNode } from 'react';
import {
  motion, useMotionTemplate, useMotionValue, useReducedMotion, type HTMLMotionProps,
} from 'motion/react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '../cn';
import { avatarColors } from '../pt-ui';
import type { ContributorStatus } from '../pt-share';
import { CONTRIBUTOR_STATUS_LABEL } from '../pt-share';

// ── Button ────────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent-btn)] text-[var(--on-accent)] hover:bg-[var(--accent)] active:bg-[var(--accent-press)] ' +
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(0,0,0,0.3)] ' +
    'disabled:border disabled:border-line disabled:bg-s3 disabled:text-ink-3 disabled:opacity-100 disabled:shadow-none',
  secondary:
    'bg-s3 text-ink border border-line-strong hover:border-ink-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
  ghost: 'bg-transparent text-ink-2 hover:bg-s2 hover:text-ink',
  danger: 'bg-err-soft text-err-text border border-[color-mix(in_srgb,var(--err)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--err)_22%,transparent)]',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-[13px] gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Shows loadingText with an inline progress sweep instead of the label. */
  loading?: boolean;
  loadingText?: string;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary', size = 'md', leading, trailing, loading = false, loadingText,
    disabled, className, children, type = 'button', ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const inactive = disabled || loading;
  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      whileTap={inactive || reduce ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cn(
        'relative inline-flex items-center justify-center overflow-hidden rounded-full font-medium whitespace-nowrap select-none',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        loading && 'cursor-progress',
        VARIANT[variant], SIZE[size], className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <span>{loadingText ?? children}</span>
          <span aria-hidden className="btn-progress" />
        </>
      ) : (
        <>
          {leading}
          <span>{children}</span>
          {trailing}
        </>
      )}
    </motion.button>
  );
});

export function IconButton({
  icon: IconCmp, label, className, ...rest
}: { icon: Icon; label: string } & Omit<HTMLMotionProps<'button'>, 'children' | 'aria-label'>) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={reduce ? undefined : { scale: 0.94 }}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors duration-150',
        'hover:bg-s2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...rest}
    >
      <IconCmp size={18} weight="regular" />
    </motion.button>
  );
}

// ── Card (optional cursor spotlight border) ──────────────────────────────────

interface CardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  variant?: 'card' | 'tile';
  /** Adds the pointer-following spotlight border. Uses motion values, not state. */
  interactive?: boolean;
  children?: ReactNode;
}

export function Card({ variant = 'card', interactive = false, className, children, ...rest }: CardProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(-300);
  const y = useMotionValue(-300);
  const bg = useMotionTemplate`radial-gradient(180px circle at ${x}px ${y}px, color-mix(in srgb, var(--text) 38%, transparent), transparent 70%)`;
  const spot = interactive && !reduce;
  return (
    <motion.div
      className={cn(variant === 'card' ? 'card' : 'tile', interactive && 'hover-lift', spot && 'has-spot', className)}
      whileHover={interactive && !reduce ? { y: -1 } : undefined}
      onPointerMove={spot ? (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - r.left);
        y.set(e.clientY - r.top);
      } : undefined}
      {...rest}
    >
      {spot && <motion.span aria-hidden className="spot-border" style={{ background: bg }} />}
      {children}
    </motion.div>
  );
}

// ── Chips and status pills ───────────────────────────────────────────────────

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'err';

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-s3 text-ink-2',
  ok: 'bg-ok-soft text-ok-text',
  warn: 'bg-warn-soft text-warn-text',
  err: 'bg-err-soft text-err-text',
};

/** Text-only pill: 12px medium with a subtle tinted background. */
export function Chip({
  tone = 'neutral', className, children,
}: { tone?: ChipTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        CHIP_TONE[tone], className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<ContributorStatus, ChipTone> = {
  'paid': 'ok',
  'partial': 'warn',
  'not-paid': 'neutral',
  'refunded': 'neutral',
};

export function StatusPill({ status }: { status: ContributorStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{CONTRIBUTOR_STATUS_LABEL[status]}</Chip>;
}

export function YouChip() {
  return <Chip className="bg-s3 text-ink">You</Chip>;
}

// ── Avatar ────────────────────────────────────────────────────────────────────

export function Avatar({ address, size = 32, className }: { address: string; size?: number; className?: string }) {
  const c = avatarColors(address);
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${c.from}, ${c.to})`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)',
      }}
    />
  );
}

/** Placeholder while an address is empty: a plain surface-3 disc. */
export function EmptyAvatar({ size = 32, className }: { size?: number; className?: string }) {
  return <span aria-hidden className={cn('inline-block shrink-0 rounded-full bg-s3', className)} style={{ width: size, height: size }} />;
}

// ── Skeleton / Empty / Notice ────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton', className)} />;
}

export function EmptyState({
  title, children, action,
}: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-start gap-4 p-6 sm:p-8">
      <div className="space-y-1.5">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
        {children && <p className="max-w-md text-sm leading-relaxed text-ink-2 text-pretty">{children}</p>}
      </div>
      {action}
    </div>
  );
}

const NOTICE_BORDER: Record<'info' | 'warn' | 'err', string> = {
  info: 'border-l-ink-3 bg-s2',
  warn: 'border-l-warn bg-s2',
  err: 'border-l-err bg-err-soft',
};

/** Plain text block on surface-2 with a 2px left border. Only errors are tinted. */
export function Notice({
  tone = 'info', children, action, className,
}: { tone?: 'info' | 'warn' | 'err'; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-[10px] border-l-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2',
        NOTICE_BORDER[tone], className,
      )}
    >
      <div className="min-w-0 flex-1 text-pretty">{children}</div>
      {action}
    </div>
  );
}
