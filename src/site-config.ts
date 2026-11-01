// ─── The two site URLs for this build (see network-switch.ts) ───────────────
import { readSiteUrls } from './network-switch';

/** Set VITE_MAINNET_URL and VITE_TESTNET_URL in both builds; each one then links to the other. */
export const SITE_URLS = readSiteUrls(import.meta.env);

import { firstFeatured, parseFeaturedKitties } from './featured';

/** The one featured kitty for this build, if the host set VITE_FEATURED_KITTIES. */
export const FEATURED_KITTY = firstFeatured(parseFeaturedKitties(import.meta.env.VITE_FEATURED_KITTIES));
