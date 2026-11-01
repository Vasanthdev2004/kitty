// ─── Kitty – "this kitty is on the other network" ───────────────────────────
import { Notice } from './ui';

export function OtherNetworkHint({ networkLabel, href }: { networkLabel: string; href: string }) {
  return (
    <Notice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>This kitty is on <span className="font-medium text-ink">{networkLabel}</span>.</span>
        <a className="font-medium text-accent-text underline-offset-2 hover:underline" href={href}>Open it there</a>
      </div>
    </Notice>
  );
}
