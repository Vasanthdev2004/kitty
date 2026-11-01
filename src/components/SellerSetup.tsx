// ─── Kitty – For sellers (?view=sell) ───────────────────────────────────────
// A shop fills in an order and gets a "Pay together" link, a button to paste next to its
// normal checkout, and a QR code. Everything is in the link: no account, no backend.
// Every link is built from the share base, so a /testnet/ build makes /testnet/ links.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useShareBase } from '../hooks';
import {
  buildCheckoutLink, sellerFormToParams, MAX_DAYS, MAX_REF_BYTES, MAX_SHOP_CHARS, type SellerForm,
} from '../checkout';
import { PAY_TOGETHER_LABEL, buildPayTogetherSnippet, embedStyleObject, type Route } from '../kitty-core';
import type { KittyDeployment } from '../kitty-config';
import { Button, Card, Notice } from './ui';
import { AddressInput, AmountInput, CopyButton, Field, ReferenceInput, SegmentedTabs, TextInput } from './fields';

const MODE_TABS = [
  { id: 'open' as const, label: 'Pool' },
  { id: 'split' as const, label: 'Split' },
];

export function SellerSetup({
  me, dep, onNavigate,
}: { me: string | undefined; dep: KittyDeployment; onNavigate: (r: Route) => void }) {
  // Recipient defaults to the connected wallet until the seller types another address.
  const [recipientInput, setRecipientInput] = useState<string | undefined>();
  const [shop, setShop] = useState('');
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('7');
  const [mode, setMode] = useState<'open' | 'split'>('open');
  const [lock, setLock] = useState(true);

  const form: SellerForm = { recipient: recipientInput ?? me ?? '', shop, ref, amount, days, mode, lock };
  const result = sellerFormToParams(form, { kitty: dep.deployed ? dep.kitty : undefined, usdc: dep.usdc });
  // Show a message only for fields the seller has typed in; empty ones just keep the outputs waiting.
  const err = (key: keyof typeof result.errors, value: string) => (value.trim() ? result.errors[key] : undefined);

  const base = useShareBase();
  const link = base && result.params ? buildCheckoutLink(base, result.params) : undefined;
  const snippet = link ? buildPayTogetherSnippet(link) : undefined;

  const [qr, setQr] = useState<{ for: string; url: string } | undefined>();
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    QRCode.toDataURL(link, { margin: 1, width: 224, color: { dark: '#0A0A0C', light: '#FAFAFC' } })
      .then(url => { if (!cancelled) setQr({ for: link, url }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [link]);

  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold leading-tight tracking-[-0.03em] text-ink text-balance md:text-4xl">For sellers</h1>
        <p className="text-base leading-relaxed text-ink-2 text-pretty">
          Add a Pay together button next to your normal checkout. A buyer opens it with your shop and the amount already filled in, shares it with friends, and you are paid once, in full, when everyone has chipped in. If it falls short, everyone is refunded.
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="space-y-5 p-5 sm:p-6">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">The order</h2>

          <Field id="sell-recipient" label="Recipient" helper="Your wallet. The full amount is paid here, straight from escrow." error={err('recipient', form.recipient)}>
            {p => (
              <AddressInput
                me={me} id={p.id} describedBy={p.describedBy} invalid={p.invalid} ariaLabel="Recipient address"
                value={form.recipient} onChange={setRecipientInput}
              />
            )}
          </Field>

          <Field id="sell-shop" label="Shop name (optional)" helper={`Shown to the buyer. Up to ${MAX_SHOP_CHARS} characters.`} error={err('shop', shop)}>
            {p => (
              <TextInput id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={shop} placeholder="Acme Coffee"
                onChange={e => setShop(e.target.value)} />
            )}
          </Field>

          <Field id="sell-ref" label="Item or order" helper={`What the money is for. Up to ${MAX_REF_BYTES} bytes.`} error={err('ref', ref)}>
            {p => (
              <ReferenceInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={ref} onChange={setRef} placeholder="Espresso machine" />
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="sell-amount" label="Amount" helper={`In USDC on ${dep.name}.`} error={err('amount', amount)}>
              {p => (
                <AmountInput id={p.id} describedBy={p.describedBy} invalid={p.invalid} value={amount} onChange={setAmount} ariaLabel="Amount in USDC" />
              )}
            </Field>
            <Field id="sell-days" label="Deadline in days" helper={`1 to ${MAX_DAYS}.`} error={err('days', days)}>
              {p => (
                <TextInput id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} inputMode="numeric" value={days}
                  onChange={e => setDays(e.target.value)} className="tnum" />
              )}
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink-2">Who chips in</p>
            <SegmentedTabs ariaLabel="Who chips in" tabs={MODE_TABS} value={mode} onChange={setMode} />
            <p className="text-xs leading-relaxed text-ink-3">
              {mode === 'open' ? 'Pool: anyone with the link chips in, any amount, until the amount is reached.' : 'Split: the buyer names each person and their share.'}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed text-ink-2">
            <input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
            <span><span className="font-medium text-ink">Lock the recipient and amount.</span> The buyer cannot change them.</span>
          </label>
        </Card>

        <Card className="space-y-5 p-5 sm:p-6" role="region" aria-label="Your link and button">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Your link and button</h2>
          {!link ? (
            <Notice>Fill in the recipient, item, amount and days to get your link.{!base ? ' Preparing the address...' : ''}</Notice>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink-2">Checkout link</p>
                <div className="flex items-center gap-2 rounded-field border border-line bg-s2 py-1 pl-3 pr-1">
                  <p className="mono min-w-0 flex-1 truncate text-[12px] text-ink" title={link} data-testid="checkout-link">{link}</p>
                  <CopyButton value={link} successMessage="Link copied" />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[13px] font-medium text-ink-2">Button for your site</p>
                <div className="flex flex-wrap items-center gap-4 rounded-field border border-line bg-s2 p-4">
                  <a href={link} target="_blank" rel="noopener noreferrer" style={embedStyleObject()}>{PAY_TOGETHER_LABEL}</a>
                  <span className="text-xs text-ink-3">Live preview</span>
                </div>
                <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-field border border-line bg-s2 p-3 text-[11.5px] leading-relaxed text-ink-2" data-testid="snippet">{snippet}</pre>
                <CopyButton variant="pill" label="Copy button HTML" value={snippet} successMessage="Button HTML copied" />
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {qr && qr.for === link && <img src={qr.url} width={112} height={112} alt="QR code of the checkout link" className="rounded-[14px]" />}
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-3">
                  Print the QR code on a receipt or a counter sign. The button is one plain link with no script.
                </p>
              </div>
            </>
          )}

          <div className="space-y-2 border-t border-line pt-4 text-[13px] leading-relaxed text-ink-2">
            <p>Your buyer sees the order already filled in: you as the recipient and the amount. They share it with friends and everyone chips in.</p>
            <p>You are paid once, in full. If the deadline passes first, everyone gets their own money back.</p>
            <Button variant="secondary" size="sm" onClick={() => onNavigate({ view: 'shop' })}>Try the demo store</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
