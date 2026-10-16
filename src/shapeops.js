import { canvas, fabric, selected, decorate, enliven } from './canvas.js';
import { state, emit, uid } from './state.js';
import { record } from './history.js';
import { h, modal, toast } from './ui.js';
import { defineCommands } from './commands.js';
import { objectPolygons, booleanShapes, polygonsToPath } from './shapetools.js';
import { mergeLayers } from './selection.js';
import { isPhoto } from './frames.js';
import { selectObjects } from './objects.js';

// Shape tools from VectorCraft's playbook, rewritten for this editor: combining
// shapes (unite, subtract, intersect, exclude), text that runs along a shape's
// outline, repeating a layer in a grid or a circle, and turning a layer into a
// photo layer.

const SHAPE_TYPES = ['rect', 'ellipse', 'circle', 'triangle', 'polygon', 'polyline', 'path'];
const isShape = (o) => o && SHAPE_TYPES.includes(String(o.type).toLowerCase()) && !o.isFrame && !o.isAdjustment;

/** The outline of a shape object as polygons in page units. */
function polygonsOf(o) {
  const type = String(o.type).toLowerCase();
  const geom = { type, width: o.width, height: o.height, rx: o.rx, ry: o.ry, radius: o.radius, points: o.points, path: o.path, pathOffset: o.pathOffset };
  return objectPolygons(geom, o.calcTransformMatrix(), 0.4);
}

// ---------- Combine ----------

function combine(op) {
  const list = selected().filter(isShape);
  if (list.length < 2) return toast('Select two or more shapes.');
  const objs = canvas.getObjects();
  list.sort((a, b) => objs.indexOf(a) - objs.indexOf(b));
  let result;
  try {
    // Subtract takes the front shapes out of the one at the back.
    result = booleanShapes(op, list.map(polygonsOf));
  } catch (e) {
    return toast(`These shapes could not be combined: ${e.message || e}`, { error: true });
  }
  const { d, width } = polygonsToPath(result);
  if (!d || !width) return toast('Nothing is left after combining.');
  const back = list[0];
  const path = new fabric.Path(d, {
    uid: uid(),
    name: { unite: 'Combined shape', subtract: 'Cut shape', intersect: 'Overlap', exclude: 'Combined shape' }[op],
    fill: back.fill,
    stroke: back.stroke,
    strokeWidth: back.strokeWidth,
    strokeUniform: true,
    fillRule: 'evenodd',
    opacity: back.opacity,
    shadow: back.shadow,
  });
  decorate(path);
  const at = objs.indexOf(list[list.length - 1]);
  canvas.discardActiveObject();
  canvas.remove(...list);
  canvas.insertAt(Math.max(0, at - list.length + 1), path);
  path.setCoords();
  canvas.setActiveObject(path);
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

// ---------- Text on a shape ----------

/** One outline of a shape, as a path starting at the top and going clockwise. */
function outlineD(o) {
  const mp = polygonsOf(o);
  let ring = mp[0]?.[0];
  if (!ring) return null;
  ring = ring.slice(0, ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0));
  // Clockwise on screen: positive area with y pointing down.
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  if (area < 0) ring = ring.reverse();
  // Start at the point nearest the top middle, so text begins at the top.
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  let start = 0;
  let best = Infinity;
  ring.forEach(([x, y], i) => {
    const score = y + Math.abs(x - cx) * 0.6;
    if (score < best) {
      best = score;
      start = i;
    }
  });
  ring = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
  return ring.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

function textOnShape() {
  const list = selected();
  const t = list.find((o) => o.type === 'textbox');
  const s = list.find(isShape);
  if (!t || !s) return toast('Select a text and a shape together (Shift+click), then try again.');
  const d = outlineD(s);
  if (!d) return;
  const fresh = new fabric.Path(d);
  const centre = fresh.getCenterPoint();
  canvas.discardActiveObject();
  if (!t.path) t.flatWidth = t.width;
  t.curve = 0;
  t.set({ path: new fabric.Path(d, { visible: false }), pathAlign: 'baseline', pathSide: 'left', pathStartOffset: 0, textAlign: 'left', angle: 0, scaleX: 1, scaleY: 1, onShape: true });
  t.initDimensions();
  t.setPositionByOrigin(centre, 'center', 'center');
  t.setCoords();
  t.dirty = true;
  canvas.setActiveObject(t);
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

function textOffPath() {
  const t = selected()[0];
  if (t?.type !== 'textbox' || !t.path) return;
  const c = t.getCenterPoint();
  t.set({ path: undefined, onShape: false, curve: 0 });
  t.width = t.flatWidth || 600;
  t.initDimensions();
  t.setPositionByOrigin(c, 'center', 'center');
  t.setCoords();
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

// ---------- Repeat ----------

async function repeatDialog() {
  const src = selected();
  if (!src.length) return;
  const S = { kind: 'grid', cols: 3, rows: 2, gapX: 20, gapY: 20, count: 8, radius: 300, rotate: true };
  const body = h('div', { class: 'stack gap' });
  const num = (label, key, min, max) =>
    h('label', { class: 'field-row' }, h('span', { class: 'label' }, label), h('input', { class: 'field num', type: 'number', min, max, value: S[key], oninput: (e) => (S[key] = Math.max(min, Math.min(max, +e.target.value || min))) }));
  const draw = () => {
    body.innerHTML = '';
    body.append(
      h(
        'div',
        { class: 'seg' },
        [
          ['grid', 'Grid'],
          ['circle', 'Circle'],
        ].map(([v, label]) => h('button', { class: S.kind === v ? 'on' : '', onclick: () => ((S.kind = v), draw()) }, label)),
      ),
      ...(S.kind === 'grid'
        ? [num('Columns', 'cols', 1, 30), num('Rows', 'rows', 1, 30), num('Gap across', 'gapX', -2000, 2000), num('Gap down', 'gapY', -2000, 2000)]
        : [num('Copies', 'count', 2, 72), num('Radius', 'radius', 10, 5000), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.rotate, onchange: (e) => (S.rotate = e.target.checked) }), 'Turn each copy to face out')]),
      h('p', { class: 'muted small' }, 'The copies are grouped. Ungroup them (Shift+Ctrl+G) to move one on its own.'),
    );
  };
  draw();
  const ok = await modal('Repeat', body, [
    { label: 'Cancel', value: false },
    { label: 'Repeat', value: true, primary: true },
  ]);
  if (!ok) return;
  const json = src.map((o) => o.toObject());
  const box = canvas.getActiveObject().getBoundingRect();
  const centre = canvas.getActiveObject().getCenterPoint();
  const copies = [];
  const n = S.kind === 'grid' ? S.cols * S.rows : S.count;
  for (let k = 0; k < n; k++) {
    const list = await enliven(json);
    for (const c of list) {
      c.uid = uid();
      const p = c.getCenterPoint();
      let dx;
      let dy;
      let rot = 0;
      if (S.kind === 'grid') {
        dx = (k % S.cols) * (box.width + S.gapX);
        dy = Math.floor(k / S.cols) * (box.height + S.gapY);
      } else {
        const a = (k / n) * Math.PI * 2 - Math.PI / 2;
        dx = Math.cos(a) * S.radius;
        dy = Math.sin(a) * S.radius + S.radius;
        rot = S.rotate ? (k / n) * 360 : 0;
      }
      // Objects inside a multi-selection keep positions relative to it.
      const base = src.length > 1 ? new fabric.Point(p.x + centre.x, p.y + centre.y) : p;
      c.setPositionByOrigin(new fabric.Point(base.x + dx, base.y + dy - (S.kind === 'circle' ? S.radius : 0)), 'center', 'center');
      if (rot) c.rotate((c.angle || 0) + rot);
      c.setCoords();
      copies.push(c);
    }
  }
  canvas.discardActiveObject();
  canvas.remove(...src);
  const g = new fabric.Group(copies, { uid: uid(), name: 'Repeat' });
  decorate(g);
  canvas.add(g);
  canvas.setActiveObject(g);
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

// ---------- Init ----------

export function init() {
  const two = () => selected().filter(isShape).length >= 2;
  defineCommands({
    'layer.combine.unite': { label: 'Unite', run: () => combine('unite'), enabled: two, also: 'merge shapes add' },
    'layer.combine.subtract': { label: 'Subtract front', run: () => combine('subtract'), enabled: two, also: 'cut minus' },
    'layer.combine.intersect': { label: 'Intersect', run: () => combine('intersect'), enabled: two, also: 'overlap' },
    'layer.combine.exclude': { label: 'Exclude overlap', run: () => combine('exclude'), enabled: two, also: 'xor' },
    'type.onshape': { label: 'Put text on a shape', run: textOnShape, enabled: () => selected().some((o) => o.type === 'textbox') && selected().some(isShape), also: 'text on path circle' },
    'type.offpath': { label: 'Take text off its path', run: textOffPath, enabled: () => selected()[0]?.type === 'textbox' && !!selected()[0].path },
    'edit.repeat': { label: 'Repeat', run: repeatDialog, enabled: () => selected().length > 0 && !selected().some((o) => o.isAdjustment), also: 'grid circle radial copies pattern' },
    'layer.rasterize': {
      label: 'Convert to photo layer',
      run: () => mergeLayers(selected(), { name: selected()[0]?.name || 'Layer', one: true }),
      enabled: () => selected().length > 0 && !selected().some((o) => o.isAdjustment || isPhoto(o)),
      also: 'rasterize flatten pixels',
    },
  });
  void state;
  void selectObjects;
}
