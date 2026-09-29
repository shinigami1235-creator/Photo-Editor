import { PDFDocument } from 'pdf-lib';
import { fabric } from './canvas.js';
import { state } from './state.js';
import { ensureFontsFor } from './fonts.js';
import { preloadMasks } from './layerfx.js';
import { loadImage } from './assets.js';

/** Draws a page on its own canvas at `multiplier` times the design size. */
export async function renderPage(page, multiplier = 1, { transparent = false, transform = null } = {}) {
  const { width, height } = state.doc;
  await ensureFontsFor(page.objects);
  await preloadMasks(page.objects);
  const el = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(el, { width, height, enableRetinaScaling: false, renderOnAddRemove: false });
  sc.backgroundColor = transparent ? null : page.background || '#ffffff';
  let objects = await fabric.util.enlivenObjects(page.objects);
  if (transform) objects = await transform(objects);
  if (objects.length) sc.add(...objects);
  sc.renderAll();
  const out = sc.toCanvasElement(multiplier);
  sc.dispose();
  return out;
}

export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export function canvasBytes(el, type, quality) {
  return new Promise((resolve, reject) =>
    el.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('export failed'))), type, quality),
  );
}

export async function pageImage(page, { format, multiplier, quality, transparent, transform, watermark, maxKB }) {
  const el = await renderPage(page, multiplier, { transparent: format !== 'jpg' && transparent, transform });
  if (watermark?.on) await drawWatermark(el, watermark);
  return encodeCanvas(el, { format, quality, maxKB });
}

/** Encodes a canvas. WebP falls back to a bundled encoder where the browser cannot make it (Safari on a Mac). */
async function encodeOnce(el, format, quality) {
  if (format !== 'webp') return canvasBytes(el, MIME[format], quality);
  const blob = await new Promise((r) => el.toBlob(r, 'image/webp', quality));
  if (blob && blob.type === 'image/webp') return new Uint8Array(await blob.arrayBuffer());
  const { default: encode } = await import('@jsquash/webp/encode.js');
  const data = el.getContext('2d').getImageData(0, 0, el.width, el.height);
  return new Uint8Array(await encode(data, { quality: Math.round(quality * 100) }));
}

/**
 * Encodes a canvas as PNG, JPG or WebP. With `maxKB` (JPG and WebP), the quality
 * steps down until the file fits, then the picture shrinks if it still does not.
 */
export async function encodeCanvas(el, { format, quality = 0.92, maxKB = 0 }) {
  let bytes = await encodeOnce(el, format, quality);
  if (!maxKB || format === 'png' || bytes.length <= maxKB * 1024) return bytes;
  let lo = 0.35;
  let hi = quality;
  let best = null;
  for (let i = 0; i < 7; i++) {
    const q = (lo + hi) / 2;
    const b = await encodeOnce(el, format, q);
    if (b.length <= maxKB * 1024) {
      best = b;
      lo = q;
    } else hi = q;
  }
  if (best) return best;
  let cur = el;
  for (let i = 0; i < 10; i++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(cur.width * 0.85));
    c.height = Math.max(1, Math.round(cur.height * 0.85));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
    bytes = await encodeOnce(cur, format, 0.6);
    if (bytes.length <= maxKB * 1024) return bytes;
  }
  return bytes;
}

/**
 * Draws the watermark on a finished picture: a logo and a line of text in one
 * corner. `wm` = { logoUrl, text, color, corner: tl|tr|bl|br, size (% of width), opacity }.
 */
export async function drawWatermark(el, wm) {
  const x = el.getContext('2d');
  const W = el.width;
  const H = el.height;
  const m = Math.round(Math.min(W, H) * 0.04);
  const lw = (W * (wm.size ?? 18)) / 100;
  let img = null;
  if (wm.logoUrl) img = await loadImage(wm.logoUrl).catch(() => null);
  const lh = img ? (lw * img.naturalHeight) / img.naturalWidth : 0;
  const fs = Math.max(10, Math.round(lw * 0.14));
  const text = (wm.text || '').trim();
  const gap = img && text ? fs * 0.5 : 0;
  x.font = `600 ${fs}px "IBM Plex Sans", Arial, sans-serif`;
  const tw = text ? x.measureText(text).width : 0;
  const boxW = Math.max(img ? lw : 0, tw);
  const boxH = lh + gap + (text ? fs * 1.2 : 0);
  const right = wm.corner === 'tr' || wm.corner === 'br';
  const bottom = wm.corner === 'bl' || wm.corner === 'br';
  const bx = right ? W - m - boxW : m;
  const by = bottom ? H - m - boxH : m;
  x.save();
  x.globalAlpha = (wm.opacity ?? 85) / 100;
  if (img) x.drawImage(img, right ? bx + boxW - lw : bx, by, lw, lh);
  if (text) {
    x.fillStyle = wm.color || '#ffffff';
    x.textBaseline = 'top';
    x.textAlign = right ? 'right' : 'left';
    x.shadowColor = 'rgba(0,0,0,0.35)';
    x.shadowBlur = fs * 0.3;
    x.fillText(text, right ? bx + boxW : bx, by + lh + gap);
  }
  x.restore();
  return el;
}

export async function thumbnail(page, size = 160) {
  const m = size / Math.max(state.doc.width, state.doc.height);
  const el = await renderPage(page, m);
  return el.toDataURL('image/png');
}

export async function buildPdf(pages, dpi) {
  const pdf = await PDFDocument.create();
  const { width, height } = state.doc;
  const pt = 72 / (dpi || 72);
  for (const page of pages) {
    const png = await pdf.embedPng(await pageImage(page, { format: 'png', multiplier: 1 }));
    const p = pdf.addPage([width * pt, height * pt]);
    p.drawImage(png, { x: 0, y: 0, width: width * pt, height: height * pt });
  }
  pdf.setTitle(state.doc.name);
  return pdf.save();
}
