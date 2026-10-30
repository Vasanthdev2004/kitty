// ─── Kitty – "Save as image" ────────────────────────────────────────────────
// Draws the kitty card (name, progress, amount, QR, link) onto a canvas in the
// current theme's colours and returns a PNG. Everything happens in the browser:
// no server, no third-party script.
import QRCode from 'qrcode';
import { cardImageModel, cardFileName } from '../share-messages';
import { shortenShareUrl } from '../pt-ui';
import type { KittyData } from '../kitty-types';

const SIZE = 1080;
const PAD = 72;

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Break `text` into at most `maxLines` lines that fit `maxWidth`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s*\S*$/, '')}\u2026`;
    return kept;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderKittyCard(data: KittyData, url: string): Promise<{ blob: Blob; fileName: string }> {
  const m = cardImageModel(data);
  const sans = '"Geist Variable", system-ui, sans-serif';
  const mono = '"Geist Mono Variable", ui-monospace, monospace';
  // Make sure the web fonts are ready before measuring or drawing.
  try {
    await Promise.all([
      document.fonts.load(`600 56px ${sans}`), document.fonts.load(`500 28px ${sans}`), document.fonts.load(`600 96px ${mono}`),
    ]);
  } catch { /* system fonts are fine */ }

  const bg = token('--bg', '#0A0A0C');
  const surface = token('--s1', '#111114');
  const track = token('--s3', '#1E1E23');
  const ink = token('--text', '#EDEDF0');
  const ink2 = token('--text-2', '#A0A0AB');
  const ink3 = token('--text-3', '#8A8A96');
  const ok = token('--ok', '#34C77B');
  const line = token('--line-strong', 'rgba(255,255,255,0.12)');

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  roundRect(ctx, 36, 36, SIZE - 72, SIZE - 72, 44);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Wordmark: ring + dot, then the name.
  const left = PAD + 24;
  const right = SIZE - PAD - 24;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(left + 20, 150, 18, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(left + 56, 150, 9, 0, Math.PI * 2); ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 40px ${sans}`;
  ctx.fillText('Kitty', left + 84, 164);
  ctx.font = `500 28px ${sans}`;
  ctx.fillStyle = ink3;
  ctx.textAlign = 'right';
  ctx.fillText(m.kindLabel, right, 162);
  ctx.textAlign = 'left';

  // Title (two lines at most).
  ctx.fillStyle = ink;
  ctx.font = `600 68px ${sans}`;
  const lines = wrap(ctx, m.title, right - left, 2);
  lines.forEach((l, i) => ctx.fillText(l, left, 290 + i * 80));

  // Amount.
  const amountY = 290 + lines.length * 80 + 90;
  const [funded, ...rest] = m.amountLine.split(' of ');
  ctx.font = `600 96px ${mono}`;
  ctx.fillStyle = ink;
  ctx.fillText(funded, left, amountY);
  const fundedW = ctx.measureText(funded).width;
  ctx.font = `500 36px ${sans}`;
  ctx.fillStyle = ink2;
  ctx.fillText(`of ${rest.join(' of ')}`, left + fundedW + 20, amountY - 4);

  // Progress bar.
  const barY = amountY + 56;
  const barW = right - left;
  roundRect(ctx, left, barY, barW, 28, 14);
  ctx.fillStyle = track;
  ctx.fill();
  if (m.percent > 0) {
    roundRect(ctx, left, barY, Math.max(28, (barW * m.percent) / 100), 28, 14);
    ctx.fillStyle = ok;
    ctx.fill();
  }
  ctx.font = `500 28px ${sans}`;
  ctx.fillStyle = ink2;
  ctx.fillText(`${m.percent}% funded`, left, barY + 74);

  // QR tile + link.
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, { margin: 0, width: 232, errorCorrectionLevel: 'M', color: { dark: '#0A0A0C', light: '#FAFAFC' } });
  const tile = 280;
  const tileY = SIZE - 36 - 96 - tile - 24;
  roundRect(ctx, left, tileY, tile, tile, 24);
  ctx.fillStyle = '#FAFAFC';
  ctx.fill();
  ctx.drawImage(qrCanvas, left + (tile - 232) / 2, tileY + (tile - 232) / 2, 232, 232);

  const textX = left + tile + 40;
  ctx.fillStyle = ink;
  ctx.font = `600 36px ${sans}`;
  ctx.fillText('Scan to chip in', textX, tileY + 60);
  ctx.fillStyle = ink2;
  ctx.font = `500 26px ${mono}`;
  const link = shortenShareUrl(url);
  wrap(ctx, link, right - textX, 3).forEach((l, i) => ctx.fillText(l, textX, tileY + 112 + i * 38));

  ctx.fillStyle = ink3;
  ctx.font = `500 28px ${sans}`;
  ctx.fillText(m.tagline, left, SIZE - 36 - 40);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'));
  return { blob, fileName: cardFileName(data.ref) };
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}
