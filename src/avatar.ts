// ─── Kitty – avatar identity (pure) ─────────────────────────────────────────
// Address avatars come from `boring-avatars` (marble), seeded by the lowercase
// address, with ONE curated palette that reads in both themes: cool blues, slate
// and teal, plus a single warm note. Named avatars (demo people, "You") are
// initials on a soft tint picked from the same family; every tint passes AA.

export const AVATAR_PALETTE = ['#2C3E6B', '#5B7FA6', '#8FBFCB', '#2F7F86', '#E0A458'] as const;

/** Soft backgrounds with dark text. Fixed colours, so contrast is the same in light and dark themes. */
export const NAMED_TINTS = [
  { bg: '#D6E2F5', fg: '#1D2F52' }, // blue
  { bg: '#CFE6EA', fg: '#15484E' }, // teal
  { bg: '#DCE3EC', fg: '#263545' }, // slate
  { bg: '#F4E3C6', fg: '#5A3A0B' }, // warm sand
  { bg: '#D3E4F0', fg: '#1B3F5C' }, // steel
] as const;

/** FNV-1a, 32 bit. Stable across runs and platforms. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface AddressAvatarProps {
  /** boring-avatars seed: the lowercase address. */
  name: string;
  size: number;
  variant: 'marble';
  colors: string[];
}

export function addressAvatarProps(address: string, size: number): AddressAvatarProps {
  return { name: address.trim().toLowerCase(), size, variant: 'marble', colors: [...AVATAR_PALETTE] };
}

/** "Ana" -> "A", "Mei Lin" -> "ML", "You" -> "Y". One or two letters, upper case. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return [...words[0]][0].toUpperCase();
  return ([...words[0]][0] + [...words[words.length - 1]][0]).toUpperCase();
}

export interface NamedAvatar { initials: string; bg: string; fg: string; fontSize: number }

export function namedAvatar(name: string, size: number): NamedAvatar {
  const tint = NAMED_TINTS[hashString(name.trim().toLowerCase()) % NAMED_TINTS.length];
  return { initials: initialsOf(name), bg: tint.bg, fg: tint.fg, fontSize: Math.round(size * 0.4 * 10) / 10 };
}

// ── Contrast (WCAG 2.x) ──────────────────────────────────────────────────────

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether `me` (the connected wallet) is this address. Case-insensitive. */
export function isSameAddress(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
