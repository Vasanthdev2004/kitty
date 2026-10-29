// ─── Kitty – Open a kitty (by ID or share link) ──────────────────────────────
import { useState, type FormEvent } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { parseKittyInput } from '../kitty-core';
import { Button, EmptyState } from './ui';

interface OrderLookupProps {
  /** Kitty ID loaded from a link. Prefills the input (remount via key to change). */
  externalOrderId?: string;
  onLookup: (id: `0x${string}`) => void | Promise<void>;
  loading: boolean;
  error: string | undefined;
}

export function OrderLookup({ externalOrderId, onLookup, loading, error }: OrderLookupProps) {
  const [input, setInput] = useState(externalOrderId ?? '');
  const [inputErr, setInputErr] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const r = parseKittyInput(input);
    if (r.kind === 'empty') { setInputErr('Paste a kitty ID or a share link.'); return; }
    if (r.kind === 'invalid') {
      setInputErr('That is not a kitty ID or share link. A kitty ID is 0x followed by 64 hex characters.');
      return;
    }
    setInputErr('');
    setInput(r.id);
    void onLookup(r.id);
  }

  const shownError = inputErr || error;

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <label htmlFor="orderid-input" className="sr-only">Kitty ID or share link</label>
      <div
        data-invalid={shownError ? 'true' : undefined}
        className="field-shell flex h-14 items-center gap-2 rounded-full bg-s1 pl-5 pr-1.5 shadow-[var(--highlight)]"
      >
        <MagnifyingGlass size={18} weight="regular" className="shrink-0 text-ink-3" />
        <input
          id="orderid-input"
          value={input}
          onChange={e => { setInput(e.target.value); setInputErr(''); }}
          placeholder="Paste kitty ID or share link"
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
          aria-invalid={!!shownError || undefined}
          aria-describedby={shownError ? 'orderid-err' : undefined}
          className="mono min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 disabled:opacity-55"
        />
        <Button type="submit" size="md" disabled={loading || !input.trim()} loading={loading} loadingText="Loading">
          Open kitty
        </Button>
      </div>
      {shownError && <p id="orderid-err" role="alert" className="px-5 text-[12.5px] text-err-text">{shownError}</p>}
    </form>
  );
}

export function LookupEmpty() {
  return (
    <EmptyState title="Open a kitty">
      Paste a kitty ID or the share link a friend sent you. You will see who has chipped in and what is left.
    </EmptyState>
  );
}
