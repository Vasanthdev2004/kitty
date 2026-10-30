// ─── Kitty – Create flow (split, open pool, request payment) ────────────────
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ConnectKitButton } from 'connectkit';
import { formatUsdc, isoToUnixSeconds, parseUsdcAmount, shortAddress } from '../pt-utils';
import { formatUsdcPlain } from '../pt-share';
import { describeDeadline, splitEvenly } from '../pt-ui';
import {
  MAX_SPLIT_CONTRIBUTORS, draftFromStart, effectiveMin, getTemplate, hasErrors, validateKittyDraft,
  type KittyDraft, type StartKind, type TemplateId,
} from '../kitty-core';
import { fundsNote, type KittyDeployment } from '../kitty-config';
import type { KittyMode } from '../kitty-types';
import { useNowMs } from '../hooks';
import { Avatar, Button, Card, Notice } from './ui';
import { AddressInput, AmountInput, Field, FieldError, ReferenceInput, SegmentedTabs } from './fields';
import { DeadlinePicker } from './DeadlinePicker';
import { ContributorRows } from './ContributorRows';

const FORM_ID = 'create-kitty-form';
const nowSeconds = () => Math.floor(Date.now() / 1000);
const nowMillis = () => Date.now();
let rowCounter = 0;
const newRowId = () => ++rowCounter;

const TITLES: Record<StartKind, string> = {
  split: 'Split a bill',
  open: 'Pool for a goal',
  request: 'Request payment',
};

const MODE_TABS = [
  { id: 'split' as const, label: 'Named people' },
  { id: 'open' as const, label: 'Open pool' },
];

interface Props {
  start: { kind: StartKind; template?: TemplateId };
  dep: KittyDeployment;
  connectedAddress: string | undefined;
  isCorrectChain: boolean;
  deployBlocked: boolean;
  txBusy: boolean;
  onSubmit: (draft: KittyDraft, recipient: string) => void | Promise<void>;
}

export function CreateKitty({ start, dep, connectedAddress, isCorrectChain, deployBlocked, txBusy, onSubmit }: Props) {
  const reduce = useReducedMotion();
  const template = getTemplate(start.template);
  const [draft, setDraft] = useState<KittyDraft>(() => draftFromStart(start, nowMillis()));
  const [rowIds, setRowIds] = useState<number[]>(() => draft.shares.map(newRowId));
  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const nowMs = useNowMs(30_000);
  const touch = (key: string) => setBlurred(b => (b[key] ? b : { ...b, [key]: true }));

  // The mobile summary bar appears only once the form is on screen.
  const formRef = useRef<HTMLFormElement>(null);
  const [inForm, setInForm] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = formRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInForm(e.isIntersecting), { rootMargin: '0px 0px -200px 0px', threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const isRequest = draft.kind === 'request';
  const recipient = isRequest ? connectedAddress ?? '' : draft.recipient;
  const effectiveDraft: KittyDraft = { ...draft, recipient };
  const patch = (p: Partial<KittyDraft>) => setDraft(d => ({ ...d, ...p }));
  const patchShare = (i: number, p: Partial<{ address: string; amount: string }>) =>
    setDraft(d => ({ ...d, shares: d.shares.map((s, idx) => (idx === i ? { ...s, ...p } : s)) }));
  const addShare = () => {
    setRowIds(ids => [...ids, newRowId()]);
    setDraft(d => ({ ...d, shares: [...d.shares, { address: '', amount: '' }] }));
  };
  const removeShare = (i: number) => {
    setRowIds(ids => ids.filter((_, idx) => idx !== i));
    setDraft(d => ({ ...d, shares: d.shares.filter((_, idx) => idx !== i) }));
  };

  const goal = parseUsdcAmount(draft.goal);
  const minParsed = draft.minContribution.trim() ? parseUsdcAmount(draft.minContribution, true) : { ok: true as const, raw: 0n };
  const floor = goal.ok && minParsed.ok ? effectiveMin(goal.raw, minParsed.raw) : null;

  function splitAll() {
    if (!goal.ok || draft.shares.length === 0) return;
    const parts = splitEvenly(goal.raw, draft.shares.length);
    setDraft(d => ({ ...d, shares: d.shares.map((s, i) => ({ ...s, amount: formatUsdc(parts[i]) })) }));
  }

  const ctx = { kitty: dep.kitty, usdc: dep.usdc, account: connectedAddress };
  const errors = validateKittyDraft(effectiveDraft, Math.floor(nowMs / 1000), ctx);
  const canCreate = !!connectedAddress && isCorrectChain && !deployBlocked && !txBusy;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setSubmitted(true);
    if (!hasErrors(validateKittyDraft(effectiveDraft, nowSeconds(), ctx))) void onSubmit(draft, recipient);
  }

  const showField = (k: string) => submitted || !!blurred[k];
  const rowErrors = draft.shares.map((_, i) => {
    const message = errors.shares?.[i];
    if (!message) return undefined;
    const part = /address/i.test(message) ? 'address' as const : 'amount' as const;
    return submitted || blurred[`${part}-${rowIds[i]}`] ? { message, part } : undefined;
  });
  const sumShown = submitted || (draft.shares.length > 0 && rowIds.every(id => blurred[`amount-${id}`]));

  const shareSum = draft.shares.reduce((acc, s) => {
    const p = parseUsdcAmount(s.amount);
    return acc + (p.ok ? p.raw : 0n);
  }, 0n);
  const diff = goal.ok ? goal.raw - shareSum : null;
  const dlTs = draft.deadlineIso ? isoToUnixSeconds(draft.deadlineIso) : 0;
  const dl = dlTs ? describeDeadline(dlTs, Math.floor(nowMs / 1000)) : null;
  const dash = <span className="text-ink-3">-</span>;

  const diffView: ReactNode = diff === null
    ? <span className="whitespace-nowrap text-ink-3">Set a goal</span>
    : diff === 0n
      ? <span className="whitespace-nowrap text-ok-text">Matches</span>
      : (
        <span className="whitespace-nowrap text-err-text">
          <span className="mono">{formatUsdcPlain(diff < 0n ? -diff : diff)}</span> {diff > 0n ? 'short' : 'over'}
        </span>
      );

  const ctaLabel = txBusy ? 'Sending' : deployBlocked ? 'Contract not ready'
    : !connectedAddress ? 'Connect wallet' : !isCorrectChain ? `Switch to ${dep.shortName}` : 'Start kitty';
  const submitBtn = (size: 'md' | 'lg', className?: string) => (
    <Button type="submit" form={FORM_ID} size={size} disabled={!canCreate} loading={txBusy} loadingText="Sending" className={className}>
      {ctaLabel}
    </Button>
  );

  const isOpen = draft.mode === 'open';

  return (
    <div className="space-y-6 pt-8 md:pt-12">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold leading-tight tracking-[-0.03em] text-ink text-balance md:text-4xl">
          {template ? template.label : TITLES[start.kind]}
        </h1>
        <p className="text-base leading-relaxed text-ink-2 text-pretty">
          {template ? template.helper : isRequest
            ? 'You are the recipient. Share the link and get paid once the goal is met.'
            : 'Set a goal and a deadline, then share the link.'}
        </p>
      </div>

      <form ref={formRef} id={FORM_ID} onSubmit={handleSubmit} noValidate className="grid items-start gap-4 pb-44 lg:grid-cols-[2fr_1fr] lg:pb-0">
        <div className="space-y-4">
          {!connectedAddress && <Notice>Connect your wallet on {dep.name} to start a kitty.</Notice>}
          {connectedAddress && !isCorrectChain && <Notice tone="warn">Switch to {dep.name} to continue.</Notice>}

          <Card className="space-y-5 p-5 sm:p-6">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Kitty</h2>

            <div className="space-y-2">
              <p className="text-[13px] font-medium text-ink-2">Who chips in</p>
              <SegmentedTabs<KittyMode> ariaLabel="Who chips in" tabs={MODE_TABS} value={draft.mode} onChange={m => patch({ mode: m })} />
              <p className="text-xs leading-relaxed text-ink-3">
                {isOpen ? 'Anyone with the link can chip in, any amount, until the goal is reached.' : 'You name each person and their share. Only they can chip in.'}
              </p>
            </div>

            <Field id="kitty-name" label="Name" helper={template ? `For example: ${template.refPlaceholder}` : 'What this money is for.'} error={showField('ref') ? errors.ref : undefined}>
              {p => (
                <ReferenceInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} placeholder={template?.refPlaceholder ?? 'Dinner on Friday'}
                  value={draft.ref} onChange={v => patch({ ref: v })} onBlur={() => touch('ref')} />
              )}
            </Field>

            {isRequest ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink-2">Recipient</p>
                {connectedAddress ? (
                  <div className="tile flex items-center gap-3 px-4 py-3">
                    <Avatar name="You" size={28} />
                    <p className="mono min-w-0 flex-1 break-all text-[13px] text-ink">{connectedAddress}</p>
                    <span className="shrink-0 text-xs font-medium text-ink-2">Requested by you</span>
                  </div>
                ) : (
                  <ConnectKitButton.Custom>
                    {({ show }) => <Button variant="secondary" onClick={show}>Connect wallet</Button>}
                  </ConnectKitButton.Custom>
                )}
                <p className="text-xs leading-relaxed text-ink-3">You receive the full amount once, when the goal is met.</p>
                {showField('recipient') && errors.recipient && <FieldError>{errors.recipient}</FieldError>}
              </div>
            ) : (
              <Field id="recipient" label="Recipient" helper="Gets the full amount once, when the goal is met. Payouts cannot be reversed." error={showField('recipient') ? errors.recipient : undefined}>
                {p => (
                  <AddressInput me={connectedAddress} id={p.id} describedBy={p.describedBy} invalid={p.invalid} ariaLabel="Recipient address"
                    value={draft.recipient} onChange={v => patch({ recipient: v })} onBlur={() => touch('recipient')} />
                )}
              </Field>
            )}

            <Field id="goal" label="Goal" helper={`In USDC on ${dep.name}. The recipient gets exactly this.`} error={showField('goal') ? errors.goal : undefined}>
              {p => (
                <AmountInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} className="sm:max-w-xs"
                  value={draft.goal} onChange={v => patch({ goal: v })} onBlur={() => touch('goal')} ariaLabel="Goal in USDC" />
              )}
            </Field>

            <DeadlinePicker
              value={draft.deadlineIso}
              onChange={iso => patch({ deadlineIso: iso })}
              error={showField('deadline') ? errors.deadline : undefined}
              onBlur={() => touch('deadline')}
              nowMs={nowMs}
            />
          </Card>

          {isOpen ? (
            <Card className="space-y-5 p-5 sm:p-6">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">Minimum per person</h2>
              <Field id="min" label="Minimum (optional)" helper="Applies to each new person's first chip in. People already in can add any amount." error={showField('min') ? errors.minContribution : undefined}>
                {p => (
                  <AmountInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} className="sm:max-w-xs"
                    value={draft.minContribution} onChange={v => patch({ minContribution: v })} onBlur={() => touch('min')} ariaLabel="Minimum per person in USDC" />
                )}
              </Field>
              <p className="text-[13px] leading-relaxed text-ink-2" aria-live="polite" data-testid="floor-line">
                {floor !== null
                  ? <>Each new person chips in at least <span className="mono text-ink">{formatUsdcPlain(floor)} USDC</span>.</>
                  : 'Set a goal to see the minimum each new person chips in.'}
              </p>
              <p className="text-xs leading-relaxed text-ink-3">
                The contract never accepts less than the goal divided by 256, so a crowd of tiny payments cannot crowd out real people. The payment that completes the goal can be any size.
              </p>
            </Card>
          ) : (
            <Card className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-[15px] font-semibold tracking-tight text-ink">People</h2>
                  <span className="tnum text-xs text-ink-3">{draft.shares.length} of {MAX_SPLIT_CONTRIBUTORS}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={splitAll} disabled={!goal.ok || draft.shares.length === 0}>Split evenly</Button>
              </div>
              <p className="text-xs leading-relaxed text-ink-3">Each address is unique. Everyone chips in only their own share.</p>
              <ContributorRows
                me={connectedAddress}
                shares={draft.shares}
                rowIds={rowIds}
                totalRaw={goal.ok ? goal.raw : shareSum}
                rowErrors={rowErrors}
                onTouch={(id, part) => touch(`${part}-${id}`)}
                onChange={patchShare}
                onRemove={removeShare}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                {draft.shares.length < MAX_SPLIT_CONTRIBUTORS ? <Button variant="secondary" onClick={addShare}>Add person</Button> : <span />}
                {sumShown && errors.sharesSum && <FieldError>{errors.sharesSum}</FieldError>}
              </div>
            </Card>
          )}

          <Notice>
            <p className="font-medium text-ink">These terms are permanent.</p>
            <p className="mt-1">
              Once created, the recipient, goal, deadline and shares cannot change. The payout is one payment and
              cannot be reversed. Delivery happens outside the contract. {fundsNote(dep)}
            </p>
          </Notice>
        </div>

        <aside className="hidden lg:sticky lg:top-24 lg:block">
          <Card className="space-y-5 p-6">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Summary</h2>
            <dl className="space-y-3 text-sm">
              <Row label="Goal" value={goal.ok ? <span className="mono text-ink">{formatUsdcPlain(goal.raw)} USDC</span> : dash} />
              <Row label="Recipient" value={recipient && showRecipient(recipient) ? <span className="mono text-ink">{shortAddress(recipient)}</span> : dash} />
              <Row label="Who chips in" value={<span className="text-ink">{isOpen ? 'Anyone with the link' : `${draft.shares.length} named`}</span>} />
              {isOpen
                ? <Row label="New person pays" value={floor !== null ? <span className="mono text-ink">{formatUsdcPlain(floor)}+</span> : dash} />
                : <>
                    <Row label="Shares total" value={shareSum > 0n ? <span className="mono text-ink">{formatUsdcPlain(shareSum)} USDC</span> : dash} />
                    <Row label="Difference" value={diffView} />
                  </>}
              <div className="hairline" />
              <Row label="Deadline" value={dl
                ? <span className="block text-right text-ink">{dl.when}<span className="block text-xs text-ink-3">{dl.rel}</span></span>
                : dash} />
            </dl>
            <div className="space-y-2">
              {submitBtn('lg', 'w-full')}
              <Button variant="ghost" onClick={() => setSubmitted(true)} className="w-full">Check details</Button>
            </div>
            {submitted && !hasErrors(errors) && (
              <p className="text-xs text-ink-2">{connectedAddress ? 'Details look good.' : 'Details look good. Connect a wallet to start.'}</p>
            )}
            <p className="text-xs leading-relaxed text-ink-3">Starting sends a transaction. Your wallet asks you to approve it.</p>
          </Card>
        </aside>
      </form>

      <AnimatePresence>
        {inForm && (
          <motion.div
            className="fixed inset-x-3 z-30 lg:hidden"
            style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="card flex items-center justify-between gap-3 p-3 pl-4">
              <div className="min-w-0 leading-tight">
                <p className="tnum whitespace-nowrap text-sm text-ink">
                  <span className="text-ink-2">Goal </span>{goal.ok ? formatUsdcPlain(goal.raw) : '0.00'} USDC
                </p>
                {!isOpen && diff !== null && diff !== 0n && <p className="mt-0.5 whitespace-nowrap text-xs">{diffView}</p>}
              </div>
              {submitBtn('md', 'shrink-0')}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const showRecipient = (r: string) => r.trim().length > 0;

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right">{value}</dd>
    </div>
  );
}
