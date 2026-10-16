import { canvas, fabric, selected, isSpaceDown } from './canvas.js';
import { state, emit } from './state.js';
import { record } from './history.js';
import { h } from './ui.js';
import { defineCommands } from './commands.js';
import { addPainter, refreshOverlay } from './selection.js';
import { hasCorners } from './layerfx.js';

// Distort, Perspective and Skew: drag the four corners of a layer. The layer
// keeps its own pixels and settings, so the change can be redone or reset.

const S = { obj: null, mode: 'distort', before: null, drag: null };
let bar = null;

const defaults = (o) => [-o.width / 2, -o.height / 2, o.width / 2, -o.height / 2, o.width / 2, o.height / 2, -o.width / 2, o.height / 2];
const H_PARTNER = [1, 0, 3, 2];
const V_PARTNER = [3, 2, 1, 0];

export const isTransforming = () => !!S.obj;

function toPage(o, x, y) {
  return new fabric.Point(x, y).transform(o.calcTransformMatrix());
}
function toLocal(o, p) {
  return p.transform(fabric.util.invertTransform(o.calcTransformMatrix()));
}

function start(mode) {
  const [o] = selected();
  if (!o || o.isAdjustment || selected().length > 1) return;
  if (S.obj) finish(true);
  S.obj = o;
  S.mode = mode;
  S.before = o.corners ? [...o.corners] : null;
  if (!hasCorners(o)) o.corners = defaults(o);
  canvas.discardActiveObject();
  canvas.skipTargetFind = true;
  canvas.selection = false;
  showBar();
  refreshOverlay();
  canvas.requestRenderAll();
}

function showBar() {
  bar?.remove();
  const seg = h(
    'div',
    { class: 'seg small' },
    [
      ['distort', 'Distort'],
      ['perspective', 'Perspective'],
      ['skew', 'Skew'],
    ].map(([v, label]) => h('button', { class: S.mode === v ? 'on' : '', onclick: () => ((S.mode = v), showBar()) }, label)),
  );
  const hint = { distort: 'Drag any corner anywhere.', perspective: 'Drag a corner and the opposite one on that side moves with it.', skew: 'Drag a corner to slide its whole side.' }[S.mode];
  bar = h(
    'div',
    { class: 'crop-bar show mask-bar' },
    h('strong', {}, 'Transform'),
    seg,
    h('span', { class: 'muted small' }, hint),
    h('button', { class: 'btn small', onclick: () => ((S.obj.corners = defaults(S.obj)), (S.obj.dirty = true), canvas.requestRenderAll(), refreshOverlay()) }, 'Straighten'),
    h('button', { class: 'btn small', onclick: () => finish(false) }, 'Cancel'),
    h('button', { class: 'btn primary small', onclick: () => finish(true) }, 'Done'),
  );
  document.getElementById('workspace').append(bar);
}

function finish(keep) {
  const o = S.obj;
  if (!o) return;
  S.obj = null;
  S.drag = null;
  bar?.remove();
  bar = null;
  if (!keep) o.corners = S.before;
  else if (o.corners && o.corners.every((v, i) => Math.abs(v - defaults(o)[i]) < 0.01)) o.corners = null;
  o.dirty = true;
  canvas.skipTargetFind = false;
  canvas.selection = true;
  canvas.setActiveObject(o);
  canvas.requestRenderAll();
  refreshOverlay();
  if (keep) record(true);
  emit('objects');
}

function paint(x, sx, sy, dpr) {
  const o = S.obj;
  if (!o) return;
  const pts = [0, 1, 2, 3].map((i) => toPage(o, o.corners[i * 2], o.corners[i * 2 + 1]));
  x.save();
  x.lineWidth = dpr;
  x.strokeStyle = '#1f5e99';
  x.beginPath();
  pts.forEach((p, i) => (i ? x.lineTo(sx(p.x), sy(p.y)) : x.moveTo(sx(p.x), sy(p.y))));
  x.closePath();
  x.stroke();
  for (const p of pts) {
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.rect(sx(p.x) - 5 * dpr, sy(p.y) - 5 * dpr, 10 * dpr, 10 * dpr);
    x.fill();
    x.stroke();
  }
  x.restore();
}

export function init() {
  addPainter(paint);
  canvas.on('mouse:down', (opt) => {
    const o = S.obj;
    if (!o || isSpaceDown() || opt.e.button !== 0) return;
    const p = canvas.getScenePoint(opt.e);
    const z = canvas.getZoom();
    let best = -1;
    let bd = 14 / z;
    for (let i = 0; i < 4; i++) {
      const c = toPage(o, o.corners[i * 2], o.corners[i * 2 + 1]);
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) return;
    S.drag = { i: best, start: [...o.corners], from: toLocal(o, p) };
  });
  canvas.on('mouse:move', (opt) => {
    const o = S.obj;
    const d = S.drag;
    if (!o || !d) return;
    const now = toLocal(o, canvas.getScenePoint(opt.e));
    const dx = now.x - d.from.x;
    const dy = now.y - d.from.y;
    const c = [...d.start];
    const i = d.i;
    const set = (k, x, y) => {
      c[k * 2] = x;
      c[k * 2 + 1] = y;
    };
    const sx = (k) => d.start[k * 2];
    const sy = (k) => d.start[k * 2 + 1];
    if (S.mode === 'distort') set(i, sx(i) + dx, sy(i) + dy);
    else if (S.mode === 'perspective') {
      if (Math.abs(dx) >= Math.abs(dy)) {
        set(i, sx(i) + dx, sy(i));
        set(H_PARTNER[i], sx(H_PARTNER[i]) - dx, sy(H_PARTNER[i]));
      } else {
        set(i, sx(i), sy(i) + dy);
        set(V_PARTNER[i], sx(V_PARTNER[i]), sy(V_PARTNER[i]) - dy);
      }
    } else if (Math.abs(dx) >= Math.abs(dy)) {
      set(i, sx(i) + dx, sy(i));
      set(H_PARTNER[i], sx(H_PARTNER[i]) + dx, sy(H_PARTNER[i]));
    } else {
      set(i, sx(i), sy(i) + dy);
      set(V_PARTNER[i], sx(V_PARTNER[i]), sy(V_PARTNER[i]) + dy);
    }
    o.corners = c;
    o.dirty = true;
    canvas.requestRenderAll();
    refreshOverlay();
  });
  canvas.on('mouse:up', () => {
    if (S.drag) S.drag = null;
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!S.obj) return;
      if (e.key === 'Enter') e.preventDefault(), e.stopPropagation(), finish(true);
      else if (e.key === 'Escape') e.preventDefault(), e.stopPropagation(), finish(false);
    },
    true,
  );

  const can = () => selected().length === 1 && !selected()[0].isAdjustment;
  defineCommands({
    'edit.distort': { label: 'Distort', run: () => start('distort'), enabled: can, also: 'corner pin' },
    'edit.perspective': { label: 'Perspective', run: () => start('perspective'), enabled: can },
    'edit.skew': { label: 'Skew', run: () => start('skew'), enabled: can, also: 'slant' },
    'edit.resetTransform': {
      label: 'Straighten corners',
      run: () => {
        const [o] = selected();
        o.corners = null;
        o.dirty = true;
        canvas.requestRenderAll();
        record(true);
        emit('objects');
      },
      enabled: () => selected().length === 1 && hasCorners(selected()[0]),
    },
  });
  void state;
}
