// ─── Kitty – Top bar ─────────────────────────────────────────────────────────
import { ConnectKitButton } from 'connectkit';
import { Wallet } from '@phosphor-icons/react';
import { Avatar, Button } from './ui';
import { SegmentedTabs } from './fields';
import { ACTIVE } from '../kitty-config';
import { NetworkPill } from './NetworkPill';
import { ThemeSwitch } from './ThemeSwitch';

import type { Tab } from '../kitty-core';

const TABS = [
  { id: 'new' as const, label: 'New' },
  { id: 'mine' as const, label: 'My kitties' },
  { id: 'open' as const, label: 'Open' },
];

interface TopBarProps {
  tab: Tab;
  onTab: (t: Tab) => void;
  isConnected: boolean;
  isCorrectChain: boolean;
  onSwitchChain: () => void;
  onHome: () => void;
}

export function TopBar({ tab, onTab, isConnected, isCorrectChain, onSwitchChain, onHome }: TopBarProps) {
  const wrongChain = isConnected && !isCorrectChain;
  return (
    <header
      className="sticky top-0 z-30 border-b border-line"
      style={{ background: 'var(--blur-bg)', backdropFilter: 'blur(16px) saturate(160%)', WebkitBackdropFilter: 'blur(16px) saturate(160%)' }}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-2 px-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
        <button
          type="button"
          onClick={onHome}
          aria-label="Kitty home"
          className={`flex items-center gap-2.5 justify-self-start rounded-full ${wrongChain ? 'max-sm:hidden' : ''}`}
        >
          <svg aria-hidden width="30" height="18" viewBox="0 0 30 18" fill="none" className="shrink-0 text-ink">
            <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="22" cy="9" r="3.75" fill="currentColor" />
          </svg>
          <span className="hidden text-[17px] font-semibold tracking-tight text-ink md:inline">Kitty</span>
          {ACTIVE.testnet && <span className="hidden md:inline-flex"><NetworkPill dep={ACTIVE} /></span>}
        </button>

        <SegmentedTabs
          ariaLabel="Sections"
          tabs={TABS}
          value={tab}
          onChange={onTab}
        />

        <div className="flex items-center justify-end gap-2">
          <span className={wrongChain ? 'max-sm:hidden' : ''}><ThemeSwitch /></span>
          {wrongChain && (
            <Button size="sm" onClick={onSwitchChain}>{`Switch to ${ACTIVE.shortName}`}</Button>
          )}
          <ConnectKitButton.Custom>
            {({ show, isConnected: connected, truncatedAddress, address }) => (
              <Button
                variant="secondary"
                size="sm"
                onClick={show}
                aria-label={connected ? `Wallet ${truncatedAddress ?? ''}` : 'Connect wallet'}
                className={wrongChain ? 'hidden sm:inline-flex max-sm:w-9 max-sm:px-0' : 'max-sm:w-9 max-sm:px-0'}
                leading={connected && address
                  ? <Avatar name="You" size={18} />
                  : <Wallet size={16} weight="regular" />}
              >
                <span className="hidden sm:inline">
                  {connected ? <span className="mono">{truncatedAddress}</span> : 'Connect wallet'}
                </span>
              </Button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </header>
  );
}
