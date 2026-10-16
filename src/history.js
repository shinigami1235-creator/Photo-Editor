import { canvas, serializeObjects, loadObjects, loading } from './canvas.js';
import { state, currentPage, emit, markDirty } from './state.js';

// One undo stack per page. A snapshot is the page's objects and background as
// JSON; images are blob: URLs so snapshots stay small. Each step gets a name
// worked out from what changed, for the History panel.

const LIMIT = 150;
const stacks = new Map(); // pageId -> { undo: [{ json, label }], redo: [...] }
let paused = 0;
let timer = null;
let nextLabel = null;

const stackFor = (id) => {
  if (!stacks.has(id)) stacks.set(id, { undo: [], redo: [] });
  return stacks.get(id);
};

const snap = () => JSON.stringify({ objects: serializeObjects(), background: currentPage().background });

/** Call once a page is on the canvas so its first state can be undone to. */
export function resetHistory() {
  const s = stackFor(currentPage().id);
  if (!s.undo.length) s.undo.push({ json: snap(), label: 'Open' });
  emit('history');
}

export function clearAllHistory() {
  stacks.clear();
}

/** Names the next recorded step, for changes the automatic name would get wrong. */
export function labelNext(label) {
  nextLabel = label;
}

/** Records the canvas after a change. Several calls within 250 ms become one step. */
export function record(immediate = false) {
  if (paused || loading || !state.doc) return;
  clearTimeout(timer);
  const run = () => {
    const s = stackFor(currentPage().id);
    const now = snap();
    const last = s.undo[s.undo.length - 1];
    if (last?.json === now) return;
    let label = nextLabel;
    nextLabel = null;
    if (!label) {
      try {
        label = last ? describe(last.json, now) : 'Change';
      } catch {
        label = 'Change';
      }
    }
    s.undo.push({ json: now, label });
    if (s.undo.length > LIMIT) s.undo.shift();
    s.redo = [];
    currentPage().objects = JSON.parse(now).objects;
    markDirty();
    emit('history');
    emit('changed');
  };
  if (immediate) run();
  else timer = setTimeout(run, 250);
}

export async function pauseHistory(fn) {
  paused++;
  try {
    return await fn();
  } finally {
    paused--;
  }
}

async function restore(json) {
  const { objects, background } = JSON.parse(json);
  currentPage().background = background;
  currentPage().objects = objects;
  await pauseHistory(() => loadObjects(objects));
  markDirty();
  emit('page-props');
  emit('changed');
}

export async function undo() {
  clearTimeout(timer);
  const s = stackFor(currentPage().id);
  if (s.undo.length < 2) return;
  s.redo.push(s.undo.pop());
  await restore(s.undo[s.undo.length - 1].json);
  emit('history');
}

export async function redo() {
  const s = stackFor(currentPage().id);
  if (!s.redo.length) return;
  const next = s.redo.pop();
  s.undo.push(next);
  await restore(next.json);
  emit('history');
}

export function canUndo() {
  return state.doc ? stackFor(currentPage().id).undo.length > 1 : false;
}
export function canRedo() {
  return state.doc ? stackFor(currentPage().id).redo.length > 0 : false;
}

/** The steps of this page, oldest first, and which one the page shows now. */
export function historySteps() {
  if (!state.doc) return { steps: [], current: -1 };
  const s = stackFor(currentPage().id);
  return { steps: [...s.undo, ...[...s.redo].reverse()].map((e) => e.label), current: s.undo.length - 1 };
}

/** Goes back or forward to step `i` of historySteps(). */
export async function jumpTo(i) {
  clearTimeout(timer);
  const s = stackFor(currentPage().id);
  const cur = s.undo.length - 1;
  if (i === cur || i < 0 || i >= s.undo.length + s.redo.length) return;
  if (i < cur) for (let k = cur; k > i; k--) s.redo.push(s.undo.pop());
  else for (let k = cur; k < i; k++) s.undo.push(s.redo.pop());
  await restore(s.undo[s.undo.length - 1].json);
  emit('history');
}

export function watchCanvas() {
  canvas.on('object:added', () => record());
  canvas.on('object:removed', () => record());
  canvas.on('object:modified', () => record());
  canvas.on('text:changed', () => record());
}

// ---------- Step names ----------

function kindName(o) {
  if (o.isAdjustment) return o.name || 'adjustment layer';
  const type = String(o.type).toLowerCase();
  if (type === 'image') return 'photo';
  if (type === 'textbox') return 'text';
  if (o.isFrame) return 'frame';
  return { rect: 'rectangle', ellipse: 'circle', triangle: 'triangle', line: 'line', group: 'group', path: o.shapeKind ? o.name?.toLowerCase() || 'shape' : 'drawing' }[type] || 'layer';
}

const STYLE_KEYS = ['shadow', 'outlineWidth', 'outlineColor', 'glowSize', 'glowColor', 'glowStrength', 'innerShadow', 'innerGlow', 'bevel', 'colorOverlay', 'gradientOverlay'];

function describe(prevJson, nextJson) {
  const a = JSON.parse(prevJson);
  const b = JSON.parse(nextJson);
  if (a.background !== b.background) return 'Background colour';
  const A = new Map(a.objects.map((o) => [o.uid, o]));
  const B = new Map(b.objects.map((o) => [o.uid, o]));
  const added = b.objects.filter((o) => !A.has(o.uid));
  const removed = a.objects.filter((o) => !B.has(o.uid));
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  if (added.length && !removed.length) return added.length > 1 ? `Add ${added.length} layers` : `Add ${kindName(added[0])}`;
  if (removed.length && !added.length) return removed.length > 1 ? `Delete ${removed.length} layers` : `Delete ${kindName(removed[0])}`;
  const isGroup = (o) => String(o.type).toLowerCase() === 'group';
  if (added.length && removed.length) return removed.length > 1 && added.length === 1 ? (isGroup(added[0]) ? 'Group' : 'Merge layers') : added.length > 1 && removed.length === 1 && isGroup(removed[0]) ? 'Ungroup' : 'Change layers';
  if (a.objects.map((o) => o.uid).join() !== b.objects.map((o) => o.uid).join()) return 'Arrange';
  const changed = b.objects.filter((o) => JSON.stringify(o) !== JSON.stringify(A.get(o.uid)));
  if (!changed.length) return 'Change';
  const o = changed[0];
  const p = A.get(o.uid);
  const keys = Object.keys({ ...o, ...p }).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(p[k]));
  const has = (...ks) => ks.some((k) => keys.includes(k));
  const only = (...ks) => keys.every((k) => ks.includes(k));
  const n = changed.length > 1 ? `${changed.length} layers` : kindName(o);
  if (only('left', 'top')) return `Move ${n}`;
  if (has('text')) return 'Edit text';
  if (only('scaleX', 'scaleY', 'width', 'height', 'left', 'top', 'rx', 'ry', 'path', 'pathOffset')) return `Resize ${n}`;
  if (has('angle') && only('angle', 'left', 'top')) return `Rotate ${n}`;
  if (has('adjust')) return o.name || 'Adjustment';
  if (has('filters')) return 'Adjust photo';
  if (has('layerMask', 'maskOn')) return 'Layer mask';
  if (has('visible')) return o.visible ? 'Show layer' : 'Hide layer';
  if (has('locked')) return o.locked ? 'Lock layer' : 'Unlock layer';
  if (has(...STYLE_KEYS)) return 'Layer style';
  if (has('corners')) return 'Transform';
  if (has('clipBelow')) return o.clipBelow ? 'Clip to layer below' : 'Release clip';
  if (has('warp', 'warpBend')) return 'Warp';
  if (has('curve')) return 'Curve text';
  if (has('fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'textAlign', 'charSpacing', 'lineHeight')) return 'Text style';
  if (has('fill', 'patternFill')) return 'Fill';
  if (has('stroke', 'strokeWidth')) return 'Border';
  if (has('opacity')) return 'Opacity';
  if (has('globalCompositeOperation')) return 'Blend mode';
  if (has('name')) return 'Rename layer';
  if (has('src')) return 'Edit photo';
  if (has('cropX', 'cropY', 'frameShape')) return 'Crop';
  if (has('flipX', 'flipY')) return 'Flip';
  if (has('shapeOpts')) return 'Shape';
  return cap(`change ${n}`);
}
