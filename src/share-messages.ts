// ─── Kitty – share messages and chat links (pure) ───────────────────────────
// One message per situation, built from the kitty itself. Every template ends in
// ": <link>" so the link can be lifted out again for Telegram, which takes the
// URL and the text as separate parameters.
import { formatUsdcPlain } from './pt-share';
import { formatDeadline } from './pt-utils';
import type { KittyData } from './kitty-types';

// ── Encoding ─────────────────────────────────────────────────────────────────

/**
 * encodeURIComponent throws on a lone surrogate (half an emoji). Replace those with
 * U+FFFD first so a pasted, damaged string can never break the share link.
 * Emoji, &, #, ? and newlines are all percent-encoded as UTF-8.
 */
export function safeEncode(text: string): string {
  let clean = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { clean += text[i] + text[i + 1]; i++; } else clean += '\uFFFD';
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      clean += '\uFFFD';
    } else {
      clean += text[i];
    }
  }
  return encodeURIComponent(clean.replace(/\r\n?/g, '\n'));
}

/** https://wa.me/?text=<message>. No script, no SDK: a plain link. */
export function whatsappUrl(message: string): string {
  return `https://wa.me/?text=${safeEncode(message)}`;
}

/**
 * https://t.me/share/url?url=<link>&text=<message without the link>.
 * If the edited message no longer contains the link, the whole message is the text.
 */
export function telegramUrl(message: string, link: string): string {
  const without = message.includes(link)
    ? message.replace(link, '').replace(/[\s:]+$/, '').replace(/^[\s:]+/, '')
    : message;
  return `https://t.me/share/url?url=${safeEncode(link)}&text=${safeEncode(without)}`;
}

// ── Templates ────────────────────────────────────────────────────────────────

export function splitMessage(p: { ref: string; amountText: string; deadlineText: string; link: string }): string {
  return `Your share for ${p.ref} is ${p.amountText} USDC. Chip in before ${p.deadlineText}: ${p.link}`;
}

export function openMessage(p: { ref: string; remainingText: string; floorText: string; deadlineText: string; link: string }): string {
  return `Chipping in for ${p.ref}. ${p.remainingText} USDC to go, minimum ${p.floorText} USDC, by ${p.deadlineText}: ${p.link}`;
}

export function requestMessage(p: { ref: string; goalText: string; link: string }): string {
  return `${p.ref}: ${p.goalText} USDC requested, split it with friends: ${p.link}`;
}

/** Split kitty, no known share for the reader (for example the creator posting to a group). */
export function splitGroupMessage(p: { ref: string; deadlineText: string; link: string }): string {
  return `Chip in for ${p.ref} before ${p.deadlineText}. Your share is on the page: ${p.link}`;
}

/** The message for the share step: picks the right template for this kitty and reader. */
export function shareMessageFor(data: KittyData, link: string, me?: string): string {
  const ref = data.ref || 'this kitty';
  const deadlineText = formatDeadline(data.deadline);
  const requested = data.creator.toLowerCase() === data.recipient.toLowerCase();
  if (requested) return requestMessage({ ref, goalText: formatUsdcPlain(data.goalRaw), link });
  if (data.mode === 'open') {
    const remaining = data.goalRaw > data.totalFundedRaw ? data.goalRaw - data.totalFundedRaw : 0n;
    return openMessage({
      ref, remainingText: formatUsdcPlain(remaining), floorText: formatUsdcPlain(data.effectiveMinRaw), deadlineText, link,
    });
  }
  const mine = me ? data.contributors.find(c => c.address.toLowerCase() === me.toLowerCase()) : undefined;
  return mine && mine.shareRaw > 0n
    ? splitMessage({ ref, amountText: formatUsdcPlain(mine.shareRaw), deadlineText, link })
    : splitGroupMessage({ ref, deadlineText, link });
}

/** A reminder for one person: their exact remaining share. */
export function remindMessageFor(data: KittyData, shareRaw: bigint, contributedRaw: bigint, link: string): string {
  const remaining = shareRaw > contributedRaw ? shareRaw - contributedRaw : 0n;
  const base = splitMessage({
    ref: data.ref || 'this kitty', amountText: formatUsdcPlain(remaining), deadlineText: formatDeadline(data.deadline), link,
  });
  return `${base}\n${PAY_FOR_YOU_LINE}`;
}

/** Reminders tell the person that a friend can cover their share. */
export const PAY_FOR_YOU_LINE = 'Or anyone can pay it for you.';

/** Who may send reminders: the creator and the recipient. */
export function canRemind(data: Pick<KittyData, 'creator' | 'recipient'>, me: string | undefined): boolean {
  if (!me) return false;
  const m = me.toLowerCase();
  return data.creator.toLowerCase() === m || data.recipient.toLowerCase() === m;
}

// ── Share step memory ────────────────────────────────────────────────────────

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

const stepKey = (chainId: number, potId: string) => `kitty:share-step-dismissed:${chainId}:${potId.toLowerCase()}`;

export function isShareStepDismissed(chainId: number, potId: string, store: StorageLike | undefined): boolean {
  try { return store?.getItem(stepKey(chainId, potId)) === '1'; } catch { return false; }
}

export function dismissShareStep(chainId: number, potId: string, store: StorageLike | undefined): void {
  try { store?.setItem(stepKey(chainId, potId), '1'); } catch { /* storage blocked: it just shows again */ }
}

// ── Card image text ──────────────────────────────────────────────────────────

/** Truncate by code points (never splits an emoji) with an ellipsis. */
export function truncateText(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}\u2026`;
}

export interface CardImageModel {
  title: string;
  fullTitle: string;
  kindLabel: string;
  amountLine: string;
  percent: number;
  tagline: string;
}

/** Everything the "Save as image" card prints, as plain strings. */
export function cardImageModel(data: KittyData): CardImageModel {
  const pct = data.goalRaw > 0n ? Number((data.totalFundedRaw * 1000n) / data.goalRaw) / 10 : 0;
  const fullTitle = data.ref || 'Untitled kitty';
  return {
    title: truncateText(fullTitle, 36),
    fullTitle,
    kindLabel: data.creator.toLowerCase() === data.recipient.toLowerCase() ? 'Payment request' : data.mode === 'split' ? 'Split' : 'Open pool',
    amountLine: `${formatUsdcPlain(data.totalFundedRaw)} of ${formatUsdcPlain(data.goalRaw)} USDC`,
    percent: Math.max(0, Math.min(100, pct)),
    tagline: 'Nobody fronts the money.',
  };
}

/** localStorage, or undefined when the browser blocks it. */
export function localStore(): StorageLike | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

/** "Weekend in Lisbon!" -> "kitty-weekend-in-lisbon.png". Always a safe file name. */
export function cardFileName(ref: string): string {
  const slug = ref.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `kitty-${slug || 'card'}.png`;
}
