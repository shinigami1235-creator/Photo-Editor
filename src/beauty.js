// Quick fixes for portraits: Enhance faces, Smooth skin, Bright eyes, Whiten
// teeth, Slim face and Slim body. Every fix renders from the photo as it was
// before the first fix (beautyBase), so amounts can change or go back to zero
// at any time.

import { detectFaces, alignFace, faceOvalMask, pasteFace } from './faces.js';
import { boxBlur, softBlur, blurAlphaCanvas, planes, grow, polygon, clamp01, smoothstep } from './pixels.js';
import { loadModel, runModel } from './bgremove.js';
import { modelBytes } from './platform.js';
import { loadImage, registerBlob } from './assets.js';

export const FIXES = [
  { id: 'enhance', label: 'Enhance faces', hint: 'Sharpens soft or small faces with the RestoreFormer++ model' },
  { id: 'smooth', label: 'Smooth skin', hint: 'Softens blotches and fine lines and keeps pores' },
  { id: 'eyes', label: 'Bright eyes', hint: 'Lifts and sharpens the eyes' },
  { id: 'teeth', label: 'Whiten teeth', hint: 'Takes the yellow out of teeth' },
  { id: 'slimFace', label: 'Slim face', hint: 'Narrows the jaw and lower cheeks' },
  { id: 'slimBody', label: 'Slim body', hint: 'Narrows the waist, hips and arms' },
];

// The amount each one-click fix sets. Glow up also runs Auto light and colour.
export const PRESETS = {
  glow: { label: 'Glow up', set: { enhance: 40, smooth: 45, eyes: 40, teeth: 35 } },
  enhance: { label: 'Enhance faces', set: { enhance: 70 } },
  smooth: { label: 'Smooth skin', set: { smooth: 55 } },
  eyes: { label: 'Bright eyes', set: { eyes: 60 } },
  teeth: { label: 'Whiten teeth', set: { teeth: 60 } },
  slimFace: { label: 'Slim face', set: { slimFace: 50 } },
  slimBody: { label: 'Slim body', set: { slimBody: 50 } },
};

export const NONE = { enhance: 0, smooth: 0, eyes: 0, teeth: 0, slimFace: 0, slimBody: 0 };
const FACE_FIXES = ['enhance', 'smooth', 'eyes', 'teeth', 'slimFace'];
export const isNone = (s) => !s || Object.keys(NONE).every((k) => !(s[k] > 0));

// ---------- Enhance faces ----------

let faceWorker = null;
let faceReady = null;
let faceCalls = 0;
const facePending = new Map();

function loadFaceModel(say) {
  if (faceReady) return faceReady;
  faceReady = (async () => {
    const bytes = await modelBytes(
      (got, total) => say?.(`Downloading the face model, ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB`, total ? got / total : null),
      'face',
    );
    say?.('Loading the face model');
    faceWorker = new Worker(new URL('./face-worker.js', import.meta.url), { type: 'module' });
    faceWorker.onmessage = ({ data }) => {
      const p = facePending.get('job');
      if (!p) return;
      facePending.delete('job');
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    };
    return call({ type: 'load', model: bytes }, [bytes.buffer]);
  })();
  faceReady.catch(() => (faceReady = null));
  return faceReady;
}

function call(msg, transfer) {
  // One job at a time, in order.
  const run = () =>
    new Promise((resolve, reject) => {
      facePending.set('job', { resolve, reject });
      faceWorker.postMessage(msg, transfer);
    });
  const prev = call.queue || Promise.resolve();
  call.queue = prev.then(run, run);
  faceCalls++;
  return call.queue;
}

async function restoreFace(faceCanvas) {
  const x = faceCanvas.getContext('2d', { willReadFrequently: true });
  const d = x.getImageData(0, 0, 512, 512).data;
  const plane = 512 * 512;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = (d[i * 4] / 255 - 0.5) / 0.5;
    input[plane + i] = (d[i * 4 + 1] / 255 - 0.5) / 0.5;
    input[2 * plane + i] = (d[i * 4 + 2] / 255 - 0.5) / 0.5;
  }
  const { face } = await call({ type: 'run', input }, [input.buffer]);
  const out = document.createElement('canvas');
  out.width = out.height = 512;
  const ox = out.getContext('2d');
  const img = ox.createImageData(512, 512);
  for (let i = 0; i < plane; i++) {
    img.data[i * 4] = clamp01((face[i] + 1) / 2) * 255;
    img.data[i * 4 + 1] = clamp01((face[plane + i] + 1) / 2) * 255;
    img.data[i * 4 + 2] = clamp01((face[2 * plane + i] + 1) / 2) * 255;
    img.data[i * 4 + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  return out;
}

// Matches the restored face's colour to the original inside the face oval, then mixes the two.
function blendRestored(orig, restored, mask, amount) {
  const od = orig.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 512, 512);
  const rx = restored.getContext('2d', { willReadFrequently: true });
  const rd = rx.getImageData(0, 0, 512, 512);
  const md = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 512, 512).data;
  const stats = (d) => {
    const m = [0, 0, 0];
    const s = [0, 0, 0];
    let w = 0;
    for (let i = 0; i < 512 * 512; i++) {
      const a = md[i * 4 + 3] / 255;
      if (a < 0.5) continue;
      w++;
      for (let c = 0; c < 3; c++) {
        m[c] += d[i * 4 + c];
        s[c] += d[i * 4 + c] ** 2;
      }
    }
    return [0, 1, 2].map((c) => {
      const mean = m[c] / (w || 1);
      return [mean, Math.sqrt(Math.max(1, s[c] / (w || 1) - mean * mean))];
    });
  };
  const so = stats(od.data);
  const sr = stats(rd.data);
  for (let i = 0; i < 512 * 512; i++) {
    for (let c = 0; c < 3; c++) {
      const matched = ((rd.data[i * 4 + c] - sr[c][0]) / sr[c][1]) * so[c][1] + so[c][0];
      const v = 0.75 * matched + 0.25 * rd.data[i * 4 + c];
      rd.data[i * 4 + c] = od.data[i * 4 + c] * (1 - amount) + v * amount;
    }
  }
  rx.putImageData(rd, 0, 0);
  return restored;
}

async function enhanceFaces(out, source, faces, t, say) {
  await loadFaceModel(say);
  const ctx = out.getContext('2d');
  const mask = faceOvalMask(512);
  let n = 0;
  for (const f of faces.slice(0, 8)) {
    if (f.parts.eyeDist < 10) continue;
    say?.(`Enhancing face ${++n}`);
    const al = alignFace(source, f, 512);
    const restored = await restoreFace(al.canvas);
    // A face bigger than 512 px loses detail through the model, so it gets less of it.
    const amount = t * Math.min(1, Math.max(0.2, al.scale ** 1.2));
    pasteFace(ctx, blendRestored(al.canvas, restored, mask, amount), al.m, mask);
  }
}

// ---------- Region helpers ----------

function regionAround(f, W, H, left, right, up, down) {
  const b = f.box;
  const x0 = Math.max(0, Math.floor(b.x - b.w * left));
  const y0 = Math.max(0, Math.floor(b.y - b.h * up));
  const x1 = Math.min(W, Math.ceil(b.x + b.w * (1 + right)));
  const y1 = Math.min(H, Math.ceil(b.y + b.h * (1 + down)));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function maskCanvas(r, draw, feather) {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const x = c.getContext('2d');
  x.translate(-r.x, -r.y);
  draw(x);
  return blurAlphaCanvas(c, feather);
}

const range = (a, b, pts) => pts.slice(a, b + 1);

// ---------- Smooth skin ----------

function guided(I, p, w, h, r, eps, mI, mII) {
  const n = w * h;
  const Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) Ip[i] = I[i] * p[i];
  const mP = boxBlur(p, w, h, r);
  const mIP = boxBlur(Ip, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIP[i] - mI[i] * mP[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const ma = boxBlur(a, w, h, r);
  const mb = boxBlur(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

function smoothSkin(out, faces, t) {
  const ctx = out.getContext('2d', { willReadFrequently: true });
  for (const f of faces) {
    const { pts, parts } = f;
    const fw = parts.width;
    if (fw < 24) continue;
    const r = regionAround(f, out.width, out.height, 0.3, 0.3, 0.6, 0.2);
    const lift = parts.height * 0.42;
    const mask = maskCanvas(
      r,
      (x) => {
        x.fillStyle = '#fff';
        polygon(x, [...range(0, 16, pts), ...range(17, 26, pts).reverse().map(([px, py]) => [px, py - lift])]);
        x.fill();
        x.globalCompositeOperation = 'destination-out';
        polygon(x, grow(range(36, 41, pts), 1.9));
        x.fill();
        polygon(x, grow(range(42, 47, pts), 1.9));
        x.fill();
        polygon(x, grow(range(48, 59, pts), 1.15));
        x.fill();
        x.lineWidth = fw * 0.075;
        x.lineCap = x.lineJoin = 'round';
        for (const [a, b] of [[17, 21], [22, 26]]) {
          x.beginPath();
          range(a, b, pts).forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
          x.stroke();
        }
        x.beginPath();
        x.arc(pts[33][0], pts[33][1], fw * 0.07, 0, Math.PI * 2);
        x.fill();
      },
      fw * 0.045,
    );
    const md = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, r.w, r.h).data;
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    const n = r.w * r.h;
    const [R, G, B] = planes(img.data, n);
    // Skin colour taken from the masked area, so hair, glasses and a hand stay out.
    let mcb = 0, mcr = 0, cnt = 0;
    const cb = new Float32Array(n);
    const cr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      cb[i] = -0.1687 * R[i] - 0.3313 * G[i] + 0.5 * B[i];
      cr[i] = 0.5 * R[i] - 0.4187 * G[i] - 0.0813 * B[i];
      if (md[i * 4 + 3] > 240) {
        mcb += cb[i];
        mcr += cr[i];
        cnt++;
      }
    }
    if (!cnt) continue;
    mcb /= cnt;
    mcr /= cnt;
    let vcb = 0, vcr = 0;
    for (let i = 0; i < n; i++)
      if (md[i * 4 + 3] > 240) {
        vcb += (cb[i] - mcb) ** 2;
        vcr += (cr[i] - mcr) ** 2;
      }
    const sd = Math.sqrt((vcb + vcr) / (2 * cnt)) * 2.6 + 0.02;
    const gate = new Float32Array(n);
    for (let i = 0; i < n; i++) gate[i] = Math.exp(-(((cb[i] - mcb) ** 2 + (cr[i] - mcr) ** 2) / (2 * sd * sd)));
    const gateS = boxBlur(gate, r.w, r.h, 2);

    const I = new Float32Array(n);
    for (let i = 0; i < n; i++) I[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    const rad = Math.max(2, Math.round(fw * (0.025 + 0.025 * t)));
    const eps = (0.012 + 0.06 * t) ** 2;
    const mI = boxBlur(I, r.w, r.h, rad);
    const II = new Float32Array(n);
    for (let i = 0; i < n; i++) II[i] = I[i] * I[i];
    const mII = boxBlur(II, r.w, r.h, rad);
    const fine = Math.max(1, Math.round(fw / 220));
    const strength = Math.min(1, t * 1.5);
    const chans = [R, G, B].map((p) => {
      const q = guided(I, p, r.w, r.h, rad, eps, mI, mII);
      const low = boxBlur(p, r.w, r.h, fine);
      // Pores and fine texture go back on top, so the skin stays real.
      for (let i = 0; i < n; i++) q[i] += (p[i] - low[i]) * 0.55;
      return q;
    });
    for (let i = 0; i < n; i++) {
      const k = (md[i * 4 + 3] / 255) * gateS[i] * strength;
      if (k <= 0.002) continue;
      for (let c = 0; c < 3; c++) {
        const o = img.data[i * 4 + c] / 255;
        img.data[i * 4 + c] = clamp01(o + (chans[c][i] - o) * k) * 255;
      }
    }
    ctx.putImageData(img, r.x, r.y);
  }
}

// ---------- Eyes and teeth ----------

function brightEyes(out, faces, t) {
  const ctx = out.getContext('2d', { willReadFrequently: true });
  for (const f of faces) {
    for (const [a, b] of [[36, 41], [42, 47]]) {
      const eye = range(a, b, f.pts);
      const xs = eye.map((p) => p[0]);
      const ys = eye.map((p) => p[1]);
      const ew = Math.max(...xs) - Math.min(...xs);
      if (ew < 6) continue;
      const r = { x: Math.max(0, Math.floor(Math.min(...xs) - ew * 0.6)), y: Math.max(0, Math.floor(Math.min(...ys) - ew * 0.6)) };
      r.w = Math.min(out.width - r.x, Math.ceil(ew * 2.2));
      r.h = Math.min(out.height - r.y, Math.ceil(Math.max(...ys) - Math.min(...ys) + ew * 1.2));
      const mask = maskCanvas(r, (x) => ((x.fillStyle = '#fff'), polygon(x, grow(eye, 1.25)), x.fill()), ew * 0.12);
      const md = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, r.w, r.h).data;
      const img = ctx.getImageData(r.x, r.y, r.w, r.h);
      const n = r.w * r.h;
      const ch = planes(img.data, n);
      const blur = ch.map((p) => boxBlur(p, r.w, r.h, Math.max(1, Math.round(ew / 14))));
      for (let i = 0; i < n; i++) {
        const k = (md[i * 4 + 3] / 255) * t;
        if (k <= 0.002) continue;
        for (let c = 0; c < 3; c++) {
          let v = ch[c][i] + (ch[c][i] - blur[c][i]) * 1.2 * k;
          v = 1 - (1 - clamp01(v)) ** (1 + 0.45 * k);
          img.data[i * 4 + c] = clamp01(v) * 255;
        }
      }
      ctx.putImageData(img, r.x, r.y);
    }
  }
}

function whitenTeeth(out, faces, t) {
  const ctx = out.getContext('2d', { willReadFrequently: true });
  for (const f of faces) {
    const inner = range(60, 67, f.pts);
    const xs = inner.map((p) => p[0]);
    const ys = inner.map((p) => p[1]);
    const mw = Math.max(...xs) - Math.min(...xs);
    const mh = Math.max(...ys) - Math.min(...ys);
    // A closed mouth shows no teeth.
    if (mw < 8 || mh < mw * 0.08) continue;
    const r = { x: Math.max(0, Math.floor(Math.min(...xs) - mw * 0.2)), y: Math.max(0, Math.floor(Math.min(...ys) - mh * 0.4)) };
    r.w = Math.min(out.width - r.x, Math.ceil(mw * 1.4));
    r.h = Math.min(out.height - r.y, Math.ceil(mh * 1.8));
    const mask = maskCanvas(r, (x) => ((x.fillStyle = '#fff'), polygon(x, grow(inner, 1.05)), x.fill()), mw * 0.04);
    const md = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, r.w, r.h).data;
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    for (let i = 0; i < r.w * r.h; i++) {
      const m = md[i * 4 + 3] / 255;
      if (m <= 0.002) continue;
      const R = img.data[i * 4] / 255, G = img.data[i * 4 + 1] / 255, B = img.data[i * 4 + 2] / 255;
      const L = 0.299 * R + 0.587 * G + 0.114 * B;
      const k = m * t * smoothstep(0.28, 0.5, L);
      const gray = Math.min(1, L + 0.07 * k);
      img.data[i * 4] = clamp01(R + (gray - R) * 0.7 * k) * 255;
      img.data[i * 4 + 1] = clamp01(G + (gray - G) * 0.7 * k) * 255;
      img.data[i * 4 + 2] = clamp01(B + (gray + 0.015 - B) * 0.75 * k) * 255;
    }
    ctx.putImageData(img, r.x, r.y);
  }
}

// ---------- Warps ----------

function sampler(data, w, h) {
  return (x, y, out, o) => {
    x = Math.min(w - 1.001, Math.max(0, x));
    y = Math.min(h - 1.001, Math.max(0, y));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
    const i = (y0 * w + x0) * 4, j = i + w * 4;
    for (let c = 0; c < 4; c++) {
      const top = data[i + c] + (data[i + 4 + c] - data[i + c]) * fx;
      const bot = data[j + c] + (data[j + 4 + c] - data[j + c]) * fx;
      out[o + c] = top + (bot - top) * fy;
    }
  };
}

function slimFace(out, faces, t) {
  const ctx = out.getContext('2d', { willReadFrequently: true });
  for (const f of faces) {
    const { pts, parts } = f;
    if (parts.width < 30) continue;
    // The face's own up-down line, so a tilted head slims evenly.
    const ax = parts.chin[0] - parts.eyeMid[0];
    const ay = parts.chin[1] - parts.eyeMid[1];
    const al = Math.hypot(ax, ay) || 1;
    const nx = ay / al;
    const ny = -ax / al;
    const weight = { 2: 0.35, 3: 0.65, 4: 0.9, 5: 1, 6: 0.9, 7: 0.45, 8: 0.15, 9: 0.45, 10: 0.9, 11: 1, 12: 0.9, 13: 0.65, 14: 0.35 };
    const ctrl = Object.entries(weight).map(([i, wgt]) => {
      const [px, py] = pts[+i];
      const off = (px - parts.eyeMid[0]) * nx + (py - parts.eyeMid[1]) * ny;
      const k = t * 0.11 * wgt;
      return { x: px, y: py, dx: -nx * off * k, dy: -ny * off * k };
    });
    const sigma = parts.width * 0.2;
    const inv2s = 1 / (2 * sigma * sigma);
    const r = regionAround(f, out.width, out.height, 0.5, 0.5, 0.1, 0.45);
    const img = ctx.getImageData(r.x, r.y, r.w, r.h);
    const src = new Uint8ClampedArray(img.data);
    const sample = sampler(src, r.w, r.h);
    const px = new Float32Array(4);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const gx = x + r.x, gy = y + r.y;
        let ddx = 0, ddy = 0;
        for (const c of ctrl) {
          const ex = gx - (c.x + c.dx), ey = gy - (c.y + c.dy);
          const d2 = ex * ex + ey * ey;
          if (d2 > 9 * sigma * sigma) continue;
          const wgt = Math.exp(-d2 * inv2s);
          ddx += c.dx * wgt;
          ddy += c.dy * wgt;
        }
        if (Math.abs(ddx) + Math.abs(ddy) < 0.01) continue;
        // Fades to nothing at the region edge, so nothing tears.
        const edge = Math.min(x, y, r.w - 1 - x, r.h - 1 - y) / (sigma * 0.6);
        const fade = edge >= 1 ? 1 : Math.max(0, edge);
        sample(x - ddx * fade, y - ddy * fade, px, 0);
        const o = (y * r.w + x) * 4;
        img.data[o] = px[0];
        img.data[o + 1] = px[1];
        img.data[o + 2] = px[2];
        img.data[o + 3] = px[3];
      }
    }
    ctx.putImageData(img, r.x, r.y);
  }
}

const personMasks = new Map();

async function personMask(source, key, say) {
  if (personMasks.has(key)) return personMasks.get(key);
  await loadModel((text, f) => say?.(text, f));
  say?.('Finding the body');
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const m = await runModel(source, { x: 0, y: 0, w, h });
  const a = m.getContext('2d').getImageData(0, 0, m.width, m.height).data;
  const mask = { w: m.width, h: m.height, a: new Float32Array(m.width * m.height) };
  for (let i = 0; i < mask.a.length; i++) mask.a[i] = a[i * 4 + 3] / 255;
  // A little vertical smoothing keeps the outline steady from row to row.
  mask.a = boxBlur(mask.a, mask.w, mask.h, Math.max(1, Math.round(mask.h * 0.006)));
  personMasks.set(key, mask);
  return mask;
}

function slimBody(out, mask, faces, t) {
  const W = out.width;
  const H = out.height;
  const sy = mask.h / H;
  const sx = W / mask.w;
  const rowRuns = (my) => {
    const runs = [];
    let start = -1;
    for (let x = 0; x <= mask.w; x++) {
      const on = x < mask.w && mask.a[my * mask.w + x] > 0.5;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= mask.w * 0.035) runs.push([start * sx, x * sx]);
        start = -1;
      }
    }
    return runs;
  };
  // The body starts under the lowest chin, or a fifth of the way down the person.
  let top = Infinity;
  let bottom = -1;
  for (let my = 0; my < mask.h; my++)
    if (rowRuns(my).length) {
      top = Math.min(top, my / sy);
      bottom = my / sy;
    }
  if (!isFinite(top)) return false;
  const chin = faces.length ? Math.max(...faces.map((f) => f.parts.chin[1] + f.parts.height * 0.18)) : top + (bottom - top) * 0.2;
  const start = Math.max(top, chin);
  const span = Math.max(1, bottom - start);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const y0 = Math.floor(start);
  const img = ctx.getImageData(0, y0, W, H - y0);
  const row = new Uint8ClampedArray(W * 4);
  for (let y = y0; y < H; y++) {
    const p = (y - start) / span;
    const profile = p < 0.1 ? smoothstep(0, 0.1, p) : p < 0.6 ? 1 : 1 - 0.6 * smoothstep(0.6, 1, p);
    const s = t * 0.1 * profile;
    if (s < 0.002) continue;
    const runs = rowRuns(Math.min(mask.h - 1, Math.floor(y * sy)));
    if (!runs.length) continue;
    const base = (y - y0) * W * 4;
    row.set(img.data.subarray(base, base + W * 4));
    runs.forEach(([L, R], i) => {
      const c = (L + R) / 2;
      const hw = (R - L) / 2;
      const gapL = i ? L - runs[i - 1][1] : L;
      const gapR = i < runs.length - 1 ? runs[i + 1][0] - R : W - R;
      const m = Math.max(2, Math.min(hw * 0.6, gapL / 2, gapR / 2));
      const inner = hw * (1 - s);
      const xa = Math.max(0, Math.floor(c - hw - m));
      const xb = Math.min(W - 1, Math.ceil(c + hw + m));
      for (let x = xa; x <= xb; x++) {
        const v = x - c;
        const av = Math.abs(v);
        let u;
        if (av <= inner) u = av / (1 - s);
        else if (av <= hw + m) u = hw + ((av - inner) * m) / (m + s * hw);
        else continue;
        const sxp = Math.min(W - 1.001, Math.max(0, c + Math.sign(v) * u));
        const x0 = sxp | 0;
        const fx = sxp - x0;
        const o = base + x * 4;
        for (let ch = 0; ch < 4; ch++) img.data[o + ch] = row[x0 * 4 + ch] + (row[(x0 + 1) * 4 + ch] - row[x0 * 4 + ch]) * fx;
      }
    });
  }
  ctx.putImageData(img, 0, y0);
  return true;
}

// ---------- Rendering ----------

/**
 * Renders the fixes onto a copy of `source` (an image or canvas). Returns
 * { canvas, faces, body } where faces is how many faces were found.
 */
export async function renderFixes(source, settings, { key, say } = {}) {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0);
  const s = { ...NONE, ...settings };
  const needFaces = FACE_FIXES.some((k) => s[k] > 0) || s.slimBody > 0;
  say?.('Finding faces');
  const faces = needFaces ? await detectFaces(source, { key }) : [];
  if (s.enhance > 0 && faces.length) await enhanceFaces(out, source, faces, s.enhance / 100, say);
  if (s.smooth > 0) smoothSkin(out, faces, s.smooth / 100);
  if (s.eyes > 0) brightEyes(out, faces, s.eyes / 100);
  if (s.teeth > 0) whitenTeeth(out, faces, s.teeth / 100);
  if (s.slimFace > 0) slimFace(out, faces, s.slimFace / 100);
  let body = false;
  if (s.slimBody > 0) body = slimBody(out, await personMask(source, key || source.src, say), faces, s.slimBody / 100);
  return { canvas: out, faces: faces.length, body };
}

/** Applies fixes to a photo layer. Returns { faces, body } for messages. */
export async function applyFixes(obj, settings, { say } = {}) {
  const base = obj.beautyBase || obj.getSrc();
  const img = await loadImage(base);
  if (isNone(settings)) {
    if (obj.beautyBase) {
      await swap(obj, base);
      obj.beautyBase = null;
    }
    obj.beauty = null;
    return { faces: null, body: false };
  }
  const r = await renderFixes(img, settings, { key: base, say });
  const blob = await new Promise((res) => r.canvas.toBlob(res, 'image/png'));
  await swap(obj, registerBlob(blob));
  obj.beautyBase = base;
  obj.beauty = { ...NONE, ...settings };
  return r;
}

async function swap(obj, url) {
  const el = await loadImage(url);
  obj.setElement(el, { width: obj.width, height: obj.height });
  if (obj.filters?.length) obj.applyFilters();
  obj.dirty = true;
}
