import { canvas, fabric } from './canvas.js';
import { loadImage } from './assets.js';
import { modelBytes } from './platform.js';
import { emit } from './state.js';

// Background removal with the ISNet general-use model (Apache 2.0), run on this
// computer. The model (179 MB) downloads once on first use. The cut-out is the
// model's mask, cleaned on plain backgrounds, then changed by the Erase and
// Restore strokes drawn in the cut-out editor (refine.js).

const SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];

let worker = null;
let ready = null;

function call(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const onMsg = ({ data }) => {
      worker.removeEventListener('message', onMsg);
      if (data.type === 'error') reject(new Error(data.message));
      else resolve(data);
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage(msg, transfer);
  });
}

/** Loads the model, downloading it the first time. `say(text, fraction)` reports progress. */
export function loadModel(say) {
  if (ready) return ready;
  ready = (async () => {
    const bytes = await modelBytes((got, total) =>
      say(`Downloading the background model, ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB`, total ? got / total : null),
    );
    say('Loading the background model');
    worker = new Worker(new URL('./bg-worker.js', import.meta.url), { type: 'module' });
    const res = await call({ type: 'load', model: bytes }, [bytes.buffer]);
    return res.provider;
  })();
  ready.catch(() => (ready = null));
  return ready;
}

/**
 * Runs the model on part of a picture. `rect` is { x, y, w, h } in the picture's
 * pixels. Returns a 1024 x 1024 canvas whose alpha is the subject mask for that rect.
 */
export async function runModel(img, rect) {
  const small = new OffscreenCanvas(SIZE, SIZE);
  const sctx = small.getContext('2d');
  sctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = px[i * 4] / 255 - MEAN[0];
    input[plane + i] = px[i * 4 + 1] / 255 - MEAN[1];
    input[2 * plane + i] = px[i * 4 + 2] / 255 - MEAN[2];
  }
  const { mask } = await call({ type: 'run', input, size: SIZE }, [input.buffer]);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of mask) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  const maskImg = new ImageData(SIZE, SIZE);
  for (let i = 0; i < plane; i++) maskImg.data[i * 4 + 3] = Math.round(((mask[i] - lo) / range) * 255);
  const out = new OffscreenCanvas(SIZE, SIZE);
  out.getContext('2d').putImageData(maskImg, 0, 0);
  return out;
}

/** The part of the picture the model looks at: the subject box plus a small margin, or all of it. */
export function modelRect(box, w, h) {
  if (!box) return { x: 0, y: 0, w, h };
  const pad = 0.04;
  const bw = (box[2] - box[0]) * w;
  const bh = (box[3] - box[1]) * h;
  const x0 = Math.max(0, Math.floor(box[0] * w - bw * pad));
  const y0 = Math.max(0, Math.floor(box[1] * h - bh * pad));
  const x1 = Math.min(w, Math.ceil(box[2] * w + bw * pad));
  const y1 = Math.min(h, Math.ceil(box[3] * h + bh * pad));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Checks the outer edge of a rect. When it is one even colour, returns that colour
 * and the distance thresholds used to key it out; otherwise null.
 */
export function flatBackground(d, w, rect) {
  const { x: rx, y: ry, w: rw, h: rh } = rect;
  const band = Math.max(2, Math.round(Math.min(rw, rh) * 0.02));
  const bstep = Math.max(1, Math.floor(band / 3));
  const step = Math.max(1, Math.round(Math.max(rw, rh) / 400));
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const samples = [];
  const take = (x, y) => {
    const i = (y * w + x) * 4;
    sr += d[i];
    sg += d[i + 1];
    sb += d[i + 2];
    samples.push(i);
    n++;
  };
  for (let x = rx; x < rx + rw; x += step)
    for (let k = 0; k < band; k += bstep) {
      take(x, ry + k);
      take(x, ry + rh - 1 - k);
    }
  for (let y = ry; y < ry + rh; y += step)
    for (let k = 0; k < band; k += bstep) {
      take(rx + k, y);
      take(rx + rw - 1 - k, y);
    }
  const r = sr / n;
  const g = sg / n;
  const b = sb / n;
  let spread = 0;
  let far = 0;
  for (const i of samples) {
    const dist = Math.hypot(d[i] - r, d[i + 1] - g, d[i + 2] - b);
    spread += dist;
    if (dist > 40) far++;
  }
  spread /= n;
  // Uneven edges (a photo, a gradient, or the subject touching the edge) use the model alone.
  if (spread > 10 || far / n > 0.03) return null;
  const t0 = Math.max(12, spread * 3);
  return { r, g, b, t0, t1: t0 + 70 };
}

/** Tolerance slider (0 to 100) to a colour distance. 100 changes everything under the brush. */
const tolDistance = (tol) => (tol >= 100 ? Infinity : 6 + (tol / 100) * 190);

/** Average colour in a small circle around a point. */
function sampleColor(d, w, h, cx, cy, r) {
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * w + x) * 4;
      sr += d[i];
      sg += d[i + 1];
      sb += d[i + 2];
      n++;
    }
  if (!n) {
    const i = (Math.round(cy) * w + Math.round(cx)) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  }
  return [sr / n, sg / n, sb / n];
}

/**
 * Erases or restores along a stroke. The colour where the stroke starts is the
 * target: pixels under the brush within the tolerance of it change, and pixels
 * further from it (the part of the stroke that spilled onto the subject) stay.
 */
function applyStroke(alpha, d, w, h, s) {
  const size = Math.max(1, s.size * w);
  const pts = s.points.map(([x, y]) => [x * w, y * h]);
  const half = size / 2 + 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bx = Math.max(0, Math.floor(minX - half));
  const by = Math.max(0, Math.floor(minY - half));
  const bw = Math.min(w, Math.ceil(maxX + half)) - bx;
  const bh = Math.min(h, Math.ceil(maxY + half)) - by;
  if (bw <= 0 || bh <= 0) return;
  const c = new OffscreenCanvas(bw, bh);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(-bx, -by);
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
  const cover = ctx.getImageData(0, 0, bw, bh).data;
  const ref = sampleColor(d, w, h, pts[0][0], pts[0][1], Math.max(1.5, size * 0.2));
  const tol = tolDistance(s.tol);
  const soft = 18;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const cov = cover[(y * bw + x) * 4 + 3] / 255;
      if (!cov) continue;
      const k = (by + y) * w + bx + x;
      const i = k * 4;
      let match = 1;
      if (tol !== Infinity) {
        const dist = Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]);
        match = 1 - clamp01((dist - tol) / soft);
      }
      const wgt = cov * match;
      if (!wgt) continue;
      alpha[k] = s.mode === 'erase' ? alpha[k] * (1 - wgt) : Math.max(alpha[k], wgt);
    }
  }
}

/**
 * Magic wand: from the clicked pixel, takes every connected pixel (or, with
 * contiguous off, every pixel) within the tolerance of its colour.
 */
function applyWand(alpha, d, w, h, s) {
  const sx = Math.min(w - 1, Math.max(0, Math.round(s.x * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.round(s.y * h)));
  const ref = sampleColor(d, w, h, sx, sy, 1.5);
  const tol = tolDistance(Math.min(99, s.tol));
  const near = (k) => {
    const i = k * 4;
    return Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]) <= tol;
  };
  const hit = new Uint8Array(w * h);
  if (s.contiguous === false) {
    for (let k = 0; k < w * h; k++) if (near(k)) hit[k] = 1;
  } else {
    const stack = [sy * w + sx];
    hit[stack[0]] = 1;
    while (stack.length) {
      const k = stack.pop();
      const x = k % w;
      const y = (k - x) / w;
      const next = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
      for (const n of next) {
        if (n < 0 || hit[n] || !near(n)) continue;
        hit[n] = 1;
        stack.push(n);
      }
    }
  }
  // One pixel of feather so the edge of the area is not jagged.
  for (let k = 0; k < w * h; k++) {
    let wgt = hit[k];
    if (!wgt) {
      const x = k % w;
      if ((x > 0 && hit[k - 1]) || (x < w - 1 && hit[k + 1]) || (k >= w && hit[k - w]) || (k < w * (h - 1) && hit[k + w])) wgt = 0.5;
    }
    if (!wgt) continue;
    alpha[k] = s.mode === 'erase' ? alpha[k] * (1 - wgt) : Math.max(alpha[k], wgt);
  }
}

/**
 * Lasso selection. `polys` are the outlines drawn (Shift adds more). With `keep`
 * everything outside them is erased; inverted, everything inside them is.
 * Older saves have `points` and an Erase or Restore `mode` instead.
 */
function applyLasso(alpha, w, h, s) {
  const polys = (s.polys || [s.points]).filter((p) => p && p.length >= 3);
  if (!polys.length) return;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const pts of polys) {
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    ctx.closePath();
  }
  ctx.fill('nonzero');
  const cover = ctx.getImageData(0, 0, w, h).data;
  for (let k = 0; k < w * h; k++) {
    const wgt = cover[k * 4 + 3] / 255;
    if (s.polys) alpha[k] *= s.keep ? wgt : 1 - wgt;
    else if (wgt) alpha[k] = s.mode === 'erase' ? alpha[k] * (1 - wgt) : Math.max(alpha[k], wgt);
  }
}

/**
 * Builds the cut-out at one size. `pic` is the original picture's ImageData at that
 * size, `maskCanvas` the model mask for `rect` (in the same size's pixels) or null
 * before the model has run. Returns new ImageData.
 */
export function compose(pic, maskCanvas, rect, strokes) {
  const { width: w, height: h } = pic;
  const d = pic.data;
  const n = w * h;
  const alpha = new Float32Array(n);
  let bg = null;
  if (!maskCanvas) alpha.fill(1);
  else {
    const m = new OffscreenCanvas(w, h);
    const mctx = m.getContext('2d');
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(maskCanvas, rect.x, rect.y, rect.w, rect.h);
    const md = mctx.getImageData(0, 0, w, h).data;
    bg = flatBackground(d, w, rect);
    for (let k = 0; k < n; k++) {
      let a = md[k * 4 + 3] / 255;
      if (bg) {
        // On a plain background (a logo on a solid colour), pixels close to that colour
        // are background where the model was unsure, such as gaps inside a shape.
        // Pixels the model is sure of stay, so a white label on a product shot on white keeps.
        const i = k * 4;
        const dist = Math.hypot(d[i] - bg.r, d[i + 1] - bg.g, d[i + 2] - bg.b);
        const key = clamp01((dist - bg.t0) / (bg.t1 - bg.t0));
        const sure = clamp01((a - 0.8) / 0.14);
        a = Math.min(a, Math.max(key, sure));
      }
      alpha[k] = a;
    }
  }
  for (const s of strokes) {
    if (s.kind === 'wand') applyWand(alpha, d, w, h, s);
    else if (s.kind === 'lasso') applyLasso(alpha, w, h, s);
    else applyStroke(alpha, d, w, h, s);
  }
  const out = new ImageData(w, h);
  const o = out.data;
  for (let k = 0; k < n; k++) {
    const i = k * 4;
    const a = alpha[k];
    o[i] = d[i];
    o[i + 1] = d[i + 1];
    o[i + 2] = d[i + 2];
    // Edge pixels on a plain background are part background colour. Taking it out stops a dark or light rim.
    if (bg && a > 0.02 && a < 0.98) {
      o[i] = clamp255((d[i] - bg.r * (1 - a)) / a);
      o[i + 1] = clamp255((d[i + 1] - bg.g * (1 - a)) / a);
      o[i + 2] = clamp255((d[i + 2] - bg.b * (1 - a)) / a);
    }
    o[i + 3] = Math.round(a * 255 * (d[i + 3] / 255));
  }
  return out;
}

export async function swapElement(obj, url) {
  const el = await loadImage(url);
  obj.setElement(el, { width: obj.width, height: obj.height });
  obj.dirty = true;
  canvas.requestRenderAll();
}

export async function restoreBackground(obj) {
  if (!obj?.originalSrc) return;
  const src = obj.originalSrc;
  obj.originalSrc = null;
  obj.cutout = null;
  await swapElement(obj, src);
  canvas.fire('object:modified', { target: obj });
  emit('selection');
}

export { fabric };
