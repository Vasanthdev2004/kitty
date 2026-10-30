// ─── Kitty – pay for someone else (fundFor) ─────────────────────────────────
// Split kitties: pick a named person who still owes. Open kitties: paste an address.
// Either way the friend is credited, so a refund goes to the friend, never to the payer.
import { useState } from 'react';
import { getAddress, isAddress } from 'viem';
import { formatUsdc, parseUsdcAmount, shortAddress } from '../pt-utils';
import { formatUsdcPlain } from '../pt-share';
import {
  FRIEND_WARNING, busyLabel, chipInBounds, unpaidContributors, validateChipIn,
} from '../kitty-core';
import { chipInHelper } from '../permit';
import type { KittyContributor, KittyData } from '../kitty-types';
import type { TxStatus } from '../pt-types';
import { cn } from '../cn';
import { Avatar, Button } from './ui';
import { AddressInput, AmountInput } from './fields';

const isBusy = (s: TxStatus) =>
  s.kind === 'wallet-pending' || s.kind === 'submitted' || s.kind === 'confirming' || s.kind === 'uncertain';

export function FriendChipIn({
  data, me, allowanceRaw, balanceRaw, txStatus, onChipIn, onBack,
}: {
  data: KittyData;
  me: string | undefined;
  allowanceRaw: bigint | undefined;
  balanceRaw: bigint | undefined;
  txStatus: TxStatus;
  onChipIn: (amountRaw: bigint, friend: `0x${string}`) => void | Promise<void>;
  /** Back to chipping in for yourself. */
  onBack?: () => void;
}) {
  const split = data.mode === 'split';
  const options = split ? unpaidContributors(data.contributors, me) : [];
  const [picked, setPicked] = useState<string | undefined>(options[0]?.address);
  const [typed, setTyped] = useState('');
  const [input, setInput] = useState(() => {
    if (!split) return formatUsdc(chipInBounds({ mode: 'open', goalRaw: data.goalRaw, totalFundedRaw: data.totalFundedRaw, effectiveMinRaw: data.effectiveMinRaw }).min);
    return options[0] ? formatUsdc(firstMax(data, options[0])) : '';
  });

  const friend = split ? picked : isAddress(typed.trim()) ? getAddress(typed.trim()) : undefined;
  const friendRow: KittyContributor | undefined = friend
    ? data.contributors.find(c => c.address.toLowerCase() === friend.toLowerCase()) : undefined;
  const bounds = chipInBounds({
    mode: data.mode, goalRaw: data.goalRaw, totalFundedRaw: data.totalFundedRaw, effectiveMinRaw: data.effectiveMinRaw, my: friendRow,
  });
  const parsed = parseUsdcAmount(input);
  const amountRaw = parsed.ok ? parsed.raw : 0n;
  const busy = isBusy(txStatus);
  const isSelf = !!friend && !!me && friend.toLowerCase() === me.toLowerCase();
  const hasFunds = balanceRaw !== undefined && balanceRaw >= amountRaw && amountRaw > 0n;
  const addrErr = !split && typed.trim() && !friend ? 'Enter a valid wallet address.' : isSelf ? 'That is your own address. Use Chip in instead.' : '';
  const amountErr = !input.trim() ? '' : !parsed.ok ? parsed.error : friend ? validateChipIn(amountRaw, bounds, data.mode) ?? '' : '';
  const err = addrErr || amountErr || (balanceRaw !== undefined && amountRaw > 0n && !hasFunds ? 'Not enough USDC in your wallet.' : '');
  const disabled = busy || !friend || isSelf || !parsed.ok || !!amountErr || amountRaw === 0n || !hasFunds;
  const helper = chipInHelper(allowanceRaw !== undefined && allowanceRaw >= amountRaw && amountRaw > 0n ? 'plain' : 'permit');

  const pick = (c: KittyContributor & { remainingRaw: bigint }) => {
    setPicked(c.address);
    const room = data.goalRaw - data.totalFundedRaw;
    setInput(formatUsdc(c.remainingRaw < room ? c.remainingRaw : room));
  };

  return (
    <div className="space-y-4">
      {split ? (
        options.length === 0 ? (
          <p className="text-[13px] text-ink-2">Everyone named on this kitty has paid their share.</p>
        ) : (
          <div role="radiogroup" aria-label="Who are you paying for" className="space-y-2">
            {options.map(c => {
              const on = c.address === picked;
              return (
                <button
                  key={c.address} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => pick(c)}
                  className={cn(
                    'tile flex min-h-11 w-full items-center gap-3 border px-3 py-2 text-left transition-colors',
                    on ? 'border-[var(--line-strong)] bg-s3' : 'border-transparent hover:border-line-strong',
                  )}
                >
                  <Avatar address={c.address} size={28} />
                  <span className="mono min-w-0 flex-1 truncate text-[13px] text-ink">{shortAddress(c.address)}</span>
                  <span className="tnum shrink-0 text-xs text-ink-2">{formatUsdcPlain(c.remainingRaw)} <span className="text-ink-3">USDC</span> left</span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="friend-address" className="block text-[13px] font-medium text-ink-2">Friend's wallet address</label>
          <AddressInput
            id="friend-address" value={typed} onChange={setTyped} invalid={!!addrErr} me={me}
            ariaLabel="Friend's wallet address" describedBy={addrErr ? 'friend-err' : undefined}
          />
          {friend && <p className="mono break-all text-xs text-ink-3">{friend}</p>}
        </div>
      )}

      {(!split || options.length > 0) && (
        <>
          <div className="space-y-2">
            <AmountInput value={input} onChange={setInput} invalid={!!amountErr} disabled={busy} ariaLabel="Amount to pay, in USDC" />
            {friend && bounds.max > 0n && (
              <div className="flex flex-wrap gap-2">
                {!split && bounds.min < bounds.max && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setInput(formatUsdc(bounds.min))}>Minimum</Button>
                )}
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setInput(formatUsdc(bounds.max))}>
                  {split ? 'Their share' : 'Remaining'}
                </Button>
              </div>
            )}
            {err && <p id="friend-err" role="alert" className="text-[12.5px] text-err-text">{err}</p>}
          </div>

          {friend && !isSelf && (
            <p className="text-[13px] leading-relaxed text-ink-2">{FRIEND_WARNING(shortAddress(friend))}</p>
          )}

          <Button
            size="lg" className="w-full" disabled={disabled} loading={busy} loadingText={busyLabel(txStatus)}
            onClick={() => { if (friend && parsed.ok && !amountErr) void onChipIn(parsed.raw, friend as `0x${string}`); }}
          >
            {friend ? `Pay for ${shortAddress(friend)}` : 'Pay for them'}
          </Button>
          <p className="text-xs text-ink-3">{helper}</p>
        </>
      )}

      {onBack && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={onBack}>Chip in for myself</Button>
      )}
    </div>
  );
}

/** Prefill for the first person on the list: their remaining share, capped by what the kitty still needs. */
function firstMax(data: KittyData, c: { remainingRaw: bigint }): bigint {
  const room = data.goalRaw - data.totalFundedRaw;
  return c.remainingRaw < room ? c.remainingRaw : room;
}
