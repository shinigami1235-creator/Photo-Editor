import { canvas, serializeObjects, loadObjects, loading } from './canvas.js';
import { state, currentPage, emit, markDirty } from './state.js';

// One undo stack per page. A snapshot is the page's objects and background as
// JSON; images are blob: URLs so snapshots stay small.

const LIMIT = 150;
const stacks = new Map(); // pageId -> { undo: [], redo: [] }
let paused = 0;
let timer = null;

const stackFor = (id) => {
  if (!stacks.has(id)) stacks.set(id, { undo: [], redo: [] });
  return stacks.get(id);
};

const snap = () => JSON.stringify({ objects: serializeObjects(), background: currentPage().background });

/** Call once a page is on the canvas so its first state can be undone to. */
export function resetHistory() {
  const s = stackFor(currentPage().id);
  if (!s.undo.length) s.undo.push(snap());
  emit('history');
}

export function clearAllHistory() {
  stacks.clear();
}

/** Records the canvas after a change. Several calls within 250 ms become one step. */
export function record(immediate = false) {
  if (paused || loading || !state.doc) return;
  clearTimeout(timer);
  const run = () => {
    const s = stackFor(currentPage().id);
    const now = snap();
    if (s.undo[s.undo.length - 1] === now) return;
    s.undo.push(now);
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
  await restore(s.undo[s.undo.length - 1]);
  emit('history');
}

export async function redo() {
  const s = stackFor(currentPage().id);
  if (!s.redo.length) return;
  const next = s.redo.pop();
  s.undo.push(next);
  await restore(next);
  emit('history');
}

export function canUndo() {
  return state.doc ? stackFor(currentPage().id).undo.length > 1 : false;
}
export function canRedo() {
  return state.doc ? stackFor(currentPage().id).redo.length > 0 : false;
}

export function watchCanvas() {
  canvas.on('object:added', () => record());
  canvas.on('object:removed', () => record());
  canvas.on('object:modified', () => record());
  canvas.on('text:changed', () => record());
}
