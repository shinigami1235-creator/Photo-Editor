import { parseCube, lutFromImageFn } from './lut.js';
import { blobFor } from './assets.js';

// Colour lookup tables: .cube files added by the user, kept in the design as
// assets, plus a few built-in film looks made here in code.

const cache = new Map(); // url -> lut, or 'loading'
const listeners = new Set();
export const onLutLoaded = (fn) => listeners.add(fn);

const mixc = (a, b, t) => a + (b - a) * t;
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const s = (x) => x * x * (3 - 2 * x);

/** Built-in looks: name and a function from 0..1 RGB to 0..1 RGB. */
export const BUILT_IN = [
  {
    id: 'builtin:teal-orange',
    name: 'Teal and orange',
    fn: (r, g, b) => {
      const l = lumOf(r, g, b);
      const t = s(Math.min(1, Math.max(0, l)));
      return [mixc(r * 0.82, r * 1.08 + 0.04, t), mixc(g * 0.98 + 0.03, g * 0.98, t), mixc(b * 1.08 + 0.06, b * 0.82, t)];
    },
  },
  {
    id: 'builtin:warm-film',
    name: 'Warm film',
    fn: (r, g, b) => {
      const f = (v) => 0.06 + 0.88 * s(v);
      return [f(r) * 1.05 + 0.02, f(g) * 1.0 + 0.01, f(b) * 0.88 + 0.03];
    },
  },
  {
    id: 'builtin:cool-film',
    name: 'Cool film',
    fn: (r, g, b) => {
      const f = (v) => 0.05 + 0.9 * s(v);
      return [f(r) * 0.9 + 0.01, f(g) * 0.98 + 0.02, f(b) * 1.06 + 0.04];
    },
  },
  {
    id: 'builtin:bleach',
    name: 'Bleach bypass',
    fn: (r, g, b) => {
      const l = lumOf(r, g, b);
      const k = s(l);
      return [mixc(r, k, 0.55), mixc(g, k, 0.55), mixc(b, k, 0.55)].map((v) => s(Math.min(1, Math.max(0, v))));
    },
  },
  {
    id: 'builtin:matte',
    name: 'Matte',
    fn: (r, g, b) => [r, g, b].map((v) => 0.1 + v * 0.82),
  },
  {
    id: 'builtin:cross',
    name: 'Cross process',
    fn: (r, g, b) => [s(Math.min(1, r * 1.08)), Math.min(1, g * 1.04 + 0.02), b * 0.75 + 0.12],
  },
];

/** The parsed LUT for a url, or null while it loads (a redraw follows). */
export function lutFor(url) {
  const c = cache.get(url);
  if (c && c !== 'loading') return c;
  if (c === 'loading') return null;
  const b = BUILT_IN.find((x) => x.id === url);
  if (b) {
    const lut = lutFromImageFn(25, b.fn);
    cache.set(url, lut);
    return lut;
  }
  cache.set(url, 'loading');
  loadLut(url)
    .then((lut) => {
      cache.set(url, lut);
      listeners.forEach((fn) => fn(url));
    })
    .catch(() => cache.delete(url));
  return null;
}

async function loadLut(url) {
  const blob = blobFor(url);
  const text = blob ? await blob.text() : await (await fetch(url)).text();
  return parseCube(text);
}

/** Loads every LUT used by saved page objects, so an export draws them. */
export async function preloadLuts(objects) {
  const urls = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (v.lut?.url) urls.add(v.lut.url);
    Object.values(v).forEach(walk);
  };
  walk(objects);
  for (const u of urls) {
    if (lutFor(u)) continue;
    try {
      cache.set(u, await loadLut(u));
    } catch {
      cache.delete(u);
    }
  }
}
