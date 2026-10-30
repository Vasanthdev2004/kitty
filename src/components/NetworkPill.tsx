// ─── Kitty – "Testnet" pill next to the wordmark (testnet builds only) ───────
import type { KittyDeployment } from '../kitty-config';
import { Chip } from './ui';

export function NetworkPill({ dep }: { dep: Pick<KittyDeployment, 'testnet'> }) {
  if (!dep.testnet) return null;
  return <Chip tone="neutral">Testnet</Chip>;
}
