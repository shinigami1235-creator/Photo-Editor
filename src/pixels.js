// Small pixel helpers for the retouch tools: fast box blurs and masks.

/** Mean over a (2r+1) square, edges clamped. Separable running sums, so the radius costs nothing. */
export function boxBlur(src, w, h, r) {
  if (r < 1) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Three box passes, close to a Gaussian with the given radius. */
export function softBlur(src, w, h, radius) {
  const r = Math.max(1, Math.round(radius / 2));
  return boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r);
}

/** The alpha of a canvas as 0 to 1 floats. */
export function alphaOf(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const a = new Float32Array(c.width * c.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  return a;
}

/** Blurs a canvas's alpha in place (masks). */
export function blurAlphaCanvas(c, radius) {
  const a = softBlur(alphaOf(c), c.width, c.height, radius);
  const x = c.getContext('2d');
  const img = x.createImageData(c.width, c.height);
  for (let i = 0; i < a.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** Splits RGBA bytes into 0 to 1 float planes. */
export function planes(data, n) {
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = data[i * 4] / 255;
    g[i] = data[i * 4 + 1] / 255;
    b[i] = data[i * 4 + 2] / 255;
  }
  return [r, g, b];
}

/** Scales points about their centre. */
export function grow(pts, k) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

export function polygon(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
