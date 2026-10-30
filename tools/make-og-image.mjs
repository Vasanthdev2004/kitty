// Generates public/og-image.png (1200x630) from the Kitty tokens: wordmark, tagline and a
// minimal progress bar. Run once and commit the PNG; it is NOT part of the build.
//
//   bun add -d @napi-rs/canvas      # only needed to regenerate
//   bun run tools/make-og-image.mjs
import { writeFileSync } from 'node:fs';
import { GlobalFonts, createCanvas } from '@napi-rs/canvas';

const fonts = 'node_modules/@fontsource-variable';
GlobalFonts.registerFromPath(`${fonts}/geist/files/geist-latin-wght-normal.woff2`, 'Geist');
GlobalFonts.registerFromPath(`${fonts}/geist-mono/files/geist-mono-latin-wght-normal.woff2`, 'GeistMono');

const W = 1200;
const H = 630;
const c = {
  bg: '#0A0A0C', surface: '#111114', track: '#1E1E23', line: 'rgba(255,255,255,0.12)',
  ink: '#EDEDF0', ink2: '#A0A0AB', ink3: '#8A8A96', ok: '#34C77B',
};

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

ctx.fillStyle = c.bg;
ctx.fillRect(0, 0, W, H);
roundRect(40, 40, W - 80, H - 80, 36);
ctx.fillStyle = c.surface;
ctx.fill();
ctx.strokeStyle = c.line;
ctx.lineWidth = 2;
ctx.stroke();

// Wordmark: ring + dot, then the name.
const x0 = 104;
ctx.strokeStyle = c.ink;
ctx.lineWidth = 5;
ctx.beginPath(); ctx.arc(x0 + 24, 130, 22, 0, Math.PI * 2); ctx.stroke();
ctx.fillStyle = c.ink;
ctx.beginPath(); ctx.arc(x0 + 68, 130, 11, 0, Math.PI * 2); ctx.fill();
ctx.font = '600 46px Geist';
ctx.fillText('Kitty', x0 + 104, 146);

// Tagline.
ctx.fillStyle = c.ink;
ctx.font = '600 92px Geist';
ctx.fillText('Nobody fronts', x0, 318);
ctx.fillText('the money.', x0, 418);

ctx.fillStyle = c.ink2;
ctx.font = '500 30px Geist';
ctx.fillText('Group money pools on Arc, settled in USDC.', x0, 478);

// Minimal progress bar: three segments, two full.
const barY = 530;
const barW = W - 2 * x0;
const gap = 10;
const seg = (barW - 2 * gap) / 3;
for (let i = 0; i < 3; i++) {
  const x = x0 + i * (seg + gap);
  roundRect(x, barY, seg, 22, 11);
  ctx.fillStyle = c.track;
  ctx.fill();
  const fill = i < 2 ? seg : seg * 0.45;
  roundRect(x, barY, fill, 22, 11);
  ctx.fillStyle = c.ok;
  ctx.fill();
}

writeFileSync('public/og-image.png', canvas.toBuffer('image/png'));
console.log('wrote public/og-image.png');
