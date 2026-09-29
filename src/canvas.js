import * as fabric from 'fabric';
import { state, currentPage, emit } from './state.js';
import { FX_PROPS } from './layerfx.js';

// Properties saved with every object on top of Fabric's own.
fabric.FabricObject.customProperties = ['uid', 'name', 'locked', 'isFrame', 'frameKind', 'frameShape', 'originalSrc', 'cutout', 'innerAngle', 'innerFlipX', 'innerFlipY', 'curve', 'flatWidth', 'qrText', 'qrDark', 'qrLight', 'qrEc', 'iconKind', 'iconColor', 'iconWidth', ...FX_PROPS];

Object.assign(fabric.InteractiveFabricObject.ownDefaults, {
  borderColor: '#1f5e99',
  cornerColor: '#ffffff',
  cornerStrokeColor: '#1f5e99',
  cornerStyle: 'circle',
  cornerSize: 11,
  transparentCorners: false,
  borderScaleFactor: 1.5,
  padding: 0,
});

export let canvas = null;
const decorators = [];
/** Registers a function run on every object placed on the canvas (new or loaded). */
export const addDecorator = (fn) => decorators.push(fn);
export const decorate = (obj) => decorators.forEach((fn) => fn(obj));

export let loading = false;

export function initCanvas(el, host) {
  canvas = new fabric.Canvas(el, {
    preserveObjectStacking: true,
    stopContextMenu: true,
    fireMiddleClick: true,
    selectionColor: 'rgba(31,94,153,0.08)',
    selectionBorderColor: '#1f5e99',
    selectionLineWidth: 1,
    targetFindTolerance: 4,
  });

  canvas.on('before:render', ({ ctx }) => {
    if (!state.doc) return;
    const v = canvas.viewportTransform;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    ctx.fillStyle = currentPage().background || '#ffffff';
    ctx.fillRect(0, 0, state.doc.width, state.doc.height);
    ctx.restore();
  });

  const resize = () => {
    const r = host.getBoundingClientRect();
    canvas.setDimensions({ width: Math.max(10, r.width), height: Math.max(10, r.height) });
    if (!userZoomed) fitToScreen();
    else canvas.requestRenderAll();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  setupPanZoom(host);
  return canvas;
}

/** Page size changed or a new design opened. */
export function applyPageSize() {
  const { width, height } = state.doc;
  canvas.clipPath = new fabric.Rect({ left: 0, top: 0, width, height, originX: 'left', originY: 'top', absolutePositioned: true });
  userZoomed = false;
  fitToScreen();
}

// ---------- Zoom and pan ----------

let userZoomed = false;

export function fitToScreen() {
  if (!state.doc) return;
  const cw = canvas.getWidth();
  const ch = canvas.getHeight();
  const { width, height } = state.doc;
  const z = Math.min((cw - 96) / width, (ch - 96) / height);
  canvas.setViewportTransform([z, 0, 0, z, (cw - width * z) / 2, (ch - height * z) / 2]);
  userZoomed = false;
  emit('zoom', z);
}

export function zoomTo(z, point) {
  z = Math.min(8, Math.max(0.02, z));
  const p = point || new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
  canvas.zoomToPoint(p, z);
  userZoomed = true;
  emit('zoom', z);
}

export const zoomBy = (factor) => zoomTo(canvas.getZoom() * factor);

let spaceDown = false;
/** True while Space is held for panning. */
export const isSpaceDown = () => spaceDown;
function setupPanZoom(host) {
  let panning = false;
  let last = null;

  canvas.on('mouse:wheel', (opt) => {
    const e = opt.e;
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      zoomTo(canvas.getZoom() * Math.pow(0.999, e.deltaY), new fabric.Point(e.offsetX, e.offsetY));
    } else {
      const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
      const dy = e.shiftKey ? 0 : -e.deltaY;
      canvas.relativePan(new fabric.Point(dx, dy));
      userZoomed = true;
    }
  });

  canvas.on('mouse:down', (opt) => {
    const e = opt.e;
    if (spaceDown || e.button === 1) {
      panning = true;
      last = { x: e.clientX, y: e.clientY };
      canvas.selection = false;
      canvas.discardActiveObject();
      canvas.setCursor('grabbing');
    }
  });
  canvas.on('mouse:move', (opt) => {
    if (!panning) return;
    const e = opt.e;
    canvas.relativePan(new fabric.Point(e.clientX - last.x, e.clientY - last.y));
    last = { x: e.clientX, y: e.clientY };
    userZoomed = true;
  });
  canvas.on('mouse:up', () => {
    if (!panning) return;
    panning = false;
    canvas.selection = true;
    canvas.setCursor(spaceDown ? 'grab' : 'default');
  });

  const typing = () => {
    const a = document.activeElement;
    return (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) || canvas.getActiveObject()?.isEditing;
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !typing() && !spaceDown) {
      spaceDown = true;
      canvas.defaultCursor = 'grab';
      canvas.setCursor('grab');
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      canvas.defaultCursor = 'default';
      canvas.setCursor('default');
    }
  });
}

// ---------- Objects in and out ----------

/** Objects that belong to the design (skips crop-mode helpers). */
export const designObjects = () => canvas.getObjects().filter((o) => !o.isTemp);

export function serializeObjects() {
  return designObjects().map((o) => o.toObject());
}

export async function enliven(objects) {
  const list = await fabric.util.enlivenObjects(objects);
  list.forEach(decorate);
  return list;
}

export async function loadObjects(objects) {
  loading = true;
  try {
    canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects());
    const list = await enliven(objects);
    if (list.length) canvas.add(...list);
  } finally {
    loading = false;
  }
  canvas.requestRenderAll();
  emit('objects');
  emit('selection');
}

export function selected() {
  const a = canvas.getActiveObject();
  if (!a) return [];
  return a.type === 'activeselection' ? a.getObjects() : [a];
}

/** Places a new object centred on the page (or at a point) and selects it. */
export function place(obj, { at, select = true } = {}) {
  decorate(obj);
  const p = at || new fabric.Point(state.doc.width / 2, state.doc.height / 2);
  obj.setPositionByOrigin(p, 'center', 'center');
  obj.setCoords();
  canvas.add(obj);
  if (select) canvas.setActiveObject(obj);
  canvas.requestRenderAll();
  return obj;
}

/** Scene point under a DOM mouse event. */
export function scenePoint(e) {
  return canvas.getScenePoint(e);
}

/** Top-most design object under a scene point. */
export function objectAt(point) {
  const list = designObjects();
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (o.visible && o.containsPoint(point)) return o;
  }
  return null;
}

export { fabric };
