// Renders public/apple-touch-icon.png (180x180) from the ring-and-dot mark in public/favicon.svg.
// Needs @napi-rs/canvas, which is NOT a dependency of the app:
//   cd /tmp && mkdir icons && cd icons && bun add @napi-rs/canvas && cp <repo>/tools/make-icons.mjs . && bun make-icons.mjs <repo>/public
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? '.';
const S = 180;
const c = createCanvas(S, S);
const g = c.getContext('2d');
// iOS rounds the corners itself, so the background fills the whole square.
g.fillStyle = '#111114';
g.fillRect(0, 0, S, S);
const k = S / 32; // the favicon is drawn on a 32 unit grid
g.strokeStyle = '#EDEDF0';
g.lineWidth = 2 * k;
g.beginPath();
g.arc(13 * k, 16 * k, 7 * k, 0, Math.PI * 2);
g.stroke();
g.fillStyle = '#EDEDF0';
g.beginPath();
g.arc(23 * k, 16 * k, 3.5 * k, 0, Math.PI * 2);
g.fill();
writeFileSync(join(out, 'apple-touch-icon.png'), c.toBuffer('image/png'));
console.log('wrote', join(out, 'apple-touch-icon.png'));
