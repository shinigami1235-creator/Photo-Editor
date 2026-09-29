import { canvas, applyPageSize, serializeObjects, loadObjects, fabric } from './canvas.js';
import { state, currentPage, emit, on, newPage, uid, markDirty } from './state.js';
import { pauseHistory, resetHistory, clearAllHistory, record } from './history.js';
import { ensureFontsFor } from './fonts.js';
import { thumbnail } from './exporter.js';
import { exitCrop, inCrop } from './frames.js';

// Switching pages, opening designs, and the page strip along the bottom.

export function syncCurrentPage() {
  if (state.doc) currentPage().objects = serializeObjects();
}

export async function openDocument(doc, path = null) {
  if (inCrop()) exitCrop();
  state.doc = doc;
  state.pageIndex = 0;
  state.path = path;
  clearAllHistory();
  applyPageSize();
  await ensureFontsFor(doc.pages.flatMap((p) => p.objects));
  await pauseHistory(() => loadObjects(doc.pages[0].objects));
  resetHistory();
  state.dirty = false;
  emit('doc');
  emit('page');
  refreshAllThumbs();
}

export async function showPage(i) {
  if (!state.doc || i < 0 || i >= state.doc.pages.length) return;
  if (inCrop()) exitCrop();
  syncCurrentPage();
  state.pageIndex = i;
  await pauseHistory(() => loadObjects(currentPage().objects));
  resetHistory();
  emit('page');
  emit('page-props');
}

export async function addPage(page = newPage(currentPage()?.background || '#ffffff'), at = state.pageIndex + 1) {
  syncCurrentPage();
  state.doc.pages.splice(at, 0, page);
  markDirty();
  await showPage(at);
  refreshThumb(page);
  emit('pages');
}

export async function duplicatePage(i = state.pageIndex) {
  syncCurrentPage();
  const src = state.doc.pages[i];
  const copy = { id: uid(), background: src.background, objects: JSON.parse(JSON.stringify(src.objects)), selections: [...(src.selections || [])], guides: JSON.parse(JSON.stringify(src.guides || [])), thumb: src.thumb };
  await addPage(copy, i + 1);
}

export async function deletePage(i = state.pageIndex) {
  if (state.doc.pages.length < 2) return;
  syncCurrentPage();
  state.doc.pages.splice(i, 1);
  markDirty();
  const next = Math.min(i, state.doc.pages.length - 1);
  state.pageIndex = -1; // forces showPage to load
  state.pageIndex = next;
  await pauseHistory(() => loadObjects(currentPage().objects));
  resetHistory();
  emit('page');
  emit('pages');
}

export function movePage(from, to) {
  if (to < 0 || to >= state.doc.pages.length || from === to) return;
  syncCurrentPage();
  const [p] = state.doc.pages.splice(from, 1);
  state.doc.pages.splice(to, 0, p);
  if (state.pageIndex === from) state.pageIndex = to;
  else if (from < state.pageIndex && to >= state.pageIndex) state.pageIndex--;
  else if (from > state.pageIndex && to <= state.pageIndex) state.pageIndex++;
  markDirty();
  emit('pages');
  emit('page');
}

/** Changes the design size. With `scale`, every page's content is scaled to fit and centred. */
export async function resizeDesign(width, height, dpi, scale) {
  syncCurrentPage();
  const { width: ow, height: oh } = state.doc;
  if (scale) {
    const s = Math.min(width / ow, height / oh);
    const ox = (width - ow * s) / 2;
    const oy = (height - oh * s) / 2;
    for (const p of state.doc.pages) p.objects = p.objects.map((o) => scaleObjectJson(o, s, ox, oy));
  }
  Object.assign(state.doc, { width, height, dpi });
  applyPageSize();
  await pauseHistory(() => loadObjects(currentPage().objects));
  record(true);
  emit('doc');
  refreshAllThumbs();
}

export function scaleObjectJson(o, s, ox, oy) {
  return { ...o, left: o.left * s + ox, top: o.top * s + oy, scaleX: (o.scaleX ?? 1) * s, scaleY: (o.scaleY ?? 1) * s };
}

// ---------- Thumbnails ----------

let thumbTimer = null;
export async function refreshThumb(page) {
  try {
    page.thumb = await thumbnail(page);
    emit('thumb', page);
  } catch (e) {
    console.warn('thumbnail', e);
  }
}

export async function refreshAllThumbs() {
  for (const p of state.doc.pages) await refreshThumb(p);
}

on('changed', () => {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    syncCurrentPage();
    refreshThumb(currentPage());
  }, 500);
});

export { canvas, fabric };
