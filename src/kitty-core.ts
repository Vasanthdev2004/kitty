// ─── Kitty – pure helpers ───────────────────────────────────────────────────
// No chain calls and no React: everything here is unit-tested in vitest.
import { encodeAbiParameters, isAddress, keccak256 } from 'viem';
import type { DraftShare } from './pt-types';
import { isoToUnixSeconds, parseUsdcAmount } from './pt-utils';
import { isValidOrderId } from './pt-share';
import { toLocalInputValue } from './pt-ui';
import type {
  ActivityItem, KittyData, KittyMode, MineRole, MineSummary,
} from './kitty-types';

// ── Contract constants (mirrors Kitty.sol) ───────────────────────────────────

export const SETTLE_GRACE_SECONDS = 30n * 24n * 60n * 60n;
export const MAX_OPEN_CONTRIBUTORS = 256n;
export const MAX_SPLIT_CONTRIBUTORS = 64;
export const MAX_REF_BYTES = 64;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ── Pot ids ──────────────────────────────────────────────────────────────────

/** 32 random bytes as 0x-hex. The bytes come from the caller so this stays pure. */
export function saltFromBytes(bytes: Uint8Array): `0x${string}` {
  if (bytes.length !== 32) throw new Error('A salt is exactly 32 bytes');
  return `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Fresh client-side salt. The creator is part of the id, so a salt cannot be squatted. */
export function randomSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return saltFromBytes(bytes);
}

/** Same formula as Kitty.computePotId: keccak256(abi.encode(creator, salt)). */
export function computePotId(creator: string, salt: `0x${string}`): `0x${string}` {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [creator as `0x${string}`, salt]));
}

/** Reads the pot id back from decoded PotCreated logs of our contract. */
export function potIdFromDecodedLogs(
  logs: ReadonlyArray<{ address: string; eventName?: string; args?: unknown }>,
  kitty: string,
): `0x${string}` | undefined {
  for (const l of logs) {
    if (l.address.toLowerCase() !== kitty.toLowerCase() || l.eventName !== 'PotCreated') continue;
    const id = (l.args as { potId?: unknown } | undefined)?.potId;
    if (typeof id === 'string' && isValidOrderId(id)) return id;
  }
  return undefined;
}

// ── Open-kitty floor ─────────────────────────────────────────────────────────

/** ceil(goal / 256): the smallest first-time contribution the contract ever accepts. */
export function dustFloor(goalRaw: bigint): bigint {
  return goalRaw / MAX_OPEN_CONTRIBUTORS + (goalRaw % MAX_OPEN_CONTRIBUTORS === 0n ? 0n : 1n);
}

/** max(creator minimum, ceil(goal / 256)). Mirrors Kitty.effectiveMinContribution. */
export function effectiveMin(goalRaw: bigint, minContributionRaw: bigint): bigint {
  const dust = dustFloor(goalRaw);
  return minContributionRaw > dust ? minContributionRaw : dust;
}

// ── Phase (lifecycle) ────────────────────────────────────────────────────────

export type KittyPhase = 'open' | 'ready' | 'paid' | 'expired' | 'stuck';

/**
 * open     funding is live
 * ready    fully funded, anyone can pay out (until deadline + 30 days)
 * paid     paid out to the recipient
 * expired  deadline passed, not fully funded: refunds open
 * stuck    fully funded but unpaid 30 days past the deadline: refunds open, pay out closed
 */
export function kittyPhase(i: {
  settled: boolean; totalFundedRaw: bigint; goalRaw: bigint; deadline: bigint; now: bigint;
}): KittyPhase {
  if (i.settled) return 'paid';
  if (i.totalFundedRaw >= i.goalRaw) return i.now < i.deadline + SETTLE_GRACE_SECONDS ? 'ready' : 'stuck';
  return i.now < i.deadline ? 'open' : 'expired';
}

/** Phase from the last read, not the live clock, so a button never appears before the chain agrees. */
export function readPhaseOf(d: Pick<KittyData, 'settled' | 'totalFundedRaw' | 'goalRaw' | 'deadline' | 'chainTimestamp'>): KittyPhase {
  return kittyPhase({ settled: d.settled, totalFundedRaw: d.totalFundedRaw, goalRaw: d.goalRaw, deadline: d.deadline, now: d.chainTimestamp });
}

export const PHASE_PILL: Record<KittyPhase, { label: string; tone: 'neutral' | 'ok' | 'warn' }> = {
  open: { label: 'Open', tone: 'neutral' },
  ready: { label: 'Ready to pay out', tone: 'ok' },
  paid: { label: 'Paid out', tone: 'ok' },
  expired: { label: 'Expired, refunds open', tone: 'warn' },
  stuck: { label: 'Refunds open', tone: 'warn' },
};

export const THIRTY_DAY_RULE =
  'If a fully funded kitty is not paid out within 30 days of its deadline, everyone can take their own money back.';

// ── Action card selection ────────────────────────────────────────────────────

export type KittyActionKind =
  | 'connect' | 'switch'
  | 'chip-in' | 'share-paid' | 'not-invited'
  | 'pay-out' | 'paid'
  | 'refund' | 'refunded' | 'nothing';

export function kittyAction(i: {
  connected: boolean;
  correctChain: boolean;
  phase: KittyPhase;
  mode: KittyMode;
  my?: { shareRaw: bigint; contributedRaw: bigint; refunded: boolean };
}): KittyActionKind {
  if (!i.connected) return 'connect';
  if (!i.correctChain) return 'switch';
  switch (i.phase) {
    case 'open':
      if (i.mode === 'open') return 'chip-in';
      if (!i.my || i.my.shareRaw === 0n) return 'not-invited';
      return i.my.shareRaw - i.my.contributedRaw > 0n ? 'chip-in' : 'share-paid';
    case 'ready':
      return 'pay-out';
    case 'paid':
      return 'paid';
    case 'expired':
    case 'stuck':
      if (i.my?.refunded) return 'refunded';
      return i.my && i.my.contributedRaw > 0n ? 'refund' : 'nothing';
  }
}

/** Cards that carry a transaction button dock to the bottom on mobile. */
export function kittyActionHasDock(kind: KittyActionKind): boolean {
  return kind === 'chip-in' || kind === 'pay-out' || kind === 'refund';
}

export interface ChipInBounds { min: bigint; max: bigint }

/**
 * Amount range the contract accepts for this wallet right now.
 * split: up to the rest of your own share. open: up to what is missing; a
 * first-time funder needs the floor unless the payment completes the goal.
 */
export function chipInBounds(i: {
  mode: KittyMode;
  goalRaw: bigint;
  totalFundedRaw: bigint;
  effectiveMinRaw: bigint;
  my?: { shareRaw: bigint; contributedRaw: bigint };
}): ChipInBounds {
  const remaining = i.goalRaw - i.totalFundedRaw;
  if (i.mode === 'split') {
    const own = i.my ? i.my.shareRaw - i.my.contributedRaw : 0n;
    const max = own < remaining ? own : remaining;
    return { min: 1n, max: max > 0n ? max : 0n };
  }
  const firstTime = !i.my || i.my.contributedRaw === 0n;
  const floor = firstTime ? (i.effectiveMinRaw < remaining ? i.effectiveMinRaw : remaining) : 1n;
  return { min: floor > 0n ? floor : 1n, max: remaining };
}

export function validateChipIn(amountRaw: bigint, b: ChipInBounds, mode: KittyMode): string | undefined {
  if (b.max <= 0n) return 'Nothing left to chip in.';
  if (amountRaw <= 0n) return 'Enter an amount above zero.';
  if (amountRaw > b.max) return mode === 'split' ? 'That is more than your remaining share.' : 'That is more than the kitty still needs.';
  if (amountRaw < b.min) return 'That is below the minimum for a new person.';
  return undefined;
}

// ── Templates and starts ─────────────────────────────────────────────────────

export type StartKind = 'split' | 'open' | 'request';
export type TemplateId = 'group-gift' | 'trip' | 'rent-deposit' | 'group-buy' | 'event-tickets' | 'team-tool';

export interface KittyTemplate {
  id: TemplateId;
  label: string;
  mode: KittyMode;
  deadlineDays: number;
  refPlaceholder: string;
  helper: string;
}

export const TEMPLATES: readonly KittyTemplate[] = [
  { id: 'group-gift', label: 'Group gift', mode: 'open', deadlineDays: 7, refPlaceholder: 'Gift for Sam', helper: 'Anyone with the link can chip in until the goal is reached.' },
  { id: 'trip', label: 'Trip', mode: 'split', deadlineDays: 14, refPlaceholder: 'Lisbon weekend', helper: 'Name each traveler and their share of the booking.' },
  { id: 'rent-deposit', label: 'Rent deposit', mode: 'split', deadlineDays: 3, refPlaceholder: 'Deposit for 12 Elm St', helper: 'Each roommate has a fixed share. The landlord is paid once, in full.' },
  { id: 'group-buy', label: 'Group buy', mode: 'open', deadlineDays: 5, refPlaceholder: 'Bulk order of coffee', helper: 'Pool money for a purchase. If it falls short, everyone is refunded.' },
  { id: 'event-tickets', label: 'Event tickets', mode: 'split', deadlineDays: 3, refPlaceholder: 'Tickets for Friday', helper: 'One person books, everyone covers their own ticket.' },
  { id: 'team-tool', label: 'Team tool', mode: 'split', deadlineDays: 7, refPlaceholder: 'Annual plan for the design tool', helper: 'Split a subscription across the team.' },
];

export function getTemplate(id: string | null | undefined): KittyTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

export interface KittyDraft {
  kind: StartKind;
  mode: KittyMode;
  recipient: string;
  ref: string;
  goal: string;
  deadlineIso: string;
  /** Open kitties: optional minimum per new person, in USDC. */
  minContribution: string;
  shares: DraftShare[];
}

export function draftFromStart(
  start: { kind: StartKind; template?: TemplateId }, nowMs: number,
): KittyDraft {
  const t = getTemplate(start.template);
  const mode: KittyMode = t ? t.mode : start.kind === 'open' ? 'open' : 'split';
  const days = t ? t.deadlineDays : start.kind === 'request' ? 7 : 7;
  return {
    kind: start.kind,
    mode,
    recipient: '',
    ref: '',
    goal: '',
    deadlineIso: toLocalInputValue(nowMs + days * 86_400_000),
    minContribution: '',
    shares: [{ address: '', amount: '' }, { address: '', amount: '' }],
  };
}

// ── Draft validation ─────────────────────────────────────────────────────────

export interface KittyFormErrors {
  recipient?: string;
  ref?: string;
  goal?: string;
  deadline?: string;
  minContribution?: string;
  shares?: (string | undefined)[];
  sharesSum?: string;
}

const MAX_USDC_RAW = 1_000_000_000_000_000_000n;

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function validateKittyDraft(
  d: KittyDraft, nowSec: number, ctx: { kitty?: string; usdc?: string; account?: string },
): KittyFormErrors {
  const e: KittyFormErrors = {};
  const r = d.recipient.trim();
  if (d.kind === 'request' && !ctx.account) e.recipient = 'Connect your wallet to request a payment.';
  else if (!r) e.recipient = 'Recipient address is required';
  else if (!isAddress(r)) e.recipient = 'Invalid address';
  else if (r.toLowerCase() === ZERO_ADDRESS) e.recipient = 'Recipient cannot be the zero address';
  else if (ctx.kitty && r.toLowerCase() === ctx.kitty.toLowerCase()) e.recipient = 'Recipient cannot be the Kitty contract itself';
  else if (ctx.usdc && r.toLowerCase() === ctx.usdc.toLowerCase()) e.recipient = 'Recipient cannot be the USDC contract';

  if (!d.ref.trim()) e.ref = 'Give the kitty a name';
  else if (utf8Length(d.ref) > MAX_REF_BYTES) e.ref = `Keep the name under ${MAX_REF_BYTES} bytes`;

  const goal = parseUsdcAmount(d.goal);
  if (!d.goal.trim()) e.goal = 'Goal is required';
  else if (!goal.ok) e.goal = goal.error;
  else if (goal.raw > MAX_USDC_RAW) e.goal = 'Amount exceeds maximum representable value';

  if (!d.deadlineIso) e.deadline = 'Deadline is required';
  else if (isoToUnixSeconds(d.deadlineIso) <= nowSec) e.deadline = 'Deadline must be in the future';

  if (d.mode === 'open') {
    if (d.minContribution.trim()) {
      const m = parseUsdcAmount(d.minContribution, true);
      if (!m.ok) e.minContribution = m.error;
      else if (goal.ok && m.raw > goal.raw) e.minContribution = 'The minimum cannot be more than the goal';
    }
    return e;
  }

  // Split: up to 64 named people whose shares add up to the goal.
  const seen = new Set<string>();
  const rows = d.shares.map(s => {
    const a = s.address.trim();
    if (!a) return 'Address required';
    if (!isAddress(a)) return 'Invalid address';
    if (a.toLowerCase() === ZERO_ADDRESS) return 'Contributor cannot be the zero address';
    if (seen.has(a.toLowerCase())) return 'Duplicate contributor address';
    seen.add(a.toLowerCase());
    const p = parseUsdcAmount(s.amount);
    if (!p.ok) return p.error;
    if (p.raw > MAX_USDC_RAW) return 'Amount exceeds maximum representable value';
    return undefined;
  });
  if (rows.some(Boolean)) e.shares = rows;
  if (d.shares.length === 0) e.sharesSum = 'Add at least one person';
  else if (d.shares.length > MAX_SPLIT_CONTRIBUTORS) e.sharesSum = `At most ${MAX_SPLIT_CONTRIBUTORS} people`;
  else if (goal.ok && !rows.some(Boolean)) {
    const sum = d.shares.reduce((acc, s) => acc + (parseUsdcAmount(s.amount).ok ? (parseUsdcAmount(s.amount) as { raw: bigint }).raw : 0n), 0n);
    if (sum !== goal.raw) e.sharesSum = 'Shares must add up to the goal';
  }
  return e;
}

export function hasErrors(e: KittyFormErrors): boolean {
  return Object.keys(e).length > 0;
}

/** Contract call for a valid draft. Throws if the draft was not validated first. */
export function buildCreateCall(d: KittyDraft, salt: `0x${string}`, recipient: string):
  | { functionName: 'createSplitPot'; args: readonly [`0x${string}`, `0x${string}`, bigint, bigint, string, `0x${string}`[], bigint[]] }
  | { functionName: 'createOpenPot'; args: readonly [`0x${string}`, `0x${string}`, bigint, bigint, string, bigint] } {
  const goal = parseUsdcAmount(d.goal);
  if (!goal.ok) throw new Error('Invalid goal');
  const deadline = BigInt(isoToUnixSeconds(d.deadlineIso));
  const to = recipient.trim() as `0x${string}`;
  if (d.mode === 'open') {
    const m = d.minContribution.trim() ? parseUsdcAmount(d.minContribution, true) : { ok: true as const, raw: 0n };
    if (!m.ok) throw new Error('Invalid minimum');
    return { functionName: 'createOpenPot', args: [salt, to, goal.raw, deadline, d.ref.trim(), m.raw] };
  }
  const contributors = d.shares.map(s => s.address.trim() as `0x${string}`);
  const shares = d.shares.map(s => {
    const p = parseUsdcAmount(s.amount);
    if (!p.ok) throw new Error('Invalid share');
    return p.raw;
  });
  return { functionName: 'createSplitPot', args: [salt, to, goal.raw, deadline, d.ref.trim(), contributors, shares] };
}

// ── Routing (query params, no router) ────────────────────────────────────────

export type Route =
  | { view: 'home' }
  | { view: 'new'; kind: StartKind; template?: TemplateId }
  | { view: 'mine' }
  | { view: 'open'; invalid?: boolean }
  | { view: 'kitty'; id: `0x${string}` };

export type Tab = 'new' | 'mine' | 'open';

export function routeTab(r: Route): Tab {
  return r.view === 'mine' ? 'mine' : r.view === 'open' || r.view === 'kitty' ? 'open' : 'new';
}

/** ?kitty=<id> (or the legacy ?order=<id>), ?view=mine, ?view=open, ?new=<kind|template>. */
export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search);
  const rawId = q.get('kitty') ?? q.get('order');
  if (rawId !== null) {
    const id = rawId.trim();
    return isValidOrderId(id) ? { view: 'kitty', id } : { view: 'open', invalid: true };
  }
  const view = q.get('view');
  if (view === 'mine') return { view: 'mine' };
  if (view === 'open') return { view: 'open' };
  const n = q.get('new');
  if (n === 'split' || n === 'open' || n === 'request') return { view: 'new', kind: n };
  const t = getTemplate(n);
  if (t) return { view: 'new', kind: t.mode, template: t.id };
  return { view: 'home' };
}

export function routeToSearch(r: Route): string {
  switch (r.view) {
    case 'kitty': return `?kitty=${r.id}`;
    case 'mine': return '?view=mine';
    case 'open': return '?view=open';
    case 'new': return `?new=${r.template ?? r.kind}`;
    default: return '';
  }
}

export type KittyInputResult =
  | { kind: 'empty' } | { kind: 'invalid' } | { kind: 'valid'; id: `0x${string}` };

/** Accepts a bare id or a full link carrying ?kitty= (or the legacy ?order=). */
export function parseKittyInput(input: string): KittyInputResult {
  const s = input.trim();
  if (!s) return { kind: 'empty' };
  if (isValidOrderId(s)) return { kind: 'valid', id: s };
  const qIdx = s.indexOf('?');
  if (qIdx === -1) return { kind: 'invalid' };
  const r = parseRoute(`?${s.slice(qIdx + 1).split('#')[0]}`);
  return r.view === 'kitty' ? { kind: 'valid', id: r.id } : { kind: 'invalid' };
}

// ── Links, nudge, embed ──────────────────────────────────────────────────────

export function buildKittyUrl(base: string, id: string): string {
  return `${base.replace(/\/+$/, '')}/?kitty=${id}`;
}

export function buildKittyNudge(i: {
  ref: string; mode: KittyMode; shareText?: string; goalText: string; deadlineText: string; link: string;
}): string {
  if (i.mode === 'split' && i.shareText) {
    return `You're in on ${i.ref}: chip in ${i.shareText} USDC by ${i.deadlineText}. ${i.link}`;
  }
  return `Chip in to ${i.ref}: ${i.goalText} USDC goal, open until ${i.deadlineText}. ${i.link}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const EMBED_CSS: ReadonlyArray<readonly [string, string]> = [
  ['display', 'inline-block'],
  ['padding', '12px 20px'],
  ['border-radius', '999px'],
  ['background', '#3563F2'],
  ['color', '#F7F8FF'],
  ['font', '600 14px/1 system-ui,sans-serif'],
  ['text-decoration', 'none'],
];

export const EMBED_LABEL = 'Split with friends';

/** Inline-styled anchor. No script, no external CSS, every dynamic value escaped. */
export function buildEmbedSnippet(url: string, label: string = EMBED_LABEL): string {
  const style = EMBED_CSS.map(([k, v]) => `${k}:${v}`).join(';');
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="${escapeHtml(style)}">${escapeHtml(label)}</a>`;
}

/** The same style as a React style object, so the live preview matches the snippet. */
export function embedStyleObject(): Record<string, string> {
  return Object.fromEntries(EMBED_CSS.map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
}

// ── Activity feed ────────────────────────────────────────────────────────────

export function parseKittyLog(log: {
  eventName?: string; args?: unknown; blockNumber: bigint | null; logIndex: number | null; transactionHash: `0x${string}` | null;
}): ActivityItem | null {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) return null;
  const a = (log.args ?? {}) as Record<string, unknown>;
  const base = { blockNumber: log.blockNumber, logIndex: log.logIndex, txHash: log.transactionHash };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const big = (v: unknown) => (typeof v === 'bigint' ? v : undefined);
  switch (log.eventName) {
    case 'PotCreated': return { kind: 'created', address: str(a.creator), ...base };
    case 'Funded': return { kind: 'chipped', address: str(a.contributor), amountRaw: big(a.amount), ...base };
    case 'Settled': return { kind: 'paid', address: str(a.recipient), amountRaw: big(a.amount), ...base };
    case 'Refunded': return { kind: 'refunded', address: str(a.contributor), amountRaw: big(a.amount), ...base };
    default: return null;
  }
}

/** Newest first. */
export function sortActivity(items: readonly ActivityItem[]): ActivityItem[] {
  return [...items].sort((x, y) =>
    x.blockNumber === y.blockNumber ? y.logIndex - x.logIndex : x.blockNumber < y.blockNumber ? 1 : -1);
}

export const ACTIVITY_VERB: Record<ActivityItem['kind'], string> = {
  created: 'started the kitty',
  chipped: 'chipped in',
  paid: 'was paid out',
  refunded: 'got a refund',
};

/** "just now", "5 minutes ago", "3 days ago". */
export function agoText(deltaSeconds: number): string {
  const s = Math.max(0, Math.floor(deltaSeconds));
  if (s < 45) return 'just now';
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (s < 3600) return unit(Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86_400) return unit(Math.round(s / 3600), 'hour');
  return unit(Math.round(s / 86_400), 'day');
}

/** Inclusive [from, to] block ranges of at most `size` blocks. */
export function chunkRanges(from: bigint, to: bigint, size: bigint): Array<[bigint, bigint]> {
  if (size <= 0n) throw new Error('size must be positive');
  const out: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    out.push([start, end < to ? end : to]);
  }
  return out;
}

// ── My kitties ───────────────────────────────────────────────────────────────

export function deriveRoles(i: {
  me: string; creator: string; recipient: string; mode: KittyMode;
  myShareRaw: bigint; myContributedRaw: bigint; myRefunded: boolean;
}): MineRole[] {
  const same = (a: string) => a.toLowerCase() === i.me.toLowerCase();
  const roles: MineRole[] = [];
  if (same(i.creator)) roles.push('Created');
  if (same(i.recipient)) roles.push('Recipient');
  if (i.myContributedRaw > 0n || i.myRefunded) roles.push('Chipped in');
  else if (i.mode === 'split' && i.myShareRaw > 0n) roles.push('Invited');
  return roles;
}

export type MineAction = 'chip-in' | 'pay-out' | 'refund';

export function mineAction(s: Pick<MineSummary, 'mode' | 'goalRaw' | 'totalFundedRaw' | 'deadline' | 'settled' | 'myShareRaw' | 'myContributedRaw' | 'myRefunded'>, now: bigint): MineAction | null {
  const phase = kittyPhase({ settled: s.settled, totalFundedRaw: s.totalFundedRaw, goalRaw: s.goalRaw, deadline: s.deadline, now });
  if (phase === 'ready') return 'pay-out';
  if (phase === 'open') return s.mode === 'split' && s.myShareRaw > s.myContributedRaw && !s.myRefunded ? 'chip-in' : null;
  if ((phase === 'expired' || phase === 'stuck') && s.myContributedRaw > 0n && !s.myRefunded) return 'refund';
  return null;
}

export interface MineGroups {
  needsAction: MineSummary[];
  active: MineSummary[];
  completed: MineSummary[];
}

export function groupMine(list: readonly MineSummary[], now: bigint): MineGroups {
  const g: MineGroups = { needsAction: [], active: [], completed: [] };
  for (const s of list) {
    const phase = kittyPhase({ settled: s.settled, totalFundedRaw: s.totalFundedRaw, goalRaw: s.goalRaw, deadline: s.deadline, now });
    if (mineAction(s, now)) g.needsAction.push(s);
    else if (phase === 'paid' || phase === 'expired' || phase === 'stuck') g.completed.push(s);
    else g.active.push(s);
  }
  const asc = (a: MineSummary, b: MineSummary) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0);
  g.needsAction.sort(asc);
  g.active.sort(asc);
  g.completed.sort((a, b) => asc(b, a));
  return g;
}
