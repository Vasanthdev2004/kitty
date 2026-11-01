// ─── Kitty – Mainnet | Testnet switch ───────────────────────────────────────
// Two plain links. The current network is marked aria-current and does nothing when
// clicked; the other is a normal link to the other build (a full page load: it is
// a different build on the same site).
import { cn } from '../cn';
import type { SwitchOption } from '../network-switch';

export function NetworkSwitch({ options, className }: { options: SwitchOption[]; className?: string }) {
  return (
    <nav aria-label="Network" className={cn('inline-flex items-center rounded-full border border-line bg-[var(--tab-track)] p-0.5', className)}>
      {options.map(o => (
        <a
          key={o.key}
          href={o.href}
          aria-current={o.current ? 'page' : undefined}
          onClick={o.current ? e => e.preventDefault() : undefined}
          className={cn(
            'inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors duration-150 max-sm:h-10 max-sm:px-4',
            o.current ? 'bg-[var(--tab-active)] text-ink shadow-[var(--tab-active-shadow)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </a>
      ))}
    </nav>
  );
}
