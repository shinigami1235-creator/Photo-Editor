import { canvas, fabric, loadObjects, designObjects } from './canvas.js';
import { state, uid, SIZE_PRESETS, currentPage } from './state.js';
import { record, pauseHistory } from './history.js';
import { syncCurrentPage, addPage, openDocument } from './pages.js';
import { buildZip } from './project.js';
import { pickFolder, joinPath, writeFile, isDesktop } from './platform.js';
import { rememberRecent } from './home.js';
import { brandFont } from './brand.js';
import { h, modal, toast } from './ui.js';

// Layout helpers: copies of a design at other sizes, the panorama carousel,
// and the before-and-after pages.

// ---------- Other sizes ----------

/**
 * Moves and scales objects from one page size to another. A background that
 * covers the page is scaled to cover the new page. Anything close to an edge
 * keeps its distance from that edge, and the rest keeps its relative position.
 */
export async function adaptObjects(objects, from, to) {
  const list = await fabric.util.enlivenObjects(objects);
  const fit = Math.min(to.w / from.w, to.h / from.h);
  const cover = Math.max(to.w / from.w, to.h / from.h);
  return list.map((o) => {
    o.setCoords();
    const r = o.getBoundingRect();
    const isBack = r.width >= from.w * 0.9 && r.height >= from.h * 0.9;
    const s = isBack ? cover : fit;
    const along = (lo, size, full, toFull) => {
      const hi = full - (lo + size);
      const ns = size * s;
      // A background, or anything spanning most of this side, stays centred.
      if (isBack || (lo < full * 0.15 && hi < full * 0.15)) return toFull / 2 + (lo + size / 2 - full / 2) * s - ns / 2;
      if (lo < full * 0.15 && lo <= hi) return lo * s;
      if (hi < full * 0.15) return toFull - hi * s - ns;
      return ((lo + size / 2) / full) * toFull - ns / 2;
    };
    const nl = along(r.left, r.width, from.w, to.w);
    const nt = along(r.top, r.height, from.h, to.h);
    o.set({ scaleX: o.scaleX * s, scaleY: o.scaleY * s });
    o.setCoords();
    const r2 = o.getBoundingRect();
    o.set({ left: o.left + nl - r2.left, top: o.top + nt - r2.top });
    o.setCoords();
    return o.toObject();
  });
}

const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'design';

/** Saves a copy of the design for each size picked. */
export async function otherSizesDialog() {
  if (!state.doc) return;
  syncCurrentPage();
  const { width: W, height: H } = state.doc;
  const choices = SIZE_PRESETS.filter((p) => p.width !== W || p.height !== H);
  const picked = new Set();
  const body = h(
    'div',
    { class: 'stack gap' },
    h('p', { class: 'muted small' }, 'Each size is saved as its own design file with the text, logos and photos moved to fit. Open each one to adjust it before exporting.'),
    choices.map((p) =>
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? picked.add(p) : picked.delete(p)) }),
        `${p.name}, ${p.width} × ${p.height}`,
      ),
    ),
  );
  const ok = await modal('Make other sizes', body, [
    { label: 'Cancel', value: false },
    { label: 'Save designs', value: true, primary: true },
  ]);
  if (!ok) return;
  if (!picked.size) return toast('Tick at least one size.');
  const dir = await pickFolder();
  if (dir == null) return;
  const note = toast('Making the other sizes', { sticky: true });
  const saved = [];
  try {
    for (const p of picked) {
      const pages = [];
      for (const pg of state.doc.pages) {
        pages.push({
          id: uid(),
          background: pg.background,
          objects: await adaptObjects(pg.objects, { w: W, h: H }, { w: p.width, h: p.height }),
          selections: [],
          guides: [],
          thumb: null,
        });
      }
      const doc = { id: uid(), name: `${state.doc.name} ${p.name}`, width: p.width, height: p.height, dpi: p.dpi, pages };
      const file = `${safeName(doc.name)}.zip`;
      const path = joinPath(dir, file);
      await writeFile(path, await buildZip(doc), 'application/zip');
      if (isDesktop) await rememberRecent(path, doc.name, null);
      saved.push({ doc, path });
    }
  } catch (e) {
    toast(`The other sizes could not be saved: ${e.message || e}`, { error: true });
  } finally {
    note.done();
  }
  if (!saved.length) return;
  const open = await modal(
    'Other sizes saved',
    h('div', { class: 'stack' }, saved.map((s) => h('p', {}, s.doc.name))),
    [
      { label: 'Close', value: null },
      { label: `Open ${saved[0].doc.name}`, value: 0, primary: true },
    ],
  );
  if (open === 0) await openDocument(saved[0].doc, isDesktop ? saved[0].path : null);
}

// ---------- Panorama carousel ----------

const SLIDE_SHAPES = [
  { id: '45', name: 'Post 4:5', width: 1080, height: 1350 },
  { id: '11', name: 'Square 1:1', width: 1080, height: 1080 },
  { id: '34', name: 'Tall post 3:4', width: 1080, height: 1440 },
];

/** Asks for the slide count and shape. Returns { width, height, slides } or null. */
export async function carouselDialog() {
  const S = { slides: 3, shape: SLIDE_SHAPES[0] };
  const count = h('input', { class: 'field num', type: 'number', min: 2, max: 10, value: S.slides, oninput: (e) => (S.slides = Math.max(2, Math.min(10, +e.target.value || 2))) });
  const shapes = h(
    'div',
    { class: 'seg' },
    SLIDE_SHAPES.map((s) =>
      h('button', {
        class: s === S.shape ? 'on' : '',
        onclick: (e) => {
          S.shape = s;
          [...shapes.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget));
        },
      }, s.name),
    ),
  );
  const ok = await modal(
    'Panorama carousel',
    h(
      'div',
      { class: 'stack gap' },
      h('p', { class: 'muted small' }, 'One wide page that exports as separate slides, so a photo or a line can run across the swipe.'),
      h('label', { class: 'field-row' }, h('span', { class: 'label' }, 'Slides'), count),
      h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Slide'), shapes),
    ),
    [
      { label: 'Cancel', value: false },
      { label: 'Create', value: true, primary: true },
    ],
  );
  if (!ok) return null;
  return { width: S.shape.width * S.slides, height: S.shape.height, slides: S.slides, name: `Carousel ${S.slides} slides` };
}

/** Cuts a rendered page into equal slides, left to right. */
export function splitSlides(cv, n) {
  const out = [];
  const w = cv.width / n;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = Math.round(w);
    c.height = cv.height;
    c.getContext('2d').drawImage(cv, Math.round(i * w), 0, Math.round(w), cv.height, 0, 0, c.width, c.height);
    out.push(c);
  }
  return out;
}

// ---------- Before and after ----------

export const BEFORE_AFTER = [
  { id: 'side', name: 'Side by side' },
  { id: 'stack', name: 'Top and bottom' },
  { id: 'split', name: 'Split' },
];

function frame(x, y, w, hh) {
  return new fabric.Rect({
    uid: uid(),
    name: 'Frame',
    isFrame: true,
    left: x,
    top: y,
    width: w,
    height: hh,
    originX: 'left',
    originY: 'top',
    fill: '#d5d9e0',
    stroke: '#9aa1ad',
    strokeWidth: 2,
    strokeDashArray: [10, 8],
    strokeUniform: true,
  });
}

function label(text, x, y, size, align) {
  const t = new fabric.Textbox(text, {
    uid: uid(),
    name: text,
    left: x,
    top: y,
    width: size * 5,
    originX: align === 'right' ? 'right' : 'left',
    originY: 'bottom',
    fontSize: size,
    fontFamily: brandFont('heading') || 'Arial',
    fontWeight: 'bold',
    fill: '#ffffff',
    textAlign: align,
    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.45)', blur: size * 0.4, offsetX: 0, offsetY: size * 0.06 }),
    charSpacing: 60,
  });
  return t;
}

/** Page objects for a before-and-after layout at the design's size. */
export function beforeAfterObjects(kind) {
  const W = state.doc.width;
  const H = state.doc.height;
  const m = Math.round(Math.min(W, H) * 0.04);
  const g = Math.round(m / 2);
  const size = Math.round(Math.min(W, H) * 0.05);
  const pad = Math.round(size * 0.7);
  const objs = [];
  if (kind === 'stack') {
    const fh = (H - 2 * m - g) / 2;
    objs.push(frame(m, m, W - 2 * m, fh), frame(m, m + fh + g, W - 2 * m, fh));
    objs.push(label('BEFORE', m + pad, m + fh - pad, size, 'left'), label('AFTER', m + pad, H - m - pad, size, 'left'));
  } else if (kind === 'split') {
    objs.push(frame(0, 0, W / 2, H), frame(W / 2, 0, W / 2, H));
    const line = new fabric.Rect({ uid: uid(), name: 'Divider', left: W / 2, top: 0, originX: 'center', originY: 'top', width: Math.max(4, Math.round(W / 180)), height: H, fill: '#ffffff' });
    objs.push(line, label('BEFORE', pad * 1.5, H - pad * 1.5, size, 'left'), label('AFTER', W - pad * 1.5, H - pad * 1.5, size, 'right'));
  } else {
    const fw = (W - 2 * m - g) / 2;
    objs.push(frame(m, m, fw, H - 2 * m), frame(m + fw + g, m, fw, H - 2 * m));
    objs.push(label('BEFORE', m + pad, H - m - pad, size, 'left'), label('AFTER', m + fw + g + pad, H - m - pad, size, 'left'));
  }
  return objs.map((o) => o.toObject());
}

/** Puts a before-and-after layout on this page when it is empty, else on a new page. */
export async function useBeforeAfter(kind) {
  const objects = beforeAfterObjects(kind);
  if (!designObjects().length) {
    await pauseHistory(() => loadObjects(objects));
    record(true);
  } else {
    syncCurrentPage();
    await addPage({ id: uid(), background: currentPage().background, objects, thumb: null });
  }
  canvas.requestRenderAll();
  toast('Drop a photo on each frame.');
}

/** Small drawings of the layouts for the Templates tab. */
export function beforeAfterIcon(kind) {
  const f = (x, y, w, hh) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="2" fill="#cfd5de"/>`;
  const inner =
    kind === 'stack' ? f(4, 4, 32, 15) + f(4, 21, 32, 15) : kind === 'split' ? f(2, 2, 18, 36) + f(20, 2, 18, 36) + '<rect x="19.2" y="2" width="1.6" height="36" fill="#fff"/>' : f(4, 4, 15, 32) + f(21, 4, 15, 32);
  return `<svg viewBox="0 0 40 40" width="56" height="56"><rect width="40" height="40" rx="4" fill="#fff" stroke="#cfd5de"/>${inner}</svg>`;
}
