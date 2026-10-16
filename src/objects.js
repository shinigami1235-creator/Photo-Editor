import { canvas, fabric, place, selected, designObjects, decorate, addDecorator, enliven } from './canvas.js';
import { state, uid, emit } from './state.js';
import { registerBlob, loadImage } from './assets.js';
import { applyClip, fillFrame, isEmptyFrame, isPhoto, archPath } from './frames.js';
import { record } from './history.js';
import { brandFont } from './brand.js';
import { shapePath } from './shapetools.js';

const W = () => state.doc.width;
const H = () => state.doc.height;
const base = (name) => ({ uid: uid(), name });

// ---------- Text ----------

export function addText(kind = 'body', at) {
  const heading = kind === 'heading';
  const size = Math.round(Math.min(W(), H()) * (heading ? 0.085 : 0.042));
  const t = new fabric.Textbox(heading ? 'Heading' : 'Body text', {
    ...base(heading ? 'Heading' : 'Text'),
    width: W() * (heading ? 0.7 : 0.6),
    fontSize: size,
    fontFamily: brandFont(heading ? 'heading' : 'body') || 'Arial',
    fontWeight: heading ? 'bold' : 'normal',
    fill: '#111111',
    textAlign: 'center',
    lineHeight: 1.16,
    paintFirst: 'stroke',
    strokeUniform: true,
    splitByGrapheme: false,
  });
  return place(t, { at });
}

export function addTextWith(text, at) {
  const t = addText('body', at);
  t.set({ text });
  t.initDimensions();
  canvas.requestRenderAll();
  return t;
}

// ---------- Curved text ----------

// Fabric sets a Textbox's width from its wrap box. With a path, the box has to
// follow the curve instead, and the text must not wrap.
const baseTextboxInit = fabric.Textbox.prototype.initDimensions;
fabric.Textbox.prototype.initDimensions = function () {
  if (!this.path) return baseTextboxInit.call(this);
  this.width = 1e5;
  baseTextboxInit.call(this);
  this.width = this.path.width + this.fontSize;
  this.height = this.path.height + this.fontSize * 1.3;
};

/** Bends text along an arc. curve runs from -100 (smile) to 100 (arch); 0 is straight. */
export function applyCurve(t) {
  const c = t.curve || 0;
  const center = t.getCenterPoint();
  if (Math.abs(c) < 1) {
    if (t.path) {
      t.path = undefined;
      t.width = t.flatWidth || t.width;
      t.initDimensions();
    }
  } else {
    if (!t.path) t.flatWidth = t.width;
    t.path = undefined;
    t.width = 1e5;
    baseTextboxInit.call(t);
    const L = Math.max(10, t.calcTextWidth());
    const theta = (Math.abs(c) / 100) * Math.PI * 1.94;
    const R = L / theta;
    const big = theta > Math.PI ? 1 : 0;
    let d;
    if (c > 0) {
      const s = -Math.PI / 2 - theta / 2;
      const e = -Math.PI / 2 + theta / 2;
      d = `M ${R * Math.cos(s)} ${R * Math.sin(s)} A ${R} ${R} 0 ${big} 1 ${R * Math.cos(e)} ${R * Math.sin(e)}`;
    } else {
      const s = Math.PI / 2 + theta / 2;
      const e = Math.PI / 2 - theta / 2;
      d = `M ${R * Math.cos(s)} ${R * Math.sin(s)} A ${R} ${R} 0 ${big} 0 ${R * Math.cos(e)} ${R * Math.sin(e)}`;
    }
    t.set({ path: new fabric.Path(d, { visible: false }), textAlign: 'center', pathAlign: 'center' });
    t.initDimensions();
  }
  t.setPositionByOrigin(center, 'center', 'center');
  t.setCoords();
  t.dirty = true;
}

// ---------- Shapes ----------

/** Shapes drawn as a path, with settings kept so they can be redrawn. */
export const PATH_SHAPES = {
  star: { name: 'Star', opts: { points: 5, inner: 0.45 } },
  burst: { name: 'Badge', opts: { points: 16, inner: 0.8 } },
  polygon: { name: 'Polygon', opts: { sides: 6 } },
  arrow: { name: 'Arrow', opts: { shaft: 0.4, head: 0.4 } },
  heart: { name: 'Heart', opts: {} },
  bubble: { name: 'Speech bubble', opts: {} },
  cross: { name: 'Plus', opts: { thick: 0.34 } },
};

export const SHAPE_NAMES = {
  rect: 'Rectangle',
  rounded: 'Rounded rectangle',
  ellipse: 'Circle',
  triangle: 'Triangle',
  line: 'Line',
  ...Object.fromEntries(Object.entries(PATH_SHAPES).map(([k, v]) => [k, v.name])),
};

const fg = () => state.fg || '#14497a';

function shapeObject(kind, w, h, opts) {
  const common = { fill: fg(), stroke: null, strokeWidth: 0, strokeUniform: true };
  if (kind === 'rect') return new fabric.Rect({ ...base('Rectangle'), ...common, width: w, height: h });
  if (kind === 'rounded') return new fabric.Rect({ ...base('Rounded rectangle'), ...common, width: w, height: h, rx: Math.min(w, h) * 0.12, ry: Math.min(w, h) * 0.12 });
  if (kind === 'ellipse') return new fabric.Ellipse({ ...base('Circle'), ...common, rx: w / 2, ry: h / 2 });
  if (kind === 'triangle') return new fabric.Triangle({ ...base('Triangle'), ...common, width: w, height: h });
  if (PATH_SHAPES[kind]) {
    const o = { ...PATH_SHAPES[kind].opts, ...(opts || {}) };
    return new fabric.Path(shapePath(kind, w, h, o), { ...base(PATH_SHAPES[kind].name), ...common, shapeKind: kind, shapeOpts: o });
  }
  return null;
}

export function addShape(kind, at) {
  const s = Math.min(W(), H()) * 0.35;
  if (kind === 'line')
    return place(new fabric.Line([0, 0, s * 1.4, 0], { ...base('Line'), stroke: fg(), strokeWidth: Math.max(2, Math.round(s / 40)), strokeUniform: true, fill: null }), { at });
  const hh = kind === 'triangle' ? s * 0.87 : kind === 'arrow' ? s * 0.6 : kind === 'bubble' ? s * 0.85 : s;
  return place(shapeObject(kind, kind === 'arrow' ? s * 1.3 : s, hh), { at });
}

/** Adds a shape filling a box dragged on the page: { x, y, w, h } or a line from a to b. */
export function addShapeBox(kind, r, a, b) {
  if (kind === 'line') {
    const l = new fabric.Line([a.x, a.y, b.x, b.y], { ...base('Line'), stroke: fg(), strokeWidth: Math.max(2, Math.round(Math.min(W(), H()) / 300)), strokeUniform: true, fill: null });
    decorate(l);
    canvas.add(l);
    canvas.setActiveObject(l);
    canvas.requestRenderAll();
    return l;
  }
  return place(shapeObject(kind, Math.max(2, r.w), Math.max(2, r.h)), { at: new fabric.Point(r.x + r.w / 2, r.y + r.h / 2) });
}

/** Redraws a path shape (star, badge, polygon...) with new settings, keeping its place. */
export function reshape(o, patch) {
  if (!o.shapeKind || !PATH_SHAPES[o.shapeKind]) return;
  const opts = { ...o.shapeOpts, ...patch };
  const c = o.getCenterPoint();
  const fresh = new fabric.Path(shapePath(o.shapeKind, o.width, o.height, opts));
  o.set({ path: fresh.path, pathOffset: fresh.pathOffset, width: fresh.width, height: fresh.height, shapeOpts: opts, dirty: true });
  o.setPositionByOrigin(c, 'center', 'center');
  o.setCoords();
  canvas.requestRenderAll();
}

// ---------- Frames ----------

function frameObject(kind, w, h) {
  const common = {
    ...base('Frame'),
    isFrame: true,
    fill: '#d5d9e0',
    stroke: '#9aa1ad',
    strokeWidth: 2,
    strokeDashArray: [10, 8],
    strokeUniform: true,
  };
  if (kind === 'ellipse') return new fabric.Ellipse({ ...common, rx: w / 2, ry: h / 2 });
  if (kind === 'rounded') return new fabric.Rect({ ...common, width: w, height: h, rx: Math.min(w, h) * 0.08, ry: Math.min(w, h) * 0.08 });
  if (kind === 'arch') return new fabric.Path(archPath(w, h), { ...common, frameKind: 'arch' });
  return new fabric.Rect({ ...common, width: w, height: h });
}

export function addFrame(kind, at) {
  const s = Math.min(W(), H()) * 0.45;
  return place(frameObject(kind, s, kind === 'ellipse' ? s : kind === 'arch' ? s * 1.3 : s * 1.25), { at });
}

/** Adds a frame filling a box dragged on the page. */
export function addFrameBox(kind, r) {
  return place(frameObject(kind, Math.max(8, r.w), Math.max(8, r.h)), { at: new fabric.Point(r.x + r.w / 2, r.y + r.h / 2) });
}

// ---------- Photos ----------

/** Adds a picture as a new photo, sized to fit inside 60% of the page. */
export async function addPhoto(url, at) {
  const el = await loadImage(url);
  const img = new fabric.FabricImage(el, { ...base('Photo'), frameShape: { kind: 'rect', r: 0 } });
  const maxW = W() * 0.6;
  const maxH = H() * 0.6;
  const s = Math.min(1, maxW / el.naturalWidth, maxH / el.naturalHeight);
  img.scale(s);
  return place(img, { at });
}

export async function addPhotoBlob(blob, at) {
  return addPhoto(registerBlob(blob), at);
}

/** Drops a picture at a point: into the frame or photo under it, otherwise as a new photo. */
export async function dropPhoto(url, point, target) {
  if (target && (isEmptyFrame(target) || (isPhoto(target) && target.frameShape && isFramed(target)))) {
    const img = await fillFrame(target, url);
    record();
    return img;
  }
  return addPhoto(url, point);
}

// A photo counts as framed once it has been cropped or shaped: dropping onto it swaps the picture.
function isFramed(img) {
  const { width, height } = img.getOriginalSize();
  return img.frameShape?.kind === 'ellipse' || img.frameShape?.kind === 'arch' || img.frameShape?.r > 0 || img.cropX > 0 || img.cropY > 0 || img.width < width - 1 || img.height < height - 1;
}

// ---------- Locking ----------

export function applyLock(o) {
  const l = !!o.locked;
  o.set({
    lockMovementX: l,
    lockMovementY: l,
    lockScalingX: l,
    lockScalingY: l,
    lockRotation: l,
    hasControls: !l,
    editable: o.type === 'textbox' ? !l : o.editable,
  });
}
addDecorator(applyLock);

export function toggleLock(o) {
  o.locked = !o.locked;
  applyLock(o);
  canvas.requestRenderAll();
  record();
  emit('objects');
  emit('selection');
}

// ---------- Arrange ----------

export function removeSelected() {
  const list = selected().filter((o) => !o.locked);
  if (!list.length) return;
  canvas.discardActiveObject();
  canvas.remove(...list);
  canvas.requestRenderAll();
}

export async function duplicateSelected(offset = 24) {
  const list = selected();
  if (!list.length) return;
  const clones = await enliven(list.map((o) => o.toObject()));
  // Objects inside a multi-selection store positions relative to the selection.
  const active = canvas.getActiveObject();
  canvas.discardActiveObject();
  clones.forEach((c, i) => {
    const src = list[i];
    const center = src.getCenterPoint();
    c.uid = uid();
    c.setPositionByOrigin(new fabric.Point(center.x + offset, center.y + offset), 'center', 'center');
    c.setCoords();
  });
  canvas.add(...clones);
  selectObjects(clones);
  void active;
  return clones;
}

export function selectObjects(list) {
  canvas.discardActiveObject();
  if (list.length === 1) canvas.setActiveObject(list[0]);
  else if (list.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(list, { canvas }));
  canvas.requestRenderAll();
}

export function arrange(how) {
  const list = selected();
  if (!list.length) return;
  const objs = designObjects();
  const order = how === 'front' || how === 'forward' ? [...list].reverse() : list;
  for (const o of order) {
    if (how === 'front') canvas.bringObjectToFront(o);
    else if (how === 'back') canvas.sendObjectToBack(o);
    else if (how === 'forward') canvas.bringObjectForward(o);
    else if (how === 'backward') canvas.sendObjectBackwards(o);
  }
  void objs;
  canvas.requestRenderAll();
  record();
  emit('objects');
}

export function flip(axis) {
  selected().forEach((o) => o.set(axis === 'x' ? { flipX: !o.flipX } : { flipY: !o.flipY }));
  canvas.requestRenderAll();
  record();
}

export function groupSelected() {
  const list = selected();
  if (list.length < 2) return;
  canvas.discardActiveObject();
  canvas.remove(...list);
  const g = new fabric.Group(list, { ...base('Group') });
  decorate(g);
  canvas.add(g);
  canvas.setActiveObject(g);
  canvas.requestRenderAll();
}

export function ungroupSelected() {
  const g = canvas.getActiveObject();
  if (!g || g.type !== 'group') return;
  const index = canvas.getObjects().indexOf(g);
  const items = g.removeAll();
  canvas.remove(g);
  items.forEach((o, i) => {
    decorate(o);
    canvas.insertAt(index + i, o);
    o.setCoords();
  });
  selectObjects(items);
}

export { applyClip };
