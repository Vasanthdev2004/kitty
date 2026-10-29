// ─── Kitty – small real-UI previews inside the three start cards ────────────
// Example figures only, labelled as such by the card. Built from Avatar / Chip.
import { Avatar, Chip } from './ui';

const A = '0x1d2f6a8b3c4e5f60718293a4b5c6d7e8f9a0b1c2';
const B = '0x7a3b9c1d2e4f60718293a4b5c6d7e8f9a0b1c2d3';
const SELLER = '0x9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b';

const frame = 'rounded-tile bg-s2 p-3';

export function SplitPreview() {
  return (
    <div className={`${frame} space-y-2`} aria-hidden>
      {([[A, 'You', '60.00'], [B, 'Sam', '40.00']] as const).map(([addr, name, amt]) => (
        <div key={addr} className="flex items-center gap-2.5">
          <Avatar address={addr} size={24} />
          <span className="text-[13px] text-ink">{name}</span>
          <span className="tnum ml-auto text-[13px] text-ink-2">{amt} USDC</span>
        </div>
      ))}
    </div>
  );
}

export function PoolPreview() {
  return (
    <div className={`${frame} space-y-2.5`} aria-hidden>
      <div className="h-2 overflow-hidden rounded-full bg-s3">
        <div className="h-full w-[64%] rounded-full bg-[var(--ok)]" />
      </div>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-ink">12 people</span>
        <span className="tnum text-ink-2">320.00 of 500.00 USDC</span>
      </div>
    </div>
  );
}

export function RequestPreview() {
  return (
    <div className={`${frame} space-y-2`} aria-hidden>
      <div className="flex items-center gap-2.5">
        <Avatar address={SELLER} size={24} />
        <span className="tnum text-[13px] text-ink">240.00 USDC</span>
        <span className="ml-auto"><Chip tone="neutral">Open</Chip></span>
      </div>
      <p className="text-xs text-ink-3">Requested by the seller</p>
    </div>
  );
}
