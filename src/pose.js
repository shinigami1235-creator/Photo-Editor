// Finds 17 body points (nose, eyes, ears, shoulders, elbows, wrists, hips,
// knees, ankles) with MoveNet Thunder (Google, Apache 2.0, in
// public/models/pose). It works on a torso with the head cropped out, which
// is how body before-and-after photos are usually taken.

import { loadFaces } from './faces.js';

export const POINTS = ['nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];

// The points used to line up two bodies: they sit on the trunk and arms,
// which stay put between visits, unlike hands and feet.
export const BODY_POINTS = [5, 6, 7, 8, 11, 12, 13, 14];

const SIZE = 256;
let model = null;
let loading = null;
const cache = new Map();

async function loadPose() {
  if (model) return model;
  loading ||= (async () => {
    const fa = await loadFaces();
    model = await fa.tf.loadGraphModel(new URL('models/pose/movenet-thunder.json', document.baseURI).href);
    return model;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** Body points in the picture's own pixels: [{ x, y, score }] in POINTS order. */
export async function detectPose(source, { key = null } = {}) {
  if (key && cache.has(key)) return cache.get(key);
  const m = await loadPose();
  const { tf } = await loadFaces();
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  // Fit the picture inside a square with even padding, the way MoveNet expects.
  const s = SIZE / Math.max(w, h);
  const ox = (SIZE - w * s) / 2;
  const oy = (SIZE - h * s) / 2;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const x = c.getContext('2d');
  x.drawImage(source, ox, oy, w * s, h * s);
  const input = tf.tidy(() => tf.browser.fromPixels(c).toInt().expandDims(0));
  const out = m.execute(input);
  const d = await out.data();
  tf.dispose([input, out]);
  const pts = POINTS.map((_, i) => ({ x: (d[i * 3 + 1] * SIZE - ox) / s, y: (d[i * 3] * SIZE - oy) / s, score: d[i * 3 + 2] }));
  if (key) cache.set(key, pts);
  return pts;
}
