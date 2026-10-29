// ─── PayTogether – theme store (DOM side) ───────────────────────────────────
// Choice is persisted in localStorage ("pt-theme"). The resolved theme is
// written to <html data-theme>. index.html sets it before React loads so there
// is no flash of the wrong theme.
import { useSyncExternalStore } from 'react';
import {
  THEME_KEY, parseThemeChoice, resolveTheme, type ResolvedTheme, type ThemeChoice,
} from './theme';

const listeners = new Set<() => void>();
let choice: ThemeChoice = 'system';
let started = false;

function prefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function readStored(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

function emit() {
  listeners.forEach(l => l());
}

function apply() {
  document.documentElement.setAttribute('data-theme', resolveTheme(choice, prefersDark()));
}

/** Call once at startup. Re-applies the theme when the OS scheme changes. */
export function initTheme(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  choice = readStored();
  apply();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (choice === 'system') { apply(); emit(); }
  });
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
  apply();
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice, () => 'system');
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => resolveTheme(choice, prefersDark()),
    () => 'dark',
  );
}
