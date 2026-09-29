import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/cinzel/latin-600.css';
import './styles.css';
import { initCanvas, canvas, fabric, fitToScreen, zoomTo, zoomBy, selected, scenePoint, objectAt, designObjects, enliven } from './canvas.js';
import { state, SIZE_PRESETS, newDoc, on, emit, uid, currentPage } from './state.js';
import { watchCanvas, undo, redo, canUndo, canRedo, record } from './history.js';
import { initFrames, inCrop, exitCrop, enterCrop, isPhoto } from './frames.js';
import { initGuides, snapping, setSnapping } from './guides.js';
import { initFonts, addFontFile, isFontName, ensureFont } from './fonts.js';
import { initBrand, renderBrandPanel, brandFont, currentKit, allLogos } from './brand.js';
import { initTemplates, renderTemplatesPanel } from './templates.js';
import { initProps, render as renderProps } from './props.js';
import { initSelection, setSelecting, selectPanel, handleSelectionKey } from './selection.js';
import { initMaskPaint } from './maskpaint.js';
import { textStylesBlock } from './textstyles.js';
import { iconsBlock } from './icons.js';
import { addQr } from './qrcode.js';
import { otherSizesDialog, carouselDialog, splitSlides } from './layouts.js';
import { initRulers, toggleRulers } from './rulers.js';
import { initMacLabels } from './mac.js';
import { initLayers, render as renderLayers } from './layers.js';
import {
  addText,
  addTextWith,
  addShape,
  addFrame,
  addPhoto,
  dropPhoto,
  removeSelected,
  duplicateSelected,
  groupSelected,
  ungroupSelected,
  arrange,
  toggleLock,
  selectObjects,
  applyCurve,
} from './objects.js';
import { openDocument, showPage, addPage, duplicatePage, deletePage, movePage, resizeDesign, syncCurrentPage } from './pages.js';
import { buildZip, readZip } from './project.js';
import { pageImage, buildPdf, renderPage, encodeCanvas, drawWatermark, MIME } from './exporter.js';
import { PROFILES, buildCmykPdf, proof } from './color.js';
import { isRawName, decodeRaw, RAW_EXTENSIONS } from './raw.js';
import { isDesktop, pickFiles, pickSavePath, pickFolder, writeFile, joinPath, baseName, dataRead, dataWrite, dataReadJson, dataWriteJson, readPath } from './platform.js';
import { registerBytes, registerBlob, typeFor, isImageName, collectAssetUrls } from './assets.js';
import { h, modal, toast, iconButton, ICONS, appLogo, prompt } from './ui.js';
import { batchDialog } from './batch.js';
import { drawPanel, setDrawing } from './draw.js';
import { showHome, rememberRecent, forgetRecent, SHORTCUTS } from './home.js';

const $ = (s) => document.querySelector(s);

// ---------- Layout ----------

const TABS = [
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'photos', label: 'Photos', icon: 'photos' },
  { id: 'shapes', label: 'Shapes', icon: 'shapes' },
  { id: 'frames', label: 'Frames', icon: 'frames' },
  { id: 'select', label: 'Select', icon: 'lasso' },
  { id: 'draw', label: 'Draw', icon: 'brush' },
  { id: 'brand', label: 'Brand', icon: 'brand' },
  { id: 'templates', label: 'Templates', icon: 'templates' },
  { id: 'layers', label: 'Layers', icon: 'layers' },
];
let tab = 'text';
const uploads = []; // asset urls shown in the Photos panel

function buildLayout() {
  document.body.innerHTML = '';
  document.body.append(
    h(
      'div',
      { class: 'app' },
      h(
        'header',
        { class: 'topbar' },
        h('button', { class: 'brand-mark', title: 'Start screen', onclick: () => home() }, h('span', { html: appLogo(28) }), h('span', { class: 'wordmark' }, 'Photo ', h('span', {}, 'Editor'))),
        menuButton('New', newDesign),
        menuButton('Open', openDesign),
        menuButton('Save', () => save(false)),
        menuButton('Save as', () => save(true)),
        h('span', { class: 'sep' }),
        h('span', { id: 'undo-slot' }),
        h('div', { class: 'doc-title', id: 'doc-title' }),
        h('span', { class: 'grow' }),
        h('span', { id: 'zoom-slot', class: 'zoom' }),
        h('button', { class: 'icon-btn', id: 'rulers-btn', title: 'Rulers (Ctrl+R)', onclick: () => toggleRulers(), html: ICONS.ruler }),
        h('button', { class: 'icon-btn', title: 'Keyboard shortcuts (?)', onclick: shortcutsDialog, html: '<span style="font-weight:600;font-size:15px">?</span>' }),
        h('button', { class: 'btn gold', onclick: exportDialog }, 'Export'),
      ),
      h(
        'nav',
        { class: 'rail' },
        TABS.map((t) =>
          h('button', { class: 'rail-btn', 'data-tab': t.id, onclick: () => showTab(t.id) }, h('span', { html: ICONS[t.icon] }), h('span', { class: 'rail-label' }, t.label)),
        ),
      ),
      h('aside', { class: 'panel', id: 'panel' }),
      h(
        'main',
        { class: 'workspace', id: 'workspace' },
        h('canvas', { id: 'c' }),
        h('div', { class: 'crop-bar', id: 'crop-bar' }, h('span', {}, 'Crop'), h('button', { class: 'btn primary small', onclick: exitCrop }, 'Done')),
      ),
      h('aside', { class: 'props', id: 'props' }),
      h('footer', { class: 'pages', id: 'pages' }),
    ),
  );
}

const menuButton = (label, fn) => h('button', { class: 'menu-btn', onclick: fn }, label);


function showTab(id) {
  tab = id;
  setDrawing(id === 'draw');
  setSelecting(id === 'select');
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
  renderPanel();
}

function renderPanel() {
  const el = $('#panel');
  el.innerHTML = '';
  el.append(h('div', { class: 'panel-title' }, TABS.find((t) => t.id === tab).label));
  const body = h('div', { class: 'panel-body' });
  el.append(body);
  if (tab === 'text') textPanel(body);
  if (tab === 'photos') photosPanel(body);
  if (tab === 'shapes') shapesPanel(body);
  if (tab === 'frames') framesPanel(body);
  if (tab === 'draw') drawPanel(body);
  if (tab === 'select') selectPanel(body);
  if (tab === 'brand') renderBrandPanel(body, brandActions);
  if (tab === 'templates') renderTemplatesPanel(body);
  if (tab === 'layers') {
    initLayersHost(body);
  }
}

let layersHost = null;
function initLayersHost(body) {
  if (!layersHost) {
    layersHost = h('div');
    initLayers(layersHost);
  }
  body.append(layersHost);
  renderLayers();
}

// ---------- Left panels ----------

function textPanel(el) {
  const heading = brandFont('heading');
  const body = brandFont('body');
  el.append(
    h(
      'div',
      { class: 'panel-block' },
      h('button', { class: 'add-text heading', style: { fontFamily: heading ? `"${heading}"` : null }, onclick: () => addText('heading') }, 'Add a heading'),
      h('button', { class: 'add-text body', style: { fontFamily: body ? `"${body}"` : null }, onclick: () => addText('body') }, 'Add body text'),
    ),
    textStylesBlock(),
    h(
      'div',
      { class: 'panel-block' },
      h('div', { class: 'section-title' }, 'Fonts'),
      h('p', { class: 'muted small' }, 'Installed fonts are listed in the font menu. Add a TTF, OTF or WOFF file for any other font.'),
      h('button', { class: 'btn wide', onclick: addFonts }, 'Add font file'),
    ),
  );
}

async function addFonts() {
  const files = await pickFiles({ extensions: ['ttf', 'otf', 'woff', 'woff2'], multiple: true, label: 'Fonts' });
  for (const f of files || []) {
    try {
      const fam = await addFontFile(f.name, f.bytes);
      toast(`${fam} added.`);
    } catch {
      toast(`${f.name} could not be read as a font.`, { error: true });
    }
  }
  renderProps();
}

function photosPanel(el) {
  el.append(h('div', { class: 'panel-block' }, h('button', { class: 'btn primary wide', onclick: uploadPhotos }, 'Add photos')));
  if (!uploads.length) {
    el.append(h('p', { class: 'muted pad' }, 'Photos you add show here. Click one to put it on the page or drag it onto a frame.'));
    return;
  }
  el.append(
    h(
      'div',
      { class: 'photo-grid' },
      uploads.map((url) =>
        h('img', {
          src: url,
          class: 'photo-tile',
          draggable: 'true',
          ondragstart: (e) => e.dataTransfer.setData('text/x-asset', url),
          onclick: () => placeOrFill(url),
        }),
      ),
    ),
  );
}

async function uploadPhotos() {
  const files = await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', ...RAW_EXTENSIONS], multiple: true, label: 'Images and RAW files' });
  if (!files?.length) return;
  for (const f of files) {
    try {
      uploads.unshift(await pictureUrl(f.name, f.bytes));
    } catch {
      toast(`${f.name} could not be read.`, { error: true });
    }
  }
  if (files.length === 1) await placeOrFill(uploads[0]);
  renderPanel();
}

/** Clicking a photo fills the selected empty frame, otherwise adds it to the page. */
async function placeOrFill(url) {
  const [s] = selected();
  if (s && s.isFrame && !isPhoto(s)) await dropPhoto(url, null, s);
  else await addPhoto(url);
}

function shapesPanel(el) {
  const items = [
    ['rect', 'Rectangle'],
    ['rounded', 'Rounded'],
    ['ellipse', 'Circle'],
    ['triangle', 'Triangle'],
    ['line', 'Line'],
  ];
  el.append(
    h(
      'div',
      { class: 'tile-grid' },
      items.map(([k, label]) =>
        h('button', { class: 'tile', onclick: () => addShape(k) }, h('span', { html: ICONS[k === 'ellipse' ? 'circle' : k] }), h('span', {}, label)),
      ),
      h('button', { class: 'tile', onclick: newQr }, h('span', { html: ICONS.qr }), h('span', {}, 'QR code')),
    ),
    iconsBlock(),
  );
}

async function newQr() {
  const text = await prompt('QR code', 'Link or text', 'https://');
  if (!text || text === 'https://') return;
  try {
    addQr(text);
  } catch {
    toast('That text is too long for a QR code.', { error: true });
  }
}

function framesPanel(el) {
  const items = [
    ['rect', 'Rectangle', 'rect'],
    ['rounded', 'Rounded', 'rounded'],
    ['arch', 'Arch', 'arch'],
    ['ellipse', 'Circle', 'circle'],
  ];
  el.append(
    h('p', { class: 'muted pad' }, 'A frame holds a photo cropped to its shape. Drop a photo on it to fill it.'),
    h(
      'div',
      { class: 'tile-grid' },
      items.map(([k, label, icon]) => h('button', { class: 'tile', onclick: () => addFrame(k) }, h('span', { html: ICONS[icon] }), h('span', {}, label))),
    ),
  );
}

const brandActions = {
  applyColor(c) {
    const list = selected();
    if (!list.length) {
      currentPage().background = c;
      canvas.requestRenderAll();
      record();
      renderProps();
      return;
    }
    list.forEach((o) => o.set(o.type === 'line' ? { stroke: c } : { fill: c }));
    canvas.requestRenderAll();
    record();
    renderProps();
  },
  addHeading: () => addText('heading'),
  addBody: () => addText('body'),
  addLogo: async (url) => {
    const logo = await addPhoto(url);
    logo.name = 'Logo';
    record();
  },
  selectionColor() {
    const [o] = selected();
    return typeof o?.fill === 'string' && o.fill.startsWith('#') ? o.fill : null;
  },
};

// ---------- Top bar pieces ----------

function renderUndo() {
  const slot = $('#undo-slot');
  slot.innerHTML = '';
  slot.append(iconButton('undo', 'Undo (Ctrl+Z)', undo, { disabled: !canUndo() }), iconButton('redo', 'Redo (Ctrl+Y)', redo, { disabled: !canRedo() }));
}

function renderZoom(z = canvas.getZoom()) {
  const slot = $('#zoom-slot');
  slot.innerHTML = '';
  slot.append(
    iconButton('magnet', snapping ? 'Snapping on' : 'Snapping off', () => {
      setSnapping(!snapping);
      renderZoom();
    }, { on: snapping }),
    iconButton('minus', 'Zoom out', () => zoomBy(1 / 1.2)),
    h('button', { class: 'zoom-value', title: 'Actual size', onclick: () => zoomTo(1) }, `${Math.round(z * 100)}%`),
    iconButton('plus', 'Zoom in', () => zoomBy(1.2)),
    iconButton('fit', 'Fit to screen (Ctrl+0)', fitToScreen),
  );
}

function renderTitle() {
  if (!state.doc) return;
  const t = $('#doc-title');
  t.innerHTML = '';
  t.append(h('span', {}, state.doc.name));
  if (state.dirty) t.append(h('span', { class: 'dirty', title: 'Unsaved changes' }, '●'));
  const title = `${state.doc.name}${state.dirty ? ' *' : ''} - Photo Editor`;
  document.title = title;
  if (isDesktop) import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title)).catch(() => {});
}

// ---------- Pages strip ----------

function renderPages() {
  const el = $('#pages');
  if (!state.doc) return;
  el.innerHTML = '';
  const strip = h('div', { class: 'page-strip' });
  state.doc.pages.forEach((p, i) => {
    const ratio = state.doc.width / state.doc.height;
    strip.append(
      h(
        'div',
        {
          class: 'page-thumb' + (i === state.pageIndex ? ' on' : ''),
          'data-page': p.id,
          draggable: 'true',
          onclick: () => i !== state.pageIndex && showPage(i),
          ondragstart: (e) => e.dataTransfer.setData('text/x-page', String(i)),
          ondragover: (e) => e.preventDefault(),
          ondrop: (e) => {
            const from = e.dataTransfer.getData('text/x-page');
            if (from !== '') movePage(+from, i);
          },
        },
        h('div', { class: 'thumb-box', style: { aspectRatio: String(ratio) } }, p.thumb ? h('img', { src: p.thumb }) : null),
        h('span', { class: 'page-num' }, String(i + 1)),
      ),
    );
  });
  strip.append(h('button', { class: 'page-add', title: 'Add page', onclick: () => addPage(), html: ICONS.plus }));
  el.append(
    strip,
    h(
      'div',
      { class: 'page-actions' },
      iconButton('left', 'Move page left', () => movePage(state.pageIndex, state.pageIndex - 1), { disabled: state.pageIndex === 0 }),
      iconButton('right', 'Move page right', () => movePage(state.pageIndex, state.pageIndex + 1), { disabled: state.pageIndex === state.doc.pages.length - 1 }),
      iconButton('copy', 'Duplicate page', () => duplicatePage()),
      iconButton('trash', 'Delete page', confirmDeletePage, { disabled: state.doc.pages.length < 2 }),
    ),
  );
}

async function confirmDeletePage() {
  if (currentPage().objects.length || designObjects().length) {
    const ok = await modal('Delete page', h('p', {}, `Delete page ${state.pageIndex + 1}?`), [
      { label: 'Cancel', value: false },
      { label: 'Delete', value: true, primary: true },
    ]);
    if (!ok) return;
  }
  deletePage();
}

// ---------- Size dialogs ----------

function sizeChooser(initial) {
  let chosen = initial;
  const w = h('input', { class: 'field num', type: 'number', min: 16, max: 12000, value: initial.width });
  const hh = h('input', { class: 'field num', type: 'number', min: 16, max: 12000, value: initial.height });
  const cards = SIZE_PRESETS.map((p) => {
    const r = p.width / p.height;
    const card = h(
      'button',
      {
        class: 'preset' + (p.width === initial.width && p.height === initial.height ? ' on' : ''),
        onclick: () => {
          chosen = { ...p };
          w.value = p.width;
          hh.value = p.height;
          cards.forEach((c) => c.classList.remove('on'));
          card.classList.add('on');
        },
      },
      h('span', { class: 'preset-shape', style: { width: `${r >= 1 ? 44 : 44 * r}px`, height: `${r >= 1 ? 44 / r : 44}px` } }),
      h('span', { class: 'preset-name' }, p.name),
      h('span', { class: 'muted small' }, `${p.width} × ${p.height}`),
    );
    return card;
  });
  const onCustom = () => {
    chosen = { width: +w.value, height: +hh.value, dpi: 72 };
    cards.forEach((c) => c.classList.remove('on'));
  };
  w.addEventListener('input', onCustom);
  hh.addEventListener('input', onCustom);
  const el = h(
    'div',
    {},
    h('div', { class: 'preset-grid' }, cards),
    h('div', { class: 'row custom-size' }, h('span', { class: 'label' }, 'Custom'), w, h('span', {}, '×'), hh, h('span', { class: 'muted' }, 'px')),
  );
  return { el, get: () => ({ ...chosen, width: Math.round(+w.value), height: Math.round(+hh.value), dpi: chosen.dpi || 72 }) };
}

async function newDesign() {
  if (!(await confirmDiscard())) return;
  const chooser = sizeChooser(SIZE_PRESETS[0]);
  const name = h('input', { class: 'field', value: 'Untitled design' });
  const res = await modal(
    'New design',
    h('div', {}, h('label', { class: 'stack' }, h('span', { class: 'label' }, 'Name'), name), chooser.el),
    [
      { label: 'Cancel', value: null },
      { label: 'Create', value: () => chooser.get(), primary: true },
    ],
    { wide: true },
  );
  if (!res || res.width < 16 || res.height < 16) return;
  await openDocument(newDoc({ name: name.value.trim() || 'Untitled design', width: res.width, height: res.height, dpi: res.dpi }));
}

async function resizeDialog() {
  const chooser = sizeChooser({ width: state.doc.width, height: state.doc.height, dpi: state.doc.dpi });
  const scale = h('input', { type: 'checkbox', checked: true });
  const res = await modal(
    'Resize design',
    h('div', {}, chooser.el, h('label', { class: 'check' }, scale, 'Scale the content to fit the new size')),
    [
      { label: 'Cancel', value: null },
      { label: 'Resize', value: () => chooser.get(), primary: true },
    ],
    { wide: true },
  );
  if (!res || res.width < 16 || res.height < 16) return;
  await resizeDesign(res.width, res.height, res.dpi, scale.checked);
}

// ---------- Files ----------

const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'design';

async function confirmDiscard() {
  if (!state.doc || !state.dirty) return true;
  const res = await modal('Unsaved changes', h('p', {}, `Save changes to ${state.doc.name}?`), [
    { label: 'Cancel', value: null },
    { label: "Don't save", value: 'discard' },
    { label: 'Save', value: 'save', primary: true },
  ]);
  if (res === 'save') return save(false);
  return res === 'discard';
}

async function save(as) {
  if (!state.doc) return false;
  if (inCrop()) exitCrop();
  syncCurrentPage();
  let path = state.path;
  if (!path || as || !isDesktop) {
    path = await pickSavePath({ defaultName: safeName(state.doc.name) + '.zip', extensions: ['zip'], label: 'Design' });
    if (!path) return false;
  }
  try {
    await writeFile(path, await buildZip(state.doc), 'application/zip');
  } catch (e) {
    toast(`${baseName(path)} could not be saved: ${e}`, { error: true });
    return false;
  }
  if (isDesktop) state.path = path;
  state.dirty = false;
  renderTitle();
  rememberRecent(path, state.doc.name, state.doc.pages[0]?.thumb);
  await dataWriteJson('autosave/meta.json', { ...(await dataReadJson('autosave/meta.json', {})), dirty: false });
  toast(`Saved ${baseName(path)}.`);
  return true;
}

async function openDesign() {
  if (!(await confirmDiscard())) return;
  const files = await pickFiles({ extensions: ['zip', 'png', 'jpg', 'jpeg', 'webp', ...RAW_EXTENSIONS], label: 'Designs, images and RAW files' });
  if (!files?.length) return;
  await openBytes(files[0]);
}

/** Opens a picture as a new design the size of the picture, with the picture filling the page. */
async function openImage(f) {
  const url = await pictureUrl(f.name, f.bytes);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = url;
  });
  const doc = newDoc({ name: f.name.replace(/\.[^.]+$/, ''), width: img.naturalWidth, height: img.naturalHeight });
  doc.pages[0].background = '#ffffff';
  await openDocument(doc);
  const photo = await addPhoto(url);
  photo.scale(1);
  photo.setPositionByOrigin(new fabric.Point(0, 0), 'left', 'top');
  photo.setCoords();
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: photo });
  if (!uploads.includes(url)) uploads.unshift(url);
}

/** Registers a picture file. RAW files are decoded first. */
async function pictureUrl(name, bytes) {
  if (!isRawName(name)) return registerBytes(bytes, typeFor(name));
  const note = toast(`Reading ${name}`, { sticky: true });
  try {
    return registerBlob(await decodeRaw(bytes));
  } finally {
    note.done();
  }
}

async function openBytes(f) {
  if (isImageName(f.name) || isRawName(f.name)) {
    try {
      await openImage(f);
    } catch {
      toast(`${f.name} could not be opened.`, { error: true });
    }
    return;
  }
  try {
    const doc = await readZip(f.bytes);
    rememberUploads(doc);
    await openDocument(doc, f.path);
    if (f.path) setTimeout(() => rememberRecent(f.path, doc.name, doc.pages[0]?.thumb), 1500);
  } catch {
    toast(`${f.name} could not be opened.`, { error: true });
  }
}

function rememberUploads(doc) {
  for (const url of collectAssetUrls(doc.pages)) if (!uploads.includes(url)) uploads.push(url);
}

// ---------- Export ----------

const EXPORT_DEFAULTS = {
  format: 'png',
  multiplier: 1,
  quality: 0.92,
  transparent: false,
  color: 'rgb',
  profile: 'coated',
  limit: false,
  maxMB: 1,
  split: true,
  watermark: { on: false, logoId: '', text: '', color: '#ffffff', corner: 'br', size: 18, opacity: 85 },
};

async function exportDialog() {
  if (!state.doc) return;
  if (inCrop()) exitCrop();
  syncCurrentPage();
  const n = state.doc.pages.length;
  const slides = state.doc.slides > 1 ? state.doc.slides : 0;
  const saved = await dataReadJson('export-settings.json', {});
  const opts = { ...EXPORT_DEFAULTS, ...saved, watermark: { ...EXPORT_DEFAULTS.watermark, ...(saved.watermark || {}) }, pages: n > 1 ? 'all' : 'current' };
  const logos = allLogos();
  const wm = opts.watermark;
  // A small render of this page for the watermark preview.
  const pm = Math.min(1, 300 / Math.max(state.doc.width, state.doc.height));
  const base = await renderPage(currentPage(), pm);
  const preview = h('canvas', { class: 'wm-preview' });
  const drawPreview = async () => {
    preview.width = base.width;
    preview.height = base.height;
    preview.getContext('2d').drawImage(base, 0, 0);
    if (wm.on) await drawWatermark(preview, { ...wm, logoUrl: logos.find((l) => l.id === wm.logoId)?.url });
  };
  const body = h('div', { class: 'export' });
  const draw = () => {
    body.innerHTML = '';
    const seg = (obj, key, items) =>
      h(
        'div',
        { class: 'seg' },
        items.map(([v, label]) =>
          h('button', {
            class: obj[key] === v ? 'on' : '',
            onclick: () => {
              obj[key] = v;
              draw();
            },
          }, label),
        ),
      );
    const px = (m) => `${Math.round(state.doc.width * m)} × ${Math.round(state.doc.height * m)}`;
    const image = opts.format !== 'pdf';
    const lossy = opts.format === 'jpg' || opts.format === 'webp';
    const each = slides && opts.split && image ? slides : 1;
    const count = (opts.pages === 'all' ? n : 1) * each;
    body.append(...[
      h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Format'), seg(opts, 'format', [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['pdf', 'PDF']])),
      n > 1 ? h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Pages'), seg(opts, 'pages', [['current', `Page ${state.pageIndex + 1}`], ['all', `All ${n} pages`]])) : null,
      image
        ? h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Size'), seg(opts, 'multiplier', [[1, `1× (${px(1)})`], [2, `2× (${px(2)})`]]))
        : h('p', { class: 'muted small' }, `PDF pages are ${Math.round((state.doc.width / state.doc.dpi) * 25.4)} × ${Math.round((state.doc.height / state.doc.dpi) * 25.4)} mm at ${state.doc.dpi} dpi.`),
      opts.format === 'pdf' ? h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Colour'), seg(opts, 'color', [['rgb', 'RGB'], ['cmyk', 'CMYK for print']])) : null,
      opts.format === 'pdf' && opts.color === 'cmyk'
        ? h(
            'div',
            { class: 'field-row' },
            h('span', { class: 'label' }, 'Paper'),
            h(
              'select',
              { class: 'field', onchange: (e) => (opts.profile = e.target.value) },
              PROFILES.map((p) => h('option', { value: p.id, selected: opts.profile === p.id }, p.name)),
            ),
          )
        : null,
      opts.format === 'pdf' && opts.color === 'cmyk'
        ? h('p', { class: 'muted small' }, 'Ask the print shop which profile they use. Most shops in the Philippines take coated FOGRA39 or a plain RGB PDF.')
        : null,
      opts.format === 'pdf' ? h('button', { class: 'link', onclick: () => printPreview(opts.profile) }, 'Preview print colours') : null,
      lossy
        ? h(
            'label',
            { class: 'field-row' },
            h('span', { class: 'label' }, 'Quality'),
            h('input', { type: 'range', min: 50, max: 100, value: Math.round(opts.quality * 100), oninput: (e) => (opts.quality = e.target.value / 100) }),
          )
        : null,
      lossy
        ? h(
            'div',
            { class: 'row' },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.limit, onchange: (e) => ((opts.limit = e.target.checked), draw()) }), 'Keep each file under'),
            h('input', { class: 'field num', type: 'number', min: 0.05, step: 0.1, value: opts.maxMB, disabled: !opts.limit, style: { width: '76px' }, oninput: (e) => (opts.maxMB = Math.max(0.05, +e.target.value || 1)) }),
            h('span', { class: 'muted' }, 'MB'),
          )
        : null,
      opts.format === 'png' || opts.format === 'webp'
        ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.transparent, onchange: (e) => (opts.transparent = e.target.checked) }), 'Transparent background')
        : null,
      slides && image
        ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.split, onchange: (e) => ((opts.split = e.target.checked), draw()) }), `Split into ${slides} slides`)
        : null,
      image ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: wm.on, onchange: (e) => ((wm.on = e.target.checked), draw()) }), 'Watermark') : null,
      image && wm.on
        ? h(
            'div',
            { class: 'wm' },
            h(
              'div',
              { class: 'stack gap grow' },
              h(
                'label',
                { class: 'field-row' },
                h('span', { class: 'label' }, 'Logo'),
                h(
                  'select',
                  { class: 'field', onchange: (e) => ((wm.logoId = e.target.value), drawPreview()) },
                  h('option', { value: '' }, logos.length ? 'No logo' : 'No logos in your brand kits'),
                  logos.map((l) => h('option', { value: l.id, selected: wm.logoId === l.id }, l.name)),
                ),
              ),
              h(
                'label',
                { class: 'field-row' },
                h('span', { class: 'label' }, 'Text'),
                h('input', { class: 'field', value: wm.text, placeholder: 'Example: @cygnusaesthetics', oninput: (e) => ((wm.text = e.target.value), drawPreview()) }),
              ),
              h(
                'label',
                { class: 'field-row' },
                h('span', { class: 'label' }, 'Text colour'),
                h('input', { type: 'color', class: 'color', value: wm.color, oninput: (e) => ((wm.color = e.target.value), drawPreview()) }),
              ),
              h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Corner'), seg(wm, 'corner', [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']])),
              h(
                'label',
                { class: 'field-row' },
                h('span', { class: 'label' }, 'Size'),
                h('input', { type: 'range', min: 5, max: 40, value: wm.size, oninput: (e) => ((wm.size = +e.target.value), drawPreview()) }),
              ),
              h(
                'label',
                { class: 'field-row' },
                h('span', { class: 'label' }, 'Opacity'),
                h('input', { type: 'range', min: 20, max: 100, value: wm.opacity, oninput: (e) => ((wm.opacity = +e.target.value), drawPreview()) }),
              ),
            ),
            preview,
          )
        : null,
      image && count > 1 ? h('p', { class: 'muted small' }, `${count} files save as ${safeName(state.doc.name)}-01.${opts.format} to -${String(count).padStart(2, '0')}.`) : null,
    ].filter(Boolean));
    drawPreview();
  };
  draw();
  const go = await modal('Export', body, [
    { label: 'Batch export', value: 'batch' },
    { label: 'Cancel', value: false },
    { label: 'Export', value: true, primary: true },
  ], { wide: true });
  const { pages, ...keep } = opts;
  void pages;
  dataWriteJson('export-settings.json', keep);
  if (go === 'batch') return batchDialog();
  if (!go) return;
  await runExport({ ...opts, slides: opts.split ? slides : 0, watermark: wm.on ? { ...wm, logoUrl: logos.find((l) => l.id === wm.logoId)?.url } : null });
}

async function printPreview(profileId = 'coated') {
  syncCurrentPage();
  const S = { profile: profileId, gamut: false };
  const m = Math.min(1, 520 / Math.max(state.doc.width, state.doc.height));
  const screen = await renderPage(currentPage(), m);
  const print = document.createElement('canvas');
  print.width = screen.width;
  print.height = screen.height;
  const update = async () => {
    const data = screen.getContext('2d').getImageData(0, 0, screen.width, screen.height);
    const p = PROFILES.find((x) => x.id === S.profile);
    print.getContext('2d').putImageData(await proof(data, p, { gamut: S.gamut }), 0, 0);
  };
  await update();
  const body = h(
    'div',
    { class: 'stack gap' },
    h('p', { class: 'muted small' }, 'Bright blues, greens and oranges on screen are outside what ink can print, so they come out duller on paper. The right side shows the page as it will print.'),
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'label' }, 'Paper'),
      h(
        'select',
        { class: 'field', onchange: async (e) => ((S.profile = e.target.value), await update()) },
        PROFILES.map((p) => h('option', { value: p.id, selected: S.profile === p.id }, p.name)),
      ),
      h('label', { class: 'check', style: { whiteSpace: 'nowrap' } }, h('input', { type: 'checkbox', onchange: async (e) => ((S.gamut = e.target.checked), await update()) }), 'Mark colours ink cannot print'),
    ),
    h('div', { class: 'proof-grid' }, h('div', {}, h('div', { class: 'label' }, 'Screen'), screen), h('div', {}, h('div', { class: 'label' }, 'Print'), print)),
  );
  await modal('Print colours', body, [{ label: 'Close', value: true, primary: true }], { wide: true });
}

async function runExport(opts) {
  const pages = opts.pages === 'all' ? state.doc.pages : [currentPage()];
  const base = safeName(state.doc.name);
  const note = toast('Exporting', { sticky: true });
  try {
    if (opts.format === 'pdf') {
      const path = await pickSavePath({ defaultName: base + '.pdf', extensions: ['pdf'], label: 'PDF' });
      if (!path) return note.done();
      const bytes =
        opts.color === 'cmyk'
          ? await buildCmykPdf(await Promise.all(pages.map((p) => renderPage(p, 1))), {
              widthPt: (state.doc.width / state.doc.dpi) * 72,
              heightPt: (state.doc.height / state.doc.dpi) * 72,
              profileId: opts.profile,
              title: state.doc.name,
            })
          : await buildPdf(pages, state.doc.dpi);
      await writeFile(path, bytes, 'application/pdf');
      note.done();
      toast(`Exported ${baseName(path)}.`);
      return;
    }
    const mime = MIME[opts.format];
    const each = opts.slides || 1;
    const total = pages.length * each;
    const encode = { format: opts.format, quality: opts.quality, maxKB: opts.limit && opts.format !== 'png' ? opts.maxMB * 1024 : 0 };
    // One picture per page, or per slide of a panorama carousel.
    const pictures = async function* () {
      for (const page of pages) {
        const el = await renderPage(page, opts.multiplier, { transparent: opts.format !== 'jpg' && opts.transparent });
        for (const piece of each > 1 ? splitSlides(el, each) : [el]) {
          if (opts.watermark) await drawWatermark(piece, opts.watermark);
          yield piece;
        }
      }
    };
    if (total === 1) {
      const path = await pickSavePath({ defaultName: `${base}.${opts.format}`, extensions: [opts.format], label: opts.format.toUpperCase() });
      if (!path) return note.done();
      for await (const el of pictures()) await writeFile(path, await encodeCanvas(el, encode), mime);
      note.done();
      toast(`Exported ${baseName(path)}.`);
      return;
    }
    const dir = await pickFolder();
    if (dir == null) return note.done();
    let i = 0;
    for await (const el of pictures()) {
      i++;
      note.text(`Exporting ${i} of ${total}`);
      note.progress(i / total);
      await writeFile(joinPath(dir, `${base}-${String(i).padStart(2, '0')}.${opts.format}`), await encodeCanvas(el, encode), mime);
    }
    note.done();
    toast(`Exported ${total} files${dir ? ' to ' + baseName(dir) : ''}.`);
  } catch (e) {
    note.done();
    toast(`Export failed: ${e.message || e}`, { error: true });
  }
}

// ---------- Drop, paste and keys ----------

function setupDrop() {
  const ws = $('#workspace');
  ws.addEventListener('dragover', (e) => {
    e.preventDefault();
    ws.classList.add('drag');
  });
  ws.addEventListener('dragleave', () => ws.classList.remove('drag'));
  ws.addEventListener('drop', async (e) => {
    e.preventDefault();
    ws.classList.remove('drag');
    if (!state.doc) return;
    const point = scenePoint(e);
    const target = objectAt(point);
    const asset = e.dataTransfer.getData('text/x-asset');
    if (asset) return dropPhoto(asset, point, target);
    for (const file of [...e.dataTransfer.files]) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isImageName(file.name) || isRawName(file.name)) {
        let url;
        try {
          url = await pictureUrl(file.name, bytes);
        } catch {
          toast(`${file.name} could not be read.`, { error: true });
          continue;
        }
        uploads.unshift(url);
        await dropPhoto(url, point, target);
      } else if (isFontName(file.name)) {
        try {
          toast(`${await addFontFile(file.name, bytes)} added.`);
        } catch {
          toast(`${file.name} could not be read as a font.`, { error: true });
        }
      } else if (file.name.toLowerCase().endsWith('.zip')) {
        if (await confirmDiscard()) await openBytes({ name: file.name, path: null, bytes });
      }
    }
    if (tab === 'photos') renderPanel();
  });
}

const typing = () => {
  const a = document.activeElement;
  return (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) || canvas.getActiveObject()?.isEditing;
};

const CLIP_MARK = 'photo-editor:objects';
let clipboard = null;

function setupClipboard() {
  document.addEventListener('copy', (e) => {
    if (typing() || !selected().length) return;
    clipboard = selected().map((o) => o.toObject());
    e.clipboardData.setData('text/plain', CLIP_MARK);
    e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    if (typing() || !selected().length) return;
    clipboard = selected().map((o) => o.toObject());
    e.clipboardData.setData('text/plain', CLIP_MARK);
    e.preventDefault();
    removeSelected();
  });
  document.addEventListener('paste', async (e) => {
    if (typing() || !state.doc) return;
    const items = [...(e.clipboardData?.items || [])];
    const image = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    const text = e.clipboardData?.getData('text/plain');
    e.preventDefault();
    if (image) {
      const url = registerBlob(image.getAsFile());
      uploads.unshift(url);
      const [s] = selected();
      await dropPhoto(url, null, s && s.isFrame && !isPhoto(s) ? s : null);
      return;
    }
    if (text === CLIP_MARK && clipboard) {
      const list = await enliven(clipboard);
      canvas.discardActiveObject();
      list.forEach((o) => {
        o.uid = uid();
        o.left += 24;
        o.top += 24;
      });
      clipboard = list.map((o) => o.toObject());
      canvas.add(...list);
      selectObjects(list);
      return;
    }
    if (text && text.trim()) addTextWith(text.trim());
  });
}

function nudge(dx, dy) {
  const list = selected().filter((o) => !o.locked);
  if (!list.length) return;
  const a = canvas.getActiveObject();
  a.left += dx;
  a.top += dy;
  a.setCoords();
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: a });
}

function setupKeys() {
  window.addEventListener('keydown', async (e) => {
    if (document.querySelector('.modal-back')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') {
      e.preventDefault();
      return save(e.shiftKey);
    }
    if (mod && k === 'o') return e.preventDefault(), openDesign();
    if (mod && k === 'n') return e.preventDefault(), newDesign();
    if (mod && k === 'e') return e.preventDefault(), exportDialog();
    if (typing()) return;
    if (!state.doc) return;
    if (inCrop()) {
      if (k === 'enter' || k === 'escape') return e.preventDefault(), exitCrop();
      return;
    }
    if (handleSelectionKey(e)) return;
    if (mod && k === 'z' && !e.shiftKey) return e.preventDefault(), undo();
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return e.preventDefault(), redo();
    if (mod && (k === 'd' || k === 'j')) return e.preventDefault(), duplicateSelected();
    if (mod && k === 'g') return e.preventDefault(), e.shiftKey ? ungroupSelected() : groupSelected();
    if (mod && k === 'a') {
      e.preventDefault();
      return selectObjects(designObjects().filter((o) => o.visible && !o.locked));
    }
    if (mod && k === 'l') {
      e.preventDefault();
      return selected().forEach(toggleLock);
    }
    if (mod && (e.key === ']' || e.key === '}')) return e.preventDefault(), arrange(e.shiftKey ? 'front' : 'forward');
    if (mod && (e.key === '[' || e.key === '{')) return e.preventDefault(), arrange(e.shiftKey ? 'back' : 'backward');
    if (mod && k === 'r' && !e.shiftKey) return e.preventDefault(), toggleRulers();
    if (mod && k === '0') return e.preventDefault(), fitToScreen();
    if (mod && k === '1') return e.preventDefault(), zoomTo(1);
    if (mod && (k === '=' || k === '+')) return e.preventDefault(), zoomBy(1.2);
    if (mod && k === '-') return e.preventDefault(), zoomBy(1 / 1.2);
    if (k === 'delete' || k === 'backspace') return e.preventDefault(), removeSelected();
    if (k === 'escape') {
      if (tab === 'draw' || tab === 'select') return showTab('layers');
      return canvas.discardActiveObject(), canvas.requestRenderAll();
    }
    if (k === 'enter') {
      const [o] = selected();
      if (o?.type === 'textbox') {
        e.preventDefault();
        canvas.setActiveObject(o);
        o.enterEditing();
        o.selectAll();
      } else if (isPhoto(o)) enterCrop(o);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    if (k === 'arrowleft') return e.preventDefault(), nudge(-step, 0);
    if (k === 'arrowright') return e.preventDefault(), nudge(step, 0);
    if (k === 'arrowup') return e.preventDefault(), nudge(0, -step);
    if (k === 'arrowdown') return e.preventDefault(), nudge(0, step);
    if (mod || e.altKey) return;
    if (k === 't') addText('body');
    if (k === 'r') addShape('rect');
    if (k === 'o') addShape('ellipse');
    if (k === 'l') addShape('line');
    if (k === 'f') addFrame('rect');
    if (k === 'b') showTab(tab === 'draw' ? 'text' : 'draw');
    if (k === 's') showTab(tab === 'select' ? 'layers' : 'select');
    if (e.key === '?') shortcutsDialog();
  });
}

// ---------- Autosave ----------

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 4000);
}

async function autosave() {
  if (!state.doc) return;
  try {
    syncCurrentPage();
    await dataWrite('autosave/current.zip', await buildZip(state.doc));
    await dataWriteJson('autosave/meta.json', { name: state.doc.name, savedAt: Date.now(), dirty: state.dirty, path: state.path });
  } catch (e) {
    console.warn('autosave failed', e);
  }
}

async function offerRestore() {
  const meta = await dataReadJson('autosave/meta.json', null);
  if (!meta?.dirty) return false;
  const bytes = await dataRead('autosave/current.zip');
  if (!bytes) return false;
  const when = new Date(meta.savedAt).toLocaleString();
  const res = await modal('Restore design', h('p', {}, `${meta.name} has changes from ${when} that were not saved.`), [
    { label: 'Start new', value: false },
    { label: 'Restore', value: true, primary: true },
  ]);
  if (!res) return false;
  try {
    const doc = await readZip(bytes);
    rememberUploads(doc);
    await openDocument(doc, meta.path || null);
    state.dirty = true;
    renderTitle();
    return true;
  } catch {
    toast('The autosaved design could not be opened.', { error: true });
    return false;
  }
}

function setupCloseGuard() {
  if (!isDesktop) {
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) e.preventDefault();
    });
    return;
  }
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    win.onCloseRequested(async (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      if (await confirmDiscard()) {
        await dataWriteJson('autosave/meta.json', { ...(await dataReadJson('autosave/meta.json', {})), dirty: false });
        await win.destroy();
      }
    });
  });
}

// ---------- Start screen and shortcuts ----------

function home(canClose = true) {
  showHome(
    {
      create: async (preset) => {
        if (!(await confirmDiscard())) return;
        await openDocument(newDoc({ name: 'Untitled design', width: preset.width, height: preset.height, dpi: preset.dpi }));
      },
      custom: newDesign,
      carousel: async () => {
        if (!(await confirmDiscard())) return;
        const c = await carouselDialog();
        if (!c) return;
        const doc = newDoc({ name: c.name, width: c.width, height: c.height, dpi: 72 });
        doc.slides = c.slides;
        await openDocument(doc);
      },
      open: openDesign,
      openRecent: async (r) => {
        if (!(await confirmDiscard())) return;
        try {
          await openBytes({ name: baseName(r.path), path: r.path, bytes: await readPath(r.path) });
        } catch {
          toast(`${baseName(r.path)} could not be found.`, { error: true });
          forgetRecent(r.path);
        }
      },
    },
    { canClose },
  );
}

function shortcutsDialog() {
  modal(
    'Keyboard shortcuts',
    h(
      'table',
      { class: 'keys' },
      SHORTCUTS.map(([k, what]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, what))),
    ),
    [{ label: 'Close', value: true, primary: true }],
  );
}

// ---------- Start ----------

async function start() {
  buildLayout();
  initCanvas($('#c'), $('#workspace'));
  watchCanvas();
  initFrames();
  initSelection();
  initMaskPaint();
  initRulers();
  initMacLabels();
  initGuides();
  initProps($('#props'), { resize: resizeDialog, otherSizes: otherSizesDialog });
  setupDrop();
  setupClipboard();
  setupKeys();
  setupCloseGuard();

  on('history', renderUndo);
  on('zoom', renderZoom);
  on('dirty', renderTitle);
  on('doc-name', renderTitle);
  on('doc', () => {
    renderTitle();
    renderPages();
    renderProps();
  });
  on('page', () => {
    renderPages();
    renderProps();
  });
  on('pages', renderPages);
  on('page-props', renderProps);
  on('thumb', (page) => {
    const img = document.querySelector(`.page-thumb[data-page="${page.id}"] .thumb-box`);
    if (img) {
      img.innerHTML = '';
      img.append(h('img', { src: page.thumb }));
    } else renderPages();
  });
  on('changed', scheduleAutosave);
  on('brand', () => {
    if (tab === 'brand' || tab === 'text') renderPanel();
    renderProps();
  });
  on('templates', () => tab === 'templates' && renderPanel());
  on('text-styles', () => tab === 'text' && renderPanel());
  on('fonts', () => renderProps());
  on('crop', (onOff) => {
    $('#crop-bar').classList.toggle('show', onOff);
    renderProps();
  });
  canvas.on('text:changed', (e) => {
    if (e.target?.curve) applyCurve(e.target);
    if (tab === 'layers') renderLayers();
  });

  await Promise.all([initFonts(), initBrand(), initTemplates()]);
  showTab('text');
  renderZoom();
  if (!(await offerRestore())) {
    await openDocument(newDoc({ ...SIZE_PRESETS[0], name: 'Untitled design' }));
    home();
  }
  renderUndo();
  window.__editor = { state, canvas, fabric, emit, currentKit, ensureFont };
}

start();
