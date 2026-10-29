// ─── Kitty – query-param routing (no router library) ────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { parseRoute, routeToSearch, type Route } from './kitty-core';

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.search));

  useEffect(() => {
    // Old PayTogether links used ?order=. Keep them working and tidy the address bar.
    const q = new URLSearchParams(window.location.search);
    if (q.has('order') && !q.has('kitty')) {
      const r = parseRoute(window.location.search);
      if (r.view === 'kitty') window.history.replaceState(null, '', window.location.pathname + routeToSearch(r));
    }
    const onPop = () => setRoute(parseRoute(window.location.search));
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
