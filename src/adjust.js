import * as fabric from 'fabric';

// Photo adjustments as one Fabric filter, so every setting is applied in a single
// pass over the pixels and saves with the design. The same code runs for an
// adjustment layer over everything below it.
//
// Exposure, highlights and shadows, whites and blacks, vibrance, clarity,
// texture, dehaze, the colour mixer, grain, noise reduction and auto tone follow
// the methods of LightCraft (github.com/storytold/lightcraft, MIT or Apache 2.0),
// rewritten here for the canvas.
//
// The 2d backend is used instead of WebGL since WebGL filters stop at 2048 px
// tiles and phone photos are larger.

import { applyLut } from './lut.js';
import { lutFor } from './luts.js';

fabric.setFilterBackend(new fabric.Canvas2dFilterBackend());

const zero8 = () => [0, 0, 0, 0, 0, 0, 0, 0];

export const NEUTRAL = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  clarity: 0,
  texture: 0,
  dehaze: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  grainSize: 25,
  sharpen: 0,
  denoise: 0,
  colorNoise: 0,
  blur: 0,
  motion: 0,
  motionAngle: 0,
  tilt: 0,
  tiltPos: 50,
  tiltBand: 30,
  pixelate: 0,
  levels: { black: 0, gamma: 1, white: 255 },
  curves: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
  mixer: { hue: zero8(), sat: zero8(), lum: zero8() },
  bw: false,
  bwMix: zero8(),
  shadowsColor: '#1e5a6e',
  shadowsAmount: 0,
  highlightsColor: '#f0a060',
  highlightsAmount: 0,
  balance: 0,
  filterColor: '#ec8a00',
  filterAmount: 0,
  lut: null, // { url, name }
  lutAmount: 100,
};

/** The eight colour bands of the mixer, with the hue each one centres on. */
export const BANDS = [
  ['Red', 0, '#e0443a'],
  ['Orange', 30, '#ef8a2a'],
  ['Yellow', 60, '#e8c530'],
  ['Green', 120, '#3aa655'],
  ['Aqua', 180, '#2bb3b8'],
  ['Blue', 240, '#2f6bd6'],
  ['Purple', 270, '#8a4fd0'],
  ['Magenta', 300, '#d045a6'],
];

const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Monotone cubic curve through control points, as a 256-entry table. */
export function curveTable(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const lut = new Float32Array(256);
  if (n < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let k = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) {
      lut[x] = ys[0];
      continue;
    }
    if (x >= xs[n - 1]) {
      lut[x] = ys[n - 1];
      continue;
    }
    while (k < n - 2 && x > xs[k + 1]) k++;
    const hgt = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / hgt;
    const t2 = t * t;
    const t3 = t2 * t;
    lut[x] = clamp(
      (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * hgt * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * hgt * m[k + 1],
    );
  }
  return lut;
}

const hexRgb = (hex) => {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ---------- Blurs ----------

/** One horizontal and one vertical box pass over a float channel, edges clamped. */
function boxPass(src, dst, w, h, r) {
  const div = 1 / (2 * r + 1);
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = src[row] * (r + 1);
    for (let i = 1; i <= r; i++) sum += src[row + Math.min(i, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * div;
      sum += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = tmp[x] * (r + 1);
    for (let i = 1; i <= r; i++) sum += tmp[Math.min(i, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * div;
      sum += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
}

/** Gaussian-like blur of a float channel. Large radii run on a smaller copy. */
function blurF(src, w, h, r) {
  r = Math.max(0, r);
  if (r < 0.5) return src.slice();
  const f = r > 8 ? Math.min(Math.floor(r / 4), Math.floor(Math.min(w, h) / 8)) : 1;
  if (f <= 1) {
    const out = new Float32Array(src.length);
    const ri = Math.max(1, Math.round(r / 1.7));
    boxPass(src, out, w, h, ri);
    boxPass(out, out, w, h, ri);
    return out;
  }
  // Average f×f blocks, blur the small copy, then scale it back up smoothly.
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const small = new Float32Array(sw * sh);
  const cnt = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const sy = (y / f) | 0;
    for (let x = 0; x < w; x++) {
      const i = sy * sw + ((x / f) | 0);
      small[i] += src[y * w + x];
      cnt[i]++;
    }
  }
  for (let i = 0; i < small.length; i++) small[i] /= cnt[i];
  const ri = Math.max(1, Math.round(r / f / 1.7));
  boxPass(small, small, sw, sh, ri);
  boxPass(small, small, sw, sh, ri);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = fy | 0;
    const y1 = Math.min(sh - 1, y0 + 1);
    const ay = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = fx | 0;
      const x1 = Math.min(sw - 1, x0 + 1);
      const ax = fx - x0;
      const top = small[y0 * sw + x0] * (1 - ax) + small[y0 * sw + x1] * ax;
      const bot = small[y1 * sw + x0] * (1 - ax) + small[y1 * sw + x1] * ax;
      out[y * w + x] = top * (1 - ay) + bot * ay;
    }
  }
  return out;
}

function channels(data) {
  const n = data.length / 4;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    r[j] = data[i];
    g[j] = data[i + 1];
    b[j] = data[i + 2];
  }
  return [r, g, b];
}

function blurRGB(data, w, h, r) {
  const [R, G, B] = channels(data).map((c) => blurF(c, w, h, r));
  for (let i = 0, j = 0; j < R.length; i += 4, j++) {
    data[i] = R[j];
    data[i + 1] = G[j];
    data[i + 2] = B[j];
  }
}

function luma(data) {
  const n = data.length / 4;
  const L = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) L[j] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  return L;
}

// ---------- Spatial steps ----------

function pixelate(data, w, h, bs, ox, oy) {
  const sx0 = ((ox % bs) + bs) % bs;
  const sy0 = ((oy % bs) + bs) % bs;
  for (let by = -sy0; by < h; by += bs) {
    for (let bx = -sx0; bx < w; bx += bs) {
      const x0 = Math.max(0, bx);
      const y0 = Math.max(0, by);
      const x1 = Math.min(w, bx + bs);
      const y1 = Math.min(h, by + bs);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      if (!n) continue;
      r /= n;
      g /= n;
      b /= n;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    }
  }
}

function motionBlur(data, w, h, dist, angle) {
  const n = Math.max(2, Math.min(24, Math.ceil(dist)));
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const src = data.slice();
  const offs = [];
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1) - 0.5) * dist;
    offs.push([Math.round(dx * t), Math.round(dy * t)]);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [ox, oy] of offs) {
        const xx = Math.min(w - 1, Math.max(0, x + ox));
        const yy = Math.min(h - 1, Math.max(0, y + oy));
        const i = (yy * w + xx) * 4;
        r += src[i];
        g += src[i + 1];
        b += src[i + 2];
      }
      const i = (y * w + x) * 4;
      data[i] = r / n;
      data[i + 1] = g / n;
      data[i + 2] = b / n;
    }
  }
}

/** Self-guided filter on the luminance: smooths flat areas and keeps edges. */
function denoiseL(data, w, h, amount, minSide) {
  const L = luma(data);
  const r = Math.max(1, Math.round(1 + (amount / 100) * 2.5 * Math.max(1, minSide / 1200)));
  const eps = ((amount / 100) * 0.07) ** 2 + 1e-5;
  const L2 = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) L2[i] = L[i] * L[i];
  const mean = new Float32Array(L.length);
  const mean2 = new Float32Array(L.length);
  boxPass(L, mean, w, h, r);
  boxPass(L2, mean2, w, h, r);
  const A = new Float32Array(L.length);
  const B = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) {
    const v = mean2[i] - mean[i] * mean[i];
    A[i] = v / (v + eps);
    B[i] = mean[i] * (1 - A[i]);
  }
  boxPass(A, A, w, h, r);
  boxPass(B, B, w, h, r);
  for (let i = 0, j = 0; j < L.length; i += 4, j++) {
    const d = (A[j] * L[j] + B[j] - L[j]) * 255;
    data[i] = clamp(data[i] + d);
    data[i + 1] = clamp(data[i + 1] + d);
    data[i + 2] = clamp(data[i + 2] + d);
  }
}

/** Blurs the colour, not the brightness, so colour speckle fades and detail stays. */
function denoiseColor(data, w, h, amount, minSide) {
  const n = data.length / 4;
  const Y = new Float32Array(n);
  const Cr = new Float32Array(n);
  const Cb = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    Y[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    Cr[j] = data[i] - Y[j];
    Cb[j] = data[i + 2] - Y[j];
  }
  const r = Math.max(1, (amount / 100) * minSide * 0.006);
  const cr = blurF(Cr, w, h, r);
  const cb = blurF(Cb, w, h, r);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const R = Y[j] + cr[j];
    const B = Y[j] + cb[j];
    data[i] = clamp(R);
    data[i + 2] = clamp(B);
    data[i + 1] = clamp((Y[j] - 0.2126 * R - 0.0722 * B) / 0.7152);
  }
}

/** Dark-channel dehaze: estimates the haze colour and how much of it each area holds. */
function dehaze(data, w, h, amount) {
  const f = Math.max(1, Math.round(Math.min(w, h) / 160));
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const dark = new Float32Array(sw * sh).fill(1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const m = Math.min(data[i], data[i + 1], data[i + 2]) / 255;
      const k = ((y / f) | 0) * sw + ((x / f) | 0);
      if (m < dark[k]) dark[k] = m;
    }
  }
  // The haze colour: the average of the brightest patches of the dark channel.
  const order = [...dark.keys()].sort((a, b) => dark[b] - dark[a]).slice(0, Math.max(1, Math.round(dark.length * 0.002)));
  let A = 0;
  for (const k of order) A += dark[k];
  A = Math.max(0.5, Math.min(1, A / order.length + 0.05));
  const t = blurF(dark, sw, sh, 2);
  const a = amount / 100;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = fy | 0;
    const y1 = Math.min(sh - 1, y0 + 1);
    const ay = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = fx | 0;
      const x1 = Math.min(sw - 1, x0 + 1);
      const ax = fx - x0;
      const d = (t[y0 * sw + x0] * (1 - ax) + t[y0 * sw + x1] * ax) * (1 - ay) + (t[y1 * sw + x0] * (1 - ax) + t[y1 * sw + x1] * ax) * ay;
      const i = (y * w + x) * 4;
      const Av = A * 255;
      if (a > 0) {
        const tr = Math.max(0.2, 1 - 0.9 * a * (d / A));
        data[i] = clamp((data[i] - Av) / tr + Av);
        data[i + 1] = clamp((data[i + 1] - Av) / tr + Av);
        data[i + 2] = clamp((data[i + 2] - Av) / tr + Av);
      } else {
        const k = -a * 0.55;
        data[i] = data[i] + (Av - data[i]) * k;
        data[i + 1] = data[i + 1] + (Av - data[i + 1]) * k;
        data[i + 2] = data[i + 2] + (Av - data[i + 2]) * k;
      }
    }
  }
}

// ---------- Colour mixer ----------

/** How much each of the eight bands owns a hue (0 to 360). The weights add up to 1. */
function bandWeights(hue) {
  const w = new Float32Array(8);
  const centres = [0, 30, 60, 120, 180, 240, 270, 300, 360];
  for (let i = 0; i < 8; i++) {
    const a = centres[i];
    const b = centres[i + 1];
    if (hue >= a && hue <= b) {
      const t = (hue - a) / (b - a);
      w[i] += 1 - t;
      w[(i + 1) % 8] += t;
      break;
    }
  }
  return w;
}

const mixerActive = (m) => m && [...m.hue, ...m.sat, ...m.lum].some((v) => v);

/** A 360-entry table of [hue shift, saturation scale, lightness shift]. */
function mixerTable(s) {
  const t = new Float32Array(360 * 3);
  for (let hdeg = 0; hdeg < 360; hdeg++) {
    const w = bandWeights(hdeg);
    let dh = 0;
    let ds = 0;
    let dl = 0;
    for (let i = 0; i < 8; i++) {
      dh += w[i] * (s.mixer.hue[i] / 100) * 30;
      ds += w[i] * (s.mixer.sat[i] / 100);
      dl += w[i] * ((s.bw ? s.bwMix[i] : s.mixer.lum[i]) / 100);
    }
    t[hdeg * 3] = dh;
    t[hdeg * 3 + 1] = 1 + ds;
    t[hdeg * 3 + 2] = dl * 0.35;
  }
  return t;
}

function rgbToHsl(r, g, b, out) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hh = 0;
  let s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
  }
  out[0] = hh;
  out[1] = s;
  out[2] = l;
}

function hue2(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(hh, s, l, out) {
  if (s <= 0) {
    out[0] = out[1] = out[2] = l;
    return;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const k = hh / 360;
  out[0] = hue2(p, q, k + 1 / 3);
  out[1] = hue2(p, q, k);
  out[2] = hue2(p, q, k - 1 / 3);
}

// ---------- Grain ----------

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise at cell size `c`, from -1 to 1. */
function noiseAt(x, y, c) {
  const fx = x / c;
  const fy = y / c;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const ax = fx - x0;
  const ay = fy - y0;
  const sx = ax * ax * (3 - 2 * ax);
  const sy = ay * ay * (3 - 2 * ay);
  const a = hash(x0, y0) * (1 - sx) + hash(x0 + 1, y0) * sx;
  const b = hash(x0, y0 + 1) * (1 - sx) + hash(x0 + 1, y0 + 1) * sx;
  return (a * (1 - sy) + b * sy) * 2 - 1;
}

// ---------- The whole pass ----------

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * Applies adjustment settings to RGBA pixels in place. Used by the photo filter,
 * adjustment layers and the Looks thumbnails. `geom` places the pixels on the
 * page for adjustment layers: { ox, oy } is the page origin's offset in pixels
 * and { pw, ph } the page size in pixels, so the vignette, grain and blur sizes
 * follow the page and not the visible part of it.
 */
export function adjustPixels(data, w, h, p, geom) {
  const s = { ...NEUTRAL, ...p };
  if (!s.mixer?.hue) s.mixer = NEUTRAL.mixer;
  if (!s.bwMix?.length) s.bwMix = NEUTRAL.bwMix;
  const g = geom || { ox: 0, oy: 0, pw: w, ph: h };
  const minSide = Math.min(g.pw, g.ph);

  // Steps that look at neighbouring pixels come first.
  if (s.pixelate > 0) pixelate(data, w, h, Math.max(2, Math.round((s.pixelate / 100) * minSide * 0.06)), Math.round(g.ox), Math.round(g.oy));
  if (s.motion > 0) motionBlur(data, w, h, (s.motion / 100) * minSide * 0.06, s.motionAngle || 0);
  if (s.blur > 0) blurRGB(data, w, h, (s.blur / 100) * minSide * 0.02);
  if (s.tilt > 0) {
    const sharp = data.slice();
    blurRGB(data, w, h, (s.tilt / 100) * minSide * 0.025);
    const yc = (s.tiltPos / 100) * g.ph - g.oy;
    const half = ((s.tiltBand / 100) * g.ph) / 2;
    const fade = g.ph * 0.22;
    for (let y = 0; y < h; y++) {
      const k = clamp01((Math.abs(y - yc) - half) / fade);
      const keep = 1 - k * k * (3 - 2 * k);
      if (keep <= 0) continue;
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        data[i] = sharp[i] * keep + data[i] * (1 - keep);
        data[i + 1] = sharp[i + 1] * keep + data[i + 1] * (1 - keep);
        data[i + 2] = sharp[i + 2] * keep + data[i + 2] * (1 - keep);
      }
    }
  }
  if (s.denoise > 0) denoiseL(data, w, h, s.denoise, minSide);
  if (s.colorNoise > 0) denoiseColor(data, w, h, s.colorNoise, minSide);
  if (s.dehaze) dehaze(data, w, h, s.dehaze);
  if (s.sharpen > 0) {
    const L = luma(data);
    const soft = blurF(L, w, h, Math.max(1, minSide / 700));
    const k = (s.sharpen / 100) * 1.6 * 255;
    for (let i = 0, j = 0; j < L.length; i += 4, j++) {
      const d = (L[j] - soft[j]) * k;
      data[i] = clamp(data[i] + d);
      data[i + 1] = clamp(data[i + 1] + d);
      data[i + 2] = clamp(data[i + 2] + d);
    }
  }
  if (s.clarity || s.texture || s.highlights || s.shadows) {
    const L = luma(data);
    const base = s.highlights || s.shadows ? blurF(L, w, h, minSide * 0.025) : null;
    const mid = s.clarity ? blurF(L, w, h, minSide * 0.012) : null;
    const fine = s.texture ? blurF(L, w, h, Math.max(1, minSide * 0.0028)) : null;
    const hl = s.highlights / 100;
    const sh = s.shadows / 100;
    const cl = s.clarity / 100;
    const tx = s.texture / 100;
    for (let i = 0, j = 0; j < L.length; i += 4, j++) {
      let add = 0;
      let mul = 1;
      if (base) {
        const t = base[j];
        const ws = clamp01((0.62 - t) / 0.62) ** 1.6;
        const wh = clamp01((t - 0.38) / 0.62) ** 1.6;
        const delta = sh * 0.32 * ws + hl * 0.3 * wh;
        mul = Math.min(4, Math.max(0.25, 1 + delta / Math.max(t, 0.09)));
      }
      if (mid) {
        const l = L[j];
        const wm = 1 - (2 * l - 1) ** 2;
        add += cl * 1.3 * (l - mid[j]) * (0.35 + 0.65 * wm) * 255;
      }
      if (fine) {
        const d = L[j] - fine[j];
        add += (tx * 1.8 * d * 255) / (1 + Math.abs(d) * 10);
      }
      data[i] = clamp(data[i] * mul + add);
      data[i + 1] = clamp(data[i + 1] * mul + add);
      data[i + 2] = clamp(data[i + 2] * mul + add);
    }
  }

  // Per-channel tables: exposure, whites and blacks, levels, curves, brightness,
  // contrast, warmth and tint.
  const { black, gamma, white } = s.levels;
  const master = curveTable(s.curves.rgb);
  const chan = [curveTable(s.curves.r), curveTable(s.curves.g), curveTable(s.curves.b)];
  const c = s.contrast * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const shift = [s.warmth * 0.3, -s.tint * 0.25, -s.warmth * 0.3];
  const ev = 2 ** (s.exposure / 50);
  const wh = s.whites / 100;
  const bl = s.blacks / 100;
  const lut = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  for (let v = 0; v < 256; v++) {
    let x = v / 255;
    if (ev !== 1) {
      let lin = toLin(x) * ev;
      // A soft shoulder so bright areas roll off instead of clipping hard.
      if (lin > 0.8) lin = 0.8 + 0.2 * (1 - Math.exp(-(lin - 0.8) / 0.2));
      x = toGamma(lin);
    }
    if (wh) x += wh * 0.28 * x ** 3 * (wh > 0 ? 1 - x * 0.5 : 1);
    if (bl) x += bl * 0.22 * (1 - x) ** 3;
    x = Math.min(1, Math.max(0, (x * 255 - black) / Math.max(1, white - black)));
    x = Math.pow(x, 1 / Math.max(0.1, gamma)) * 255;
    x = master[Math.round(clamp(x))];
    for (let ch = 0; ch < 3; ch++) {
      let y = chan[ch][Math.round(clamp(x))];
      y += s.brightness * 1.28;
      y = cf * (y - 128) + 128;
      y += shift[ch];
      lut[ch][v] = clamp(y);
    }
  }

  const sat = 1 + s.saturation / 100;
  const vib = s.vibrance / 100;
  const sh = hexRgb(s.shadowsColor);
  const hi = hexRgb(s.highlightsColor);
  const sa = s.shadowsAmount / 100;
  const ha = s.highlightsAmount / 100;
  const bal = s.balance / 100;
  const fc = hexRgb(s.filterColor);
  const fa = s.filterAmount / 100;
  const mix = mixerActive(s.mixer) || (s.bw && s.bwMix.some((v) => v)) ? mixerTable(s) : null;
  const useHsl = !!mix || vib !== 0;
  const hsl = new Float32Array(3);
  const rgb = new Float32Array(3);
  for (let i = 0; i < data.length; i += 4) {
    let r = lut[0][data[i]];
    let gg = lut[1][data[i + 1]];
    let b = lut[2][data[i + 2]];
    if (useHsl) {
      rgbToHsl(r / 255, gg / 255, b / 255, hsl);
      let [hh, ss, ll] = hsl;
      if (mix) {
        const k = Math.round(hh) % 360;
        // Greys have no hue, so the mixer leaves them alone.
        const weight = Math.min(1, ss * 2.2);
        hh = (hh + mix[k * 3] * weight + 360) % 360;
        ss = clamp01(ss * (1 + (mix[k * 3 + 1] - 1) * weight));
        ll = clamp01(ll + mix[k * 3 + 2] * weight * (s.bw ? 1.4 : 1) * (1 - Math.abs(2 * ll - 1) * 0.5));
      }
      if (vib) {
        const skin = hh > 8 && hh < 50 ? 0.55 : 1;
        ss = clamp01(ss * (1 + vib * (vib > 0 ? (1 - ss) ** 2 * skin * 1.4 : 1)));
      }
      hslToRgb(hh, ss, ll, rgb);
      r = rgb[0] * 255;
      gg = rgb[1] * 255;
      b = rgb[2] * 255;
    }
    const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    if (s.bw) {
      r = gg = b = lum;
    } else if (sat !== 1) {
      r = lum + (r - lum) * sat;
      gg = lum + (gg - lum) * sat;
      b = lum + (b - lum) * sat;
    }
    if (sa || ha) {
      // Colour grading: tint the shadows and the highlights toward their colours.
      const t = Math.min(1, Math.max(0, lum / 255 - bal * 0.5));
      const ws = sa * (1 - t) * (1 - t);
      const wh2 = ha * t * t;
      r += (sh[0] - 128) * ws * 0.7 + (hi[0] - 128) * wh2 * 0.7;
      gg += (sh[1] - 128) * ws * 0.7 + (hi[1] - 128) * wh2 * 0.7;
      b += (sh[2] - 128) * ws * 0.7 + (hi[2] - 128) * wh2 * 0.7;
    }
    if (fa) {
      // Photo filter: a coloured glass over the lens, keeping the brightness.
      const tr = (r * fc[0]) / 255;
      const tg = (gg * fc[1]) / 255;
      const tb = (b * fc[2]) / 255;
      const tl = Math.max(1, 0.2126 * tr + 0.7152 * tg + 0.0722 * tb);
      const k = Math.max(0.0001, 0.2126 * r + 0.7152 * gg + 0.0722 * b) / tl;
      r += (tr * k - r) * fa;
      gg += (tg * k - gg) * fa;
      b += (tb * k - b) * fa;
    }
    data[i] = clamp(r);
    data[i + 1] = clamp(gg);
    data[i + 2] = clamp(b);
  }

  if (s.lut?.url) {
    const cube = lutFor(s.lut.url);
    if (cube) applyLut(data, cube, (s.lutAmount ?? 100) / 100);
  }

  const fade = s.fade / 100;
  const vig = s.vignette / 100;
  const grain = s.grain / 100;
  if (!fade && !vig && !grain) return;
  const cx = g.pw / 2 - g.ox;
  const cy = g.ph / 2 - g.oy;
  const maxD = Math.hypot(g.pw / 2, g.ph / 2);
  const cell = Math.max(0.6, ((s.grainSize ?? 25) / 100) * minSide * 0.004 + 0.4);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let r = data[i];
      let gg = data[i + 1];
      let b = data[i + 2];
      if (fade) {
        const k = 1 - fade * 0.16;
        r = r * k + 255 * fade * 0.12;
        gg = gg * k + 255 * fade * 0.12;
        b = b * k + 255 * fade * 0.12;
      }
      if (vig) {
        const dist = Math.hypot(x - cx, y - cy) / maxD;
        const t = Math.min(1, Math.max(0, (dist - 0.35) / 0.65));
        const f = 1 - vig * 0.85 * t * t * (3 - 2 * t);
        r *= f;
        gg *= f;
        b *= f;
      }
      if (grain) {
        const l = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
        const n = noiseAt(x + g.ox, y + g.oy, cell) * grain * 46 * (1 - Math.abs(2 * l - 1) * 0.6);
        r += n;
        gg += n;
        b += n;
      }
      data[i] = clamp(r);
      data[i + 1] = clamp(gg);
      data[i + 2] = clamp(b);
    }
  }
}

// ---------- Auto ----------

/**
 * Auto tone and auto colour from a picture's pixels: exposure from the average
 * brightness, whites and blacks from the ends of the histogram, and warmth and
 * tint so the average colour comes out grey.
 */
export function autoSettings(el, { tone = true, color = true } = {}) {
  const sc = Math.min(1, 300 / Math.max(el.naturalWidth || el.width, el.naturalHeight || el.height));
  const w = Math.max(1, Math.round((el.naturalWidth || el.width) * sc));
  const hh = Math.max(1, Math.round((el.naturalHeight || el.height) * sc));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = hh;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(el, 0, 0, w, hh);
  const d = x.getImageData(0, 0, w, hh).data;
  const hist = new Uint32Array(256);
  let n = 0;
  let lin = 0;
  let R = 0;
  let G = 0;
  let B = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    hist[Math.round(l)]++;
    lin += Math.log(Math.max(1e-4, toLin(l / 255)));
    R += d[i];
    G += d[i + 1];
    B += d[i + 2];
    n++;
  }
  if (!n) return {};
  const out = {};
  if (tone) {
    const pct = (q) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= q * n) return v;
      }
      return 255;
    };
    const lo = pct(0.005);
    const hi = pct(0.995);
    const key = Math.exp(lin / n); // average brightness on a log scale
    const evs = Math.max(-1.5, Math.min(1.5, Math.log2(0.18 / Math.max(1e-4, key)) * 0.7));
    out.exposure = Math.round(evs * 50);
    out.whites = Math.round(Math.max(-40, Math.min(60, (245 - hi) * 1.2)));
    out.blacks = Math.round(Math.max(-60, Math.min(40, (lo - 8) * -1.2)));
    out.contrast = Math.round(Math.max(-10, Math.min(25, (180 - (hi - lo)) / 6)));
    out.highlights = hi > 250 ? -25 : 0;
    out.shadows = lo < 6 ? 15 : 0;
    out.vibrance = 12;
  }
  if (color) {
    R /= n;
    G /= n;
    B /= n;
    out.warmth = Math.round(Math.max(-60, Math.min(60, (B - R) / 0.6 / 1.4)));
    out.tint = Math.round(Math.max(-60, Math.min(60, (G - (R + B) / 2) / 0.25 / 1.6)));
  }
  return out;
}

/** Goes up each time a photo is filtered, so adjustment layers above it redraw. */
export let filterRev = 0;
export const bumpFilterRev = () => filterRev++;

export class Adjust extends fabric.filters.BaseFilter {
  static type = 'Adjust';
  static defaults = clone(NEUTRAL);

  constructor(options) {
    super(options);
    // Nested settings are copied so photos never share one levels or curves object.
    this.levels = clone(this.levels);
    this.curves = clone(this.curves);
    this.mixer = clone(this.mixer || NEUTRAL.mixer);
    this.bwMix = clone(this.bwMix || NEUTRAL.bwMix);
    this.lut = this.lut ? clone(this.lut) : null;
  }

  applyTo2d({ imageData }) {
    filterRev++;
    adjustPixels(imageData.data, imageData.width, imageData.height, this);
  }

  // A filter whose LUT is still loading gets drawn again once it arrives.
  isNeutralState() {
    return isNeutral(this);
  }
}
fabric.classRegistry.setClass(Adjust);

export function isNeutral(p) {
  return JSON.stringify(settingsOf(p)) === JSON.stringify(NEUTRAL);
}

export function settingsOf(p) {
  const out = {};
  for (const k of Object.keys(NEUTRAL)) out[k] = clone(p?.[k] ?? NEUTRAL[k]);
  return out;
}

export const LOOKS = [
  { name: 'None', set: {} },
  { name: 'Vivid', set: { contrast: 15, saturation: 30 } },
  { name: 'Warm', set: { warmth: 30, saturation: 8 } },
  { name: 'Cool', set: { warmth: -28, tint: -5 } },
  { name: 'Golden', set: { warmth: 35, contrast: 10, saturation: 8, highlightsColor: '#e0b45a', highlightsAmount: 60, shadowsColor: '#3a2412', shadowsAmount: 30 } },
  { name: 'Film', set: { shadowsColor: '#1e5a6e', shadowsAmount: 35, highlightsColor: '#f0a060', highlightsAmount: 30, contrast: 10 } },
  { name: 'Fade', set: { fade: 45, contrast: -10, saturation: -12 } },
  { name: 'B&W', set: { saturation: -100, contrast: 12 } },
  { name: 'Sepia', set: { saturation: -100, shadowsColor: '#3a2412', shadowsAmount: 50, highlightsColor: '#f2d6a0', highlightsAmount: 45 } },
  { name: 'Noir', set: { saturation: -100, contrast: 40, vignette: 45 } },
  { name: 'Soft skin', set: { brightness: 6, contrast: -8, warmth: 8, blur: 6, fade: 10 } },
  { name: 'Crisp', set: { sharpen: 45, contrast: 12, saturation: 8 } },
];

export function lookSettings(look) {
  return { ...clone(NEUTRAL), ...clone(look.set) };
}

/** The Adjust filter on a photo, created when missing. */
export function adjustOf(img) {
  let f = img.filters?.find((x) => x.type === 'Adjust');
  if (!f) {
    f = new Adjust();
    img.filters = [...(img.filters || []), f];
  }
  return f;
}

/** Histogram of a photo's original pixels, 256 bins per channel plus luminance. */
export function histogram(el) {
  const s = Math.min(1, 400 / Math.max(el.naturalWidth || el.width, el.naturalHeight || el.height));
  const w = Math.max(1, Math.round((el.naturalWidth || el.width) * s));
  const h = Math.max(1, Math.round((el.naturalHeight || el.height) * s));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(el, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const hist = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    hist.r[d[i]]++;
    hist.g[d[i + 1]]++;
    hist.b[d[i + 2]]++;
    hist.l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
  }
  return hist;
}
