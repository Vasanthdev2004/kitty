// ─── Featured kitty (pure) ──────────────────────────────────────────────────
// Judges and first-time visitors often have no wallet. The person hosting the site can name ONE
// real, already paid-out kitty in VITE_FEATURED_KITTIES (comma-separated ids; the first is used) and the
// home hero and proof strip then link to it. Nothing is listed when it is unset, and no one else's kitty is
// ever listed: the app only links to ids the host put there.

const ID = /^0x[0-9a-fA-F]{64}$/;

/** Valid kitty ids (0x + 64 hex) from a comma- or space-separated list. Invalid entries are ignored; duplicates removed. */
export function parseFeaturedKitties(raw: string | undefined): `0x${string}`[] {
  if (!raw) return [];
  const out: `0x${string}`[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    if (!ID.test(part)) continue;
    const id = part.toLowerCase() as `0x${string}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The kitty the home page points to, or undefined. */
export const firstFeatured = (ids: readonly `0x${string}`[]): `0x${string}` | undefined => ids[0];

export const FEATURED_LABEL = 'See a real paid-out kitty';
