// ─── Kitty – "Get USDC" sheet ───────────────────────────────────────────────
// USDC on Arc is the native token AND pays the network fee. Mainnet: bridge with
// Circle's Arc Portal, Circle CCTP bridges, or an exchange. Testnet: the faucet. The wallet's own
// address (copy + QR) and an "Add Arc to my wallet" button on both. The only
// outside links are the ones named in project-facts.ts.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { KittyDeployment } from '../kitty-config';
import { ARC_BRIDGES_DOC_URL, ARC_PORTAL_DEPOSIT_URL, ARC_PORTAL_FIAT_URL } from '../project-facts';
import { Button, Card } from './ui';
import { CopyButton } from './fields';

const LINK = 'font-medium text-accent-text underline-offset-2 hover:underline';

export function GetUsdcSheet({
  dep, address, onClose, onAddNetwork,
}: {
  dep: KittyDeployment;
  address: string | undefined;
  onClose: () => void;
  onAddNetwork: () => void;
}) {
  const [qr, setQr] = useState<{ for: string; url: string } | undefined>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    QRCode.toDataURL(address, { margin: 1, width: 176, color: { dark: '#0A0A0C', light: '#FAFAFC' } })
      .then(url => { if (!cancelled) setQr({ for: address, url }); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [address]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(10,10,12,0.55)] p-3 backdrop-blur-sm sm:items-center sm:p-6">
      <Card role="dialog" aria-modal="true" aria-labelledby="usdc-title" className="max-h-[90dvh] w-full max-w-md space-y-5 overflow-y-auto p-5 sm:p-6">
        <div className="space-y-2">
          <h2 id="usdc-title" className="text-lg font-semibold tracking-tight text-ink">
            {dep.testnet ? `Get test USDC on ${dep.networkLabel}` : `Get USDC on ${dep.networkLabel}`}
          </h2>
          {dep.testnet ? (
            <p className="text-sm leading-relaxed text-ink-2 text-pretty">
              {dep.networkLabel} uses free test USDC with no real value. USDC is also the token that pays the network fee.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-ink-2 text-pretty">
              USDC on Arc is native USDC, and it also pays the network fee. Keep about 0.1 USDC in your wallet for fees.
            </p>
          )}
        </div>

        {dep.testnet ? (
          dep.faucetUrl && (
            <p className="text-sm text-ink-2">
              <a className={LINK} href={dep.faucetUrl} target="_blank" rel="noopener noreferrer">Get test USDC</a> from the Circle faucet, then come back.
            </p>
          )
        ) : (
          <div className="space-y-3 text-sm leading-relaxed text-ink-2">
            <div className="space-y-1.5">
              <p className="text-[13px] font-medium text-ink">Circle's Arc Portal</p>
              <ul className="space-y-1.5">
                <li><a className={LINK} href={ARC_PORTAL_DEPOSIT_URL} target="_blank" rel="noopener noreferrer">Bring USDC from another chain</a></li>
                <li><a className={LINK} href={ARC_PORTAL_FIAT_URL} target="_blank" rel="noopener noreferrer">Buy USDC with a card (where available)</a></li>
              </ul>
              <p className="text-xs text-ink-3">The Arc Portal is run by Circle, not by Kitty.</p>
            </div>
            <ul className="space-y-2">
              <li>
                You can also bridge with Circle CCTP. See the{' '}
                <a className={LINK} href={ARC_BRIDGES_DOC_URL} target="_blank" rel="noopener noreferrer">supported bridges</a>.
              </li>
              <li>Withdraw USDC from an exchange and choose the Arc network. Check first that your exchange supports Arc.</li>
            </ul>
          </div>
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-ink">Your address on Arc</p>
          {address ? (
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="mono break-all text-[13px] leading-relaxed text-ink" data-testid="usdc-address">{address}</p>
                <CopyButton value={address} variant="pill" label="Copy address" successMessage="Address copied" />
              </div>
              {qr && qr.for === address && (
                <img src={qr.url} width={112} height={112} alt="QR code of your wallet address" className="rounded-[14px]" />
              )}
            </div>
          ) : (
            <p className="text-[13px] text-ink-2">Connect your wallet to see your address.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" size="sm" onClick={onAddNetwork}>Add Arc to my wallet</Button>
          <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </Card>
    </div>
  );
}
