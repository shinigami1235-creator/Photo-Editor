import { canvas, fabric, addDecorator, designObjects, decorate } from './canvas.js';
import { loadImage } from './assets.js';
import { emit } from './state.js';

const { Point, util } = fabric;
const rad = util.degreesToRadians;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A photo is a FabricImage whose width/height/cropX/cropY pick the visible part
// of the source picture. The selection box then matches the visible photo.
// frameShape = { kind: 'rect' | 'ellipse' | 'arch', r } where r is the corner radius in
// the image's own (unscaled) units.

export const isPhoto = (o) => o?.type === 'image';

// Rotate and flip inside the frame: the picture turns around the centre of the
// visible part while the frame (the object's box) stays where it is. The picture
// is zoomed just enough to keep the frame covered.
const baseRenderFill = fabric.FabricImage.prototype._renderFill;
fabric.FabricImage.prototype._renderFill = function (ctx) {
  const a = this.innerAngle || 0;
  if (!a && !this.innerFlipX && !this.innerFlipY) return baseRenderFill.call(this, ctx);
  const el = this._element;
  if (!el) return;
  const w = this.width;
  const hh = this.height;
  const elW = el.naturalWidth || el.width;
  const elH = el.naturalHeight || el.height;
  const sx = this._filterScalingX || 1;
  const sy = this._filterScalingY || 1;
  const cx = this.cropX + w / 2;
  const cy = this.cropY + hh / 2;
  const rad = util.degreesToRadians(a);
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const k = Math.max((w * c + hh * s) / w, (w * s + hh * c) / hh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2, -hh / 2, w, hh);
  ctx.clip();
  ctx.rotate(rad);
  ctx.scale(k * (this.innerFlipX ? -1 : 1), k * (this.innerFlipY ? -1 : 1));
  ctx.drawImage(el, 0, 0, elW, elH, -cx, -cy, elW / sx, elH / sy);
  ctx.restore();
};
export const isEmptyFrame = (o) => !!o?.isFrame && !isPhoto(o);

/** SVG path of an arch (rounded top, square bottom) centred on 0,0. */
export function archPath(w, h) {
  const r = Math.min(w / 2, h);
  const x0 = -w / 2;
  const y0 = -h / 2;
  return `M ${x0} ${h / 2} L ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${w / 2} ${y0 + r} L ${w / 2} ${h / 2} Z`;
}

export function applyClip(img) {
  const shape = img.frameShape || { kind: 'rect', r: 0 };
  if (shape.kind === 'arch') {
    img.clipPath = new fabric.Path(archPath(img.width, img.height), { originX: 'center', originY: 'center', left: 0, top: 0 });
  } else if (shape.kind === 'ellipse') {
    img.clipPath = new fabric.Ellipse({ rx: img.width / 2, ry: img.height / 2, originX: 'center', originY: 'center', left: 0, top: 0 });
  } else if (shape.r > 0) {
    const r = Math.min(shape.r, img.width / 2, img.height / 2);
    img.clipPath = new fabric.Rect({ width: img.width, height: img.height, rx: r, ry: r, originX: 'center', originY: 'center', left: 0, top: 0 });
  } else {
    img.clipPath = undefined;
  }
  img.dirty = true;
}

/** Side handles crop the photo instead of stretching it. */
function cropBySide(img, side, x, y) {
  const { width: natW, height: natH } = img.getOriginalSize();
  const p = util.transformPoint(new Point(x, y), util.invertTransform(img.calcTransformMatrix()));
  const min = 12 / (img.scaleX * canvas.getZoom());
  if (side === 'mr') {
    const fixed = img.getPointByOrigin('left', 'center');
    img.width = clamp(p.x + img.width / 2, min, natW - img.cropX);
    img.setPositionByOrigin(fixed, 'left', 'center');
  } else if (side === 'ml') {
    const fixed = img.getPointByOrigin('right', 'center');
    const w = clamp(img.width / 2 - p.x, min, img.cropX + img.width);
    img.cropX = img.cropX + img.width - w;
    img.width = w;
    img.setPositionByOrigin(fixed, 'right', 'center');
  } else if (side === 'mb') {
    const fixed = img.getPointByOrigin('center', 'top');
    img.height = clamp(p.y + img.height / 2, min, natH - img.cropY);
    img.setPositionByOrigin(fixed, 'center', 'top');
  } else if (side === 'mt') {
    const fixed = img.getPointByOrigin('center', 'bottom');
    const h = clamp(img.height / 2 - p.y, min, img.cropY + img.height);
    img.cropY = img.cropY + img.height - h;
    img.height = h;
    img.setPositionByOrigin(fixed, 'center', 'bottom');
  }
  applyClip(img);
  img.setCoords();
  return true;
}

function photoControls() {
  const base = fabric.controlsUtils.createObjectDefaultControls();
  for (const side of ['ml', 'mr', 'mt', 'mb']) {
    base[side] = new fabric.Control({
      x: base[side].x,
      y: base[side].y,
      cursorStyleHandler: fabric.controlsUtils.scaleCursorStyleHandler,
      actionHandler: (e, t, x, y) => cropBySide(t.target, side, x, y),
      actionName: 'crop',
      render: renderBar(side === 'ml' || side === 'mr'),
      sizeX: side === 'ml' || side === 'mr' ? 6 : 18,
      sizeY: side === 'ml' || side === 'mr' ? 18 : 6,
    });
  }
  return base;
}

// Side handles on photos are drawn as short bars so they read as crop handles.
function renderBar(upright) {
  return (ctx, left, top, _style, obj) => {
    ctx.save();
    ctx.translate(left, top);
    ctx.rotate(rad(obj.angle));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1f5e99';
    ctx.lineWidth = 1.5;
    const w = upright ? 6 : 18;
    const h = upright ? 18 : 6;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
}

addDecorator((o) => {
  if (isPhoto(o)) {
    o.controls = photoControls();
    o.lockSkewingX = o.lockSkewingY = true;
  }
});

// ---------- Filling frames ----------

function frameGeometry(o) {
  if (isPhoto(o)) {
    const shape = o.frameShape || { kind: 'rect', r: 0 };
    return {
      w: o.width * o.scaleX,
      h: o.height * o.scaleY,
      center: o.getCenterPoint(),
      angle: o.angle,
      kind: shape.kind,
      radius: (shape.r || 0) * o.scaleX,
    };
  }
  return {
    w: o.width * o.scaleX,
    h: o.height * o.scaleY,
    center: o.getCenterPoint(),
    angle: o.angle,
    kind: o.frameKind || (o.type === 'ellipse' ? 'ellipse' : 'rect'),
    radius: (o.rx || 0) * o.scaleX,
  };
}

/**
 * Builds a photo from the picture at `url`, cropped to cover the frame of `target`
 * (an empty frame or an existing photo). A replaced photo keeps its adjustments.
 */
export async function framedImage(target, url) {
  const el = await loadImage(url);
  const natW = el.naturalWidth;
  const natH = el.naturalHeight;
  const g = frameGeometry(target);
  const z = Math.max(g.w / natW, g.h / natH);
  const w = g.w / z;
  const h = g.h / z;
  const img = new fabric.FabricImage(el, {
    width: w,
    height: h,
    cropX: (natW - w) / 2,
    cropY: (natH - h) / 2,
    scaleX: z,
    scaleY: z,
    angle: g.angle,
    opacity: target.opacity,
    name: isPhoto(target) ? target.name : 'Photo',
    uid: target.uid,
    frameShape: { kind: g.kind, r: g.radius / z },
    shadow: target.shadow,
    visible: target.visible,
    locked: target.locked,
  });
  if (isPhoto(target) && target.filters?.length) {
    img.filters = await Promise.all(target.filters.map((f) => fabric.classRegistry.getClass(f.type).fromObject(f.toObject())));
    img.applyFilters();
  }
  decorate(img);
  applyClip(img);
  img.setPositionByOrigin(g.center, 'center', 'center');
  img.setCoords();
  return img;
}

/** Puts the photo at `url` into a frame (an empty frame or an existing photo), cropped to cover it. */
export async function fillFrame(target, url) {
  const img = await framedImage(target, url);
  const index = canvas.getObjects().indexOf(target);
  canvas.remove(target);
  canvas.insertAt(index, img);
  canvas.setActiveObject(img);
  canvas.requestRenderAll();
  return img;
}

/** Changes the frame shape of a photo. */
export function setPhotoShape(img, kind, radiusDisplay = 0) {
  img.frameShape = { kind, r: radiusDisplay / img.scaleX };
  applyClip(img);
  canvas.requestRenderAll();
}

// ---------- Crop mode: move and zoom the photo inside its frame ----------

let crop = null;
export const inCrop = () => !!crop;

function offsetsOf(img) {
  const { width: natW, height: natH } = img.getOriginalSize();
  return {
    x: img.flipX ? natW - img.cropX - img.width : img.cropX,
    y: img.flipY ? natH - img.cropY - img.height : img.cropY,
  };
}

export function enterCrop(img) {
  if (crop) exitCrop();
  if (!isPhoto(img)) return;
  canvas.discardActiveObject();
  const z = img.scaleX;
  const a = rad(img.angle);
  const frameTL = img.getPointByOrigin('left', 'top');
  const off = offsetsOf(img);
  const ghostTL = frameTL.subtract(util.rotateVector(new Point(off.x * z, off.y * z), a));
  const ghost = new fabric.FabricImage(img.getElement(), {
    originX: 'left',
    originY: 'top',
    left: ghostTL.x,
    top: ghostTL.y,
    angle: img.angle,
    scaleX: z,
    scaleY: z,
    flipX: img.flipX,
    flipY: img.flipY,
    opacity: 0.4,
    isTemp: true,
    excludeFromExport: true,
    lockRotation: true,
    lockScalingFlip: true,
    lockSkewingX: true,
    lockSkewingY: true,
  });
  ghost.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });

  const saved = new Map();
  for (const o of designObjects()) {
    saved.set(o, { evented: o.evented, selectable: o.selectable });
    o.evented = false;
    o.selectable = false;
  }
  crop = {
    img,
    ghost,
    saved,
    frameTL,
    FW: img.width * img.scaleX,
    FH: img.height * img.scaleY,
    radius: (img.frameShape?.r || 0) * img.scaleX,
  };
  canvas.add(ghost);
  canvas.setActiveObject(ghost);
  canvas.requestRenderAll();
  emit('crop', true);
}

function syncFromGhost() {
  const { img, ghost, frameTL, FW, FH } = crop;
  const { width: natW, height: natH } = img.getOriginalSize();
  const a = rad(img.angle);
  let z = ghost.scaleX;
  const minZ = Math.max(FW / natW, FH / natH);
  if (z < minZ) {
    z = minZ;
    ghost.set({ scaleX: z, scaleY: z });
  }
  const w = FW / z;
  const h = FH / z;
  const d = util.rotateVector(frameTL.subtract(ghost.getPointByOrigin('left', 'top')), -a);
  const offX = clamp(d.x / z, 0, natW - w);
  const offY = clamp(d.y / z, 0, natH - h);
  const tl = frameTL.subtract(util.rotateVector(new Point(offX * z, offY * z), a));
  ghost.setPositionByOrigin(tl, 'left', 'top');
  ghost.setCoords();
  img.set({
    width: w,
    height: h,
    scaleX: z,
    scaleY: z,
    cropX: img.flipX ? natW - offX - w : offX,
    cropY: img.flipY ? natH - offY - h : offY,
  });
  if (img.frameShape) img.frameShape = { ...img.frameShape, r: crop.radius / z };
  img.setPositionByOrigin(frameTL, 'left', 'top');
  applyClip(img);
  img.setCoords();
}

export function exitCrop() {
  if (!crop) return;
  const { img, ghost, saved } = crop;
  crop = null;
  for (const [o, s] of saved) Object.assign(o, s);
  canvas.remove(ghost);
  canvas.setActiveObject(img);
  canvas.fire('object:modified', { target: img });
  canvas.requestRenderAll();
  emit('crop', false);
}

export function initFrames() {
  canvas.on('object:moving', (e) => crop && e.target === crop.ghost && syncFromGhost());
  canvas.on('object:scaling', (e) => crop && e.target === crop.ghost && syncFromGhost());
  canvas.on('selection:cleared', () => crop && exitCrop());
  canvas.on('mouse:dblclick', (e) => {
    if (crop) return exitCrop();
    if (isPhoto(e.target)) enterCrop(e.target);
  });
  // Frame outline while cropping.
  canvas.on('after:render', ({ ctx }) => {
    if (!crop) return;
    const { img } = crop;
    const v = canvas.viewportTransform;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    const c = img.getCenterPoint();
    ctx.translate(c.x, c.y);
    ctx.rotate(rad(img.angle));
    ctx.setLineDash([6 / canvas.getZoom(), 4 / canvas.getZoom()]);
    ctx.lineWidth = 1.5 / canvas.getZoom();
    ctx.strokeStyle = '#1f5e99';
    const w = crop.FW;
    const h = crop.FH;
    ctx.beginPath();
    if (img.frameShape?.kind === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (img.frameShape?.kind === 'arch') ctx.stroke(new Path2D(archPath(w, h)));
    else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.stroke();
    ctx.restore();
  });
}
