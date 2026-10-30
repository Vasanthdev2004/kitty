// ─── Kitty – small real-UI previews inside the three start cards ────────────
// Example people and figures only. Built from Avatar / Chip.
import { Avatar, Chip } from './ui';

const frame = 'rounded-tile bg-s2 p-3';

function Usdc({ amount }: { amount: string }) {
  return <span className="tnum text-[13px] text-ink-2">{amount} <span className="text-ink-3">USDC</span></span>;
}

export function SplitPreview() {
  return (
    <div className={`${frame} space-y-2`} aria-hidden>
      <div className="flex items-center gap-2.5">
        <Avatar name="You" size={24} status="paid" badgeRing="var(--s2)" />
        <span className="text-[13px] font-medium text-ink">You</span>
        <span className="ml-auto"><Usdc amount="60.00" /></span>
      </div>
      <div className="flex items-center gap-2.5">
        <Avatar name="Sam" size={24} />
        <span className="text-[13px] font-medium text-ink">Sam</span>
        <span className="ml-auto"><Usdc amount="40.00" /></span>
      </div>
    </div>
  );
}

export function PoolPreview() {
  return (
    <div className={`${frame} space-y-2.5`} aria-hidden>
      <div className="h-2 overflow-hidden rounded-full bg-s3">
        <div className="h-full w-[64%] rounded-full bg-[var(--ok)]" />
      </div>
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="flex items-center gap-2 text-ink">
          <span className="flex">
            {(['Ana', 'Ravi', 'Mei'] as const).map((n, i) => (
              <span key={n} className={i === 0 ? '' : '-ml-1.5'}>
                <Avatar name={n} size={20} className="ring-2 ring-[var(--s2)]" />
              </span>
            ))}
          </span>
          12 people
        </span>
        <Usdc amount="320.00" />
      </div>
    </div>
  );
}

export function RequestPreview() {
  return (
    <div className={`${frame} space-y-2`} aria-hidden>
      <div className="flex items-center gap-2.5">
        <Avatar name="Lola's Bakery" size={24} />
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">Lola's Bakery</span>
        <span className="ml-auto"><Usdc amount="240.00" /></span>
      </div>
      <p className="flex items-center justify-between text-xs text-ink-3">
        Requested by the seller
        <Chip tone="neutral">Open</Chip>
      </p>
    </div>
  );
}
