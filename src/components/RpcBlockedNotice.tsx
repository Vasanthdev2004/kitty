// ─── Kitty – "your browser is blocking the network" notice ──────────────────
import { Button, Notice } from './ui';

export const RPC_BLOCKED_TEXT = (shortName: string) =>
  `Can't reach the ${shortName} network from this browser. A content blocker may be blocking arc.io. Allow this site in your blocker, then reload.`;

/** One calm inline notice, shown instead of repeated toasts. Only for network failures, never for RPC-level errors. */
export function RpcBlockedNotice({ shortName, onReload }: { shortName: string; onReload: () => void }) {
  return (
    <Notice tone="warn">
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
        <span>{RPC_BLOCKED_TEXT(shortName)}</span>
        <Button size="sm" variant="secondary" onClick={onReload}>Reload</Button>
      </div>
    </Notice>
  );
}
