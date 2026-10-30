// ─── Mainnet: one-time acknowledgement per browser session ──────────────────
// On mainnet the first write of a session is preceded by a confirmation that
// spells out what will happen. Ticking "Got it" is remembered for the session
// (sessionStorage), so later writes in the same tab do not ask again.
// Testnet never asks.
import type { KittyDeployment } from './kitty-config';
import { sessionStore, type StorageLike } from './kitty-tx';

const ackKey = (dep: KittyDeployment) => `kitty:mainnet-ack:${dep.chainId}`;

export function hasMainnetAck(dep: KittyDeployment, store: StorageLike | undefined = sessionStore()): boolean {
  try { return store?.getItem(ackKey(dep)) === '1'; } catch { return false; }
}

export function rememberMainnetAck(dep: KittyDeployment, store: StorageLike | undefined = sessionStore()): void {
  try { store?.setItem(ackKey(dep), '1'); } catch { /* blocked storage: the dialog simply asks again next time */ }
}

/** True when a write must be confirmed first: mainnet, and not yet acknowledged this session. */
export function needsMainnetConfirm(dep: KittyDeployment, store: StorageLike | undefined = sessionStore()): boolean {
  return !dep.testnet && !hasMainnetAck(dep, store);
}
