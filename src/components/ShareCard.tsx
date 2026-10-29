// ─── PayTogether – Share card (link, QR, nudge message) ──────────────────────
import { useEffect, useState } from 'react';
import { useShareBase } from '../hooks';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { buildKittyUrl } from '../kitty-core';
import { shortenShareUrl } from '../pt-ui';
import { Button, Card } from './ui';
import { CopyButton } from './fields';

interface ShareCardProps {
  potId: string;
  title: string;
  /** Builds the "copy nudge" text once the share link is known. */
  buildNudge: (link: string) => string;
  /** Soft ring right after this browser created the kitty. */
  justCreated?: boolean;
}

export function ShareCard({ potId, title, buildNudge, justCreated }: ShareCardProps) {
  const base = useShareBase();
  const [canShare] = useState(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  const [qrState, setQrState] = useState<{ url: string; data: string } | undefined>();

  const url = base ? buildKittyUrl(base, potId) : undefined;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M', color: { dark: '#0A0A0C', light: '#FAFAFC' } })
      .then(d => { if (!cancelled) setQrState({ url, data: d }); })
      .catch(() => { if (!cancelled) setQrState(undefined); });
    return () => { cancelled = true; };
  }, [url]);

  const qr = qrState && qrState.url === url ? qrState.data : undefined;
  const nudge = url ? buildNudge(url) : undefined;

  async function nativeShare() {
    if (!url) return;
    try {
      await navigator.share({ title: `Kitty: ${title}`, text: `Chip in to "${title}" on Kitty`, url });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error('Could not open the share sheet.');
    }
  }

  return (
    <Card
      className="space-y-5 p-5 sm:p-6"
      style={justCreated ? { boxShadow: '0 0 0 1px var(--line-strong), 0 0 0 4px var(--s3), var(--shadow)' } : undefined}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">
          {justCreated ? 'Kitty started. Share it now.' : 'Share this kitty'}
        </h2>
        <p className="text-[13px] leading-relaxed text-ink-2 text-pretty">
          Anyone with the link can see it. Each person chips in only their own money.
        </p>
      </div>

      <div className="flex flex-col items-stretch gap-5 sm:flex-row sm:items-start">
        <div
          className="mx-auto flex h-[160px] w-[160px] shrink-0 items-center justify-center rounded-[14px] p-2 sm:mx-0"
          style={{ background: '#FAFAFC' }}
        >
          {qr ? (
            <img src={qr} alt="QR code for the kitty link" width={144} height={144} className="h-[144px] w-[144px]" />
          ) : (
            <span className="text-xs" style={{ color: '#55555F' }}>Preparing</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <CopyButton variant="pill" value={url} label="Copy link" successMessage="Link copied" className="w-full" />
          <CopyButton variant="pill" value={nudge} label="Copy nudge" successMessage="Message copied" className="w-full" />
          {canShare && (
            <Button variant="secondary" onClick={() => void nativeShare()} disabled={!url} className="w-full">
              Share
            </Button>
          )}
        </div>
      </div>

      <div className="flex h-11 items-center gap-1 rounded-full border border-line bg-s2 pl-4 pr-1.5">
        <span
          className="mono min-w-0 flex-1 truncate text-xs text-ink-2"
          data-testid="share-url"
          title={url}
        >
          {url ? shortenShareUrl(url) : 'Preparing link'}
        </span>
        <CopyButton value={url} label="Copy link" successMessage="Link copied" />
      </div>
    </Card>
  );
}
