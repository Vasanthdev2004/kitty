// ─── Sliding active pill for segmented controls ─────────────────────────────
// The indicator lives INSIDE the control's own box (`relative` track, absolute
// pill) and is placed with a measured translateX + width. There is no shared
// layout animation, so it can never drift into neighbouring content when the
// page around it changes height. Only `transform` is transitioned.
import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * `active` is any value that changes when the selection changes. Mark the active
 * button with `data-pill-active="true"`. The track needs `position: relative`.
 */
export function useSlidingPill(active: string) {
  const track = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const t = track.current;
    const p = pill.current;
    if (!t || !p) return;
    const place = () => {
      const el = t.querySelector<HTMLElement>('[data-pill-active="true"]');
      if (!el || el.offsetWidth === 0) { p.style.opacity = '0'; return; }
      p.style.opacity = '1';
      p.style.width = `${el.offsetWidth}px`;
      p.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    place();
    // Slide only after the first placement, so the pill never animates in from x = 0.
    const raf = requestAnimationFrame(() => {
      p.style.transition = reduce ? 'none' : 'transform 220ms cubic-bezier(0.3, 0.9, 0.3, 1)';
    });
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    ro?.observe(t);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [active, reduce]);

  return { track, pill };
}

/** Class for the indicator span. Pair with `style={{ opacity: 0 }}` until first placement. */
export const PILL_CLASS =
  'pointer-events-none absolute inset-y-1 left-0 rounded-full bg-[var(--tab-active)] shadow-[var(--tab-active-shadow)]';
