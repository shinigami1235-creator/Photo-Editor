import { canvas, fabric, designObjects, selected, isSpaceDown, decorate } from './canvas.js';
import { state, currentPage, emit, on, uid, markDirty } from './state.js';
import { record } from './history.js';
import { registerBlob, loadImage } from './assets.js';
import { rasterize, nativeScale, boundsOf, alphaBounds, cropCanvas, canvasBlob, pageToMask, maskSizeFor, cacheMask, maskDrawable } from './layerfx.js';
import { h, section, row, rangeField, toast, toHex } from './ui.js';
import { loadModel, runModel } from './bgremove.js';

// Pixel selections on the page, the way Photoshop does them. A selection is a
// page-sized mask (alpha = how selected) that stays put while you switch
// layers, so the same area can be copied, hidden or filled on any layer.

export const TOOLS = [
  ['rect', 'Rectangle', 'M'],
  ['ellipse', 'Ellipse', 'M'],
  ['lasso', 'Lasso', 'L'],
  ['poly', 'Polygon', 'L'],
  ['wand', 'Wand', 'W'],
];

const OPS = [
  ['new', 'New'],
  ['add', 'Add'],
  ['subtract', 'Subtract'],
  ['intersect', 'Intersect'],
];

const S = {
  on: false,
  tool: 'rect',
  op: 'new',
  tol: 32,
  contiguous: true,
  sample: 'layer',
  feather: 0,
  modify: 10,
  fill: '#c89a3c',
  mask: null, // canvas at S.res pixels per page unit
  res: 1,
  bounds: null, // page units
  paths: [], // outlines in page units, for the marching ants
  live: null,
  target: null,
  targetUid: null,
  undo: [],
  redo: [],
  lastWasSelection: false,
};

const W = () => state.doc.width;
const H = () => state.doc.height;
const page = () => ({ x: 0, y: 0, w: W(), h: H() });

export const hasSelection = () => !!S.mask;
export const isSelecting = () => S.on;
export function selectionTarget() {
  if (S.target && canvas.getObjects().includes(S.target)) return S.target;
  // After an undo the objects are rebuilt, so find the layer again by its id.
  const again = S.targetUid && canvas.getObjects().find((o) => o.uid === S.targetUid);
  S.target = again || null;
  return S.target;
}

function assignTarget(o) {
  S.target = o || null;
  S.targetUid = o?.uid || null;
}

/** The layer selection actions work on: the Select tab's layer, or the selected object. */
export function targetLayer() {
  if (S.on) return selectionTarget();
  const list = selected();
  return list.length === 1 ? list[0] : null;
}

export function setTarget(o) {
  assignTarget(o);
  drawOverlay();
  renderPanel();
  emit('selection-target');
}

// ---------- Mask helpers ----------

function resFor() {
  return Math.min(1.5, 3000 / Math.max(W(), H()));
}

function blankMask() {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W() * S.res));
  c.height = Math.max(1, Math.round(H() * S.res));
  return c;
}

/** A mask canvas with a shape drawn by fn(ctx) in page units. */
function shapeMask(fn) {
  const c = blankMask();
  const x = c.getContext('2d');
  x.setTransform(S.res, 0, 0, S.res, 0, 0);
  x.fillStyle = '#fff';
  fn(x);
  return c;
}

function cloneMask(c) {
  const n = blankMask();
  n.getContext('2d').drawImage(c, 0, 0, n.width, n.height);
  return n;
}

function blurred(c, px) {
  const n = blankMask();
  const x = n.getContext('2d');
  x.filter = `blur(${Math.max(0.1, px * S.res)}px)`;
  x.drawImage(c, 0, 0);
  return n;
}

/** Keeps alpha above a level, with a soft 1px edge. */
function threshold(c, level) {
  const x = c.getContext('2d');
  const img = x.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const lo = level * 255 - 24;
  for (let i = 3; i < d.length; i += 4) {
    const a = Math.max(0, Math.min(255, ((d[i] - lo) / 48) * 255));
    d[i - 3] = d[i - 2] = d[i - 1] = 255;
    d[i] = a;
  }
  x.putImageData(img, 0, 0);
  return c;
}

function applyFeather(c) {
  return S.feather > 0 ? blurred(c, S.feather / 2) : c;
}

function combine(shape, op) {
  if (op === 'new' || (!S.mask && op !== 'subtract' && op !== 'intersect')) return shape;
  if (!S.mask) return null;
  const n = cloneMask(S.mask);
  const x = n.getContext('2d');
  x.globalCompositeOperation = op === 'add' ? 'source-over' : op === 'subtract' ? 'destination-out' : 'destination-in';
  x.drawImage(shape, 0, 0);
  return n;
}

function snapshot() {
  if (!S.mask) return null;
  const d = S.mask.getContext('2d').getImageData(0, 0, S.mask.width, S.mask.height).data;
  const a = new Uint8Array(d.length / 4);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return { a, w: S.mask.width, h: S.mask.height };
}

function fromSnapshot(s) {
  if (!s) return null;
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  const x = c.getContext('2d');
  const img = x.createImageData(s.w, s.h);
  for (let i = 0; i < s.a.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = s.a[i];
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** Makes `c` the selection. An empty mask clears it. */
function setMask(c, { remember = true } = {}) {
  if (remember) {
    S.undo.push(snapshot());
    if (S.undo.length > 20) S.undo.shift();
    S.redo = [];
    S.lastWasSelection = true;
  }
  const b = c ? alphaBounds(c) : null;
  S.mask = b ? c : null;
  S.bounds = b ? { x: b.x / S.res, y: b.y / S.res, w: b.w / S.res, h: b.h / S.res } : null;
  S.paths = S.mask ? traceOutlines(S.mask) : [];
  drawOverlay();
  renderPanel();
  emit('selection-mask');
}

export function undoSelection() {
  if (!S.lastWasSelection || !S.undo.length) return false;
  S.redo.push(snapshot());
  setMask(fromSnapshot(S.undo.pop()), { remember: false });
  return true;
}

export function redoSelection() {
  if (!S.lastWasSelection || !S.redo.length) return false;
  S.undo.push(snapshot());
  setMask(fromSnapshot(S.redo.pop()), { remember: false });
  return true;
}

// ---------- Outlines ----------

/** Traces the edges of the selected area into closed outlines (page units). */
function traceOutlines(mask) {
  const g = Math.min(1, 1000 / Math.max(W(), H()));
  const gw = Math.max(2, Math.round(W() * g));
  const gh = Math.max(2, Math.round(H() * g));
  const c = document.createElement('canvas');
  c.width = gw;
  c.height = gh;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(mask, 0, 0, gw, gh);
  const d = x.getImageData(0, 0, gw, gh).data;
  const on = (i, j) => i >= 0 && j >= 0 && i < gw && j < gh && d[(j * gw + i) * 4 + 3] >= 128;
  const next = new Map(); // "x,y" -> [[x2,y2], ...]
  const add = (x1, y1, x2, y2) => {
    const k = x1 * 100003 + y1;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x2, y2]);
  };
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) add(i, j, i + 1, j);
      if (!on(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!on(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!on(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  const paths = [];
  for (const [k, list] of next) {
    while (list.length) {
      let cx = Math.floor(k / 100003);
      let cy = k - cx * 100003;
      const pts = [cx, cy];
      let [nx, ny] = list.pop();
      let guard = 0;
      while (guard++ < 1e6) {
        // Merge straight runs.
        const n = pts.length;
        if (n >= 4 && (pts[n - 2] - pts[n - 4]) * (ny - pts[n - 1]) === (pts[n - 1] - pts[n - 3]) * (nx - pts[n - 2])) {
          pts[n - 2] = nx;
          pts[n - 1] = ny;
        } else pts.push(nx, ny);
        cx = nx;
        cy = ny;
        const out = next.get(cx * 100003 + cy);
        if (!out || !out.length) break;
        [nx, ny] = out.pop();
      }
      if (pts.length >= 6) paths.push(Float32Array.from(pts, (v) => v / g));
    }
  }
  return paths;
}

// ---------- Overlay: marching ants and tool previews ----------

let overlay = null;
let phase = 0;
let antsTimer = 0;

function ensureOverlay() {
  if (overlay || !canvas?.wrapperEl) return overlay;
  overlay = document.createElement('canvas');
  overlay.className = 'sel-overlay';
  canvas.wrapperEl.appendChild(overlay);
  canvas.on('after:render', drawOverlay);
  return overlay;
}

const painters = new Set();
/** Adds a drawing step to the overlay: fn(ctx, toScreenX, toScreenY, dpr). */
export function addPainter(fn) {
  painters.add(fn);
  return () => painters.delete(fn);
}
export const refreshOverlay = () => drawOverlay();

function drawOverlay() {
  if (!ensureOverlay()) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.getWidth();
  const ch = canvas.getHeight();
  if (overlay.width !== Math.round(cw * dpr) || overlay.height !== Math.round(ch * dpr)) {
    overlay.width = Math.round(cw * dpr);
    overlay.height = Math.round(ch * dpr);
    overlay.style.width = `${cw}px`;
    overlay.style.height = `${ch}px`;
  }
  const x = overlay.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, overlay.width, overlay.height);
  if (!state.doc) return;
  const v = canvas.viewportTransform;
  const sx = (px) => (v[0] * px + v[4]) * dpr;
  const sy = (py) => (v[3] * py + v[5]) * dpr;

  // The layer the Select tab works on.
  const t = S.on ? selectionTarget() : null;
  if (t?.aCoords) {
    const { tl, tr, br, bl } = t.aCoords;
    x.strokeStyle = 'rgba(31,94,153,0.9)';
    x.lineWidth = dpr;
    x.setLineDash([2 * dpr, 3 * dpr]);
    x.beginPath();
    [tl, tr, br, bl].forEach((p, i) => (i ? x.lineTo(sx(p.x), sy(p.y)) : x.moveTo(sx(p.x), sy(p.y))));
    x.closePath();
    x.stroke();
  }

  if (S.paths.length) {
    const path = new Path2D();
    for (const p of S.paths) {
      path.moveTo(sx(p[0]), sy(p[1]));
      for (let i = 2; i < p.length; i += 2) path.lineTo(sx(p[i]), sy(p[i + 1]));
      path.closePath();
    }
    x.lineWidth = dpr;
    x.setLineDash([]);
    x.strokeStyle = '#ffffff';
    x.stroke(path);
    x.setLineDash([4 * dpr, 4 * dpr]);
    x.lineDashOffset = -phase * dpr;
    x.strokeStyle = '#000000';
    x.stroke(path);
  }

  const L = S.live;
  if (L) {
    x.lineWidth = dpr;
    x.setLineDash([4 * dpr, 3 * dpr]);
    x.strokeStyle = '#ffffff';
    x.fillStyle = 'rgba(31,94,153,0.12)';
    x.beginPath();
    if (L.kind === 'rect' || L.kind === 'ellipse') {
      const [x0, y0, x1, y1] = [sx(L.a.x), sy(L.a.y), sx(L.b.x), sy(L.b.y)];
      if (L.kind === 'rect') x.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      else x.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    } else if (L.pts?.length) {
      L.pts.forEach((p, i) => (i ? x.lineTo(sx(p.x), sy(p.y)) : x.moveTo(sx(p.x), sy(p.y))));
      if (L.kind === 'poly' && L.hover) x.lineTo(sx(L.hover.x), sy(L.hover.y));
    }
    x.fill();
    x.stroke();
    x.strokeStyle = '#000000';
    x.lineDashOffset = 3.5 * dpr;
    x.stroke();
    if (L.kind === 'poly' && L.pts.length) {
      x.setLineDash([]);
      x.fillStyle = '#ffffff';
      x.fillRect(sx(L.pts[0].x) - 3 * dpr, sy(L.pts[0].y) - 3 * dpr, 6 * dpr, 6 * dpr);
    }
  }
  for (const fn of painters) {
    x.save();
    fn(x, sx, sy, dpr);
    x.restore();
  }
}

function tickAnts() {
  clearInterval(antsTimer);
  antsTimer = setInterval(() => {
    if (!S.paths.length || document.hidden) return;
    phase = (phase + 1) % 8;
    drawOverlay();
  }, 110);
}

// ---------- Tools on the canvas ----------

function opFor(e) {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return S.op;
}

function commitShape(fn, op) {
  const shape = applyFeather(shapeMask(fn));
  setMask(combine(shape, op));
}

function polyPath(x, pts) {
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
  x.closePath();
  x.fill();
}

function closePoly() {
  const L = S.live;
  S.live = null;
  if (L?.pts.length >= 3) commitShape((x) => polyPath(x, L.pts), L.op);
  else drawOverlay();
}

export function setSelecting(onNow) {
  if (S.on === onNow) return;
  S.on = onNow;
  S.live = null;
  if (!canvas) return;
  canvas.skipTargetFind = onNow;
  canvas.selection = !onNow;
  canvas.defaultCursor = onNow ? 'crosshair' : 'default';
  canvas.hoverCursor = onNow ? 'crosshair' : 'move';
  if (onNow) {
    const list = selected();
    if (list.length === 1) assignTarget(list[0]);
    else if (!selectionTarget()) assignTarget([...designObjects()].reverse().find((o) => o.visible));
    canvas.discardActiveObject();
  } else if (selectionTarget()) canvas.setActiveObject(selectionTarget());
  canvas.requestRenderAll();
  drawOverlay();
}

export function initSelection() {
  ensureOverlay();
  tickAnts();
  canvas.on('mouse:down', (opt) => {
    if (!S.on || !state.doc) return;
    const e = opt.e;
    if (isSpaceDown() || e.button === 1 || e.button === 2) return;
    const p = canvas.getScenePoint(e);
    const op = opFor(e);
    if (S.tool === 'wand') return wandAt(p, op);
    if (S.tool === 'poly') {
      if (!S.live) S.live = { kind: 'poly', pts: [p], op };
      else {
        const f = S.live.pts[0];
        const z = canvas.getZoom();
        if (S.live.pts.length >= 3 && Math.hypot(f.x - p.x, f.y - p.y) * z < 9) return closePoly();
        S.live.pts.push(p);
      }
      return drawOverlay();
    }
    if (S.tool === 'lasso') S.live = { kind: 'lasso', pts: [p], op };
    else S.live = { kind: S.tool, a: p, b: p, op };
    drawOverlay();
  });
  canvas.on('mouse:move', (opt) => {
    const L = S.live;
    if (!S.on || !L) return;
    const p = canvas.getScenePoint(opt.e);
    if (L.kind === 'poly') L.hover = p;
    else if (L.kind === 'lasso') {
      const last = L.pts[L.pts.length - 1];
      if (Math.hypot(last.x - p.x, last.y - p.y) * canvas.getZoom() > 2) L.pts.push(p);
    } else L.b = p;
    drawOverlay();
  });
  canvas.on('mouse:up', () => {
    if (!S.on) return;
    canvas.selection = false;
    const L = S.live;
    if (!L || L.kind === 'poly') return;
    S.live = null;
    if (L.kind === 'lasso') {
      if (L.pts.length < 3) return drawOverlay();
      return commitShape((x) => polyPath(x, L.pts), L.op);
    }
    const x0 = Math.min(L.a.x, L.b.x);
    const y0 = Math.min(L.a.y, L.b.y);
    const w = Math.abs(L.b.x - L.a.x);
    const hh = Math.abs(L.b.y - L.a.y);
    if (w * canvas.getZoom() < 3 || hh * canvas.getZoom() < 3) {
      // A click without a drag clears the selection, as in Photoshop.
      if (L.op === 'new' && S.mask) setMask(null);
      return drawOverlay();
    }
    commitShape((x) => {
      x.beginPath();
      if (L.kind === 'rect') x.rect(x0, y0, w, hh);
      else x.ellipse(x0 + w / 2, y0 + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
      x.fill();
    }, L.op);
  });
  canvas.on('mouse:dblclick', () => {
    if (S.on && S.live?.kind === 'poly') {
      // The double click's own two presses added two extra points.
      S.live.pts.splice(-1, 1);
      closePoly();
    }
  });
  const forget = () => {
    S.lastWasSelection = false;
  };
  ['object:added', 'object:removed', 'object:modified'].forEach((ev) => canvas.on(ev, forget));
  on('page', () => clearSelection());
  on('doc', () => clearSelection());
  window.addEventListener('resize', () => drawOverlay());
}

function clearSelection() {
  S.res = state.doc ? resFor() : 1;
  S.mask = null;
  S.bounds = null;
  S.paths = [];
  S.live = null;
  S.undo = [];
  S.redo = [];
  selectionTarget();
  drawOverlay();
  renderPanel();
}

// ---------- Wand ----------

function sampleCanvas() {
  const t = selectionTarget() || targetLayer();
  const all = S.sample === 'all' || !t;
  const objs = all ? designObjects().filter((o) => o.visible) : [t];
  const r = rasterize(objs, page(), S.res, { plain: !all });
  if (!all) return r;
  const c = blankMask();
  const x = c.getContext('2d');
  x.fillStyle = currentPage().background || '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(r, 0, 0);
  return c;
}

function wandAt(p, op) {
  const src = sampleCanvas();
  const w = src.width;
  const hgt = src.height;
  const px = Math.floor(p.x * S.res);
  const py = Math.floor(p.y * S.res);
  if (px < 0 || py < 0 || px >= w || py >= hgt) return;
  const d = src.getContext('2d').getImageData(0, 0, w, hgt).data;
  const i0 = (py * w + px) * 4;
  const seed = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const tol = S.tol * 2.55;
  const near = (k) => {
    const i = k * 4;
    return Math.max(Math.abs(d[i] - seed[0]), Math.abs(d[i + 1] - seed[1]), Math.abs(d[i + 2] - seed[2]), Math.abs(d[i + 3] - seed[3])) <= tol;
  };
  const hit = new Uint8Array(w * hgt);
  if (S.contiguous) {
    const stack = new Int32Array(w * hgt);
    let top = 0;
    stack[top++] = py * w + px;
    hit[py * w + px] = 1;
    while (top) {
      const k = stack[--top];
      const x = k % w;
      const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, k >= w ? k - w : -1, k < w * (hgt - 1) ? k + w : -1];
      for (const n of nb) {
        if (n >= 0 && !hit[n] && near(n)) {
          hit[n] = 1;
          stack[top++] = n;
        }
      }
    }
  } else for (let k = 0; k < w * hgt; k++) hit[k] = near(k) ? 1 : 0;
  const c = blankMask();
  const x = c.getContext('2d');
  const img = x.createImageData(w, hgt);
  for (let k = 0; k < hit.length; k++) {
    if (!hit[k]) continue;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = img.data[k * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  setMask(combine(applyFeather(c), op));
}

// ---------- Selection commands ----------

export function selectAll() {
  if (!state.doc) return;
  setMask(shapeMask((x) => x.fillRect(0, 0, W(), H())));
}

export function deselect() {
  if (S.live) {
    S.live = null;
    return drawOverlay();
  }
  if (S.mask) setMask(null);
}

export function invertSelection() {
  if (!state.doc) return;
  const c = shapeMask((x) => x.fillRect(0, 0, W(), H()));
  if (S.mask) {
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(S.mask, 0, 0);
  }
  setMask(c);
}

/** Selects a layer's visible pixels (Ctrl+click in the layers list). */
export function selectFromLayer(o, op = 'new') {
  if (!o) return;
  const r = rasterize([o], page(), S.res, { plain: true });
  const x = r.getContext('2d');
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, r.width, r.height);
  setMask(combine(r, op));
}

export function featherSelection(px) {
  if (!S.mask || px <= 0) return;
  setMask(blurred(S.mask, px / 2));
}

/** Grows (px > 0) or shrinks (px < 0) the selection edge. */
export function growSelection(px) {
  if (!S.mask || !px) return;
  const sigma = Math.abs(px) / 1.645;
  setMask(threshold(blurred(S.mask, sigma), px > 0 ? 0.05 : 0.95));
}

// ---------- Select subject ----------

let subjectBusy = false;

/**
 * Selects the main subject of the layer (or of the whole page with All layers
 * picked) with the background model.
 */
export async function selectSubject(op = 'new', layer = undefined) {
  if (subjectBusy || !state.doc) return false;
  const t = layer === undefined ? targetLayer() : layer;
  const objs = t ? [t] : designObjects().filter((o) => o.visible);
  if (!objs.length) return false;
  const r = t ? intersect(boundsOf([t]), page()) : page();
  if (!r) return toast('This layer is outside the page.'), false;
  subjectBusy = true;
  renderPanel();
  const note = toast('Finding the subject', { sticky: true });
  try {
    await loadModel((text, f) => {
      note.text(text);
      if (f != null) note.progress(f);
    });
    note.text('Finding the subject');
    const scale = Math.min(nativeScale(objs, r), 2048 / Math.max(r.w, r.h));
    const flat = rasterize(objs, r, scale, { plain: !!t });
    const pic = document.createElement('canvas');
    pic.width = flat.width;
    pic.height = flat.height;
    const px = pic.getContext('2d');
    px.fillStyle = t ? '#ffffff' : currentPage().background || '#ffffff';
    px.fillRect(0, 0, pic.width, pic.height);
    px.drawImage(flat, 0, 0);
    const m = await runModel(pic, { x: 0, y: 0, w: pic.width, h: pic.height });
    const shape = blankMask();
    const x = shape.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(m, r.x * S.res, r.y * S.res, r.w * S.res, r.h * S.res);
    if (t) {
      // Only where the layer has pixels.
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(flat, r.x * S.res, r.y * S.res, r.w * S.res, r.h * S.res);
    }
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, shape.width, shape.height);
    setMask(combine(shape, op));
    return true;
  } catch (e) {
    toast(`The subject could not be found: ${e.message}`, { error: true });
    return false;
  } finally {
    note.done();
    subjectBusy = false;
    renderPanel();
  }
}

/**
 * Puts text behind the person or product in a photo: the subject is copied to
 * a layer on top, so any text between the photo and that copy sits behind it.
 */
export async function textBehindSubject(photo, addText) {
  if (!photo) return;
  if (!(await selectSubject('new', photo)) || !S.mask) return;
  const objs = canvas.getObjects();
  const texts = objs.slice(objs.indexOf(photo) + 1).filter((o) => o.type === 'textbox');
  const copy = await copyWith(photo, 'Subject in front');
  setMask(null);
  if (!copy) return;
  let text = texts[0];
  if (!text) {
    // A big heading across the top third of the photo, where heads and products usually sit.
    text = await addText();
    const b = photo.getBoundingRect();
    text.set({ fontSize: Math.round(Math.min(W(), H()) * 0.16), width: Math.min(W(), b.width) * 0.95 });
    text.initDimensions();
    text.setPositionByOrigin(new fabric.Point(b.left + b.width / 2, b.top + b.height * 0.3), 'center', 'center');
    text.setCoords();
  }
  canvas.bringObjectToFront(copy);
  canvas.moveObjectTo(text, canvas.getObjects().length - 2);
  canvas.setActiveObject(text);
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

/** Copies the selected part of one layer to a new layer, with a name. */
async function copyWith(o, name) {
  const region = intersect(S.bounds, boundsOf([o]));
  if (!region) return null;
  const scale = nativeScale([o], region);
  const c = rasterize([o], region, scale, { plain: true });
  const x = c.getContext('2d');
  x.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(S.mask, 0, 0, W(), H());
  return addLayerFrom(c, region, scale, name, o);
}

// ---------- Saved selections ----------

const savedList = () => (currentPage().selections ||= []);

export async function saveSelection() {
  if (!S.mask) return;
  const list = savedList();
  const url = registerBlob(await canvasBlob(S.mask));
  list.push({ id: uid(), name: `Selection ${list.length + 1}`, url });
  markDirty();
  renderPanel();
}

export async function loadSaved(entry, op = S.op) {
  const img = await loadImage(entry.url);
  const c = blankMask();
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  setMask(combine(c, op));
}

function deleteSaved(entry) {
  const list = savedList();
  list.splice(list.indexOf(entry), 1);
  markDirty();
  renderPanel();
}

// ---------- Working with a layer ----------

function needLayer() {
  const t = targetLayer();
  if (!t) toast('Pick a layer first.');
  return t;
}

function intersect(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Puts a canvas on the page as a new photo layer above `above` (or on top). */
async function addLayerFrom(c, rect, scale, name, above) {
  const ab = alphaBounds(c);
  if (!ab) return null;
  const crop = cropCanvas(c, ab);
  const url = registerBlob(await canvasBlob(crop));
  const el = await loadImage(url);
  const img = new fabric.FabricImage(el, {
    uid: uid(),
    name,
    frameShape: { kind: 'rect', r: 0 },
    originX: 'left',
    originY: 'top',
    left: rect.x + ab.x / scale,
    top: rect.y + ab.y / scale,
    scaleX: 1 / scale,
    scaleY: 1 / scale,
  });
  decorate(img);
  const objs = canvas.getObjects();
  const at = above ? objs.indexOf(above) + 1 : objs.length;
  canvas.insertAt(at, img);
  img.setCoords();
  return img;
}

/**
 * Copies the selected pixels of the layer (or of everything, with no layer
 * picked) onto a new layer. With `cut`, the area is hidden on the original.
 */
export async function copyToLayer(cut = false) {
  if (!S.mask) return;
  const t = targetLayer();
  const objs = t ? [t] : designObjects().filter((o) => o.visible);
  if (!objs.length) return;
  const region = intersect(S.bounds, boundsOf(objs));
  if (!region) return toast(t ? 'The selection misses this layer.' : 'Nothing is inside the selection.');
  const scale = nativeScale(objs, region);
  const c = rasterize(objs, region, scale, { plain: !!t });
  const x = c.getContext('2d');
  x.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(S.mask, 0, 0, W(), H());
  const name = `${t ? t.name || 'Layer' : 'Merged'} ${cut ? 'cut' : 'copy'}`;
  const img = await addLayerFrom(c, region, scale, name, t || null);
  if (!img) return toast('The selected area of this layer is empty.');
  if (cut && t) await hideArea(t, 'inside', { quiet: true });
  record(true);
  emit('objects');
  if (S.on) setTarget(img);
  else {
    canvas.setActiveObject(img);
    canvas.requestRenderAll();
  }
  return img;
}

/** Fills the selection with a colour, as a new layer. */
export async function fillSelection(color = S.fill) {
  if (!S.mask) return;
  const r = S.bounds;
  const scale = S.res;
  const c = document.createElement('canvas');
  c.width = Math.ceil(r.w * scale);
  c.height = Math.ceil(r.h * scale);
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(S.mask, -r.x * scale, -r.y * scale);
  const img = await addLayerFrom(c, r, scale, 'Fill', targetLayer());
  if (!img) return;
  record(true);
  emit('objects');
  if (S.on) setTarget(img);
}

/**
 * Edits a layer's mask with the selection: 'inside' hides the selected area,
 * 'outside' hides the rest, 'show' brings the selected area back.
 */
export async function hideArea(o, how, { quiet = false } = {}) {
  if (!S.mask || !o) return;
  const old = o.layerMask ? maskDrawable(o) : null;
  if (o.layerMask && !old) return toast('The mask is still loading. Try again.');
  const [sw, sh] = maskSizeFor(o);
  const mw = Math.max(sw, old ? old.naturalWidth || old.width : 0);
  const mh = Math.max(sh, old ? old.naturalHeight || old.height : 0);
  const c = document.createElement('canvas');
  c.width = mw;
  c.height = mh;
  const x = c.getContext('2d');
  if (old && o.maskOn !== false) x.drawImage(old, 0, 0, mw, mh);
  else {
    x.fillStyle = '#fff';
    x.fillRect(0, 0, mw, mh);
  }
  x.setTransform(pageToMask(o, mw, mh));
  x.globalCompositeOperation = how === 'inside' ? 'destination-out' : how === 'outside' ? 'destination-in' : 'source-over';
  x.drawImage(S.mask, 0, 0, W(), H());
  await setLayerMask(o, c);
  if (!quiet) {
    record(true);
    emit('objects');
  }
}

export async function setLayerMask(o, c) {
  const url = registerBlob(await canvasBlob(c));
  cacheMask(url, c);
  o.set({ layerMask: url, maskOn: true });
  o.dirty = true;
  canvas.requestRenderAll();
}

export async function invertLayerMask(o) {
  const old = maskDrawable(o);
  if (!old) return;
  const c = document.createElement('canvas');
  c.width = old.naturalWidth || old.width;
  c.height = old.naturalHeight || old.height;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(old, 0, 0, c.width, c.height);
  await setLayerMask(o, c);
  record(true);
  emit('objects');
}

export function removeLayerMask(o) {
  o.set({ layerMask: null, maskOn: true });
  o.dirty = true;
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

export function toggleLayerMask(o) {
  o.set({ maskOn: o.maskOn === false });
  o.dirty = true;
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

/** Flattens layers into one photo layer, keeping how they look together. */
export async function mergeLayers(list) {
  const objs = canvas.getObjects();
  list = [...list].sort((a, b) => objs.indexOf(a) - objs.indexOf(b));
  if (list.length < 2) return;
  canvas.discardActiveObject();
  const rect = boundsOf(list);
  const scale = nativeScale(list, rect);
  const c = rasterize(list, rect, scale);
  const img = await addLayerFrom(c, rect, scale, 'Merged', list[list.length - 1]);
  canvas.remove(...list);
  if (img) {
    if (S.on) setTarget(img);
    else canvas.setActiveObject(img);
  }
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

/** The layer below, for Merge down. */
export function layerBelow(o) {
  const list = designObjects();
  return list[list.indexOf(o) - 1] || null;
}

// ---------- Keys ----------

/** Selection shortcuts. Returns true when the key was used. */
export function handleSelectionKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && e.shiftKey && k === 'i' && (S.mask || S.on)) return e.preventDefault(), invertSelection(), true;
  if (mod && k === 'z' && !e.shiftKey && undoSelection()) return e.preventDefault(), true;
  if (mod && (k === 'y' || (k === 'z' && e.shiftKey)) && redoSelection()) return e.preventDefault(), true;
  if (S.on && S.live?.kind === 'poly') {
    if (k === 'enter') return e.preventDefault(), closePoly(), true;
    if (k === 'backspace') {
      e.preventDefault();
      S.live.pts.pop();
      if (!S.live.pts.length) S.live = null;
      drawOverlay();
      return true;
    }
  }
  if (k === 'escape' && (S.live || S.mask)) return e.preventDefault(), deselect(), true;
  if (mod && k === 'd' && S.mask) return e.preventDefault(), deselect(), true;
  if (mod && k === 'a' && S.on) return e.preventDefault(), selectAll(), true;
  if (mod && k === 'j' && S.mask) return e.preventDefault(), copyToLayer(e.shiftKey), true;
  if ((k === 'delete' || k === 'backspace') && S.mask && targetLayer()) return e.preventDefault(), hideArea(targetLayer(), 'inside'), true;
  if (S.on && !mod && !e.altKey) {
    if (k === 'm') return setTool(S.tool === 'rect' ? 'ellipse' : 'rect'), true;
    if (k === 'l') return setTool(S.tool === 'lasso' ? 'poly' : 'lasso'), true;
    if (k === 'w') return setTool('wand'), true;
  }
  return false;
}

function setTool(t) {
  S.tool = t;
  S.live = null;
  drawOverlay();
  renderPanel();
}

// ---------- Panel ----------

let panelHost = null;

const layerLabel = (o) => (o.type === 'textbox' ? o.text.split('\n')[0].slice(0, 30) || 'Text' : o.name || 'Layer');

export function selectPanel(body) {
  panelHost = h('div', { class: 'sel-panel' });
  body.append(panelHost);
  renderPanel();
}

function renderPanel() {
  if (!panelHost || !panelHost.isConnected || !state.doc) return;
  panelHost.innerHTML = '';
  const t = selectionTarget();
  const has = !!S.mask;
  const seg = (items, cur, pick, cls = '') =>
    h(
      'div',
      { class: 'seg' + cls },
      items.map(([v, label, key]) => h('button', { class: cur === v ? 'on' : '', title: key ? `${label} (${key})` : label, onclick: () => pick(v) }, label)),
    );
  const btn = (label, fn, { disabled = false, title = '', primary = false } = {}) =>
    h('button', { class: 'btn' + (primary ? ' primary' : ''), title, disabled, onclick: fn }, label);

  const layers = [...designObjects()].reverse();
  const layerSelect = h(
    'select',
    {
      class: 'field',
      onchange: (e) => setTarget(e.target.value === '' ? null : layers[+e.target.value]),
    },
    h('option', { value: '', selected: !t }, 'All layers'),
    layers.map((o, i) => h('option', { value: String(i), selected: o === t }, layerLabel(o))),
  );

  const hint = {
    rect: 'Drag to select a rectangle.',
    ellipse: 'Drag to select an ellipse.',
    lasso: 'Drag around an area.',
    poly: 'Click each corner. Click the first point, double-click or press Enter to close.',
    wand: 'Click a colour to select the area around it.',
  }[S.tool];

  panelHost.append(
    section(
      'Tool',
      h('div', { class: 'sel-tools' }, seg(TOOLS.slice(0, 3), S.tool, setTool), seg(TOOLS.slice(3), S.tool, setTool)),
      seg(
        OPS,
        S.op,
        (v) => {
          S.op = v;
          renderPanel();
        },
        ' small',
      ),
      h('p', { class: 'muted small' }, `${hint} Hold Shift to add, Alt to subtract.`),
      S.tool === 'wand' ? rangeField('Tolerance', S.tol, (v) => (S.tol = v), { min: 0, max: 100 }) : null,
      S.tool === 'wand'
        ? h(
            'label',
            { class: 'check' },
            h('input', { type: 'checkbox', checked: S.contiguous, onchange: (e) => (S.contiguous = e.target.checked) }),
            'Connected area only',
          )
        : null,
      S.tool === 'wand'
        ? h(
            'label',
            { class: 'field-row' },
            h('span', { class: 'label' }, 'Look at'),
            h(
              'select',
              { class: 'field', onchange: (e) => (S.sample = e.target.value) },
              h('option', { value: 'layer', selected: S.sample === 'layer' }, 'This layer'),
              h('option', { value: 'all', selected: S.sample === 'all' }, 'All layers'),
            ),
          )
        : null,
      rangeField('Feather', S.feather, (v) => (S.feather = v), { min: 0, max: 100, suffix: ' px' }),
    ),
    section('Layer', layerSelect, h('p', { class: 'muted small' }, 'Selections stay when you pick another layer. Ctrl+click a layer in Layers to select its shape.')),
    section(
      'Selection',
      h(
        'button',
        { class: 'btn wide', disabled: subjectBusy, title: 'Finds the person or product with the background model', onclick: () => selectSubject(S.op) },
        subjectBusy ? 'Finding the subject' : 'Select subject',
      ),
      row(btn('Select all', selectAll, { title: 'Ctrl+A' }), btn('Deselect', deselect, { disabled: !has, title: 'Esc or Ctrl+D' })),
      row(btn('Invert', invertSelection, { title: 'Ctrl+Shift+I' }), btn('From layer', () => selectFromLayer(t), { disabled: !t, title: 'Selects the pixels of this layer' })),
      h(
        'label',
        { class: 'num-field' },
        h('span', { class: 'label' }, 'Edge by'),
        h('input', {
          class: 'field num',
          type: 'number',
          min: 1,
          max: 500,
          value: S.modify,
          oninput: (e) => (S.modify = Math.max(1, +e.target.value || 1)),
        }),
        h('span', { class: 'suffix' }, 'px'),
      ),
      row(
        btn('Expand', () => growSelection(S.modify), { disabled: !has }),
        btn('Contract', () => growSelection(-S.modify), { disabled: !has }),
        btn('Feather', () => featherSelection(S.modify), { disabled: !has }),
      ),
    ),
    section(
      'Use the selection',
      h('button', { class: 'btn wide primary', disabled: !has, title: 'Ctrl+J', onclick: () => copyToLayer(false) }, t ? 'Copy to new layer' : 'Copy all layers to new layer'),
      h('button', { class: 'btn wide', disabled: !has || !t, title: 'Ctrl+Shift+J', onclick: () => copyToLayer(true) }, 'Cut to new layer'),
      row(
        btn('Hide area', () => hideArea(t, 'inside'), { disabled: !has || !t, title: 'Delete. Hides it with a layer mask, so Show area brings it back' }),
        btn('Keep only area', () => hideArea(t, 'outside'), { disabled: !has || !t }),
      ),
      h('button', { class: 'btn wide', disabled: !has || !t || !t.layerMask, onclick: () => hideArea(t, 'show') }, 'Show area again'),
      h(
        'div',
        { class: 'row' },
        h('input', { type: 'color', class: 'color', value: toHex(S.fill), oninput: (e) => (S.fill = e.target.value) }),
        h('button', { class: 'btn grow', disabled: !has, onclick: () => fillSelection() }, 'Fill as new layer'),
      ),
    ),
    section(
      'Saved selections',
      h('button', { class: 'btn wide', disabled: !has, onclick: saveSelection }, 'Save selection'),
      savedList().length
        ? h(
            'div',
            { class: 'sel-saved' },
            savedList().map((s) =>
              h(
                'div',
                { class: 'sel-saved-row' },
                h('button', { class: 'link grow', title: 'Load. Shift adds it, Alt subtracts it', onclick: (e) => loadSaved(s, opFor(e)) }, s.name),
                h('button', { class: 'icon-btn tiny', title: 'Delete', onclick: () => deleteSaved(s), html: '&times;' }),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'Saved selections stay with this page and are kept in the design file.'),
    ),
  );
}

on('objects', () => renderPanel());
