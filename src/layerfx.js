import * as fabric from 'fabric';
import { loadImage } from './assets.js';

// Layer features Fabric doesn't have: layer masks, clipping to the layer below,
// warp, outline and glow. An object that uses any of them is drawn on its own
// scratch canvas first, then put on the page with its opacity, blend mode and
// shadow. Everything else renders the normal Fabric way.

export const FX_PROPS = ['layerMask', 'maskOn', 'clipBelow', 'warp', 'warpBend', 'outlineColor', 'outlineWidth', 'glowColor', 'glowSize', 'glowStrength'];

export const BLEND_MODES = [
  ['source-over', 'Normal'],
  ['multiply', 'Multiply'],
  ['screen', 'Screen'],
  ['overlay', 'Overlay'],
  ['darken', 'Darken'],
  ['lighten', 'Lighten'],
  ['color-dodge', 'Colour dodge'],
  ['color-burn', 'Colour burn'],
  ['hard-light', 'Hard light'],
  ['soft-light', 'Soft light'],
  ['difference', 'Difference'],
  ['exclusion', 'Exclusion'],
  ['hue', 'Hue'],
  ['saturation', 'Saturation'],
  ['color', 'Colour'],
  ['luminosity', 'Luminosity'],
];

export const WARPS = [
  ['', 'None'],
  ['arc', 'Arc'],
  ['arch', 'Arch'],
  ['bulge', 'Bulge'],
  ['flag', 'Flag'],
  ['wave', 'Wave'],
  ['rise', 'Rise'],
];

const maskOn = (o) => !!o.layerMask && o.maskOn !== false;
export const hasFx = (o) => !!(maskOn(o) || o.clipBelow || (o.warp && o.warpBend) || o.outlineWidth > 0 || o.glowSize > 0);

// ---------- Mask pictures ----------

const masks = new Map(); // url -> canvas or image, or 'loading'

/** Keeps a freshly made mask canvas so it draws without waiting for the file. */
export const cacheMask = (url, drawable) => masks.set(url, drawable);

function maskFor(o) {
  const m = masks.get(o.layerMask);
  if (m && m !== 'loading') return m;
  if (!m && o.layerMask.startsWith('blob:')) {
    masks.set(o.layerMask, 'loading');
    loadImage(o.layerMask)
      .then((img) => {
        masks.set(o.layerMask, img);
        o.canvas?.requestRenderAll();
      })
      .catch(() => masks.delete(o.layerMask));
  }
  return null;
}

/** Loads every mask used in saved page objects, so an export draws them. */
export async function preloadMasks(objects) {
  const urls = new Set();
  const walk = (o) => {
    if (o?.layerMask?.startsWith('blob:')) urls.add(o.layerMask);
    o?.objects?.forEach(walk);
  };
  objects.forEach(walk);
  await Promise.all(
    [...urls].map(async (u) => {
      const m = masks.get(u);
      if (m && m !== 'loading') return;
      try {
        masks.set(u, await loadImage(u));
      } catch {
        masks.delete(u);
      }
    }),
  );
}

/** The mask picture for an object, or null while it loads. */
export const maskDrawable = (o) => (o.layerMask ? maskFor(o) : null);

// ---------- Scratch canvases ----------

const pool = [];
let depth = 0;
function scratch(slot, w, h) {
  const key = depth * 4 + slot;
  let c = pool[key];
  if (!c) c = pool[key] = document.createElement('canvas');
  // Exact size, so nothing left from an earlier frame can bleed in at the edges.
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.shadowColor = 'transparent';
  x.shadowBlur = 0;
  x.clearRect(0, 0, w, h);
  return [c, x];
}

// ---------- Rendering ----------

const baseRender = fabric.FabricObject.prototype.render;

fabric.FabricObject.prototype.render = function (ctx) {
  if (this.__plain || !hasFx(this) || this.isNotVisible()) return baseRender.call(this, ctx);
  if (this.canvas?.skipOffscreen && !this.group && !this.isOnScreen() && !(this.outlineWidth || this.glowSize)) return;
  renderFx(this, ctx, false);
};

/** Runs fn with some properties swapped, without marking the object changed. */
function withProps(o, patch, fn) {
  const old = {};
  for (const k of Object.keys(patch)) {
    old[k] = o[k];
    o[k] = patch[k];
  }
  try {
    return fn();
  } finally {
    Object.assign(o, old);
  }
}

/** Draws the object alone: no opacity, blend, shadow or layer features. */
function plainRender(o, ctx) {
  const cv = o.canvas;
  const skip = cv?.skipOffscreen;
  if (cv) cv.skipOffscreen = false;
  try {
    withProps(o, { opacity: 1, shadow: null, globalCompositeOperation: 'source-over', __plain: true }, () => o.render(ctx));
  } finally {
    if (cv) cv.skipOffscreen = skip;
  }
}

/** The layer a clipped layer shows through: the nearest unclipped one below it. */
export function clipBaseOf(o) {
  const list = o.group ? o.group._objects : o.canvas?._objects;
  if (!list) return null;
  for (let i = list.indexOf(o) - 1; i >= 0; i--) {
    const b = list[i];
    if (!b.isTemp && !b.clipBelow) return b;
  }
  return null;
}

function renderAsBase(b, ctx) {
  if (maskOn(b) || (b.warp && b.warpBend)) renderFx(b, ctx, true);
  else plainRender(b, ctx);
}

/** The part of the object a warp bends across: the text itself for a text box, else the whole width. */
function warpSpan(o) {
  if (o.type === 'textbox' && o.__lineWidths?.length && o.textAlign !== 'justify') {
    const tw = Math.min(o.width, Math.max(...o.__lineWidths));
    const x0 = o.textAlign === 'center' ? -tw / 2 : o.textAlign === 'right' ? o.width / 2 - tw : -o.width / 2;
    return { x0, w: Math.max(1, tw) };
  }
  return { x0: -o.width / 2, w: o.width };
}

/** How far a warp bends, in the object's own units: a quarter of the bent width at 100%. */
const warpReach = (o) => (o.warp && o.warpBend ? (o.warpBend / 100) * warpSpan(o).w * 0.25 : 0);

function effectMargin(o, vs) {
  let m = 2 + Math.abs(warpReach(o)) * Math.abs(o.scaleY) * vs;
  if (o.outlineWidth > 0) m += o.outlineWidth * vs;
  if (o.glowSize > 0) m += o.glowSize * vs * 1.6;
  if (o.shadow) {
    const sc = shadowScale(o, vs);
    m += (Math.max(Math.abs(o.shadow.offsetX), Math.abs(o.shadow.offsetY)) + o.shadow.blur) * sc;
  }
  return m;
}

const shadowScale = (o, vs) => (o.shadow?.nonScaling ? vs : vs * Math.max(Math.abs(o.scaleX), Math.abs(o.scaleY)));

function renderFx(o, ctx, asBase) {
  const T = ctx.getTransform();
  const needFull = o.group && !o.group._transformDone;
  const m = o.calcTransformMatrix(!needFull);
  const M = T.multiply(new DOMMatrix(m));
  const pad = Math.max(2, o.strokeWidth || 0) + 2;
  const bw = o.width + pad * 2;
  const bh = o.height + pad * 2;
  const reach = warpReach(o);
  const ext = Math.abs(reach); // room above and below for the bend
  const vs = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c));
  const margin = asBase ? 1 : effectMargin(o, vs);

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of [
    [-bw / 2, -bh / 2 - ext],
    [bw / 2, -bh / 2 - ext],
    [bw / 2, bh / 2 + ext],
    [-bw / 2, bh / 2 + ext],
  ]) {
    const p = M.transformPoint(new DOMPoint(x, y));
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  x0 = Math.max(0, Math.floor(x0 - margin));
  y0 = Math.max(0, Math.floor(y0 - margin));
  x1 = Math.min(ctx.canvas.width, Math.ceil(x1 + margin));
  y1 = Math.min(ctx.canvas.height, Math.ceil(y1 + margin));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return;

  let lw = Math.ceil(bw * Math.hypot(M.a, M.b));
  let lh = Math.ceil(bh * Math.hypot(M.c, M.d));
  const cap = 4096 / Math.max(lw, lh);
  if (cap < 1) {
    lw = Math.ceil(lw * cap);
    lh = Math.ceil(lh * cap);
  }
  if (lw < 1 || lh < 1) return;
  const mask = maskOn(o) ? maskFor(o) : null;
  if (maskOn(o) && !mask) return; // still loading; the canvas redraws when it arrives

  depth++;
  try {
    // 1. The object in its own flat space, with its mask.
    const kx = lw / bw;
    const ky = lh / bh;
    const Lmap = new DOMMatrix([kx, 0, 0, ky, lw / 2, lh / 2]);
    const [L, lc] = scratch(0, lw, lh);
    lc.setTransform(Lmap.multiply(new DOMMatrix(m).inverse()));
    plainRender(o, lc);
    if (mask) {
      const [Mc, mc] = scratch(1, lw, lh);
      mc.fillStyle = '#fff';
      mc.fillRect(0, 0, lw, lh);
      mc.setTransform(Lmap);
      mc.clearRect(-o.width / 2, -o.height / 2, o.width, o.height);
      mc.drawImage(mask, -o.width / 2, -o.height / 2, o.width, o.height);
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'destination-in';
      lc.drawImage(Mc, 0, 0, lw, lh, 0, 0, lw, lh);
      lc.globalCompositeOperation = 'source-over';
    }

    // 2. Onto the screen region, warped if set.
    const [A, ac] = scratch(2, rw, rh);
    ac.imageSmoothingQuality = 'high';
    if (reach) {
      ac.setTransform(new DOMMatrix([1, 0, 0, 1, -x0, -y0]).multiply(M));
      drawWarped(ac, L, lw, lh, bw, bh, o.warp, reach, warpSpan(o));
    } else {
      ac.setTransform(new DOMMatrix([1, 0, 0, 1, -x0, -y0]).multiply(M).multiply(new DOMMatrix([1 / kx, 0, 0, 1 / ky, -bw / 2, -bh / 2])));
      ac.drawImage(L, 0, 0, lw, lh, 0, 0, lw, lh);
    }
    ac.setTransform(1, 0, 0, 1, 0, 0);

    // 3. Clipped to the layer below.
    if (!asBase && o.clipBelow) {
      const base = clipBaseOf(o);
      if (!base || !base.visible) return;
      const [B, bc] = scratch(3, rw, rh);
      bc.setTransform(new DOMMatrix([1, 0, 0, 1, -x0, -y0]).multiply(T));
      renderAsBase(base, bc);
      ac.globalCompositeOperation = 'destination-in';
      ac.drawImage(B, 0, 0, rw, rh, 0, 0, rw, rh);
      ac.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (asBase) {
      ctx.drawImage(A, 0, 0, rw, rh, x0, y0, rw, rh);
      ctx.restore();
      return;
    }
    ctx.globalAlpha *= o.opacity ?? 1;
    ctx.globalCompositeOperation = o.globalCompositeOperation || 'source-over';

    // Shadow and glow are drawn from far off-canvas so only the shadow lands.
    const FAR = 20000 + rw;
    let silhouette = A;
    if (o.outlineWidth > 0) {
      const [C, cc] = scratch(3, rw, rh);
      const r = o.outlineWidth * vs;
      const rings = r > 3 ? [r, r * 0.66, r * 0.33] : [r];
      for (const rr of rings) {
        const n = Math.max(12, Math.min(48, Math.round(rr * 2)));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          cc.drawImage(A, 0, 0, rw, rh, Math.cos(a) * rr, Math.sin(a) * rr, rw, rh);
        }
      }
      cc.drawImage(A, 0, 0, rw, rh, 0, 0, rw, rh);
      cc.globalCompositeOperation = 'source-in';
      cc.fillStyle = o.outlineColor || '#ffffff';
      cc.fillRect(0, 0, rw, rh);
      silhouette = C;
    }
    if (o.shadow) {
      const sc = shadowScale(o, vs);
      const s = o.shadow;
      ctx.save();
      shadowPassFrom(ctx, silhouette, rw, rh, x0, y0, FAR, s.color, (s.blur * sc) / 2, s.offsetX * sc, s.offsetY * sc);
      ctx.restore();
    }
    if (o.glowSize > 0) {
      ctx.save();
      const passes = Math.max(1, Math.round((o.glowStrength ?? 60) / 34));
      for (let i = 0; i < passes; i++) shadowPassFrom(ctx, silhouette, rw, rh, x0, y0, FAR, o.glowColor || '#ffd76a', o.glowSize * vs, 0, 0);
      ctx.restore();
    }
    if (silhouette !== A) ctx.drawImage(silhouette, 0, 0, rw, rh, x0, y0, rw, rh);
    ctx.drawImage(A, 0, 0, rw, rh, x0, y0, rw, rh);
    ctx.restore();
  } finally {
    depth--;
  }
}

function shadowPassFrom(ctx, src, rw, rh, x0, y0, far, color, blur, ox, oy) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = ox + far;
  ctx.shadowOffsetY = oy;
  ctx.drawImage(src, 0, 0, rw, rh, x0 - far, y0, rw, rh);
}

// ---------- Warp ----------

/**
 * Where a column at u (0 to 1 across) goes: its shift from the top edge and its
 * height, in the object's units. `d` is the bend reach; positive bends upward.
 */
function warpAt(style, u, d, bh) {
  const p = 1 - (2 * u - 1) ** 2; // 0 at the sides, 1 in the middle
  const min = bh * 0.05;
  switch (style) {
    case 'arc':
      return [-d * p, bh];
    case 'arch':
      return [-d * p, Math.max(min, bh + d * p)];
    case 'bulge':
      return [(-d * p) / 2, Math.max(min, bh + d * p)];
    case 'flag':
      return [-d * 0.5 * Math.sin(2 * Math.PI * u), bh];
    case 'wave':
      return [-d * 0.5 * Math.sin(4 * Math.PI * u), bh];
    case 'rise':
      return [-d * (0.5 - 0.5 * Math.cos(Math.PI * u) - 0.5), bh];
    default:
      return [0, bh];
  }
}

/** Draws the flat layer in thin columns, each moved and stretched by the warp. */
function drawWarped(c, L, lw, lh, bw, bh, style, d, span) {
  const n = Math.max(2, Math.min(900, lw));
  const sw = lw / n;
  const dw = bw / n;
  for (let i = 0; i < n; i++) {
    const x = -bw / 2 + (i + 0.5) * dw;
    const u = Math.min(1, Math.max(0, (x - span.x0) / span.w));
    const [off, hgt] = warpAt(style, u, d, bh);
    c.drawImage(L, i * sw, 0, sw, lh, -bw / 2 + i * dw, -bh / 2 + off, dw * 1.6, hgt);
  }
}

// ---------- Flattening ----------

/**
 * Draws objects into a new canvas covering `rect` (page units) at `scale` pixels
 * per page unit. With `plain`, opacity, blend, shadow, outline and glow are left
 * out, the way Photoshop copies a layer's pixels.
 */
export function rasterize(objs, rect, scale, { plain = false } = {}) {
  const w = Math.max(1, Math.ceil(rect.w * scale));
  const h = Math.max(1, Math.ceil(rect.h * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
  for (const o of objs) {
    if (!o.visible) continue;
    const cv = o.canvas;
    const skip = cv?.skipOffscreen;
    if (cv) cv.skipOffscreen = false;
    try {
      if (plain) withProps(o, { opacity: 1, shadow: null, globalCompositeOperation: 'source-over', outlineWidth: 0, glowSize: 0 }, () => o.render(ctx));
      else o.render(ctx);
    } finally {
      if (cv) cv.skipOffscreen = skip;
    }
  }
  return c;
}

/** Pixels per page unit that keeps a photo at its own resolution, within a size cap. */
export function nativeScale(objs, rect) {
  let s = 1;
  for (const o of objs) {
    if (o.type === 'image') s = Math.max(s, 1 / Math.max(0.01, Math.min(Math.abs(o.scaleX), Math.abs(o.scaleY))));
    else s = Math.max(s, 2);
  }
  return Math.min(s, 4096 / Math.max(rect.w, rect.h, 1));
}

/** Page-unit box around objects, with room for their effects. */
export function boundsOf(objs, extra = 0) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of objs) {
    const r = o.getBoundingRect();
    const e = extra + effectMargin(o, 1) + (o.strokeWidth || 0);
    x0 = Math.min(x0, r.left - e);
    y0 = Math.min(y0, r.top - e);
    x1 = Math.max(x1, r.left + r.width + e);
    y1 = Math.max(y1, r.top + r.height + e);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Smallest box around the non-transparent pixels, or null if all clear. */
export function alphaBounds(c) {
  const { width: w, height: h } = c;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 2) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function cropCanvas(c, r) {
  const out = document.createElement('canvas');
  out.width = r.w;
  out.height = r.h;
  out.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return out;
}

export const canvasBlob = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('picture could not be made'))), 'image/png'));

/** Transform from page units into an object's mask pixels (mask covers the object's box). */
export function pageToMask(o, mw, mh) {
  const m = new DOMMatrix(o.calcTransformMatrix());
  return new DOMMatrix([mw / o.width, 0, 0, mh / o.height, mw / 2, mh / 2]).multiply(m.inverse());
}

/** Mask size for an object: its on-page size at up to 2x, capped. */
export function maskSizeFor(o) {
  const s = Math.min(2, 2048 / Math.max(o.getScaledWidth(), o.getScaledHeight(), 1));
  return [Math.max(8, Math.round(o.getScaledWidth() * s)), Math.max(8, Math.round(o.getScaledHeight() * s))];
}
