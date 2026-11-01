// ─── Wallet connectors (pure builder) ───────────────────────────────────────
// Injected wallets always. WalletConnect (phones, QR) only when a project id is set.
// With no id the list is exactly what it was before: no crash, no empty connector.
import type { CreateConnectorFn } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

/** A usable WalletConnect project id, or undefined (missing, empty, or only whitespace). */
export function normalizeProjectId(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  return v ? v : undefined;
}

export function walletConnectMetadata(origin: string | undefined) {
  const base = (origin ?? '').replace(/\/+$/, '');
  return {
    name: 'Kitty',
    description: 'Nobody fronts the money. Group money pools on Arc, settled in USDC.',
    url: base,
    icons: base ? [`${base}/og-image.png`] : [],
  };
}

export interface ConnectorFactories<T> {
  injected: () => T;
  walletConnect: (p: { projectId: string; metadata: ReturnType<typeof walletConnectMetadata>; showQrModal: boolean }) => T;
}

export function buildConnectors<T>(
  opts: { projectId?: string; origin?: string },
  factories: ConnectorFactories<T>,
): T[] {
  const list: T[] = [factories.injected()];
  const projectId = normalizeProjectId(opts.projectId);
  if (projectId) {
    // ConnectKit draws the QR itself, so the connector's own modal stays off.
    list.push(factories.walletConnect({ projectId, metadata: walletConnectMetadata(opts.origin), showQrModal: false }));
  }
  return list;
}

/** The real connectors for this build. */
export const realConnectors = (opts: { projectId?: string; origin?: string }): CreateConnectorFn[] =>
  buildConnectors<CreateConnectorFn>(opts, {
    injected: () => injected(),
    walletConnect: p => walletConnect(p),
  });
