import { fabric } from './canvas.js';
import { loadImage } from './assets.js';

// Pattern fills for shapes and text: a small tile drawn in code and repeated,
// or a photo repeated as a tile.

export const PATTERNS = [
  ['dots', 'Dots'],
  ['stripes', 'Stripes'],
  ['diagonal', 'Diagonal'],
  ['checks', 'Checks'],
  ['grid', 'Grid'],
  ['waves', 'Waves'],
  ['zigzag', 'Zigzag'],
  ['photo', 'Photo'],
];

/** Draws one tile of a pattern, `size` pixels square. */
export function patternTile(kind, color, bg, size) {
  const s = Math.max(4, Math.round(size));
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  if (bg) {
    x.fillStyle = bg;
    x.fillRect(0, 0, s, s);
  }
  x.fillStyle = color;
  x.strokeStyle = color;
  x.lineCap = 'round';
  if (kind === 'dots') {
    x.beginPath();
    x.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
    x.fill();
  } else if (kind === 'stripes') {
    x.fillRect(0, 0, s, s / 2);
  } else if (kind === 'diagonal') {
    x.lineWidth = s * 0.28;
    x.beginPath();
    x.moveTo(-s * 0.5, s * 0.5);
    x.lineTo(s * 0.5, -s * 0.5);
    x.moveTo(0, s);
    x.lineTo(s, 0);
    x.moveTo(s * 0.5, s * 1.5);
    x.lineTo(s * 1.5, s * 0.5);
    x.stroke();
  } else if (kind === 'checks') {
    x.fillRect(0, 0, s / 2, s / 2);
    x.fillRect(s / 2, s / 2, s / 2, s / 2);
  } else if (kind === 'grid') {
    x.lineWidth = Math.max(1, s * 0.08);
    x.strokeRect(0, 0, s, s);
  } else if (kind === 'waves') {
    x.lineWidth = Math.max(1, s * 0.12);
    x.beginPath();
    for (let i = 0; i <= s; i++) x.lineTo(i, s / 2 + Math.sin((i / s) * Math.PI * 2) * s * 0.18);
    x.stroke();
  } else if (kind === 'zigzag') {
    x.lineWidth = Math.max(1, s * 0.12);
    x.beginPath();
    x.moveTo(0, s * 0.65);
    x.lineTo(s / 2, s * 0.35);
    x.lineTo(s, s * 0.65);
    x.stroke();
  }
  return c;
}

/** A Fabric pattern for the settings in `p` = { kind, color, bg, size, url }. */
export async function makePattern(p) {
  if (p.kind === 'photo') {
    if (!p.url) return null;
    const img = await loadImage(p.url);
    const k = p.size / Math.max(1, img.naturalWidth);
    return new fabric.Pattern({ source: img, repeat: 'repeat', patternTransform: [k, 0, 0, k, 0, 0] });
  }
  return new fabric.Pattern({ source: patternTile(p.kind, p.color, p.bg, p.size), repeat: 'repeat' });
}
