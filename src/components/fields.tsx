// ─── PayTogether – form controls, tabs, copy button ─────────────────────────
import {
  useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ClipboardText, Copy, type Icon } from '@phosphor-icons/react';
import { isAddress } from 'viem';
import { toast } from 'sonner';
import { cn } from '../cn';
import { copyText } from '../copy';
import { Avatar, Button, EmptyAvatar } from './ui';
import { isSameAddress } from '../avatar';
import { PILL_CLASS, useSlidingPill } from './useSlidingPill';

// ── Segmented tabs with a sliding active pill ────────────────────────────────

export function SegmentedTabs<T extends string>({
  tabs, value, onChange, className, ariaLabel,
}: {
  tabs: ReadonlyArray<{ id: T; label: string; icon?: Icon }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
  ariaLabel: string;
}) {
  const { track, pill } = useSlidingPill(value);
  return (
    <div
      ref={track}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('relative inline-flex items-center gap-0.5 rounded-full border border-line bg-[var(--tab-track)] p-1', className)}
    >
      <span ref={pill} aria-hidden className={PILL_CLASS} style={{ opacity: 0 }} />
      {tabs.map(t => {
        const active = t.id === value;
        const TabIcon = t.icon;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            data-pill-active={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative z-10 inline-flex h-9 max-sm:h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 sm:px-4',
              active ? 'text-ink' : 'text-ink-2 hover:text-ink',
            )}
          >
            {TabIcon && <TabIcon size={16} weight={active ? 'fill' : 'regular'} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Input shell: 48px, surface-2, 12px radius ────────────────────────────────
// Focus, hover and invalid styling live in index.css (.field-shell) so the
// shell is the only thing that ever draws a focus outline.

const INNER =
  'min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 disabled:cursor-not-allowed';

export function InputShell({
  invalid, disabled, className, children,
}: { invalid?: boolean; disabled?: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      data-invalid={invalid ? 'true' : undefined}
      className={cn('field-shell flex min-h-12 w-full items-center gap-2 rounded-field bg-s2 px-3', disabled && 'opacity-55', className)}
    >
      {children}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Classes for the outer shell. `className` styles the input itself. */
  shellClassName?: string;
}

export function TextInput({ invalid, mono, leading, trailing, shellClassName, className, ...rest }: TextInputProps) {
  return (
    <InputShell invalid={invalid} disabled={rest.disabled} className={shellClassName}>
      {leading}
      <input
        aria-invalid={invalid || undefined}
        className={cn(INNER, 'h-6', mono && 'mono text-[13px]', className)}
        {...rest}
      />
      {trailing}
    </InputShell>
  );
}

/** Reference with a character counter that shows only while focused or near the limit. */
export function ReferenceInput({
  value, onChange, onBlur, invalid, id, describedBy, max = 64, placeholder,
}: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; invalid?: boolean; id: string;
  describedBy?: string; max?: number; placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const showCount = focused || max - value.length <= 10;
  return (
    <TextInput
      id={id}
      aria-describedby={describedBy}
      invalid={invalid}
      value={value}
      maxLength={max}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onBlur?.(); }}
      trailing={showCount
        ? <span className="tnum shrink-0 text-xs text-ink-3" aria-label={`${value.length} of ${max} characters`}>{value.length}/{max}</span>
        : undefined}
    />
  );
}

/**
 * Address input. Mono, wraps instead of truncating (the full address is always
 * visible), live avatar once valid, a green check only after blur, and a Paste
 * button while empty. Errors are shown by the parent, not by this control.
 */
export function AddressInput({
  value, onChange, onBlur, invalid, ariaLabel, id, describedBy, className, me,
}: {
  /** The connected wallet: a typed address equal to it shows the "You" avatar. */
  me?: string;
  value: string; onChange: (v: string) => void; onBlur?: () => void; invalid?: boolean;
  ariaLabel?: string; id?: string; describedBy?: string; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [blurred, setBlurred] = useState(false);
  const trimmed = value.trim();
  const valid = isAddress(trimmed);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) { w = el.clientWidth; fit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      onChange(t.replace(/\s+/g, ''));
    } catch {
      toast.error('Paste is blocked here. Press Ctrl+V in the field instead.');
    }
  }

  return (
    <InputShell invalid={invalid} className={cn('py-3', className)}>
      {valid ? (isSameAddress(trimmed, me) ? <Avatar name="You" size={24} /> : <Avatar address={trimmed} size={24} />) : <EmptyAvatar size={24} />}
      <textarea
        ref={ref}
        id={id}
        rows={1}
        value={value}
        onChange={e => { setBlurred(false); onChange(e.target.value.replace(/\s+/g, '')); }}
        onBlur={() => { setBlurred(true); onBlur?.(); }}
        onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
        placeholder="0x…"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(INNER, 'mono resize-none overflow-hidden break-all py-0 text-[13px] leading-[18px]')}
      />
      {trimmed.length === 0 ? (
        <Button variant="ghost" size="sm" onClick={() => void paste()} leading={<ClipboardText size={16} weight="regular" />} className="h-8 shrink-0 px-3 text-xs">
          Paste
        </Button>
      ) : valid && blurred ? (
        <span className="shrink-0 text-ok-text" title="Valid address">
          <Check size={18} weight="bold" aria-hidden />
          <span className="sr-only">Valid address</span>
        </span>
      ) : null}
    </InputShell>
  );
}

/** Amount: right-aligned mono value with a muted USDC suffix and an optional Max. */
export function AmountInput({
  value, onChange, onBlur, invalid, disabled, onMax, maxLabel = 'Max', ariaLabel, id, describedBy, autoFocus, className,
}: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; invalid?: boolean; disabled?: boolean;
  onMax?: () => void; maxLabel?: string; ariaLabel?: string; id?: string; describedBy?: string;
  autoFocus?: boolean; className?: string;
}) {
  return (
    <InputShell invalid={invalid} disabled={disabled} className={cn('pl-2', className)}>
      {onMax ? (
        <Button variant="ghost" size="sm" onClick={onMax} disabled={disabled} className="h-8 shrink-0 px-3 text-xs">
          {maxLabel}
        </Button>
      ) : <span className="w-1 shrink-0" aria-hidden />}
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder="0.00"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(INNER, 'mono h-6 text-right text-[15px]')}
      />
      <span className="shrink-0 text-xs text-ink-3">USDC</span>
    </InputShell>
  );
}

/** Label above (13px medium), helper below (12px), error below the field. */
export function Field({
  id, label, helper, error, children, aside,
}: {
  id: string; label: string; helper?: string; error?: string; aside?: ReactNode;
  children: (p: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const ids = [helper ? `${id}-help` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-2">{label}</label>
        {aside}
      </div>
      {children({ id, describedBy: ids, invalid: !!error })}
      {helper && !error && <p id={`${id}-help`} className="text-xs leading-relaxed text-ink-3 text-pretty">{helper}</p>}
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </div>
  );
}

/** Plain red text under the field. No icon. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-[12.5px] leading-relaxed text-err-text">
      {children}
    </p>
  );
}

// ── Copy button with check morph ─────────────────────────────────────────────

export function CopyButton({
  value, label = 'Copy', successMessage, variant = 'icon', disabled, className,
}: {
  value: string | undefined; label?: string; successMessage?: string;
  variant?: 'icon' | 'pill'; disabled?: boolean; className?: string;
}) {
  const reduce = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function handle() {
    if (!value) return;
    const ok = await copyText(value);
    if (!ok) { toast.error('Could not copy. Select the text and copy it manually.'); return; }
    if (successMessage) toast.success(successMessage);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  const glyph = (
    <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            initial={reduce ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? undefined : { scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="text-ok-text"
          >
            <Check size={18} weight="bold" />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={reduce ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduce ? undefined : { scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <Copy size={18} weight="regular" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );

  if (variant === 'pill') {
    return (
      <Button variant="secondary" size="md" onClick={() => void handle()} disabled={disabled || !value} leading={glyph} className={className}>
        {copied ? 'Copied' : label}
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void handle()}
      disabled={disabled || !value}
      aria-label={copied ? 'Copied' : label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 max-sm:h-11 max-sm:w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-150',
        'hover:bg-s3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      {glyph}
    </button>
  );
}
