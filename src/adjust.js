import * as fabric from 'fabric';

// Photo adjustments as one Fabric filter, so every setting is applied in a single
// pass over the pixels and saves with the design: levels, curves, brightness,
// contrast, warmth, tint, saturation, colour grading, fade, vignette, sharpen and blur.
// The 2d backend is used instead of WebGL since WebGL filters stop at 2048 px tiles
// and phone photos are larger.

fabric.setFilterBackend(new fabric.Canvas2dFilterBackend());

export const NEUTRAL = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  tint: 0,
  fade: 0,
  vignette: 0,
  sharpen: 0,
  blur: 0,
  levels: { black: 0, gamma: 1, white: 255 },
  curves: { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] },
  shadowsColor: '#1e5a6e',
  shadowsAmount: 0,
  highlightsColor: '#f0a060',
  highlightsAmount: 0,
  balance: 0,
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

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
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Box blur, three passes (close to a gaussian). Works on RGB, leaves alpha. */
function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const out = new Uint8ClampedArray(src);
  const tmp = new Uint8ClampedArray(src.length);
  const pass = (from, to, horizontal) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const div = 2 * r + 1;
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        const at = (i) => {
          const j = Math.min(len - 1, Math.max(0, i));
          return horizontal ? (line * w + j) * 4 + c : (j * w + line) * 4 + c;
        };
        for (let i = -r; i <= r; i++) sum += from[at(i)];
        for (let i = 0; i < len; i++) {
          to[at(i)] = sum / div;
          sum += from[at(i + r + 1)] - from[at(i - r)];
        }
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(out, tmp, true);
    pass(tmp, out, false);
  }
  return out;
}

/** Applies adjustment settings to RGBA pixels in place. Used by the filter and the Looks thumbnails. */
export function adjustPixels(data, w, h, p) {
  const s = { ...NEUTRAL, ...p };
  // Blur and sharpen work on neighbouring pixels, so they run first.
  const minSide = Math.min(w, h);
  if (s.blur > 0) {
    const blurred = boxBlur(data, w, h, Math.max(1, Math.round((s.blur / 100) * minSide * 0.02)));
    for (let i = 0; i < data.length; i += 4) {
      data[i] = blurred[i];
      data[i + 1] = blurred[i + 1];
      data[i + 2] = blurred[i + 2];
    }
  }
  if (s.sharpen > 0) {
    const soft = boxBlur(data, w, h, Math.max(1, Math.round(minSide / 800)));
    const k = (s.sharpen / 100) * 1.5;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp(data[i] + k * (data[i] - soft[i]));
      data[i + 1] = clamp(data[i + 1] + k * (data[i + 1] - soft[i + 1]));
      data[i + 2] = clamp(data[i + 2] + k * (data[i + 2] - soft[i + 2]));
    }
  }

  // Per-channel tables: levels, curves, brightness, contrast, warmth and tint.
  const { black, gamma, white } = s.levels;
  const master = curveTable(s.curves.rgb);
  const chan = [curveTable(s.curves.r), curveTable(s.curves.g), curveTable(s.curves.b)];
  const c = s.contrast * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const shift = [s.warmth * 0.3, -s.tint * 0.25, -s.warmth * 0.3];
  const lut = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
  for (let v = 0; v < 256; v++) {
    let x = Math.min(1, Math.max(0, (v - black) / Math.max(1, white - black)));
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
  const sh = hexRgb(s.shadowsColor);
  const hi = hexRgb(s.highlightsColor);
  const sa = s.shadowsAmount / 100;
  const ha = s.highlightsAmount / 100;
  const bal = s.balance / 100;
  const fade = s.fade / 100;
  const vig = s.vignette / 100;
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let r = lut[0][data[i]];
      let g = lut[1][data[i + 1]];
      let b = lut[2][data[i + 2]];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (sat !== 1) {
        r = lum + (r - lum) * sat;
        g = lum + (g - lum) * sat;
        b = lum + (b - lum) * sat;
      }
      if (sa || ha) {
        // Colour grading: tint the shadows and the highlights toward their colours.
        const t = Math.min(1, Math.max(0, lum / 255 - bal * 0.5));
        const ws = sa * (1 - t) * (1 - t);
        const wh = ha * t * t;
        r += (sh[0] - 128) * ws * 0.7 + (hi[0] - 128) * wh * 0.7;
        g += (sh[1] - 128) * ws * 0.7 + (hi[1] - 128) * wh * 0.7;
        b += (sh[2] - 128) * ws * 0.7 + (hi[2] - 128) * wh * 0.7;
      }
      if (fade) {
        const k = 1 - fade * 0.16;
        r = r * k + 255 * fade * 0.12;
        g = g * k + 255 * fade * 0.12;
        b = b * k + 255 * fade * 0.12;
      }
      if (vig) {
        const dist = Math.hypot(x - cx, y - cy) / maxD;
        const t = Math.min(1, Math.max(0, (dist - 0.35) / 0.65));
        const f = 1 - vig * 0.85 * t * t * (3 - 2 * t);
        r *= f;
        g *= f;
        b *= f;
      }
      data[i] = clamp(r);
      data[i + 1] = clamp(g);
      data[i + 2] = clamp(b);
    }
  }
}

export class Adjust extends fabric.filters.BaseFilter {
  static type = 'Adjust';
  static defaults = clone(NEUTRAL);

  constructor(options) {
    super(options);
    // Nested settings are copied so photos never share one levels or curves object.
    this.levels = clone(this.levels);
    this.curves = clone(this.curves);
  }

  applyTo2d({ imageData }) {
    adjustPixels(imageData.data, imageData.width, imageData.height, this);
  }

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
