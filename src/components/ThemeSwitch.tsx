// ─── PayTogether – theme switch (system / light / dark) ─────────────────────
import { Desktop, Moon, Sun, type Icon } from '@phosphor-icons/react';
import { nextThemeChoice, THEME_LABEL, type ThemeChoice } from '../theme';
import { setThemeChoice, useThemeChoice } from '../theme-store';
import { cn } from '../cn';
import { PILL_CLASS, useSlidingPill } from './useSlidingPill';

const OPTIONS: ReadonlyArray<{ id: ThemeChoice; icon: Icon }> = [
  { id: 'light', icon: Sun },
  { id: 'system', icon: Desktop },
  { id: 'dark', icon: Moon },
];

const ICON_OF: Record<ThemeChoice, Icon> = { light: Sun, system: Desktop, dark: Moon };

export function ThemeSwitch() {
  const choice = useThemeChoice();
  const { track, pill } = useSlidingPill(choice);
  const Current = ICON_OF[choice];

  return (
    <>
      {/* sm and up: three-state segmented pill */}
      <div
        ref={track}
        role="radiogroup"
        aria-label="Theme"
        className="relative hidden items-center gap-0.5 rounded-full border border-line bg-[var(--tab-track)] p-1 sm:inline-flex"
      >
        <span ref={pill} aria-hidden className={PILL_CLASS} style={{ opacity: 0 }} />
        {OPTIONS.map(({ id, icon: OptIcon }) => {
          const active = id === choice;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={THEME_LABEL[id]}
              title={THEME_LABEL[id]}
              data-pill-active={active}
              onClick={() => setThemeChoice(id)}
              className={cn(
                'relative z-10 flex h-7 w-8 items-center justify-center rounded-full transition-colors duration-150',
                active ? 'text-ink' : 'text-ink-3 hover:text-ink',
              )}
            >
              <OptIcon size={16} weight={active ? 'fill' : 'regular'} />
            </button>
          );
        })}
      </div>

      {/* below sm: one button that cycles */}
      <button
        type="button"
        onClick={() => setThemeChoice(nextThemeChoice(choice))}
        aria-label={`${THEME_LABEL[choice]}. Tap to change.`}
        title={THEME_LABEL[choice]}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-[var(--tab-track)] text-ink-2 transition-colors duration-150 hover:text-ink sm:hidden"
      >
        <Current size={18} weight="regular" />
      </button>
    </>
  );
}
