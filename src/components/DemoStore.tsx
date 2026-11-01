// ─── Kitty – Demo store (?view=shop) ────────────────────────────────────────
// A made-up shop to show the buyer's side. In this demo YOU are the shop owner, so
// payouts come back to the connected wallet. Each button is a real checkout link built
// from the share base (so /testnet/ stays /testnet/), and opens in the app.
import { ConnectKitButton } from 'connectkit';
import { useShareBase } from '../hooks';
import { buildCheckoutLink, buildCheckoutSearch, type CheckoutParams } from '../checkout';
import { buildCheckoutRoute, type Route } from '../kitty-core';
import { footerNote, type KittyDeployment } from '../kitty-config';
import { Avatar, Button, Card, Notice } from './ui';
import { OpenInWalletApp } from './OpenInWalletApp';

export const DEMO_SHOP_NAME = 'Kitty Demo Store';

export interface DemoItem { id: string; name: string; blurb: string; price: string; mode: 'open' | 'split'; days: number }

export const DEMO_ITEMS: readonly DemoItem[] = [
  { id: 'lunch', name: 'Team lunch box', blurb: 'Twelve sandwiches, sides and drinks, delivered at noon.', price: '12.00', mode: 'split', days: 3 },
  { id: 'espresso', name: 'Group gift: espresso machine', blurb: 'A proper machine for the office. Everyone puts in what they like.', price: '240.00', mode: 'open', days: 7 },
  { id: 'tickets', name: 'Concert tickets x4', blurb: 'Four seats together, Friday night. One person books, all four pay.', price: '180.00', mode: 'split', days: 3 },
];

/** The checkout link parameters for one demo item. The recipient is whoever plays the shop owner. */
export function demoCheckoutParams(item: DemoItem, owner: string): CheckoutParams {
  return { mode: item.mode, to: owner, amount: item.price, ref: item.name, days: item.days, lock: true, shop: DEMO_SHOP_NAME };
}

function ProductCard({
  item, owner, base, onBuy,
}: {
  item: DemoItem; owner: string | undefined; base: string | undefined; onBuy: () => void;
}) {
  const params = owner ? demoCheckoutParams(item, owner) : undefined;
  // A real link (right-click, copy, new tab) from the share base; a plain click opens it in the app.
  const href = params ? (base ? buildCheckoutLink(base, params) : buildCheckoutSearch(params)) : undefined;
  return (
    <Card className="flex flex-col justify-between gap-5 p-5 sm:p-6">
      <div className="space-y-3">
        <div aria-hidden className="flex h-28 items-end rounded-[14px] bg-s2 p-3">
          <span className="tnum text-xs text-ink-3">Product photo</span>
        </div>
        <div className="space-y-1">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{item.name}</h3>
          <p className="text-[13px] leading-relaxed text-ink-2 text-pretty">{item.blurb}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="tnum text-lg font-medium text-ink">{item.price} <span className="text-xs font-normal text-ink-3">USDC</span></p>
        {owner && href ? (
          <a
            href={href}
            onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); onBuy(); } }}
            className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent-btn)] px-5 text-[14px] font-medium text-[var(--on-accent)] transition-colors hover:bg-[var(--accent)] active:bg-[var(--accent-press)]"
          >
            Pay together
          </a>
        ) : (
          // Not connected: the button asks to connect first.
          <ConnectKitButton.Custom>{({ show }) => <Button onClick={show}>Pay together</Button>}</ConnectKitButton.Custom>
        )}
      </div>
    </Card>
  );
}

export function DemoStore({
  me, dep, onNavigate,
}: { me: string | undefined; dep: KittyDeployment; onNavigate: (r: Route) => void }) {
  const base = useShareBase();
  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-3">
        <div className="flex items-center gap-3">
          <Avatar name={DEMO_SHOP_NAME} size={40} />
          <div>
            <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink md:text-3xl">{DEMO_SHOP_NAME}</h1>
            <p className="text-xs font-medium text-ink-2">A demo store. Nothing here is for sale.</p>
          </div>
        </div>
        <p className="text-base leading-relaxed text-ink-2 text-pretty">
          This is what a shop looks like with a Pay together button next to its normal checkout. You are the shop owner in this demo, so payouts come back to you.
        </p>
      </div>

      {!me && (
        <Notice>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Connect your wallet first. It becomes the shop's payout address for this demo.</span>
            <ConnectKitButton.Custom>{({ show }) => <Button size="sm" variant="secondary" onClick={show}>Connect wallet</Button>}</ConnectKitButton.Custom>
          </div>
          <OpenInWalletApp className="mt-2 text-xs leading-relaxed text-ink-2" />
        </Notice>
      )}
      {!dep.testnet && <Notice tone="warn">{footerNote(dep)}</Notice>}

      <div className="grid gap-4 md:grid-cols-3">
        {DEMO_ITEMS.map(item => (
          <ProductCard
            key={item.id}
            item={item}
            owner={me}
            base={base}
            onBuy={() => me && onNavigate(buildCheckoutRoute(demoCheckoutParams(item, me)))}
          />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        Want this on your own site? <button type="button" className="font-medium text-accent-text underline-offset-2 hover:underline" onClick={() => onNavigate({ view: 'sell' })}>See For sellers</button>.
      </p>
    </div>
  );
}
