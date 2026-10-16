import { canvas, fabric, designObjects, selected } from './canvas.js';
import { state, currentPage } from './state.js';
import { record } from './history.js';
import { selectObjects } from './objects.js';

// Snap guides while dragging, plus align and distribute.

let lines = { x: [], y: [] };
let measures = []; // { x1, y1, x2, y2, text } in page units, while dragging
export let snapping = true;
export const setSnapping = (v) => (snapping = v);

function box(o) {
  const r = o.getBoundingRect();
  return { l: r.left, t: r.top, r: r.left + r.width, b: r.top + r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
}

function targets(moving) {
  const skip = new Set(moving.type === 'activeselection' ? moving.getObjects() : [moving]);
  const xs = [0, state.doc.width / 2, state.doc.width];
  const ys = [0, state.doc.height / 2, state.doc.height];
  // Ruler guides and the edges of carousel slides.
  for (const g of currentPage()?.guides || []) (g.axis === 'x' ? xs : ys).push(g.pos);
  const n = state.doc.slides || 0;
  for (let i = 1; i < n; i++) xs.push((state.doc.width * i) / n, (state.doc.width * (i - 0.5)) / n);
  if (n > 1) xs.push(state.doc.width * (1 - 0.5 / n));
  for (const o of designObjects()) {
    if (skip.has(o) || !o.visible) continue;
    const b = box(o);
    xs.push(b.l, b.cx, b.r);
    ys.push(b.t, b.cy, b.b);
  }
  return { xs, ys };
}

function best(values, candidates, tol) {
  let hit = null;
  for (const v of values) {
    for (const c of candidates) {
      const d = c - v;
      if (Math.abs(d) <= tol && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, at: c };
    }
  }
  return hit;
}

export function initGuides() {
  canvas.on('object:moving', (e) => {
    lines = { x: [], y: [] };
    measures = [];
    const o = e.target;
    if (o.isTemp) return;
    if (!snapping || e.e?.altKey) {
      measures = spacing(o, box(o));
      return;
    }
    const tol = 6 / canvas.getZoom();
    const b = box(o);
    const { xs, ys } = targets(o);
    const hx = best([b.l, b.cx, b.r], xs, tol);
    const hy = best([b.t, b.cy, b.b], ys, tol);
    if (hx) o.left += hx.d;
    if (hy) o.top += hy.d;
    if (hx || hy) o.setCoords();
    const nb = box(o);
    measures = spacing(o, nb);
    // Show every guide the object now touches.
    for (const x of new Set(xs)) if ([nb.l, nb.cx, nb.r].some((v) => Math.abs(v - x) < 0.5)) lines.x.push(x);
    for (const y of new Set(ys)) if ([nb.t, nb.cy, nb.b].some((v) => Math.abs(v - y) < 0.5)) lines.y.push(y);
  });
  const clear = () => {
    if (lines.x.length || lines.y.length || measures.length) {
      lines = { x: [], y: [] };
      measures = [];
      canvas.requestRenderAll();
    }
  };
  canvas.on('mouse:up', clear);
  canvas.on('selection:cleared', clear);

  canvas.on('after:render', ({ ctx }) => {
    if (measures.length) drawMeasures(ctx);
    if (!lines.x.length && !lines.y.length) return;
    const v = canvas.viewportTransform;
    const z = canvas.getZoom();
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    ctx.strokeStyle = '#ff3fa4';
    ctx.lineWidth = 1 / z;
    const pad = 4000;
    ctx.beginPath();
    for (const x of lines.x) {
      ctx.moveTo(x, -pad);
      ctx.lineTo(x, state.doc.height + pad);
    }
    for (const y of lines.y) {
      ctx.moveTo(-pad, y);
      ctx.lineTo(state.doc.width + pad, y);
    }
    ctx.stroke();
    ctx.restore();
  });
}

/**
 * The gaps from a moving layer to the nearest layer (or the page edge) on each
 * side, shown as labelled lines like Figma's spacing hints.
 */
function spacing(moving, b) {
  const skip = new Set(moving.type === 'activeselection' ? moving.getObjects() : [moving]);
  const others = designObjects().filter((o) => !skip.has(o) && o.visible && !o.isAdjustment).map(box);
  const out = [];
  const cy = (Math.max(b.t, 0) + Math.min(b.b, state.doc.height)) / 2;
  const cx = (Math.max(b.l, 0) + Math.min(b.r, state.doc.width)) / 2;
  const overlapY = (o) => o.t < b.b && o.b > b.t;
  const overlapX = (o) => o.l < b.r && o.r > b.l;
  const near = (cands, pick) => cands.reduce((best, o) => (best == null || pick(o) > pick(best) ? o : best), null);
  // Left and right.
  const left = near(others.filter((o) => overlapY(o) && o.r <= b.l + 0.5), (o) => o.r);
  const right = near(others.filter((o) => overlapY(o) && o.l >= b.r - 0.5), (o) => -o.l);
  const top = near(others.filter((o) => overlapX(o) && o.b <= b.t + 0.5), (o) => o.b);
  const bottom = near(others.filter((o) => overlapX(o) && o.t >= b.b - 0.5), (o) => -o.t);
  const lx = left ? left.r : 0;
  const rx = right ? right.l : state.doc.width;
  const ty = top ? top.b : 0;
  const by = bottom ? bottom.t : state.doc.height;
  if (b.l - lx > 0.5) out.push({ x1: lx, y1: cy, x2: b.l, y2: cy, d: b.l - lx });
  if (rx - b.r > 0.5) out.push({ x1: b.r, y1: cy, x2: rx, y2: cy, d: rx - b.r });
  if (b.t - ty > 0.5) out.push({ x1: cx, y1: ty, x2: cx, y2: b.t, d: b.t - ty });
  if (by - b.b > 0.5) out.push({ x1: cx, y1: b.b, x2: cx, y2: by, d: by - b.b });
  // Equal gaps on both sides show in pink.
  const h = out.filter((m) => m.y1 === m.y2);
  const v = out.filter((m) => m.x1 === m.x2);
  if (h.length === 2 && Math.abs(h[0].d - h[1].d) < 1) h.forEach((m) => (m.equal = true));
  if (v.length === 2 && Math.abs(v[0].d - v[1].d) < 1) v.forEach((m) => (m.equal = true));
  return out;
}

function drawMeasures(ctx) {
  const v = canvas.viewportTransform;
  const z = canvas.getZoom();
  const r = canvas.getRetinaScaling?.() || 1;
  ctx.save();
  ctx.setTransform(r, 0, 0, r, 0, 0);
  const sx = (x) => x * v[0] + v[4];
  const sy = (y) => y * v[3] + v[5];
  ctx.font = '600 11px "IBM Plex Sans", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of measures) {
    const col = m.equal ? '#ff3fa4' : '#e0712c';
    const x1 = sx(m.x1);
    const y1 = sy(m.y1);
    const x2 = sx(m.x2);
    const y2 = sy(m.y2);
    if (Math.hypot(x2 - x1, y2 - y1) < 6) continue;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    const vert = m.x1 === m.x2;
    for (const [x, y] of [
      [x1, y1],
      [x2, y2],
    ]) {
      if (vert) ctx.moveTo(x - 4, y), ctx.lineTo(x + 4, y);
      else ctx.moveTo(x, y - 4), ctx.lineTo(x, y + 4);
    }
    ctx.stroke();
    const text = String(Math.round(m.d));
    const tw = ctx.measureText(text).width + 8;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect?.(mx - tw / 2, my - 8, tw, 16, 4) ?? ctx.rect(mx - tw / 2, my - 8, tw, 16);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, mx, my + 0.5);
  }
  ctx.restore();
  void z;
}

function moveBy(o, dx, dy) {
  o.left += dx;
  o.top += dy;
  o.setCoords();
}

/** Aligns the selection to itself, or a single object to the page. */
export function align(how) {
  const list = selected().filter((o) => !o.locked);
  if (!list.length) return;
  canvas.discardActiveObject();
  let ref;
  if (list.length === 1) ref = { l: 0, t: 0, r: state.doc.width, b: state.doc.height, cx: state.doc.width / 2, cy: state.doc.height / 2 };
  else {
    const bs = list.map(box);
    const l = Math.min(...bs.map((b) => b.l));
    const t = Math.min(...bs.map((b) => b.t));
    const r = Math.max(...bs.map((b) => b.r));
    const b = Math.max(...bs.map((b) => b.b));
    ref = { l, t, r, b, cx: (l + r) / 2, cy: (t + b) / 2 };
  }
  for (const o of list) {
    const b = box(o);
    if (how === 'left') moveBy(o, ref.l - b.l, 0);
    if (how === 'center') moveBy(o, ref.cx - b.cx, 0);
    if (how === 'right') moveBy(o, ref.r - b.r, 0);
    if (how === 'top') moveBy(o, 0, ref.t - b.t);
    if (how === 'middle') moveBy(o, 0, ref.cy - b.cy);
    if (how === 'bottom') moveBy(o, 0, ref.b - b.b);
  }
  selectObjects(list);
  record();
}

/** Equal gaps between three or more objects. */
export function distribute(axis) {
  const list = selected().filter((o) => !o.locked);
  if (list.length < 3) return;
  canvas.discardActiveObject();
  const horiz = axis === 'x';
  const items = list.map((o) => ({ o, b: box(o) })).sort((a, b) => (horiz ? a.b.l - b.b.l : a.b.t - b.b.t));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const span = horiz ? last.r - first.l : last.b - first.t;
  const total = items.reduce((s, i) => s + (horiz ? i.b.w : i.b.h), 0);
  const gap = (span - total) / (items.length - 1);
  let pos = horiz ? first.l : first.t;
  for (const { o, b } of items) {
    if (horiz) moveBy(o, pos - b.l, 0);
    else moveBy(o, 0, pos - b.t);
    pos += (horiz ? b.w : b.h) + gap;
  }
  selectObjects(list);
  record();
}

export { fabric };
