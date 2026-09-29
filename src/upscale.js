import { canvas } from './canvas.js';
import { emit } from './state.js';
import { record } from './history.js';
import { registerBlob, loadImage, blobFor } from './assets.js';
import { canvasBlob } from './layerfx.js';
import { toast } from './ui.js';
import { applyClip } from './frames.js';

// Makes a photo 2 or 4 times bigger with the Real-ESRGAN general model, which
// ships with the app (4.9 MB). The picture is run in overlapping tiles so any
// size fits in memory. It stays the same size on the page with more pixels.

const TILE = 160;
const PAD = 12;
const MAX_OUT = 8192;

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

function load() {
  if (ready) return ready;
  ready = (async () => {
    const res = await fetch(new URL('models/upscale-x4.onnx', document.baseURI));
    if (!res.ok) throw new Error('the upscale model is missing');
    const bytes = new Uint8Array(await res.arrayBuffer());
    worker = new Worker(new URL('./upscale-worker.js', import.meta.url), { type: 'module' });
    await call({ type: 'load', model: bytes }, [bytes.buffer]);
  })();
  ready.catch(() => (ready = null));
  return ready;
}

/** Largest factor (2 or 4) that keeps the result within the size cap, or 0. */
export function upscaleLimit(obj) {
  const el = obj.getElement();
  const big = Math.max(el.naturalWidth || el.width, el.naturalHeight || el.height);
  if (big * 4 <= MAX_OUT) return 4;
  if (big * 2 <= MAX_OUT) return 2;
  return 0;
}

/** Upscales a photo by `factor` (2 or 4). */
export async function upscalePhoto(obj, factor) {
  const img = await loadImage(obj.getSrc());
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (Math.max(W, H) * factor > MAX_OUT) return toast(`The result would be over ${MAX_OUT} pixels wide.`, { error: true });
  const note = toast('Loading the upscale model', { sticky: true });
  try {
    await load();
    // The model always makes 4x, so a 2x result starts from a half-size copy.
    const pre = factor / 4;
    const iw = Math.max(1, Math.round(W * pre));
    const ih = Math.max(1, Math.round(H * pre));
    const src = document.createElement('canvas');
    src.width = iw;
    src.height = ih;
    const sx = src.getContext('2d', { willReadFrequently: true });
    sx.imageSmoothingQuality = 'high';
    sx.drawImage(img, 0, 0, iw, ih);
    const out = document.createElement('canvas');
    out.width = iw * 4;
    out.height = ih * 4;
    const ox = out.getContext('2d');
    const tilesX = Math.ceil(iw / TILE);
    const tilesY = Math.ceil(ih / TILE);
    let done = 0;
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = tx * TILE;
        const y0 = ty * TILE;
        const cw = Math.min(TILE, iw - x0);
        const ch = Math.min(TILE, ih - y0);
        // Read a margin around the tile so seams fall outside the part kept.
        const rx = Math.max(0, x0 - PAD);
        const ry = Math.max(0, y0 - PAD);
        const rw = Math.min(iw, x0 + cw + PAD) - rx;
        const rh = Math.min(ih, y0 + ch + PAD) - ry;
        const px = sx.getImageData(rx, ry, rw, rh).data;
        const plane = rw * rh;
        const input = new Float32Array(3 * plane);
        for (let i = 0; i < plane; i++) {
          input[i] = px[i * 4] / 255;
          input[plane + i] = px[i * 4 + 1] / 255;
          input[2 * plane + i] = px[i * 4 + 2] / 255;
        }
        const { data } = await call({ type: 'run', input, w: rw, h: rh }, [input.buffer]);
        const OW = rw * 4;
        const OH = rh * 4;
        const tile = new ImageData(OW, OH);
        const op = OW * OH;
        for (let i = 0; i < op; i++) {
          tile.data[i * 4] = Math.max(0, Math.min(255, data[i] * 255));
          tile.data[i * 4 + 1] = Math.max(0, Math.min(255, data[op + i] * 255));
          tile.data[i * 4 + 2] = Math.max(0, Math.min(255, data[2 * op + i] * 255));
          tile.data[i * 4 + 3] = 255;
        }
        const tc = document.createElement('canvas');
        tc.width = OW;
        tc.height = OH;
        tc.getContext('2d').putImageData(tile, 0, 0);
        ox.drawImage(tc, (x0 - rx) * 4, (y0 - ry) * 4, cw * 4, ch * 4, x0 * 4, y0 * 4, cw * 4, ch * 4);
        done++;
        note.text(`Upscaling, ${Math.round((done / (tilesX * tilesY)) * 100)}%`);
        note.progress(done / (tilesX * tilesY));
      }
    }
    // Transparent areas (a cut-out) keep their shape, scaled smoothly.
    const a = sx.getImageData(0, 0, iw, ih).data;
    let hasAlpha = false;
    for (let i = 3; i < a.length; i += 4) {
      if (a[i] < 255) {
        hasAlpha = true;
        break;
      }
    }
    if (hasAlpha) {
      ox.globalCompositeOperation = 'destination-in';
      ox.imageSmoothingQuality = 'high';
      ox.drawImage(src, 0, 0, out.width, out.height);
      ox.globalCompositeOperation = 'source-over';
    }
    const jpeg = !hasAlpha && blobFor(obj.getSrc())?.type === 'image/jpeg';
    const blob = jpeg ? await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.95)) : await canvasBlob(out);
    const url = registerBlob(blob);
    const el = await loadImage(url);
    // Same place and size on the page, with the crop scaled to the new pixels.
    const k = out.width / W;
    const keep = { width: obj.width * k, height: obj.height * k, cropX: (obj.cropX || 0) * k, cropY: (obj.cropY || 0) * k, scaleX: obj.scaleX / k, scaleY: obj.scaleY / k };
    obj.setElement(el);
    obj.set(keep);
    // The frame shape is in the photo's own units, so its corner radius scales too.
    if (obj.frameShape?.r) obj.frameShape = { ...obj.frameShape, r: obj.frameShape.r * k };
    applyClip(obj);
    if (obj.filters?.length) obj.applyFilters();
    obj.setCoords();
    obj.dirty = true;
    canvas.requestRenderAll();
    record(true);
    emit('objects');
    note.done();
    toast(`Upscaled to ${out.width} × ${out.height} px.`);
  } catch (e) {
    note.done();
    toast(`Upscale failed: ${e.message || e}`, { error: true });
  }
}
