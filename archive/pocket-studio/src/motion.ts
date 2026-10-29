// ─── Pocket Studio – Motion presets ─────────────────────────────────────────
export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: [0.25, 0.1, 0.25, 1.0] },
};

export const springs = {
  snappy: { type: 'spring', stiffness: 420, damping: 32 } as const,
  gentle: { type: 'spring', stiffness: 300, damping: 26 } as const,
  sheet: { type: 'spring', stiffness: 400, damping: 36 } as const,
};
