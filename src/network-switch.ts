// ─── Mainnet | Testnet on one site (pure) ───────────────────────────────────
// One Vercel deployment serves two builds: the mainnet app at / and the Arc
// Testnet app at /testnet/. Both builds read the same two absolute URLs
// (VITE_MAINNET_URL, VITE_TESTNET_URL), so each knows where the other one lives.
// Kitty ids do not carry across networks, so a switch never carries an id.
import { routeToSearch, type Route } from './kitty-core';

export type NetworkKey = 'mainnet' | 'testnet';

export interface SiteUrls { mainnet?: string; testnet?: string }

/** Absolute http(s) URL only. Anything else (empty, relative, junk) counts as "not set". */
export function parseSiteUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function readSiteUrls(env: { VITE_MAINNET_URL?: string; VITE_TESTNET_URL?: string }): SiteUrls {
  return { mainnet: parseSiteUrl(env.VITE_MAINNET_URL), testnet: parseSiteUrl(env.VITE_TESTNET_URL) };
}

/**
 * Views that mean the same thing on the other network: mine, requests, open, and the For sellers and
 * Demo store pages. A kitty page, the create flow (with any checkout params) and home all land on home.
 */
function carriedSearch(route: Route): string {
  switch (route.view) {
    case 'mine':
    case 'requests':
    case 'open':
    case 'sell':
    case 'shop':
      return routeToSearch({ view: route.view });
    default:
      return '';
  }
}

/** The other network's address for the same view. Never includes a kitty id. */
export function otherNetworkHref(otherUrl: string, route: Route): string {
  const u = new URL(otherUrl);
  u.search = carriedSearch(route);
  return u.href;
}

/** The other network's page for one kitty ("Open it there"). */
export function otherNetworkKittyHref(otherUrl: string, id: string): string {
  const u = new URL(otherUrl);
  u.search = `?kitty=${id}`;
  return u.href;
}

export interface SwitchOption { key: NetworkKey; label: 'Mainnet' | 'Testnet'; href: string; current: boolean }

/**
 * The two-option switch, or undefined (hidden) when the other network's URL is not set.
 * The current option points at this network's own home; the other at the other network's page for the same view.
 */
export function switchModel(i: { activeTestnet: boolean; urls: SiteUrls; route: Route }): SwitchOption[] | undefined {
  const current: NetworkKey = i.activeTestnet ? 'testnet' : 'mainnet';
  const other: NetworkKey = i.activeTestnet ? 'mainnet' : 'testnet';
  const otherUrl = i.urls[other];
  if (!otherUrl) return undefined;
  const own = i.urls[current] ?? '#';
  const make = (key: NetworkKey): SwitchOption => ({
    key,
    label: key === 'mainnet' ? 'Mainnet' : 'Testnet',
    href: key === current ? own : otherNetworkHref(otherUrl, i.route),
    current: key === current,
  });
  return [make('mainnet'), make('testnet')];
}
