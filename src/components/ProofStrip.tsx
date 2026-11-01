// ─── Kitty – proof strip (home, below the hero) ─────────────────────────────
// Every fact comes from the active deployment's config or from project-facts.ts.
import { FEATURED_LABEL } from '../featured';
import { shortAddress } from '../pt-utils';
import type { KittyDeployment } from '../kitty-config';
import { STUDIO_APP_URL, testFactsText } from '../project-facts';

const LINK = 'font-medium text-ink underline decoration-[var(--line-strong)] underline-offset-4 transition-colors hover:decoration-ink';

export function ProofStrip({
  dep, onGetUsdc, featuredId, onOpenKitty,
}: {
  dep: KittyDeployment;
  onGetUsdc?: () => void;
  /** The host's featured kitty, if any. */
  featuredId?: `0x${string}`;
  onOpenKitty?: (id: `0x${string}`) => void;
}) {
  if (!dep.deployed) return null;
  return (
    <ul aria-label="Proof" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-line py-3.5 text-[13px] leading-relaxed text-ink-2">
      <li className="font-medium text-ink">Live on {dep.networkLabel}</li>
      <li>
        <a className={`mono ${LINK}`} href={`${dep.explorerBase}/address/${dep.kitty}`} target="_blank" rel="noopener noreferrer">
          {shortAddress(dep.kitty)}
        </a>
      </li>
      {dep.deployTx && (
        <li>
          <a className={LINK} href={`${dep.explorerBase}/tx/${dep.deployTx}`} target="_blank" rel="noopener noreferrer">Deploy tx</a>
        </li>
      )}
      <li>No owner, no admin keys, no upgrades</li>
      <li className="tnum">{testFactsText()}</li>
      <li>
        <a className={LINK} href={STUDIO_APP_URL} target="_blank" rel="noopener noreferrer">Built with Arc Studio</a>
      </li>
      {featuredId && (
        <li>
          <a
            className={LINK}
            href={`?kitty=${featuredId}`}
            onClick={e => { if (onOpenKitty) { e.preventDefault(); onOpenKitty(featuredId); } }}
          >{FEATURED_LABEL}</a>
        </li>
      )}
      {onGetUsdc && (
        <li>
          <button type="button" onClick={onGetUsdc} className={`rounded-full ${LINK}`}>Get USDC</button>
        </li>
      )}
    </ul>
  );
}
