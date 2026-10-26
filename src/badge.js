// Labels and tags: a rounded box with a word in it, such as BEFORE or
// SIMULATED GOAL. Each is one layer that can be dragged anywhere, and its
// words and colours can be changed in Properties or by Claude.

import { canvas, fabric, decorate } from './canvas.js';
import { uid } from './state.js';
import { brandFont } from './brand.js';

export const LABEL_COLORS = { fill: '#101c2b', color: '#ffffff' };
export const TAG_COLORS = { fill: '#e0b45a', color: '#101c2b' };

function build({ text, fill, color, size, opacity = 1, spacing = 170 }) {
  const t = new fabric.Textbox(String(text).toUpperCase(), {
    fontFamily: brandFont('heading') || 'Arial',
    fontWeight: 'bold',
    fontSize: size,
    charSpacing: spacing,
    fill: color,
    textAlign: 'center',
    width: size * (String(text).length * 0.95 + 1.6),
  });
  t.initDimensions();
  const padX = size * 0.75;
  const padY = size * 0.38;
  const bg = new fabric.Rect({ left: 0, top: 0, width: t.width + padX * 2, height: t.height + padY * 2, rx: size * 0.35, ry: size * 0.35, fill, opacity });
  t.set({ left: padX, top: padY });
  return [bg, t];
}

/**
 * A new label or tag layer. `at` is { x, y, anchor } where anchor is
 * left or right, so a right-hand label keeps its right edge when retyped.
 */
export function makeBadge({ text, fill, color, size, opacity = 1, layerOpacity = 1, kind = 'label', name, at = { x: 0, y: 0, anchor: 'left' } }) {
  const badge = { text, fill, color, size, opacity, kind, anchor: at.anchor || 'left' };
  const g = new fabric.Group(build(badge), { uid: uid(), name: name || `${text} label`, badge, opacity: layerOpacity });
  g.set({ left: badge.anchor === 'right' ? at.x - g.width : at.x, top: at.y });
  g.setCoords();
  decorate(g);
  return g;
}

/** Changes a label's words or colours in place. Returns the new layer. */
export function updateBadge(o, changes) {
  const badge = { ...o.badge, ...changes };
  const right = o.left + o.getScaledWidth();
  const g = new fabric.Group(build(badge), { uid: o.uid, name: o.name, badge, angle: o.angle, scaleX: o.scaleX, scaleY: o.scaleY, opacity: o.opacity, visible: o.visible });
  g.set({ left: badge.anchor === 'right' ? right - g.getScaledWidth() : o.left, top: o.top });
  g.setCoords();
  decorate(g);
  const i = canvas.getObjects().indexOf(o);
  const active = canvas.getActiveObject() === o;
  canvas.remove(o);
  canvas.insertAt(i, g);
  if (active) canvas.setActiveObject(g);
  canvas.requestRenderAll();
  return g;
}

export const isBadge = (o) => !!o?.badge;

/** Labels such as BEFORE or TODAY. The Simulated goal tag is not one. */
export const isLabel = (o) => !!o?.badge && (o.badge.kind || (o.name === 'Simulated goal tag' ? 'tag' : 'label')) === 'label';
export const pageLabels = () => canvas.getObjects().filter(isLabel);

/** Sets the opacity of every label on the page, 0 to 100. */
export function setLabelOpacity(v) {
  const k = Math.max(0, Math.min(100, +v || 0)) / 100;
  for (const o of pageLabels()) o.set('opacity', k);
  canvas.requestRenderAll();
}

/** The labels' opacity on this page, 0 to 100. */
export const labelOpacity = () => Math.round((pageLabels()[0]?.opacity ?? 1) * 100);
