// ─── Kitty – Top bar ─────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { ConnectKitButton } from 'connectkit';
import { toast } from 'sonner';
import { Wallet } from '@phosphor-icons/react';
import { Avatar, Button } from './ui';
import { SegmentedTabs } from './fields';
import { ACTIVE, switchLabel } from '../kitty-config';
import { NetworkPill } from './NetworkPill';
import { NetworkSwitch } from './NetworkSwitch';
import { ThemeSwitch } from './ThemeSwitch';
import { copyText } from '../copy';
import { useWideScreen } from '../hooks';
import type { SwitchOption } from '../network-switch';
import type { Tab } from '../kitty-core';

const TABS = [
  { id: 'new' as const, label: 'New' },
  { id: 'mine' as const, label: 'My kitties' },
  { id: 'open' as const, label: 'Open' },
];
// Sellers get a Requests tab once connected. Four tabs do not fit a phone's top bar, so below
// sm it is reached from the My kitties page instead.
const TABS_WITH_REQUESTS = [
  TABS[0], TABS[1], { id: 'requests' as const, label: 'Requests' }, TABS[2],
];

interface TopBarProps {
  tab: Tab;
  onTab: (t: Tab) => void;
  isConnected: boolean;
  isCorrectChain: boolean;
  onSwitchChain: () => void;
  onHome: () => void;
  /** Mainnet | Testnet links. Undefined hides the switch (the other network's URL is not set). */
  networkOptions?: SwitchOption[];
  onGetUsdc: () => void;
}

/** The wallet button. Connected, it opens a small menu: Get USDC, Copy address, Wallet. */
function WalletMenu({ wrongChain, onGetUsdc }: { wrongChain: boolean; onGetUsdc: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <ConnectKitButton.Custom>
      {({ show, isConnected: connected, truncatedAddress, address }) => (
        <div ref={box} className="relative">
          <Button
            variant="secondary"
            size="sm"
            onClick={connected ? () => setOpen(o => !o) : show}
            aria-label={connected ? `Wallet menu, ${truncatedAddress ?? ''}` : 'Connect wallet'}
            aria-haspopup={connected ? 'menu' : undefined}
            aria-expanded={connected ? open : undefined}
            className={wrongChain ? 'hidden sm:inline-flex max-sm:w-9 max-sm:px-0' : 'max-sm:w-9 max-sm:px-0'}
            leading={connected && address
              ? <Avatar name="You" size={18} />
              : <Wallet size={16} weight="regular" />}
          >
            <span className="hidden sm:inline">
              {connected ? <span className="mono">{truncatedAddress}</span> : 'Connect wallet'}
            </span>
          </Button>
          {connected && open && (
            <div role="menu" aria-label="Wallet" className="card absolute right-0 top-full z-40 mt-2 w-48 space-y-0.5 p-1.5">
              {[
                { label: 'Get USDC', run: () => { setOpen(false); onGetUsdc(); } },
                {
                  label: 'Copy address',
                  run: () => {
                    setOpen(false);
                    if (address) void copyText(address).then(ok => (ok ? toast.success('Address copied') : toast.error('Could not copy')));
                  },
                },
                { label: 'Wallet', run: () => { setOpen(false); show?.(); } },
              ].map(i => (
                <button
                  key={i.label}
                  type="button"
                  role="menuitem"
                  onClick={i.run}
                  className="flex h-10 w-full items-center rounded-[10px] px-3 text-left text-[13px] font-medium text-ink transition-colors hover:bg-s2"
                >
                  {i.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </ConnectKitButton.Custom>
  );
}

export function TopBar({
  tab, onTab, isConnected, isCorrectChain, onSwitchChain, onHome, networkOptions, onGetUsdc,
}: TopBarProps) {
  const wrongChain = isConnected && !isCorrectChain;
  const wide = useWideScreen();
  const showRequests = isConnected && wide;
  return (
    <header
      className="sticky top-0 z-30 border-b border-line"
      style={{ background: 'var(--blur-bg)', backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)' }}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
        <div className={`flex items-center gap-3 justify-self-start ${wrongChain ? 'max-sm:hidden' : ''}`}>
          <button type="button" onClick={onHome} aria-label="Kitty home" className="flex items-center gap-2.5 rounded-full">
            <svg aria-hidden width="30" height="18" viewBox="0 0 30 18" fill="none" className="shrink-0 text-ink">
              <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="22" cy="9" r="3.75" fill="currentColor" />
            </svg>
            <span className="hidden text-[17px] font-semibold tracking-tight text-ink md:inline">Kitty</span>
            {/* The switch shows which network this is; the plain pill is only for a build with no other URL. */}
            {ACTIVE.testnet && !networkOptions && <span className="hidden md:inline-flex"><NetworkPill dep={ACTIVE} /></span>}
          </button>
          {networkOptions && <NetworkSwitch options={networkOptions} className="hidden lg:inline-flex" />}
        </div>

        <SegmentedTabs
          ariaLabel="Sections"
          tabs={showRequests ? TABS_WITH_REQUESTS : TABS}
          value={tab}
          onChange={onTab}
        />

        <div className="flex items-center justify-end gap-2">
          <span className={wrongChain ? 'max-sm:hidden' : ''}><ThemeSwitch /></span>
          {wrongChain && (
            <Button size="sm" onClick={onSwitchChain}>{switchLabel(ACTIVE)}</Button>
          )}
          <WalletMenu wrongChain={wrongChain} onGetUsdc={onGetUsdc} />
        </div>
      </div>

      {/* Below lg the switch does not fit beside the tabs, so it gets its own slim row. */}
      {networkOptions && (
        <div className="border-t border-line lg:hidden">
          <div className="mx-auto flex max-w-5xl justify-center px-4 py-1.5">
            <NetworkSwitch options={networkOptions} />
          </div>
        </div>
      )}
    </header>
  );
}
