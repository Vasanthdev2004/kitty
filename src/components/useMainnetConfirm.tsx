// ─── Kitty – mainnet confirmation hook ──────────────────────────────────────
// `confirm(summary)` resolves true straight away on testnet, or once this
// session has acknowledged the mainnet notice. Otherwise it opens the dialog.
import { useCallback, useState, type ReactNode } from 'react';
import type { KittyDeployment } from '../kitty-config';
import { needsMainnetConfirm, rememberMainnetAck } from '../mainnet-ack';
import type { WriteSummary } from '../write-summary';
import { MainnetConfirm } from './MainnetConfirm';

export function useMainnetConfirm(dep: KittyDeployment): {
  confirm: (summary: WriteSummary) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<{ summary: WriteSummary; resolve: (ok: boolean) => void } | undefined>();

  const confirm = useCallback((summary: WriteSummary): Promise<boolean> => {
    if (!needsMainnetConfirm(dep)) return Promise.resolve(true);
    return new Promise<boolean>(resolve => setPending({ summary, resolve }));
  }, [dep]);

  const settle = (ok: boolean) => {
    if (!pending) return;
    if (ok) rememberMainnetAck(dep);
    pending.resolve(ok);
    setPending(undefined);
  };

  const dialog = pending
    ? <MainnetConfirm summary={pending.summary} networkName={dep.name} onCancel={() => settle(false)} onContinue={() => settle(true)} />
    : null;
  return { confirm, dialog };
}
