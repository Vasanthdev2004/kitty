// ─── Kitty – query-param routing (no router library) ────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { parseRoute, routeToSearch, type Route } from './kitty-core';
import { ACTIVE } from './kitty-config';

// A checkout link may not name the Kitty contract or the USDC token as the shop's address.
const CHECKOUT_CTX = { kitty: ACTIVE.deployed ? ACTIVE.kitty : undefined, usdc: ACTIVE.usdc };
const parse = (search: string) => parseRoute(search, CHECKOUT_CTX);

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.search));

  useEffect(() => {
    // Old PayTogether links used ?order=. Keep them working and tidy the address bar.
    const q = new URLSearchParams(window.location.search);
    if (q.has('order') && !q.has('kitty')) {
      const r = parse(window.location.search);
      if (r.view === 'kitty') window.history.replaceState(null, '', window.location.pathname + routeToSearch(r));
    }
    const onPop = () => setRoute(parse(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.history.pushState(null, '', window.location.pathname + routeToSearch(r));
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  return { route, navigate };
}
