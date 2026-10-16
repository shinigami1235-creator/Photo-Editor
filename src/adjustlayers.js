import { canvas, fabric, selected, designObjects, addDecorator, decorate } from './canvas.js';
import { state, currentPage, emit, on, uid } from './state.js';
import { record } from './history.js';
import { h, section, row, rangeField, toast, ICONS } from './ui.js';
import { NEUTRAL, adjustPixels, settingsOf, filterRev } from './adjust.js';
import { drawDevelop, focusAdjust } from './adjustpanel.js';
import { maskDrawable, clipBaseOf, drawSilhouette, renderRev, BLEND_MODES } from './layerfx.js';
import { isPhoto } from './frames.js';
import { defineCommands } from './commands.js';
import { showPanel } from './dock.js';
import { startMaskPaint } from './maskpaint.js';
import { toggleLayerMask, invertLayerMask, removeLayerMask, hasSelection, hideArea, setLayerMask } from './selection.js';

// Adjustment layers: a layer with no pixels of its own that changes everything
// below it, the way Photoshop's do. It covers the page, can have a mask, can be
// clipped to the layer below, and has its own opacity and blend mode.

const clone = (v) => JSON.parse(JSON.stringify(v));

export const ADJ_KINDS = {
  brightness: { name: 'Brightness and contrast', icon: 'sun', section: 'Light', key: 'brightness' },
  levels: { name: 'Levels', icon: 'levels', section: 'Curves and levels' },
  curves: { name: 'Curves', icon: 'curves', section: 'Curves and levels' },
  exposure: { name: 'Exposure', icon: 'sun', section: 'Light', key: 'exposure' },
  vibrance: { name: 'Vibrance', icon: 'vibrance', section: 'Colour', key: 'vibrance' },
  hsl: { name: 'Colour mixer', icon: 'hsl', section: 'Colour mixer' },
  grading: { name: 'Colour grading', icon: 'grading', section: 'Colour grading' },
  bw: { name: 'Black and white', icon: 'bw', section: 'Colour mixer', set: { bw: true } },
  filter: { name: 'Photo filter', icon: 'photoFilter', section: 'Photo filter', set: { filterAmount: 30 } },
  lut: { name: 'Colour lookup', icon: 'lut', section: 'Colour lookup', set: { lut: { url: 'builtin:teal-orange', name: 'Teal and orange' } } },
  detail: { name: 'Clarity and dehaze', icon: 'detail', section: 'Effects', key: 'clarity' },
  blur: { name: 'Blur', icon: 'grain', section: 'Blur', key: 'blur', set: { blur: 30 } },
};

const FILTERS = {
  blur: ['Gaussian blur', 'Blur', 'blur', 30],
  motion: ['Motion blur', 'Blur', 'motion', 40],
  tiltshift: ['Tilt-shift', 'Blur', 'tilt', 50],
  pixelate: ['Pixelate', 'Blur', 'pixelate', 30],
  sharpen: ['Sharpen', 'Detail', 'sharpen', 40],
  denoise: ['Reduce noise', 'Detail', 'denoise', 40],
  clarity: ['Clarity', 'Effects', 'clarity', 30],
  texture: ['Texture', 'Effects', 'texture', 30],
  grain: ['Add grain', 'Effects', 'grain', 30],
  vignette: ['Vignette', 'Effects', 'vignette', 40],
  dehaze: ['Dehaze', 'Effects', 'dehaze', 30],
};

// ---------- The layer ----------

export class AdjustmentLayer extends fabric.Rect {
  static type = 'AdjustmentLayer';

  constructor(options = {}) {
    super({
      originX: 'left',
      originY: 'top',
      fill: 'rgba(0,0,0,0)',
      strokeWidth: 0,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      evented: false,
      selectable: false,
      objectCaching: false,
      ...options,
    });
    this.isAdjustment = true;
    this.adjust = { ...clone(NEUTRAL), ...clone(options.adjust || {}) };
  }

  toObject(props = []) {
    return { ...super.toObject(props), adjust: clone(this.adjust), isAdjustment: true, adjKind: this.adjKind };
  }

  render(ctx) {
    renderAdjustment(this, ctx);
  }

  // Never selected by clicking the page, and nothing to draw for its outline.
  containsPoint() {
    return false;
  }
}
fabric.classRegistry.setClass(AdjustmentLayer);
fabric.classRegistry.setClass(AdjustmentLayer, 'adjustmentlayer');

/** An adjustment layer always covers the page exactly. */
function fitToPage(o) {
  if (!o.isAdjustment || !state.doc) return;
  o.set({ left: 0, top: 0, width: state.doc.width, height: state.doc.height, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false, evented: false, selectable: false, hasControls: false, hasBorders: false, objectCaching: false });
  o.setCoords();
}
addDecorator(fitToPage);

// ---------- Drawing ----------

const caches = new WeakMap(); // drawing canvas -> Map(uid -> { key, kind, data, x0, y0 })

let draft = false;
let draftTimer = 0;
/** Marks the page as busy for a moment, so adjustment layers draw fast until it settles. */
export function busy(ms = 220) {
  draft = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draft = false;
    canvas?.requestRenderAll();
  }, ms);
}

function sigOf(b) {
  if (b.isAdjustment) return `${b.uid}${JSON.stringify(b.adjust)}${b.visible}${b.opacity}${b.layerMask}${b.maskOn}${b.clipBelow}${b.globalCompositeOperation}`;
  try {
    return JSON.stringify(b.toObject());
  } catch {
    return String(Math.random());
  }
}

function renderAdjustment(o, ctx) {
  if (!o.visible || !(o.opacity > 0) || !state.doc) return;
  const list = o.group ? o.group._objects : o.canvas?._objects || [];
  const idx = list.indexOf(o);
  const W = state.doc.width;
  const H = state.doc.height;
  const T = ctx.getTransform();
  const pts = [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ].map(([x, y]) => T.transformPoint(new DOMPoint(x, y)));
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map((p) => p.x))));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map((p) => p.y))));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return;
  const mask = o.layerMask && o.maskOn !== false ? maskDrawable(o) : null;
  if (o.layerMask && o.maskOn !== false && !mask) return; // still loading

  let below = '';
  for (let i = 0; i < idx; i++) below += sigOf(list[i]) + '|';
  // While the page is being dragged, zoomed or adjusted, work at half size so it keeps up.
  const f = draft && ctx.canvas === canvas?.lowerCanvasEl && rw * rh > 250000 ? 0.5 : 1;
  const key = [sigOf(o), below, [T.a, T.b, T.c, T.d, T.e, T.f].map((v) => v.toFixed(3)).join(','), ctx.canvas.width, ctx.canvas.height, currentPage()?.background, o.canvas?.backgroundColor, renderRev, filterRev, f].join('#');
  let byCanvas = caches.get(ctx.canvas);
  if (!byCanvas) caches.set(ctx.canvas, (byCanvas = new Map()));
  const hit = byCanvas.get(o.uid);
  if (hit && hit.key === key) return paint(ctx, o, hit);

  const sw = Math.max(1, Math.round(rw * f));
  const sh = Math.max(1, Math.round(rh * f));
  let before;
  if (f < 1) {
    const t = document.createElement('canvas');
    t.width = sw;
    t.height = sh;
    const tx = t.getContext('2d', { willReadFrequently: true });
    tx.drawImage(ctx.canvas, x0, y0, rw, rh, 0, 0, sw, sh);
    before = tx.getImageData(0, 0, sw, sh);
  } else before = ctx.getImageData(x0, y0, rw, rh);
  const out = new ImageData(new Uint8ClampedArray(before.data), sw, sh);
  const k = Math.hypot(T.a, T.b) * f;
  adjustPixels(out.data, sw, sh, o.adjust, { ox: (x0 - T.e) * f, oy: (y0 - T.f) * f, pw: W * k, ph: H * k });

  // How much of the change each pixel gets: opacity, mask and clipping base.
  let weight = null;
  const local = new DOMMatrix([f, 0, 0, f, 0, 0]).multiply(new DOMMatrix([1, 0, 0, 1, -x0, -y0])).multiply(T);
  if (mask) {
    const mc = document.createElement('canvas');
    mc.width = sw;
    mc.height = sh;
    const mx = mc.getContext('2d', { willReadFrequently: true });
    mx.setTransform(local);
    mx.drawImage(mask, 0, 0, W, H);
    weight = mx.getImageData(0, 0, sw, sh).data;
  }
  if (o.clipBelow) {
    const base = clipBaseOf(o);
    if (!base || !base.visible) return;
    const bc = document.createElement('canvas');
    bc.width = sw;
    bc.height = sh;
    const bx = bc.getContext('2d', { willReadFrequently: true });
    bx.setTransform(local);
    drawSilhouette(base, bx);
    const bd = bx.getImageData(0, 0, sw, sh).data;
    if (!weight) weight = bd;
    else for (let i = 3; i < weight.length; i += 4) weight[i] = (weight[i] * bd[i]) / 255;
  }
  const op = o.opacity ?? 1;
  const blend = o.globalCompositeOperation || 'source-over';
  let entry;
  if (blend === 'source-over') {
    const a = before.data;
    const b = out.data;
    if (op < 1 || weight) {
      for (let i = 0; i < b.length; i += 4) {
        const m = op * (weight ? weight[i + 3] / 255 : 1);
        if (m >= 1) continue;
        b[i] = a[i] + (b[i] - a[i]) * m;
        b[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * m;
        b[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * m;
      }
    }
    if (f < 1) {
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      c.getContext('2d').putImageData(out, 0, 0);
      entry = { key, kind: 'draw', data: c, x0, y0, rw, rh, blend: 'source-over' };
    } else entry = { key, kind: 'put', data: out, x0, y0 };
  } else {
    // Other blend modes mix the changed picture over the one below.
    const b = out.data;
    for (let i = 0; i < b.length; i += 4) b[i + 3] = b[i + 3] * op * (weight ? weight[i + 3] / 255 : 1);
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d').putImageData(out, 0, 0);
    entry = { key, kind: 'draw', data: c, x0, y0, rw, rh, blend };
  }
  byCanvas.set(o.uid, entry);
  paint(ctx, o, entry);
}

function paint(ctx, o, e) {
  if (e.kind === 'put') return ctx.putImageData(e.data, e.x0, e.y0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = e.blend;
  ctx.drawImage(e.data, e.x0, e.y0, e.rw ?? e.data.width, e.rh ?? e.data.height);
  ctx.restore();
}

// ---------- Making and editing ----------

/** Adds an adjustment layer of a kind above the selected layer, or on top. */
export function addAdjustmentLayer(kind, extra = {}) {
  if (!state.doc) return null;
  const def = ADJ_KINDS[kind] || ADJ_KINDS.brightness;
  const o = new AdjustmentLayer({ uid: uid(), name: extra.name || def.name, adjKind: kind, adjust: { ...(def.set || {}), ...(extra.set || {}) } });
  decorate(o);
  const [s] = selected();
  const objs = canvas.getObjects();
  const at = s && objs.includes(s) ? objs.indexOf(s) + 1 : objs.length;
  canvas.insertAt(at, o);
  canvas.setActiveObject(o);
  canvas.requestRenderAll();
  record(true);
  emit('objects');
  focusAdjust(extra.section || def.section, extra.key || def.key);
  showPanel('properties');
  return o;
}

function snapshot(o, size, withSelf) {
  const W = state.doc.width;
  const H = state.doc.height;
  const sc = Math.min(1, size / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * sc));
  c.height = Math.max(1, Math.round(H * sc));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = currentPage().background || '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.setTransform(sc, 0, 0, sc, 0, 0);
  const objs = designObjects();
  const end = objs.indexOf(o) + (withSelf ? 1 : 0);
  const cv = o.canvas;
  const skip = cv?.skipOffscreen;
  if (cv) cv.skipOffscreen = false;
  try {
    for (const b of objs.slice(0, end)) if (b.visible) b.render(x);
  } finally {
    if (cv) cv.skipOffscreen = skip;
  }
  return c;
}

/** An adjustment layer as something the adjustments panel can edit. */
export function layerTarget(o) {
  return {
    key: `adj:${o.uid}:${Date.now() >> 12}`,
    settings: () => settingsOf(o.adjust),
    apply(patch, commit) {
      Object.assign(o.adjust, clone(patch));
      o.dirty = true;
      if (!commit) busy(300);
      canvas.requestRenderAll();
      if (commit) {
        record();
        emit('adjusted', o);
      }
    },
    source: () => snapshot(o, 400, false),
    result: () => snapshot(o, 260, true),
  };
}

/** Properties for a selected adjustment layer. */
export function drawAdjustmentProps(host, o, rerender) {
  const kind = ADJ_KINDS[o.adjKind];
  const set = (props) => {
    o.set(props);
    o.dirty = true;
    canvas.requestRenderAll();
  };
  host.append(
    h('div', { class: 'props-head' }, h('span', { class: 'props-type', html: ICONS[kind?.icon || 'adjustLayer'] }), h('span', { class: 'props-type' }, 'Adjustment layer'), h('span', { class: 'props-name' }, o.name || '')),
    section(
      'Layer',
      rangeField('Opacity', Math.round((o.opacity ?? 1) * 100), (v, c) => (set({ opacity: v / 100 }), c && record()), { min: 0, max: 100, suffix: '%' }),
      h(
        'label',
        { class: 'field-row' },
        h('span', { class: 'label' }, 'Blend'),
        h(
          'select',
          { class: 'field', onchange: (e) => (set({ globalCompositeOperation: e.target.value }), record()) },
          BLEND_MODES.map(([v, name]) => h('option', { value: v, selected: (o.globalCompositeOperation || 'source-over') === v }, name)),
        ),
      ),
      h(
        'label',
        { class: 'check', title: 'Changes only the layer right below' },
        h('input', { type: 'checkbox', checked: !!o.clipBelow, disabled: !clipBaseOf(o), onchange: (e) => (set({ clipBelow: e.target.checked }), record(), rerender()) }),
        'Only the layer below',
      ),
      row(
        h('button', { class: 'btn small', title: 'Paint where the adjustment shows', onclick: () => startMaskPaint(o, 'brush') }, 'Paint mask'),
        h('button', { class: 'btn small', title: 'Drag across the page to fade the adjustment out', onclick: () => startMaskPaint(o, 'fade') }, 'Fade'),
        h('button', { class: 'btn small', title: 'Drag out a circle where the adjustment shows', onclick: () => startMaskPaint(o, 'radial') }, 'Radial'),
      ),
      o.layerMask
        ? row(
            h('button', { class: 'btn small', onclick: () => (toggleLayerMask(o), rerender()) }, o.maskOn === false ? 'Mask on' : 'Mask off'),
            h('button', { class: 'btn small', onclick: () => invertLayerMask(o).then(rerender) }, 'Invert'),
            h('button', { class: 'btn small', onclick: () => (removeLayerMask(o), rerender()) }, 'Delete mask'),
          )
        : hasSelection()
          ? h('button', { class: 'btn small wide', onclick: () => hideArea(o, 'outside').then(rerender) }, 'Only inside the selection')
          : h('p', { class: 'muted small' }, 'A selection limits it to one area. Paint mask, Fade and Radial do it by hand.'),
    ),
  );
  drawDevelop(host, layerTarget(o), rerender);
}

// ---------- Adjustments panel ----------

function drawPanel(el) {
  el.innerHTML = '';
  const tiles = Object.entries(ADJ_KINDS).map(([k, d]) =>
    h('button', { class: 'adj-tile', title: d.name, onclick: () => addAdjustmentLayer(k) }, h('span', { html: ICONS[d.icon] }), h('span', {}, d.name)),
  );
  el.append(
    section('Add an adjustment layer', h('div', { class: 'adj-grid' }, tiles), h('p', { class: 'muted small' }, 'An adjustment layer changes every layer below it and leaves them as they are, so you can change it or delete it later. Move it in Layers to change what it covers.')),
    section(
      'Photo filters',
      h(
        'div',
        { class: 'adj-grid' },
        Object.entries(FILTERS).map(([id, [name]]) => h('button', { class: 'adj-tile small', onclick: () => applyFilter(id) }, h('span', {}, name))),
      ),
      h('p', { class: 'muted small' }, 'With a photo selected, a filter changes that photo. Otherwise it goes on an adjustment layer over the page.'),
    ),
  );
}

// ---------- Commands ----------

const one = () => (selected().length === 1 ? selected()[0] : null);

/** Opens a section on the selected photo or adjustment layer, or makes an adjustment layer for it. */
function openOn(kind) {
  const def = ADJ_KINDS[kind];
  const o = one();
  if (isPhoto(o) || o?.isAdjustment) {
    if (def.set && kind !== 'lut' && kind !== 'blur') {
      if (isPhoto(o)) import('./adjustpanel.js').then((m) => m.photoTarget(o).apply(def.set, true));
      else layerTarget(o).apply(def.set, true);
    }
    focusAdjust(def.section, def.key);
    showPanel('properties');
    emit('objects');
    return;
  }
  addAdjustmentLayer(kind);
}

async function applyFilter(id) {
  const [name, sectionName, key, start] = FILTERS[id];
  const o = one();
  if (isPhoto(o) || o?.isAdjustment) {
    const target = isPhoto(o) ? (await import('./adjustpanel.js')).photoTarget(o) : layerTarget(o);
    if (!target.settings()[key]) target.apply({ [key]: start }, true);
    focusAdjust(sectionName, key);
    showPanel('properties');
    emit('objects');
    return;
  }
  addAdjustmentLayer('blur', { name, section: sectionName, key, set: { blur: 0, [key]: start } });
}

export function init({ adjustmentsEl }) {
  let down = false;
  canvas.on('mouse:down', () => (down = true));
  canvas.on('mouse:move', () => down && busy(400));
  canvas.on('mouse:up', () => {
    down = false;
    busy(60);
  });
  canvas.on('mouse:wheel', () => busy(250));
  const defs = {};
  for (const [k, d] of Object.entries(ADJ_KINDS)) {
    defs[`layer.adj.${k}`] = { label: d.name, run: () => addAdjustmentLayer(k), enabled: () => !!state.doc, also: 'adjustment layer' };
    defs[`image.adj.${k}`] = { label: d.name, run: () => openOn(k), enabled: () => !!state.doc, also: 'adjust photo' };
  }
  for (const [id, [name]] of Object.entries(FILTERS)) defs[`filter.${id}`] = { label: name, run: () => applyFilter(id), enabled: () => !!state.doc, also: 'filter' };
  defs['image.adj.curves'].keys = 'Ctrl+M';
  defs['image.adj.levels'].keys = 'Ctrl+L';
  defs['image.adj.hsl'].keys = 'Ctrl+U';
  defs['image.adj.grading'].keys = 'Ctrl+B';
  defs['image.adj.bw'].keys = 'Alt+Shift+Ctrl+B';
  defineCommands(defs);
  const draw = () => adjustmentsEl.dataset.on === '1' && drawPanel(adjustmentsEl);
  on('adjustments-panel', () => drawPanel(adjustmentsEl));
  on('doc', () => {
    canvas.getObjects().forEach(fitToPage);
    draw();
  });
  void toast;
  void setLayerMask;
}
