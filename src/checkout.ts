// ─── "Pay together" checkout links (pure) ───────────────────────────────────
// A shop links to   <app>/?new=open&to=<shop address>&amount=240&ref=Espresso+machine&days=7&lock=1&shop=Acme
// and the create form opens prefilled. Nothing is stored anywhere: the link IS the order.
//
//   new     open | split | request   open/split fix the mode; request lets the buyer choose
//   to      0x address of the shop (the recipient)
//   amount  USDC, up to 6 decimals, above zero
//   ref     what it is for, at most 64 bytes of UTF-8 (the contract's limit)
//   days    deadline in days from when the buyer opens the link, 1 to 90
//   lock    1 = recipient and amount cannot be edited by the buyer
//   shop    display name, at most 40 characters
//
// Parsing is strict but never throws: a bad value is dropped and reported so the page
// can say, calmly, what it ignored.
import { isAddress } from 'viem';
import { parseUsdcAmount } from './pt-utils';

export type CheckoutNew = 'open' | 'split' | 'request';
export const CHECKOUT_NEW: readonly CheckoutNew[] = ['open', 'split', 'request'];

export const MAX_REF_BYTES = 64;
export const MAX_SHOP_CHARS = 40;
export const MIN_DAYS = 1;
export const MAX_DAYS = 90;

export interface CheckoutParams {
  mode: CheckoutNew;
  to?: string;
  amount?: string;
  ref?: string;
  days?: number;
  lock?: boolean;
  shop?: string;
}

export interface CheckoutContext { kitty?: string; usdc?: string }

export interface IgnoredParam { param: 'to' | 'amount' | 'ref' | 'days' | 'lock' | 'shop'; why: string }

export interface CheckoutParse { params: CheckoutParams; ignored: readonly IgnoredParam[] }

const ZERO = '0x0000000000000000000000000000000000000000';
const CHECKOUT_KEYS = ['to', 'amount', 'ref', 'days', 'lock', 'shop'] as const;

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;
const codePoints = (s: string): number => [...s].length;

// ── Single-field validators (shared with the For sellers form) ───────────────

export function checkTo(v: string, ctx: CheckoutContext = {}): string | undefined {
  const a = v.trim();
  if (!isAddress(a)) return 'must be a wallet address (0x followed by 40 characters)';
  const l = a.toLowerCase();
  if (l === ZERO) return 'cannot be the zero address';
  if (ctx.kitty && l === ctx.kitty.toLowerCase()) return 'cannot be the Kitty contract';
  if (ctx.usdc && l === ctx.usdc.toLowerCase()) return 'cannot be the USDC token';
  return undefined;
}
export function checkAmount(v: string): string | undefined {
  const p = parseUsdcAmount(v.trim());
  if (!p.ok || p.raw <= 0n) return 'must be a USDC amount above zero with at most 6 decimals';
  return undefined;
}
export function checkRef(v: string): string | undefined {
  if (!v.trim()) return 'cannot be empty';
  if (utf8Bytes(v) > MAX_REF_BYTES) return `must be at most ${MAX_REF_BYTES} bytes`;
  return undefined;
}
export function checkShop(v: string): string | undefined {
  if (!v.trim()) return 'cannot be empty';
  if (codePoints(v) > MAX_SHOP_CHARS) return `must be at most ${MAX_SHOP_CHARS} characters`;
  return undefined;
}
export function checkDays(v: string): string | undefined {
  if (!/^\d{1,3}$/.test(v.trim())) return `must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}`;
  const n = Number(v);
  return n >= MIN_DAYS && n <= MAX_DAYS ? undefined : `must be a whole number from ${MIN_DAYS} to ${MAX_DAYS}`;
}

// ── Parse ────────────────────────────────────────────────────────────────────

/**
 * undefined when the link is not a checkout link at all (no new=open|split|request, or none of
 * the checkout parameters). Otherwise the valid values plus what was ignored.
 */
export function parseCheckout(search: string, ctx: CheckoutContext = {}): CheckoutParse | undefined {
  const q = new URLSearchParams(search);
  const n = q.get('new');
  if (n !== 'open' && n !== 'split' && n !== 'request') return undefined;
  if (!CHECKOUT_KEYS.some(k => q.has(k))) return undefined;

  const params: CheckoutParams = { mode: n };
  const ignored: IgnoredParam[] = [];
  const drop = (param: IgnoredParam['param'], why: string) => ignored.push({ param, why });

  const to = q.get('to');
  if (to !== null) { const e = checkTo(to, ctx); if (e) drop('to', e); else params.to = to.trim(); }

  const amount = q.get('amount');
  if (amount !== null) { const e = checkAmount(amount); if (e) drop('amount', e); else params.amount = amount.trim(); }

  const ref = q.get('ref');
  if (ref !== null) { const e = checkRef(ref); if (e) drop('ref', e); else params.ref = ref; }

  const days = q.get('days');
  if (days !== null) { const e = checkDays(days); if (e) drop('days', e); else params.days = Number(days); }

  const shop = q.get('shop');
  if (shop !== null) { const e = checkShop(shop); if (e) drop('shop', e); else params.shop = shop.trim(); }

  const lock = q.get('lock');
  if (lock === '1') {
    // Locking something that was not given (or was invalid) would lock nothing.
    if (params.to || params.amount) params.lock = true;
    else drop('lock', 'needs a valid to or amount to lock');
  } else if (lock !== null && lock !== '0' && lock !== '') {
    drop('lock', 'only lock=1 is supported');
  }

  return { params, ignored };
}

/** One calm sentence naming what the page ignored, or undefined when nothing was. */
export function ignoredNote(ignored: readonly IgnoredParam[]): string | undefined {
  if (ignored.length === 0) return undefined;
  return `Ignored from the link: ${ignored.map(i => `${i.param} (${i.why})`).join('; ')}.`;
}

// ── Build ────────────────────────────────────────────────────────────────────

/** "?new=open&to=...". Everything is percent-encoded, so &, #, newlines, emoji and unicode round-trip. */
export function buildCheckoutSearch(p: CheckoutParams): string {
  const sp = new URLSearchParams();
  sp.set('new', p.mode);
  if (p.to) sp.set('to', p.to);
  if (p.amount) sp.set('amount', p.amount);
  if (p.ref !== undefined && p.ref !== '') sp.set('ref', p.ref);
  if (p.days !== undefined) sp.set('days', String(p.days));
  if (p.lock) sp.set('lock', '1');
  if (p.shop) sp.set('shop', p.shop);
  return `?${sp.toString()}`;
}

/** Full link from the share base (never from a hardcoded "/"), e.g. https://site/testnet/?new=open&... */
export function buildCheckoutLink(base: string, p: CheckoutParams): string {
  return `${base.replace(/\/+$/, '')}/${buildCheckoutSearch(p)}`;
}

// ── For sellers form → params ────────────────────────────────────────────────

export interface SellerForm {
  recipient: string;
  shop: string;
  ref: string;
  amount: string;
  days: string;
  mode: 'open' | 'split';
  lock: boolean;
}

export interface SellerFormResult {
  params?: CheckoutParams;
  errors: Partial<Record<'recipient' | 'shop' | 'ref' | 'amount' | 'days', string>>;
}

/** Validates the seller's form with the same rules the buyer's page applies. params only when everything is valid. */
export function sellerFormToParams(f: SellerForm, ctx: CheckoutContext = {}): SellerFormResult {
  const errors: SellerFormResult['errors'] = {};
  const e1 = checkTo(f.recipient, ctx); if (e1) errors.recipient = `Recipient ${e1}.`;
  if (f.shop.trim()) { const e = checkShop(f.shop); if (e) errors.shop = `Shop name ${e}.`; }
  const e3 = checkRef(f.ref); if (e3) errors.ref = `Item ${e3}.`;
  const e4 = checkAmount(f.amount); if (e4) errors.amount = `Amount ${e4}.`;
  const e5 = checkDays(f.days); if (e5) errors.days = `Days ${e5}.`;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    params: {
      mode: f.mode, to: f.recipient.trim(), amount: f.amount.trim(), ref: f.ref, days: Number(f.days),
      lock: f.lock || undefined, shop: f.shop.trim() || undefined,
    },
  };
}
