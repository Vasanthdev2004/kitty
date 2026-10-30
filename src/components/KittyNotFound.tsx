// ─── Kitty – calm "not found" for a bad or foreign kitty ID ─────────────────
import type { Route } from '../kitty-core';
import { Button, EmptyState } from './ui';

export function KittyNotFound({ networkName, onNavigate }: { networkName: string; onNavigate: (r: Route) => void }) {
  return (
    <EmptyState
      title="We could not find that kitty"
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onNavigate({ view: 'home' })}>Go home</Button>
          <Button variant="secondary" onClick={() => onNavigate({ view: 'open' })}>Open another kitty</Button>
        </div>
      }
    >
      The link may be mistyped, or the kitty may live on a different network. This app is showing kitties on {networkName}.
    </EmptyState>
  );
}
