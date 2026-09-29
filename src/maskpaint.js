import { canvas, isSpaceDown } from './canvas.js';
import { emit } from './state.js';
import { record } from './history.js';
import { h, toast } from './ui.js';
import { cacheMask, maskDrawable, pageToMask, maskSizeFor } from './layerfx.js';
import { setLayerMask, addPainter, refreshOverlay } from './selection.js';

// Painting a layer's mask by hand. The Brush hides or shows parts with a soft
// round brush, and Fade drags a gradient so the layer fades out across it.
// Nothing is saved to the design until Done.

const S = {
  on: null, // 'brush' | 'fade'
  obj: null,
  work: null, // the mask canvas being painted
  before: null, // the mask when editing started, for Cancel
  key: '',
  hide: true,
  size: 60,
  soft: 50,
  undo: [],
  drag: null,
  pointer: null,
};

let bar = null;
let undoBtn = null;
let unpaint = null;

export const isPaintingMask = () => !!S.on;

function copyOf(c) {
  const n = document.createElement('canvas');
  n.width = c.width;
  n.height = c.height;
  n.getContext('2d').drawImage(c, 0, 0);
  return n;
}

/** Starts painting the mask of `o`. `mode` is 'brush' or 'fade'. */
export function startMaskPaint(o, mode) {
  if (!o) return;
  if (S.on) finish(true);
  const old = o.layerMask ? maskDrawable(o) : null;
  if (o.layerMask && !old) return toast('The mask is still loading. Try again.');
  const [mw, mh] = maskSizeFor(o);
  const work = document.createElement('canvas');
  work.width = Math.max(mw, old ? old.naturalWidth || old.width : 0);
  work.height = Math.max(mh, old ? old.naturalHeight || old.height : 0);
  const x = work.getContext('2d');
  if (old && o.maskOn !== false) x.drawImage(old, 0, 0, work.width, work.height);
  else {
    x.fillStyle = '#fff';
    x.fillRect(0, 0, work.width, work.height);
  }
  Object.assign(S, { on: mode, obj: o, work, before: { mask: o.layerMask, on: o.maskOn }, undo: [], drag: null });
  S.key = `maskpaint:${Date.now()}`;
  cacheMask(S.key, work);
  o.set({ layerMask: S.key, maskOn: true });
  canvas.discardActiveObject();
  canvas.skipTargetFind = true;
  canvas.selection = false;
  canvas.defaultCursor = 'crosshair';
  canvas.hoverCursor = 'crosshair';
  showBar();
  unpaint = addPainter(paintCursor);
  canvas.requestRenderAll();
  emit('maskpaint', true);
}

function showBar() {
  bar?.remove();
  const ws = document.getElementById('workspace');
  const seg = (items, cur, pick) =>
    h(
      'div',
      { class: 'seg small' },
      items.map(([v, label]) => h('button', { class: cur === v ? 'on' : '', onclick: () => pick(v) }, label)),
    );
  const slider = (label, value, min, max, set) => {
    const out = h('span', { class: 'range-value' }, String(value));
    const input = h('input', { type: 'range', min, max, value });
    input.addEventListener('input', () => {
      set(+input.value);
      out.textContent = input.value;
      refreshOverlay();
    });
    return h('label', { class: 'mp-slider' }, h('span', { class: 'muted small' }, label), input, out);
  };
  bar = h(
    'div',
    { class: 'crop-bar show mask-bar' },
    h('strong', {}, S.on === 'brush' ? 'Mask brush' : 'Fade out'),
    S.on === 'brush'
      ? [
          seg(
            [
              [true, 'Hide (X)'],
              [false, 'Show (X)'],
            ],
            S.hide,
            (v) => {
              S.hide = v;
              showBar();
            },
          ),
          slider('Size', S.size, 4, 400, (v) => (S.size = v)),
          slider('Softness', S.soft, 0, 100, (v) => (S.soft = v)),
        ]
      : h('span', { class: 'muted small' }, 'Drag from where the layer stays to where it fades out.'),
    (undoBtn = h('button', { class: 'btn small', onclick: undoStep, title: 'Ctrl+Z', disabled: !S.undo.length }, 'Undo')),
    h('button', { class: 'btn small', onclick: () => finish(false) }, 'Cancel'),
    h('button', { class: 'btn primary small', onclick: () => finish(true) }, 'Done'),
  );
  ws.appendChild(bar);
}

function pushUndo() {
  S.undo.push(copyOf(S.work));
  if (S.undo.length > 30) S.undo.shift();
  if (undoBtn) undoBtn.disabled = false;
}

function undoStep() {
  const last = S.undo.pop();
  if (undoBtn) undoBtn.disabled = !S.undo.length;
  if (!last) return;
  const x = S.work.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'copy';
  x.drawImage(last, 0, 0);
  x.globalCompositeOperation = 'source-over';
  S.obj.dirty = true;
  canvas.requestRenderAll();
}

function toMask(x) {
  const t = pageToMask(S.obj, S.work.width, S.work.height);
  x.setTransform(t);
}

function dab(p) {
  const x = S.work.getContext('2d');
  toMask(x);
  const r = S.size / 2;
  const inner = r * (1 - S.soft / 100);
  const g = x.createRadialGradient(p.x, p.y, Math.max(0, inner), p.x, p.y, r);
  // Soft dabs overlap, so each one carries a little and a stroke builds up.
  const a = S.soft > 0 ? 0.35 : 1;
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.globalCompositeOperation = S.hide ? 'destination-out' : 'source-over';
  x.fillStyle = S.soft > 0 ? g : '#fff';
  x.beginPath();
  x.arc(p.x, p.y, r, 0, Math.PI * 2);
  x.fill();
  x.globalCompositeOperation = 'source-over';
  x.setTransform(1, 0, 0, 1, 0, 0);
}

function strokeTo(p) {
  const last = S.drag.last;
  const step = Math.max(1, S.size * 0.12);
  const d = Math.hypot(p.x - last.x, p.y - last.y);
  for (let t = step; t <= d; t += step) dab({ x: last.x + ((p.x - last.x) * t) / d, y: last.y + ((p.y - last.y) * t) / d });
  if (d >= step) S.drag.last = p;
}

function fadeTo(p) {
  const x = S.work.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'copy';
  x.drawImage(S.drag.start, 0, 0);
  toMask(x);
  const a = S.drag.a;
  const g = x.createLinearGradient(a.x, a.y, p.x, p.y);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = g;
  // A rectangle far bigger than the page so the gradient covers the whole mask.
  x.fillRect(-1e5, -1e5, 2e5, 2e5);
  x.globalCompositeOperation = 'source-over';
  x.setTransform(1, 0, 0, 1, 0, 0);
}

function paintCursor(x, sx, sy, dpr) {
  if (!S.on) return;
  if (S.on === 'fade' && S.drag?.b) {
    x.strokeStyle = '#ffffff';
    x.lineWidth = 2 * dpr;
    x.beginPath();
    x.moveTo(sx(S.drag.a.x), sy(S.drag.a.y));
    x.lineTo(sx(S.drag.b.x), sy(S.drag.b.y));
    x.stroke();
    x.strokeStyle = '#101c2b';
    x.setLineDash([4 * dpr, 4 * dpr]);
    x.stroke();
  }
  if (S.on === 'brush' && S.pointer) {
    const r = (S.size / 2) * canvas.getZoom() * dpr;
    x.lineWidth = dpr;
    x.strokeStyle = '#ffffff';
    x.beginPath();
    x.arc(sx(S.pointer.x), sy(S.pointer.y), r, 0, Math.PI * 2);
    x.stroke();
    x.strokeStyle = '#101c2b';
    x.beginPath();
    x.arc(sx(S.pointer.x), sy(S.pointer.y), r + dpr, 0, Math.PI * 2);
    x.stroke();
  }
}

async function finish(keep) {
  if (!S.on) return;
  const o = S.obj;
  const mode = S.on;
  S.on = null;
  bar?.remove();
  bar = null;
  unpaint?.();
  canvas.skipTargetFind = false;
  canvas.selection = true;
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = 'move';
  if (keep && S.undo.length) {
    await setLayerMask(o, S.work);
    record(true);
  } else {
    o.set({ layerMask: S.before.mask, maskOn: S.before.on });
  }
  o.dirty = true;
  canvas.setActiveObject(o);
  canvas.requestRenderAll();
  refreshOverlay();
  emit('objects');
  emit('maskpaint', false);
  void mode;
}

export function initMaskPaint() {
  canvas.on('mouse:down', (opt) => {
    if (!S.on || isSpaceDown() || opt.e.button !== 0) return;
    const p = canvas.getScenePoint(opt.e);
    pushUndo();
    if (S.on === 'brush') {
      S.drag = { last: p };
      dab(p);
    } else S.drag = { a: p, b: p, start: copyOf(S.work) };
    S.obj.dirty = true;
    canvas.requestRenderAll();
  });
  canvas.on('mouse:move', (opt) => {
    if (!S.on) return;
    const p = canvas.getScenePoint(opt.e);
    S.pointer = p;
    if (S.drag) {
      if (S.on === 'brush') strokeTo(p);
      else {
        S.drag.b = p;
        fadeTo(p);
      }
      S.obj.dirty = true;
      canvas.requestRenderAll();
    } else refreshOverlay();
  });
  canvas.on('mouse:up', () => {
    if (!S.on) return;
    canvas.selection = false;
    S.drag = null;
    refreshOverlay();
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!S.on) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (k === 'escape') return e.preventDefault(), e.stopPropagation(), finish(false);
      if (k === 'enter') return e.preventDefault(), e.stopPropagation(), finish(true);
      if (mod && k === 'z') return e.preventDefault(), e.stopPropagation(), undoStep();
      if (k === 'x' && S.on === 'brush') return e.stopPropagation(), (S.hide = !S.hide), showBar();
      if ((k === '[' || k === ']') && S.on === 'brush') {
        e.stopPropagation();
        S.size = Math.max(4, Math.min(400, Math.round(S.size * (k === ']' ? 1.2 : 1 / 1.2))));
        showBar();
        refreshOverlay();
      }
      if (!mod && k !== ' ') e.stopPropagation();
    },
    true,
  );
}
