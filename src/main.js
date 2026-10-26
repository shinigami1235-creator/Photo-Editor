import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/cinzel/latin-600.css';
import './styles.css';
import { initCanvas, canvas, fabric, fitToScreen, zoomTo, zoomBy, selected, scenePoint, objectAt, designObjects, enliven } from './canvas.js';
import { state, SIZE_PRESETS, newDoc, on, emit, uid, currentPage } from './state.js';
import { watchCanvas, undo, redo, canUndo, canRedo, record } from './history.js';
import { initFrames, inCrop, exitCrop, enterCrop, isPhoto, isEmptyFrame } from './frames.js';
import { initGuides, snapping, setSnapping, align, distribute } from './guides.js';
import { initFonts, addFontFile, isFontName, ensureFont } from './fonts.js';
import { initBrand, renderBrandPanel, brandFont, currentKit, allLogos } from './brand.js';
import { initTemplates, renderTemplatesPanel, saveTemplate } from './templates.js';
import { initProps, render as renderProps } from './props.js';
import {
  initSelection,
  selectPanel,
  handleSelectionKey,
  hasSelection,
  isSelecting,
  selectAll,
  deselect,
  invertSelection,
  selectFromLayer,
  selectSubject,
  growSelection,
  featherSelection,
  copyToLayer,
  hideArea,
  fillSelection,
  saveSelection,
  loadSaved,
  savedList,
  targetLayer,
  mergeLayers,
  layerBelow,
  setLayerMask,
  removeLayerMask,
  invertLayerMask,
  toggleLayerMask,
  textBehindSubject,
} from './selection.js';
import { initMaskPaint, startMaskPaint } from './maskpaint.js';
import { textStylesBlock, saveTextStyle } from './textstyles.js';
import { iconsBlock } from './icons.js';
import { addQr } from './qrcode.js';
import { otherSizesDialog, carouselDialog, splitSlides } from './layouts.js';
import { initRulers, toggleRulers, toggleSafeZone, viewSettings, clearGuides } from './rulers.js';
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
  flip,
  SHAPE_NAMES,
} from './objects.js';
import { openDocument, showPage, addPage, duplicatePage, deletePage, movePage, resizeDesign, syncCurrentPage } from './pages.js';
import { buildZip, readZip } from './project.js';
import { buildPdf, renderPage, encodeCanvas, drawWatermark, MIME } from './exporter.js';
import { PROFILES, buildCmykPdf, proof } from './color.js';
import { isRawName, decodeRaw, RAW_EXTENSIONS } from './raw.js';
import { isDesktop, pickFiles, pickSavePath, pickFolder, writeFile, joinPath, baseName, dataRead, dataWrite, dataReadJson, dataWriteJson, readPath } from './platform.js';
import { registerBytes, registerBlob, typeFor, isImageName, collectAssetUrls } from './assets.js';
import { h, modal, toast, ICONS, appLogo, prompt, setToastHook } from './ui.js';
import { batchDialog } from './batch.js';
import { showHome, rememberRecent, forgetRecent, SHORTCUT_EXTRAS } from './home.js';
import { defineCommands, buildMenuBar, commandForKey, runCommand, commandSearch, allCommands, shortcutLabel, menuPaths, command, closeMenus } from './commands.js';
import { buildToolColumn, buildOptionsBar, initTools, setTool, handleToolKey, markLibrary, TOOL_GROUPS, currentTool, setForeground } from './tools.js';
import { addPanel, buildDock, showPanel, toggleDock, historyPanel, panelShown, dockCollapsed } from './dock.js';
import { openCutout } from './refine.js';
import { restoreBackground } from './bgremove.js';
import { openRetouch } from './retouch.js';
import { upscalePhoto, upscaleLimit } from './upscale.js';
import { MENUS } from './menus.js';
import { init as initClaude } from './mcp.js';
import { initQuickFixes } from './quickfix.js';
import { beforeAfterDialog } from './beforeafter.js';

const $ = (s) => document.querySelector(s);

// ---------- Layout ----------

const LIBRARIES = [
  { id: 'photos', label: 'Photos', icon: 'photos' },
  { id: 'elements', label: 'Elements', short: 'Shapes', icon: 'elements' },
  { id: 'text', label: 'Text and fonts', short: 'Text', icon: 'heading' },
  { id: 'templates', label: 'Templates', icon: 'templates' },
  { id: 'brand', label: 'Brand', icon: 'brand' },
];
let library = null; // open library panel id, or null
const uploads = []; // asset urls shown in the Photos panel
const prefs = { pages: true };

function buildLayout() {
  document.body.innerHTML = '';
  document.body.append(
    h(
      'div',
      { class: 'app' },
      h(
        'header',
        { class: 'menubar' },
        h('button', { class: 'brand-mark', title: 'Start screen', onclick: () => home() }, h('span', { html: appLogo(24) }), h('span', { class: 'wordmark' }, 'Photo ', h('span', {}, 'Editor'))),
        h('nav', { class: 'menus', id: 'menus' }),
        h('div', { class: 'doc-title', id: 'doc-title' }),
        h('span', { class: 'grow' }),
        h('button', { class: 'icon-btn', title: 'Search commands (Ctrl+F)', onclick: commandSearch, html: ICONS.search }),
        h('button', { class: 'btn gold', onclick: exportDialog }, 'Export'),
      ),
      h('div', { class: 'optionsbar', id: 'options' }),
      h('nav', { class: 'toolcol', id: 'tools' }),
      h('aside', { class: 'drawer', id: 'drawer' }),
      h(
        'main',
        { class: 'workspace', id: 'workspace' },
        h('canvas', { id: 'c' }),
        h('div', { class: 'crop-bar', id: 'crop-bar' }, h('span', {}, 'Crop'), h('button', { class: 'btn primary small', onclick: exitCrop }, 'Done')),
      ),
      h('footer', { class: 'pages', id: 'pages' }),
      h('nav', { class: 'dock-rail', id: 'dock-rail' }),
      h('aside', { class: 'dock', id: 'dock' }),
      h(
        'footer',
        { class: 'statusbar', id: 'status' },
        h('label', { class: 'status-zoom', title: 'Zoom' }, h('input', { class: 'field num', id: 'zoom-input', type: 'number', min: 2, max: 800 }), h('span', {}, '%')),
        h('span', { class: 'status-item', id: 'status-doc' }),
        h('span', { class: 'status-item', id: 'status-page' }),
        h('span', { class: 'status-item', id: 'status-layers' }),
        h('span', { class: 'status-msg', id: 'status-msg' }),
        h('span', { class: 'grow' }),
        h('button', { class: 'claude-chip', id: 'claude-chip', hidden: true, title: 'Claude can control this app. Click to turn it off.', onclick: () => runCommand('help.mcp') }, 'Claude control on'),
        h('button', { class: 'icon-btn tiny', id: 'snap-btn', title: 'Snapping (Shift+Ctrl+;)', html: ICONS.magnet, onclick: () => runCommand('view.snap') }),
        h('button', { class: 'icon-btn tiny', id: 'rulers-btn', title: 'Rulers (Ctrl+R)', html: ICONS.ruler, onclick: () => toggleRulers() }),
        h('button', { class: 'icon-btn tiny', title: 'Fit on screen (Ctrl+0)', html: ICONS.fit, onclick: fitToScreen }),
      ),
    ),
  );
  const zi = $('#zoom-input');
  zi.addEventListener('keydown', (e) => e.stopPropagation());
  zi.addEventListener('change', () => zoomTo(Math.max(2, Math.min(800, +zi.value || 100)) / 100));
}

function applyPrefs() {
  document.body.classList.toggle('no-pages', !prefs.pages);
  document.body.classList.toggle('drawer-open', !!library);
}

// ---------- Library panels ----------

function openLibrary(id) {
  library = library === id ? null : id;
  markLibrary(library);
  applyPrefs();
  renderDrawer();
}

function renderDrawer() {
  const el = $('#drawer');
  el.innerHTML = '';
  if (!library) return;
  const lib = LIBRARIES.find((l) => l.id === library);
  el.append(h('div', { class: 'panel-title row' }, h('span', { class: 'grow' }, lib.label), h('button', { class: 'icon-btn tiny', title: 'Close', html: ICONS.close, onclick: () => openLibrary(library) })));
  const body = h('div', { class: 'panel-body' });
  el.append(body);
  if (library === 'text') textPanel(body);
  if (library === 'photos') photosPanel(body);
  if (library === 'elements') elementsPanel(body);
  if (library === 'brand') renderBrandPanel(body, brandActions);
  if (library === 'templates') renderTemplatesPanel(body);
}

function textPanel(el) {
  const heading = brandFont('heading');
  const body = brandFont('body');
  el.append(
    h(
      'div',
      { class: 'panel-block' },
      h('button', { class: 'add-text heading', style: { fontFamily: heading ? `"${heading}"` : null }, onclick: () => addText('heading') }, 'Add a heading'),
      h('button', { class: 'add-text body', style: { fontFamily: body ? `"${body}"` : null }, onclick: () => addText('body') }, 'Add body text'),
      h('p', { class: 'muted small' }, 'The Text tool (T) adds text where you click.'),
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
  if (library === 'photos') renderDrawer();
}

/** Clicking a photo fills the selected empty frame, otherwise adds it to the page. */
async function placeOrFill(url) {
  const [s] = selected();
  if (s && s.isFrame && !isPhoto(s)) await dropPhoto(url, null, s);
  else await addPhoto(url);
}

const SHAPE_TILE_ICON = { rect: 'rect', rounded: 'rounded', ellipse: 'circle', triangle: 'triangle', line: 'line', star: 'star', polygon: 'polygon', burst: 'burst', arrow: 'arrow', heart: 'heart', bubble: 'bubble', cross: 'cross' };

function elementsPanel(el) {
  const tile = (icon, label, fn) => h('button', { class: 'tile small', onclick: fn }, h('span', { html: ICONS[icon] }), h('span', {}, label));
  el.append(
    h('div', { class: 'panel-block' }, h('div', { class: 'section-title' }, 'Shapes'), h('p', { class: 'muted small' }, 'Click to add, or pick the Shape tool (U) and drag on the page.')),
    h(
      'div',
      { class: 'tile-grid three' },
      Object.keys(SHAPE_TILE_ICON).map((k) => tile(SHAPE_TILE_ICON[k], SHAPE_NAMES[k], () => addShape(k))),
    ),
    h('div', { class: 'panel-block' }, h('div', { class: 'section-title' }, 'Frames'), h('p', { class: 'muted small' }, 'A frame holds a photo cropped to its shape. Drop a photo on it to fill it.')),
    h(
      'div',
      { class: 'tile-grid three' },
      [
        ['rect', 'Rectangle', 'frames'],
        ['rounded', 'Rounded', 'rounded'],
        ['arch', 'Arch', 'arch'],
        ['ellipse', 'Circle', 'circle'],
      ].map(([k, label, icon]) => tile(icon, label, () => addFrame(k))),
      tile('qr', 'QR code', newQr),
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

// ---------- Title, status and pages ----------

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

function renderStatus() {
  if (!state.doc) return;
  const zi = $('#zoom-input');
  if (document.activeElement !== zi) zi.value = Math.round(canvas.getZoom() * 100);
  $('#status-doc').textContent = `${state.doc.width} × ${state.doc.height} px · ${state.doc.dpi} dpi`;
  $('#status-page').textContent = `Page ${state.pageIndex + 1} of ${state.doc.pages.length}`;
  const n = designObjects().length;
  $('#status-layers').textContent = `${n} layer${n === 1 ? '' : 's'}`;
  $('#snap-btn').classList.toggle('on', snapping);
  $('#rulers-btn').classList.toggle('on', viewSettings().rulers);
}

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
  const ib = (icon, title, fn, disabled = false) => h('button', { class: 'icon-btn', title, onclick: fn, disabled, html: ICONS[icon] });
  el.append(
    strip,
    h(
      'div',
      { class: 'page-actions' },
      ib('left', 'Move page left', () => movePage(state.pageIndex, state.pageIndex - 1), state.pageIndex === 0),
      ib('right', 'Move page right', () => movePage(state.pageIndex, state.pageIndex + 1), state.pageIndex === state.doc.pages.length - 1),
      ib('copy', 'Duplicate page', () => duplicatePage()),
      ib('trash', 'Delete page', confirmDeletePage, state.doc.pages.length < 2),
    ),
  );
  renderStatus();
}

async function confirmDeletePage() {
  if (state.doc.pages.length < 2) return;
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

/** Puts pictures from disk on the page, like Photoshop's Place Embedded. */
async function placePhoto() {
  const files = await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', ...RAW_EXTENSIONS], multiple: true, label: 'Images and RAW files' });
  for (const f of files || []) {
    try {
      const url = await pictureUrl(f.name, f.bytes);
      uploads.unshift(url);
      await placeOrFill(url);
    } catch {
      toast(`${f.name} could not be read.`, { error: true });
    }
  }
  if (library === 'photos') renderDrawer();
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
  toast(`Opened ${f.name}.`);
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
    toast(`Opened ${f.name}.`);
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

const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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
  const issues = await import('./preflight.js').then((m) => m.checkDesign({ quiet: true })).catch(() => []);
  // A small render of this page for the preview.
  const pm = Math.min(1, 320 / Math.max(state.doc.width, state.doc.height));
  const base = await renderPage(currentPage(), pm);
  const preview = h('canvas', { class: 'export-preview' });
  const sizeLine = h('div', { class: 'export-size muted small' });
  const drawPreview = async () => {
    preview.width = base.width;
    preview.height = base.height;
    preview.getContext('2d').drawImage(base, 0, 0);
    if (wm.on && opts.format !== 'pdf') await drawWatermark(preview, { ...wm, logoUrl: logos.find((l) => l.id === wm.logoId)?.url });
  };
  // The file size comes from encoding this page at the chosen settings.
  let sizeRun = 0;
  let full = null;
  let fullKey = '';
  const estimate = () => {
    const run = ++sizeRun;
    if (opts.format === 'pdf') {
      sizeLine.textContent = 'PDF';
      return;
    }
    sizeLine.textContent = `${opts.format.toUpperCase()} · working out the file size`;
    setTimeout(async () => {
      if (run !== sizeRun) return;
      try {
        const key = `${opts.multiplier}|${opts.transparent}|${opts.format === 'jpg'}`;
        if (key !== fullKey) {
          full = await renderPage(currentPage(), opts.multiplier, { transparent: opts.format !== 'jpg' && opts.transparent });
          fullKey = key;
        }
        let el = full;
        if (slides && opts.split) el = splitSlides(full, slides)[0];
        const bytes = await encodeCanvas(el, { format: opts.format, quality: opts.quality, maxKB: opts.limit && opts.format !== 'png' ? opts.maxMB * 1024 : 0 });
        if (run !== sizeRun) return;
        sizeLine.textContent = `${opts.format.toUpperCase()} · about ${kb(bytes.length)}${slides && opts.split ? ' per slide' : n > 1 && opts.pages === 'all' ? ' for this page' : ''} · ${el.width} × ${el.height} px`;
      } catch {
        if (run === sizeRun) sizeLine.textContent = opts.format.toUpperCase();
      }
    }, 350);
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
    const settings = h('div', { class: 'stack gap grow' }, ...[
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
            h('input', { type: 'range', min: 50, max: 100, value: Math.round(opts.quality * 100), oninput: (e) => (opts.quality = e.target.value / 100), onchange: estimate }),
          )
        : null,
      lossy
        ? h(
            'div',
            { class: 'row' },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.limit, onchange: (e) => ((opts.limit = e.target.checked), draw()) }), 'Keep each file under'),
            h('input', { class: 'field num', type: 'number', title: 'Largest file size in MB', min: 0.05, step: 0.1, value: opts.maxMB, disabled: !opts.limit, style: { width: '76px' }, oninput: (e) => (opts.maxMB = Math.max(0.05, +e.target.value || 1)), onchange: estimate }),
            h('span', { class: 'muted' }, 'MB'),
          )
        : null,
      opts.format === 'png' || opts.format === 'webp'
        ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.transparent, onchange: (e) => ((opts.transparent = e.target.checked), estimate()) }), 'Transparent background')
        : null,
      slides && image
        ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.split, onchange: (e) => ((opts.split = e.target.checked), draw()) }), `Split into ${slides} slides`)
        : null,
      image ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: wm.on, onchange: (e) => ((wm.on = e.target.checked), draw()) }), 'Watermark') : null,
      image && wm.on
        ? h(
            'div',
            { class: 'wm stack gap' },
            h(
              'label',
              { class: 'field-row' },
              h('span', { class: 'label' }, 'Logo'),
              logos.length
                ? h(
                    'select',
                    { class: 'field', onchange: (e) => ((wm.logoId = e.target.value), drawPreview()) },
                    h('option', { value: '' }, 'No logo'),
                    logos.map((l) => h('option', { value: l.id, selected: wm.logoId === l.id }, l.name)),
                  )
                : h('span', { class: 'muted small' }, 'Add a logo in the Brand panel to use it here.'),
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
          )
        : null,
      image && count > 1 ? h('p', { class: 'muted small' }, `${count} files save as ${safeName(state.doc.name)}-01.${opts.format} to -${String(count).padStart(2, '0')}.`) : null,
      issues.length
        ? h(
            'div',
            { class: 'export-issues' },
            h('div', { class: 'section-title' }, `Check before exporting (${issues.length})`),
            issues.slice(0, 4).map((i) => h('p', { class: 'small' }, i.text)),
            issues.length > 4 ? h('button', { class: 'link', onclick: () => runCommand('file.check') }, 'See all') : null,
          )
        : null,
    ].filter(Boolean));
    body.append(h('div', { class: 'export-grid' }, settings, h('div', { class: 'export-side' }, preview, sizeLine)));
    drawPreview();
    estimate();
  };
  draw();
  const go = await modal('Export', body, [
    { label: 'Batch export', value: 'batch' },
    { label: 'Cancel', value: false },
    { label: 'Export', value: true, primary: true },
  ], { wide: true });
  sizeRun++;
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

// ---------- Clipboard ----------

const CLIP_MARK = 'photo-editor:objects';
let clipboard = null;

const typing = () => {
  const a = document.activeElement;
  return (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) || canvas.getActiveObject()?.isEditing;
};

function copyObjects(cut) {
  if (!selected().length) return false;
  clipboard = selected().map((o) => o.toObject());
  if (cut) removeSelected();
  return true;
}

async function pasteObjects() {
  if (!clipboard) return;
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
}

function setupClipboard() {
  document.addEventListener('copy', (e) => {
    if (typing() || !copyObjects(false)) return;
    e.clipboardData.setData('text/plain', CLIP_MARK);
    e.preventDefault();
  });
  document.addEventListener('cut', (e) => {
    if (typing() || !selected().length) return;
    e.clipboardData.setData('text/plain', CLIP_MARK);
    e.preventDefault();
    copyObjects(true);
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
    if (text === CLIP_MARK && clipboard) return pasteObjects();
    if (text && text.trim()) addTextWith(text.trim());
  });
}

// ---------- Drop ----------

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
      } else if (file.name.toLowerCase().endsWith('.cube')) {
        emit('cube-dropped', { name: file.name, bytes });
      }
    }
    if (library === 'photos') renderDrawer();
  });
}

// ---------- Commands ----------

const one = () => (selected().length === 1 ? selected()[0] : null);
const has = () => selected().length > 0;
const photo = () => (isPhoto(one()) ? one() : null);
const layer = () => targetLayer() || one();

/** Alt+Backspace: fills the selection, or the selected shapes and text, with the foreground colour. */
async function fillWith(color) {
  if (hasSelection()) return fillSelection(color);
  const list = selected().filter((o) => !o.locked && o.type !== 'image');
  if (!list.length) {
    currentPage().background = color;
    canvas.requestRenderAll();
    record();
    renderProps();
    return;
  }
  list.forEach((o) => o.set(o.type === 'line' ? { stroke: color } : { fill: color }));
  canvas.requestRenderAll();
  record();
  renderProps();
}

async function emptyMask(o) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 8, 8);
  await setLayerMask(o, c);
  record(true);
  emit('objects');
}

function rotate90(dir) {
  const list = selected();
  if (!list.length) return;
  const a = canvas.getActiveObject();
  a.rotate(((a.angle || 0) + 90 * dir + 360) % 360);
  a.setCoords();
  canvas.requestRenderAll();
  canvas.fire('object:modified', { target: a });
}

function freeTransform() {
  const t = targetLayer() || one();
  setTool('move');
  if (t) canvas.setActiveObject(t);
  canvas.requestRenderAll();
}

function changeCase() {
  const o = one();
  if (o?.type !== 'textbox') return;
  const upper = o.text === o.text.toUpperCase();
  o.set({ text: upper ? o.text.toLowerCase() : o.text.toUpperCase() });
  o.initDimensions();
  if (o.curve) applyCurve(o);
  canvas.requestRenderAll();
  record();
}

function curveText() {
  const o = one();
  if (o?.type !== 'textbox') return;
  o.curve = o.curve ? 0 : 40;
  applyCurve(o);
  canvas.requestRenderAll();
  record();
  renderProps();
}

function defineCoreCommands() {
  const doc = () => !!state.doc;
  defineCommands({
    // File
    'file.new': { label: 'New design', keys: 'Ctrl+N', run: newDesign, global: true },
    'file.open': { label: 'Open', keys: 'Ctrl+O', run: openDesign, global: true, also: 'picture raw' },
    'file.home': { label: 'Start screen', run: () => home(), also: 'recent designs' },
    'file.save': { label: 'Save', keys: 'Ctrl+S', run: () => save(false), enabled: doc, global: true },
    'file.saveas': { label: 'Save as', keys: 'Shift+Ctrl+S', run: () => save(true), enabled: doc, global: true },
    'file.place': { label: 'Place photo', keys: 'Shift+Ctrl+P', run: placePhoto, enabled: doc, also: 'add image import' },
    'file.export': { label: 'Export', keys: 'Ctrl+E', run: exportDialog, enabled: doc, global: true, also: 'png jpg webp pdf save picture' },
    'file.batch': { label: 'Batch export and spreadsheet posts', run: batchDialog, enabled: doc, also: 'csv data merge' },
    'file.sizes': { label: 'Make other sizes', run: otherSizesDialog, enabled: doc, also: 'resize story square' },
    'file.template': { label: 'Save page as template', run: saveTemplate, enabled: doc },
    'file.print': { label: 'Preview print colours', run: () => printPreview(), enabled: doc, also: 'cmyk proof' },
    // Edit
    'edit.undo': { label: 'Undo', keys: 'Ctrl+Z', run: undo, enabled: canUndo },
    'edit.redo': { label: 'Redo', keys: ['Ctrl+Y', 'Shift+Ctrl+Z'], run: redo, enabled: canRedo },
    'edit.cut': { label: 'Cut', run: () => copyObjects(true), enabled: has },
    'edit.copy': { label: 'Copy', run: () => copyObjects(false), enabled: has },
    'edit.paste': { label: 'Paste', run: pasteObjects, enabled: () => !!clipboard },
    'edit.duplicate': { label: 'Duplicate', keys: ['Ctrl+J', 'Ctrl+D'], run: () => duplicateSelected(), enabled: has },
    'edit.delete': { label: 'Delete', run: removeSelected, enabled: has },
    'edit.fillfg': { label: 'Fill with foreground colour', keys: 'Alt+Backspace', run: () => fillWith(state.fg), enabled: doc },
    'edit.fillbg': { label: 'Fill with background colour', keys: 'Ctrl+Backspace', run: () => fillWith(state.bg), enabled: doc },
    'edit.transform': { label: 'Free transform', keys: 'Ctrl+T', run: freeTransform, enabled: () => !!(targetLayer() || one()) },
    'edit.flipH': { label: 'Flip horizontal', run: () => flip('x'), enabled: has },
    'edit.flipV': { label: 'Flip vertical', run: () => flip('y'), enabled: has },
    'edit.rotCW': { label: 'Rotate 90° clockwise', run: () => rotate90(1), enabled: has },
    'edit.rotCCW': { label: 'Rotate 90° anticlockwise', run: () => rotate90(-1), enabled: has },
    'edit.shortcuts': { label: 'Keyboard shortcuts', keys: 'Shift+?', run: shortcutsDialog },
    // Image
    'image.resize': { label: 'Resize design', keys: 'Alt+Ctrl+I', run: resizeDialog, enabled: doc, also: 'image size canvas size' },
    'image.cutout': { label: 'Remove background', run: () => openCutout(photo()), enabled: photo, also: 'cut out' },
    'image.restore': { label: 'Restore background', run: () => restoreBackground(photo()), enabled: () => !!photo()?.originalSrc },
    'image.retouch': { label: 'Spot heal, clone and red eye', run: () => openRetouch(photo()), enabled: photo },
    'image.up2': { label: 'Upscale 2×', run: () => upscalePhoto(photo(), 2).then(renderProps), enabled: () => photo() && upscaleLimit(photo()) >= 2 },
    'image.up4': { label: 'Upscale 4×', run: () => upscalePhoto(photo(), 4).then(renderProps), enabled: () => photo() && upscaleLimit(photo()) >= 4 },
    'image.crop': { label: 'Crop photo', run: () => (setTool('crop'), photo() && enterCrop(photo())), enabled: photo },
    'image.behind': { label: 'Text behind subject', run: () => textBehindSubject(photo(), () => addText('heading')), enabled: photo },
    'file.beforeAfter': {
      label: 'Before and after from two photos',
      run: () =>
        beforeAfterDialog({
          confirmDiscard,
          pickPhoto: async () => {
            const [f] = (await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp', ...RAW_EXTENSIONS], label: 'Images and RAW files' })) || [];
            return f ? { name: f.name, url: await pictureUrl(f.name, f.bytes) } : null;
          },
        }),
      also: 'collage compare result',
    },
    // Layer
    'layer.text': { label: 'New text', run: () => addText('body') , enabled: doc },
    'layer.heading': { label: 'New heading', run: () => addText('heading'), enabled: doc },
    'layer.duplicate': { label: 'Duplicate layer', run: () => duplicateSelected(), enabled: has },
    'layer.delete': { label: 'Delete layer', run: removeSelected, enabled: has },
    'layer.maskReveal': { label: 'Add mask', run: () => emptyMask(layer()), enabled: () => layer() && !layer().layerMask },
    'layer.maskSel': { label: 'Mask from selection', run: () => hideArea(layer(), 'outside'), enabled: () => hasSelection() && layer() },
    'layer.maskHideSel': { label: 'Hide selected area', run: () => hideArea(layer(), 'inside'), enabled: () => hasSelection() && layer() },
    'layer.maskPaint': { label: 'Paint mask', run: () => startMaskPaint(layer(), 'brush'), enabled: layer },
    'layer.maskFade': { label: 'Fade out', run: () => startMaskPaint(layer(), 'fade'), enabled: layer },
    'layer.maskRadial': { label: 'Radial fade', run: () => startMaskPaint(layer(), 'radial'), enabled: layer, also: 'vignette spotlight' },
    'layer.maskInvert': { label: 'Invert mask', run: () => invertLayerMask(layer()), enabled: () => !!layer()?.layerMask },
    'layer.maskToggle': { label: 'Mask on', run: () => toggleLayerMask(layer()), enabled: () => !!layer()?.layerMask, checked: () => layer()?.layerMask && layer().maskOn !== false },
    'layer.maskDelete': { label: 'Delete mask', run: () => removeLayerMask(layer()), enabled: () => !!layer()?.layerMask },
    'layer.clip': {
      label: 'Clip to layer below',
      keys: 'Alt+Ctrl+G',
      run: () => {
        const o = layer();
        o.set({ clipBelow: !o.clipBelow, dirty: true });
        canvas.requestRenderAll();
        record();
        emit('objects');
      },
      enabled: () => layer() && layerBelow(layer()),
      checked: () => !!layer()?.clipBelow,
      also: 'clipping mask',
    },
    'layer.group': { label: 'Group', keys: 'Ctrl+G', run: groupSelected, enabled: () => selected().length > 1 },
    'layer.ungroup': { label: 'Ungroup', keys: 'Shift+Ctrl+G', run: ungroupSelected, enabled: () => one()?.type === 'group' },
    'layer.front': { label: 'Bring to front', keys: 'Shift+Ctrl+]', run: () => arrange('front'), enabled: has },
    'layer.forward': { label: 'Bring forward', keys: 'Ctrl+]', run: () => arrange('forward'), enabled: has },
    'layer.backward': { label: 'Send backward', keys: 'Ctrl+[', run: () => arrange('backward'), enabled: has },
    'layer.back': { label: 'Send to back', keys: 'Shift+Ctrl+[', run: () => arrange('back'), enabled: has },
    'layer.alignL': { label: 'Left edges', run: () => align('left'), enabled: has },
    'layer.alignC': { label: 'Centres across', run: () => align('center'), enabled: has },
    'layer.alignR': { label: 'Right edges', run: () => align('right'), enabled: has },
    'layer.alignT': { label: 'Top edges', run: () => align('top'), enabled: has },
    'layer.alignM': { label: 'Middles', run: () => align('middle'), enabled: has },
    'layer.alignB': { label: 'Bottom edges', run: () => align('bottom'), enabled: has },
    'layer.distH': { label: 'Space evenly across', run: () => distribute('x'), enabled: () => selected().length > 2 },
    'layer.distV': { label: 'Space evenly down', run: () => distribute('y'), enabled: () => selected().length > 2 },
    'layer.lock': { label: 'Lock layer', keys: 'Ctrl+/', run: () => selected().forEach(toggleLock), enabled: has, checked: () => !!one()?.locked },
    'layer.mergeDown': { label: 'Merge down', run: () => mergeLayers([layerBelow(layer()), layer()]), enabled: () => layer() && layerBelow(layer()) && selected().length < 2 },
    'layer.merge': { label: 'Merge selected layers', run: () => mergeLayers(selected()), enabled: () => selected().length > 1 },
    // Type
    'type.heading': { label: 'Add a heading', run: () => addText('heading'), enabled: doc },
    'type.body': { label: 'Add body text', run: () => addText('body'), enabled: doc },
    'type.curve': { label: 'Curve text', run: curveText, enabled: () => one()?.type === 'textbox', checked: () => !!one()?.curve },
    'type.case': { label: 'Change case', run: changeCase, enabled: () => one()?.type === 'textbox' },
    'type.style': { label: 'Save as text style', run: saveTextStyle, enabled: () => one()?.type === 'textbox' },
    'type.font': { label: 'Add font file', run: addFonts },
    // Select
    'select.all': { label: 'All', keys: 'Ctrl+A', run: () => (isSelecting() ? selectAll() : selectObjects(designObjects().filter((o) => o.visible && !o.locked && !o.isAdjustment))), enabled: doc },
    'select.none': { label: 'Deselect', run: () => (hasSelection() ? deselect() : (canvas.discardActiveObject(), canvas.requestRenderAll())), enabled: () => hasSelection() || has() },
    'select.invert': { label: 'Inverse', keys: 'Shift+Ctrl+I', run: invertSelection, enabled: doc },
    'select.subject': { label: 'Subject', run: () => selectSubject('new'), enabled: doc, also: 'person product ai' },
    'select.layer': { label: 'Layer shape', run: () => selectFromLayer(layer()), enabled: layer },
    'select.expand': { label: 'Expand by 10 px', run: () => growSelection(10), enabled: hasSelection },
    'select.contract': { label: 'Contract by 10 px', run: () => growSelection(-10), enabled: hasSelection },
    'select.feather': { label: 'Feather 10 px', keys: 'Shift+F6', run: () => featherSelection(10), enabled: hasSelection },
    'select.copy': { label: 'Copy to new layer', run: () => copyToLayer(false), enabled: hasSelection },
    'select.cut': { label: 'Cut to new layer', run: () => copyToLayer(true), enabled: () => hasSelection() && !!targetLayer() },
    'select.hide': { label: 'Hide area', run: () => hideArea(targetLayer(), 'inside'), enabled: () => hasSelection() && !!targetLayer() },
    'select.keep': { label: 'Keep only area', run: () => hideArea(targetLayer(), 'outside'), enabled: () => hasSelection() && !!targetLayer() },
    'select.show': { label: 'Show area again', run: () => hideArea(targetLayer(), 'show'), enabled: () => hasSelection() && !!targetLayer()?.layerMask },
    'select.fill': { label: 'Fill as new layer', run: () => fillSelection(state.fg), enabled: hasSelection },
    'select.save': { label: 'Save selection', run: saveSelection, enabled: hasSelection },
    // View
    'view.in': { label: 'Zoom in', keys: ['Ctrl+=', 'Ctrl+Shift+='], run: () => zoomBy(1.2) },
    'view.out': { label: 'Zoom out', keys: 'Ctrl+-', run: () => zoomBy(1 / 1.2) },
    'view.fit': { label: 'Fit on screen', keys: 'Ctrl+0', run: fitToScreen },
    'view.actual': { label: '100%', keys: 'Ctrl+1', run: () => zoomTo(1), also: 'actual size' },
    'view.rulers': { label: 'Rulers', keys: 'Ctrl+R', run: () => toggleRulers(), checked: () => viewSettings().rulers },
    'view.safe': { label: 'Story safe zone', run: () => toggleSafeZone(), checked: () => viewSettings().safe },
    'view.snap': {
      label: 'Snap',
      keys: 'Shift+Ctrl+;',
      run: () => {
        setSnapping(!snapping);
        renderStatus();
      },
      checked: () => snapping,
    },
    'view.clearGuides': { label: 'Clear guides', run: () => (clearGuides(), renderProps()), enabled: () => !!currentPage()?.guides?.length },
    'view.pages': {
      label: 'Page strip',
      run: () => {
        prefs.pages = !prefs.pages;
        applyPrefs();
        dataWriteJson('layout.json', prefs);
      },
      checked: () => prefs.pages,
    },
    // Window
    'window.properties': { label: 'Properties', run: () => showPanel('properties'), checked: () => panelShown('properties') },
    'window.adjustments': { label: 'Adjustments', run: () => showPanel('adjustments'), checked: () => panelShown('adjustments') },
    'window.layers': { label: 'Layers', keys: 'F7', run: () => showPanel('layers'), checked: () => panelShown('layers') },
    'window.history': { label: 'History', run: () => showPanel('history'), checked: () => panelShown('history') },
    'window.dock': { label: 'Panels', keys: 'Shift+Tab', run: toggleDock, checked: () => !dockCollapsed() },
    ...Object.fromEntries(LIBRARIES.map((l) => [`window.lib.${l.id}`, { label: l.label, run: () => openLibrary(l.id), checked: () => library === l.id }])),
    // Help
    'help.search': { label: 'Search commands', keys: 'Ctrl+F', run: commandSearch, global: true },
    'help.about': { label: 'About Photo Editor', run: aboutDialog },
  });
  // Tools, so the search box can switch them too.
  for (const g of TOOL_GROUPS) for (const [id, label] of g.tools) defineCommands({ [`tool.${id}`]: { label: `${label} tool`, run: () => setTool(id), hidden: false, also: 'tool' } });
  // Pages
  defineCommands({
    'page.add': { label: 'New page', run: () => addPage(), enabled: doc },
    'page.duplicate': { label: 'Duplicate page', run: () => duplicatePage(), enabled: doc },
    'page.delete': { label: 'Delete page', run: confirmDeletePage, enabled: () => state.doc?.pages.length > 1 },
    'page.prev': { label: 'Previous page', keys: 'PageUp', run: () => showPage(state.pageIndex - 1), enabled: () => state.pageIndex > 0 },
    'page.next': { label: 'Next page', keys: 'PageDown', run: () => showPage(state.pageIndex + 1), enabled: () => state.doc && state.pageIndex < state.doc.pages.length - 1 },
  });
}

/** Loaded selections for the Select menu. */
export const savedSelectionItems = () =>
  state.doc
    ? savedList().map((s) => {
        const id = `select.load.${s.id}`;
        defineCommands({ [id]: { label: s.name, run: () => loadSaved(s), hidden: true } });
        return id;
      })
    : [];

function aboutDialog() {
  modal(
    'About Photo Editor',
    h(
      'div',
      { class: 'stack gap' },
      h('div', { class: 'row' }, h('span', { html: appLogo(48) }), h('div', {}, h('div', { class: 'wordmark dark' }, 'Photo ', h('span', {}, 'Editor')), h('div', { class: 'muted small' }, 'Version 0.3.0 by Cygnus Tools'))),
      h('p', { class: 'small' }, 'The layout follows PhotoCraft. Clarity, texture, dehaze, the colour mixer, auto tone, red eye and the gradient masks follow LightCraft. Both are open-source apps by Storyteller under the MIT and Apache 2.0 licences, and their methods were rewritten here in JavaScript.'),
      h('p', { class: 'small muted' }, 'Background removal uses ISNet (Apache 2.0) and upscaling uses Real-ESRGAN (BSD 3-Clause). Icons come from Lucide (ISC) and Simple Icons (CC0).'),
    ),
    [{ label: 'Close', value: true, primary: true }],
  );
}

// ---------- Keys ----------

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
    if (document.querySelector('.modal-back, .palette-back')) return;
    const k = e.key.toLowerCase();
    const id = commandForKey(e);
    if (id && command(id)?.global) {
      e.preventDefault();
      return runCommand(id);
    }
    if (typing()) return;
    if (!state.doc) return;
    if (inCrop()) {
      if (k === 'enter' || k === 'escape') return e.preventDefault(), exitCrop();
      return;
    }
    if (handleSelectionKey(e)) return;
    if (id) {
      e.preventDefault();
      return runCommand(id);
    }
    if (k === 'delete' || k === 'backspace') return e.preventDefault(), removeSelected();
    if (k === 'escape') {
      closeMenus();
      if (currentTool() !== 'move') return setTool('move');
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
    if (e.key === '?') return shortcutsDialog();
    if (handleToolKey(e)) e.preventDefault();
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
  const paths = menuPaths();
  const rows = [];
  rows.push(h('tr', {}, h('th', { colspan: 2 }, 'Tools')));
  for (const g of TOOL_GROUPS) rows.push(h('tr', {}, h('td', {}, h('kbd', {}, g.key)), h('td', {}, g.tools.length > 1 ? g.tools.map((t) => t[1]).join(', ').replace(/^(.{60}).+$/, '$1…') : g.tools[0][1])));
  rows.push(h('tr', {}, h('td', {}, h('kbd', {}, 'X'), ' ', h('kbd', {}, 'D')), h('td', {}, 'Swap colours, black and white')));
  let lastMenu = '';
  for (const c of allCommands().filter((x) => x.keys && paths.has(x.id))) {
    const menu = paths.get(c.id)[0];
    if (menu !== lastMenu) rows.push(h('tr', {}, h('th', { colspan: 2 }, menu)));
    lastMenu = menu;
    rows.push(h('tr', {}, h('td', {}, h('kbd', {}, shortcutLabel(c))), h('td', {}, c.label)));
  }
  rows.push(h('tr', {}, h('th', { colspan: 2 }, 'Other keys')));
  for (const [k, what] of SHORTCUT_EXTRAS) rows.push(h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, what)));
  modal('Keyboard shortcuts', h('table', { class: 'keys' }, rows), [{ label: 'Close', value: true, primary: true }], { wide: true });
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
  defineCoreCommands();

  // Right-hand panels.
  const propsEl = addPanel({ id: 'properties', label: 'Properties', icon: 'sliders', group: 'top', onShow: () => renderProps() });
  const adjEl = addPanel({ id: 'adjustments', label: 'Adjustments', icon: 'adjustLayer', group: 'top', onShow: () => emit('adjustments-panel') });
  const layersEl = addPanel({ id: 'layers', label: 'Layers', icon: 'layers', group: 'bottom', onShow: () => renderLayers() });
  const histEl = addPanel({ id: 'history', label: 'History', icon: 'history', group: 'bottom', onShow: () => drawHistory() });
  const drawHistory = historyPanel(histEl);
  initProps(propsEl, { resize: resizeDialog, otherSizes: otherSizesDialog, selectionPanel: selectPanel });
  initLayers(layersEl);
  await buildDock($('#dock'), $('#dock-rail'));

  // Optional modules add their own commands and panels.
  const mods = await Promise.all([import('./adjustlayers.js'), import('./layerstyles.js'), import('./transform.js'), import('./shapeops.js'), import('./preflight.js'), import('./develop-ui.js')].map((p) => p.catch((e) => (console.warn(e), null))));
  for (const m of mods) m?.init?.({ adjustmentsEl: adjEl });

  initQuickFixes({ photo, rerender: () => renderProps() });
  await initClaude({ openBytes, pictureUrl, rememberRecent });
  buildMenuBar($('#menus'), MENUS({ savedSelections: savedSelectionItems }));
  buildToolColumn($('#tools'), LIBRARIES.map((l) => ({ ...l, open: () => openLibrary(l.id) })));
  buildOptionsBar($('#options'));
  initTools();

  setupDrop();
  setupClipboard();
  setupKeys();
  setupCloseGuard();
  setToastHook((text) => ($('#status-msg').textContent = text));
  Object.assign(prefs, await dataReadJson('layout.json', {}));
  applyPrefs();

  on('zoom', renderStatus);
  on('view', renderStatus);
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
  on('objects', renderStatus);
  on('thumb', (page) => {
    const img = document.querySelector(`.page-thumb[data-page="${page.id}"] .thumb-box`);
    if (img) {
      img.innerHTML = '';
      img.append(h('img', { src: page.thumb }));
    } else renderPages();
  });
  on('changed', scheduleAutosave);
  on('brand', () => {
    if (library === 'brand' || library === 'text') renderDrawer();
    renderProps();
  });
  on('templates', () => library === 'templates' && renderDrawer());
  on('text-styles', () => library === 'text' && renderDrawer());
  on('fonts', () => renderProps());
  on('crop', (onOff) => {
    $('#crop-bar').classList.toggle('show', onOff);
    renderProps();
  });
  on('tool', () => renderProps());
  // Picking a layer brings its settings forward when the Adjustments list is showing.
  const toProps = () => panelShown('adjustments') && showPanel('properties');
  canvas.on('selection:created', toProps);
  canvas.on('selection:updated', toProps);
  canvas.on('object:added', renderStatus);
  canvas.on('object:removed', renderStatus);
  canvas.on('text:changed', (e) => {
    if (e.target?.curve) applyCurve(e.target);
    renderLayers();
  });

  await Promise.all([initFonts(), initBrand(), initTemplates()]);
  setTool('move');
  if (!(await offerRestore())) {
    await openDocument(newDoc({ ...SIZE_PRESETS[0], name: 'Untitled design' }));
    home();
  }
  renderStatus();
  window.__editor = { state, canvas, fabric, emit, currentKit, ensureFont, runCommand, setTool, setForeground, commands: () => allCommands().map((c) => ({ id: c.id, label: c.label, on: (() => { try { return !c.enabled || !!c.enabled(); } catch { return false; } })() })) };
}

start();

export { isEmptyFrame };
