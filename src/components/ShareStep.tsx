// ─── Kitty – the share step ─────────────────────────────────────────────────
// Shown on a new kitty's page (and to its creator until dismissed): the link, an
// editable message, WhatsApp / Telegram / native share, a QR code and "Save as
// image". Plain links only: no third-party scripts. Dismissal is remembered per
// kitty in localStorage.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { useShareBase } from '../hooks';
import { buildKittyUrl } from '../kitty-core';
import { downloadBlob, renderKittyCard } from '../lib/kittyCard';
import { shortenShareUrl } from '../pt-ui';
import { shareMessageFor, telegramUrl, whatsappUrl } from '../share-messages';
import type { KittyData } from '../kitty-types';
import { Button, Card } from './ui';
import { CopyButton } from './fields';

function openChat(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function ShareStep({
  data, me, onDismiss,
}: { data: KittyData; me?: string; onDismiss: () => void }) {
  const base = useShareBase();
  const url = base ? buildKittyUrl(base, data.id) : undefined;
  const [canShare] = useState(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  const [qrState, setQrState] = useState<{ url: string; data: string } | undefined>();
  const [edited, setEdited] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M', color: { dark: '#0A0A0C', light: '#FAFAFC' } })
      .then(d => { if (!cancelled) setQrState({ url, data: d }); })
      .catch(() => { if (!cancelled) setQrState(undefined); });
    return () => { cancelled = true; };
  }, [url]);

  const qr = qrState && qrState.url === url ? qrState.data : undefined;
  // The message follows the kitty until the user edits it; after that their text wins.
  const message = edited ?? (url ? shareMessageFor(data, url, me) : '');

  async function nativeShare() {
    if (!url) return;
    try {
      await navigator.share({ title: `Kitty: ${data.ref}`, text: message.replace(url, '').trim() || data.ref, url });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error('Could not open the share sheet.');
    }
  }

  async function saveImage() {
    if (!url || saving) return;
    setSaving(true);
    try {
      const { blob, fileName } = await renderKittyCard(data, url);
      downloadBlob(blob, fileName);
      toast.success('Image saved');
    } catch (e) {
      console.error('Save as image failed', e);
      toast.error('Could not make the image.');
    } finally {
      setSaving(false);
    }
  }

  const ready = !!url;
  return (
    <Card className="space-y-5 p-5 sm:p-6" style={{ boxShadow: '0 0 0 1px var(--line-strong), 0 0 0 4px var(--s3), var(--shadow)' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink text-balance">Your kitty is live. Send the link.</h2>
          <p className="text-[13px] leading-relaxed text-ink-2 text-pretty">
            Money stays locked until the goal is met. Anyone with the link can see it, and each person chips in only their own money.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="shrink-0">Dismiss</Button>
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-3">
          <label htmlFor="share-message" className="text-[13px] font-medium text-ink-2">Message</label>
          <textarea
            id="share-message"
            value={message}
            onChange={e => setEdited(e.target.value)}
            rows={4}
            disabled={!ready}
            className="block w-full resize-y rounded-field border border-line bg-s2 px-4 py-3 text-sm leading-relaxed text-ink placeholder:text-ink-3 hover:border-line-strong focus-visible:outline-none focus-visible:[border-color:color-mix(in_srgb,var(--accent)_70%,transparent)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]"
          />
          <div className="flex flex-wrap gap-2">
            <CopyButton variant="pill" value={message} label="Copy message" successMessage="Message copied" />
            <CopyButton variant="pill" value={url} label="Copy link" successMessage="Link copied" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!ready} onClick={() => url && openChat(whatsappUrl(message))}>WhatsApp</Button>
            <Button variant="secondary" disabled={!ready} onClick={() => url && openChat(telegramUrl(message, url))}>Telegram</Button>
            {canShare && <Button variant="secondary" disabled={!ready} onClick={() => void nativeShare()}>Share</Button>}
            <Button variant="secondary" disabled={!ready} loading={saving} loadingText="Saving" onClick={() => void saveImage()}>Save as image</Button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 md:items-start">
          <div className="flex h-[176px] w-[176px] items-center justify-center rounded-[14px] p-2" style={{ background: '#FAFAFC' }}>
            {qr ? (
              <img src={qr} alt="QR code for the kitty link" width={160} height={160} className="h-[160px] w-[160px]" />
            ) : (
              <span className="text-xs" style={{ color: '#55555F' }}>Preparing</span>
            )}
          </div>
          <p className="mono max-w-[176px] truncate text-[11px] text-ink-3" title={url}>{url ? shortenShareUrl(url) : 'Preparing link'}</p>
        </div>
      </div>
    </Card>
  );
}
