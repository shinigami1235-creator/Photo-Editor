// Opens Photoshop files with ag-psd (MIT). Each pixel layer becomes its own
// photo layer at the same place, with its name, opacity, visibility and blend
// mode. Layer masks and clipping masks are baked into the pixels so the page
// looks the way it did in Photoshop. Text and smart objects come in as they
// look, as pixels. CMYK files are converted to RGB. Adjustment layers have
// no pixels, so they're counted and left out.

import { readPsd } from 'ag-psd/dist/index.js';
import { supportedColorModes } from 'ag-psd/dist/psdReader.js';

// ag-psd can decode 8-bit CMYK files but leaves CMYK off its list of modes.
// Print designs are often CMYK, so turn it on; they come in converted to RGB.
if (!supportedColorModes.includes(4)) supportedColorModes.push(4);

const BLEND = {
  normal: 'source-over',
  'pass through': 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

const pixels = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);

/** Multiplies a layer's alpha by its mask, which may be offset from the layer. */
function applyMask(layer) {
  const m = layer.mask;
  const c = layer.canvas;
  const img = pixels(c);
  const md = m.canvas ? pixels(m.canvas) : null;
  const mw = m.canvas?.width || 0;
  const mh = m.canvas?.height || 0;
  const outside = (m.defaultColor ?? 0) / 255;
  for (let y = 0; y < c.height; y++) {
    const my = layer.top + y - (m.top ?? 0);
    for (let x = 0; x < c.width; x++) {
      const mx = layer.left + x - (m.left ?? 0);
      const k = md && mx >= 0 && my >= 0 && mx < mw && my < mh ? md.data[(my * mw + mx) * 4] / 255 : outside;
      img.data[(y * c.width + x) * 4 + 3] *= k;
    }
  }
  c.getContext('2d').putImageData(img, 0, 0);
}

/** Keeps a clipped layer only where the layer it clips to has pixels. */
function applyClip(layer, base) {
  const c = layer.canvas;
  const img = pixels(c);
  const bd = pixels(base.canvas);
  const bw = base.canvas.width;
  const bh = base.canvas.height;
  for (let y = 0; y < c.height; y++) {
    const by = layer.top + y - base.top;
    for (let x = 0; x < c.width; x++) {
      const bx = layer.left + x - base.left;
      const k = bx >= 0 && by >= 0 && bx < bw && by < bh ? bd.data[(by * bw + bx) * 4 + 3] / 255 : 0;
      img.data[(y * c.width + x) * 4 + 3] *= k;
    }
  }
  c.getContext('2d').putImageData(img, 0, 0);
}

/**
 * Reads a PSD. Returns { width, height, layers, composite, skipped } where
 * layers run bottom to top as { name, canvas, left, top, opacity, hidden, blend }.
 */
export function readPhotoshop(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // The page is built from the layers, so the flattened copy Photoshop stores
  // is skipped: ag-psd can't read it in CMYK files with extra channels (spot
  // colours, saved selections). It's read only for files without layers.
  let psd = readPsd(buf, { skipThumbnail: true, skipCompositeImageData: true });
  if (!psd.children?.length) {
    try {
      psd = readPsd(buf, { skipThumbnail: true });
    } catch (e) {
      throw new Error(`It has no layers, and its flattened picture can't be read (${e.message}). Save a copy from Photoshop in RGB and open that.`);
    }
  }
  const layers = [];
  const skipped = { adjustments: 0, blends: new Set() };
  let base = null;
  const walk = (list, path, opacity, hidden) => {
    for (const l of list || []) {
      const name = path ? `${path} / ${l.name || 'Layer'}` : l.name || 'Layer';
      const op = opacity * (l.opacity ?? 1);
      const hid = hidden || !!l.hidden;
      if (l.children) {
        walk(l.children, name, op, hid);
        base = null;
        continue;
      }
      if (l.adjustment) {
        skipped.adjustments++;
        continue;
      }
      if (!l.canvas || !l.canvas.width || !l.canvas.height) continue;
      if (l.mask && !l.mask.disabled && (l.mask.canvas || l.mask.defaultColor !== undefined)) applyMask(l);
      if (l.clipping && base) applyClip(l, base);
      else if (!l.clipping) base = l;
      const blend = BLEND[l.blendMode || 'normal'];
      if (!blend) skipped.blends.add(l.blendMode);
      layers.push({ name, canvas: l.canvas, left: l.left || 0, top: l.top || 0, opacity: op, hidden: hid, blend: blend || 'source-over' });
    }
  };
  walk(psd.children, '', 1, false);
  return { width: psd.width, height: psd.height, layers, composite: psd.canvas || null, skipped };
}
