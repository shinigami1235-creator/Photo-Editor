// Finds faces and 68 points on each (jawline, brows, eyes, nose, lips) with
// face-api (MIT, models in public/models/face), straightens a face to a fixed
// 512 x 512 square the way CodeFormer and RestoreFormer expect, and pastes a
// worked face back with a soft edge.

import { blurAlphaCanvas } from './pixels.js';

let api = null;
let loading = null;
const cache = new Map();

/** Loads the face models once. */
export function loadFaces() {
  if (api) return Promise.resolve(api);
  loading ||= (async () => {
    const fa = await import('@vladmandic/face-api/dist/face-api.esm.js');
    try {
      await fa.tf.setBackend('webgl');
      await fa.tf.ready();
    } catch {
      await fa.tf.setBackend('cpu');
      await fa.tf.ready();
    }
    const base = new URL('models/face/', document.baseURI).href;
    await fa.nets.ssdMobilenetv1.loadFromUri(base);
    await fa.nets.faceLandmark68Net.loadFromUri(base);
    api = fa;
    return fa;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

const mean = (pts, a, b) => {
  let x = 0;
  let y = 0;
  for (let i = a; i <= b; i++) {
    x += pts[i][0];
    y += pts[i][1];
  }
  const n = b - a + 1;
  return [x / n, y / n];
};

/** Named points and sizes worked out from the 68 points. */
export function faceParts(pts) {
  const leftEye = mean(pts, 36, 41);
  const rightEye = mean(pts, 42, 47);
  const eyeDist = Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]);
  const width = Math.hypot(pts[16][0] - pts[0][0], pts[16][1] - pts[0][1]);
  const browY = mean(pts, 17, 26)[1];
  return {
    leftEye,
    rightEye,
    eyeMid: [(leftEye[0] + rightEye[0]) / 2, (leftEye[1] + rightEye[1]) / 2],
    nose: pts[30],
    chin: pts[8],
    mouthLeft: pts[48],
    mouthRight: pts[54],
    eyeDist,
    width,
    height: pts[8][1] - browY,
    angle: Math.atan2(rightEye[1] - leftEye[1], rightEye[0] - leftEye[0]),
  };
}

/**
 * Faces in a picture, biggest first: [{ box: {x,y,w,h}, pts: [[x,y] x 68], score, parts }].
 * Big pictures are searched at up to `max` pixels and the points scaled back.
 */
export async function detectFaces(source, { max = 1600, key = null, minScore = 0.45 } = {}) {
  if (key && cache.has(key)) return cache.get(key);
  const fa = await loadFaces();
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  const found = await fa.detectAllFaces(c, new fa.SsdMobilenetv1Options({ minConfidence: minScore, maxResults: 20 })).withFaceLandmarks();
  const faces = found
    .map((f) => {
      const b = f.detection.box;
      const pts = f.landmarks.positions.map((p) => [p.x / s, p.y / s]);
      return { box: { x: b.x / s, y: b.y / s, w: b.width / s, h: b.height / s }, pts, score: f.detection.score, parts: faceParts(pts) };
    })
    // On a real face the eyes sit about half the box width apart. Boxes over
    // clothing or patterns pass the detector but fail this.
    .filter((f) => {
      const r = f.parts.eyeDist / f.box.w;
      return r > 0.3 && r < 0.8;
    })
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  if (key) cache.set(key, faces);
  return faces;
}

// Where the eyes, nose tip and mouth corners sit in a straightened 512 x 512 face (FFHQ layout).
const TEMPLATE = [
  [192.98138, 239.94708],
  [318.90277, 240.1936],
  [256.63416, 314.01935],
  [201.26117, 371.41043],
  [313.08905, 371.15118],
];

/** Least-squares rotation, scale and shift taking src points onto dst points: [a, b, tx, ty] for x' = a x - b y + tx, y' = b x + a y + ty. */
export function similarity(src, dst) {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1];
  }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - sx, y = src[i][1] - sy, u = dst[i][0] - dx, v = dst[i][1] - dy;
    num1 += x * u + y * v;
    num2 += x * v - y * u;
    den += x * x + y * y;
  }
  const a = num1 / den;
  const b = num2 / den;
  return [a, b, dx - (a * sx - b * sy), dy - (b * sx + a * sy)];
}

export function invert([a, b, tx, ty]) {
  const d = a * a + b * b;
  const ia = a / d;
  const ib = -b / d;
  return [ia, ib, -(ia * tx - ib * ty), -(ib * tx + ia * ty)];
}

/** Straightens one face to a size x size canvas. Returns { canvas, m } where m maps picture to face square. */
export function alignFace(source, face, size = 512) {
  const p = face.parts;
  const src = [p.leftEye, p.rightEye, p.nose, p.mouthLeft, p.mouthRight];
  const dst = TEMPLATE.map(([x, y]) => [(x * size) / 512, (y * size) / 512]);
  const m = similarity(src, dst);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#878584';
  x.fillRect(0, 0, size, size);
  x.imageSmoothingQuality = 'high';
  x.setTransform(m[0], m[1], -m[1], m[0], m[2], m[3]);
  x.drawImage(source, 0, 0);
  return { canvas: c, m, scale: Math.hypot(m[0], m[1]) };
}

/** A soft face-shaped mask for a straightened 512 face: the oval from brow line to chin. */
export function faceOvalMask(size = 512, soft = 0.06) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const k = size / 512;
  x.fillStyle = '#fff';
  x.beginPath();
  x.ellipse(256 * k, 285 * k, 165 * k, 210 * k, 0, 0, Math.PI * 2);
  x.fill();
  return blurAlphaCanvas(c, size * soft);
}

/** Draws a worked face square back into the picture through a mask. */
export function pasteFace(targetCtx, faceCanvas, m, mask) {
  const size = faceCanvas.width;
  const masked = document.createElement('canvas');
  masked.width = masked.height = size;
  const mx = masked.getContext('2d');
  mx.drawImage(faceCanvas, 0, 0);
  mx.globalCompositeOperation = 'destination-in';
  mx.drawImage(mask, 0, 0, size, size);
  const inv = invert(m);
  targetCtx.save();
  targetCtx.imageSmoothingQuality = 'high';
  targetCtx.setTransform(inv[0], inv[1], -inv[1], inv[0], inv[2], inv[3]);
  targetCtx.drawImage(masked, 0, 0);
  targetCtx.restore();
}

export function forgetFaces(key) {
  cache.delete(key);
}
