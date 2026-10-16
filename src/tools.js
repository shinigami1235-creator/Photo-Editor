import { canvas, fabric, objectAt, selected, isSpaceDown, setHandTool, zoomTo, zoomBy, fitToScreen, designObjects } from './canvas.js';
import { state, emit, on } from './state.js';
import { h, iconButton, ICONS, toast, toHex } from './ui.js';
import { addText, addShapeBox, addShape, addFrame, addFrameBox, SHAPE_NAMES, arrange, flip, toggleLock } from './objects.js';
import { setSelecting, setSelectTool, selectOptions, addPainter, refreshOverlay } from './selection.js';
import { setDrawing, drawOptions, setDrawColor } from './draw.js';
import { isPhoto, enterCrop, exitCrop, inCrop } from './frames.js';
import { openRetouch } from './retouch.js';
import { sample } from './eyedropper.js';
import { align, distribute } from './guides.js';
import { undo, redo, canUndo, canRedo } from './history.js';
import { dataReadJson, dataWriteJson } from './platform.js';

// The tool column on the left and the options bar under the menus, the way
// Photoshop lays them out. One tool is active at a time; its settings show in
// the options bar.

const SHAPE_KINDS = ['rect', 'rounded', 'ellipse', 'triangle', 'line', 'star', 'polygon', 'burst', 'arrow', 'heart', 'bubble', 'cross'];
const SHAPE_ICON = { rect: 'rect', rounded: 'rounded', ellipse: 'circle', triangle: 'triangle', line: 'line', star: 'star', polygon: 'polygon', burst: 'burst', arrow: 'arrow', heart: 'heart', bubble: 'bubble', cross: 'cross' };
const FRAME_KINDS = [
  ['rect', 'Rectangle frame', 'frames'],
  ['rounded', 'Rounded frame', 'rounded'],
  ['arch', 'Arch frame', 'arch'],
  ['ellipse', 'Circle frame', 'circle'],
];

export const TOOL_GROUPS = [
  { id: 'move', key: 'V', tools: [['move', 'Move', 'move']] },
  {
    id: 'marquee',
    key: 'M',
    tools: [
      ['rect-select', 'Rectangle select', 'marqueeRect'],
      ['ellipse-select', 'Ellipse select', 'marqueeEllipse'],
    ],
  },
  {
    id: 'lasso',
    key: 'L',
    tools: [
      ['lasso', 'Lasso', 'lasso'],
      ['poly', 'Polygon lasso', 'polyLasso'],
    ],
  },
  { id: 'wand', key: 'W', tools: [['wand', 'Magic wand', 'wand']] },
  { id: 'crop', key: 'C', tools: [['crop', 'Crop', 'crop']] },
  { id: 'eyedropper', key: 'I', tools: [['eyedropper', 'Eyedropper', 'pipette']] },
  { id: 'retouch', key: 'J', tools: [['retouch', 'Spot heal and clone', 'heal']] },
  { id: 'brush', key: 'B', tools: [['brush', 'Brush', 'brush']] },
  { id: 'text', key: 'T', tools: [['text', 'Text', 'text']] },
  { id: 'shape', key: 'U', tools: SHAPE_KINDS.map((k) => [`shape:${k}`, SHAPE_NAMES[k], SHAPE_ICON[k]]) },
  { id: 'frame', key: 'K', tools: FRAME_KINDS.map(([k, n, i]) => [`frame:${k}`, n, i]) },
  { id: 'hand', key: 'H', tools: [['hand', 'Hand', 'hand']] },
  { id: 'zoom', key: 'Z', tools: [['zoom', 'Zoom', 'zoom']] },
];

const SELECT_KIND = { 'rect-select': 'rect', 'ellipse-select': 'ellipse', lasso: 'lasso', poly: 'poly', wand: 'wand' };

const S = {
  tool: 'move',
  last: {}, // group id -> last tool id used in it
  textKind: 'body',
  drag: null, // { a, b } in page units while drawing a box
};

const groupOf = (id) => TOOL_GROUPS.find((g) => g.tools.some((t) => t[0] === id));
const toolDef = (id) => groupOf(id)?.tools.find((t) => t[0] === id);
export const currentTool = () => S.tool;
export const isSelectTool = (id = S.tool) => !!SELECT_KIND[id];

let column = null;
let options = null;
let colorsEl = null;

// ---------- Colours ----------

export function setForeground(c) {
  state.fg = toHex(c);
  setDrawColor(state.fg);
  renderColors();
  saveColors();
}
export function setBackground(c) {
  state.bg = toHex(c);
  renderColors();
  saveColors();
}
export function swapColors() {
  [state.fg, state.bg] = [state.bg, state.fg];
  setDrawColor(state.fg);
  renderColors();
  saveColors();
}
export function defaultColors() {
  state.fg = '#000000';
  state.bg = '#ffffff';
  setDrawColor(state.fg);
  renderColors();
  saveColors();
}
const saveColors = () => dataWriteJson('colors.json', { fg: state.fg, bg: state.bg });

function renderColors() {
  if (!colorsEl) return;
  colorsEl.innerHTML = '';
  const chip = (which) => {
    const input = h('input', { type: 'color', class: 'hidden-color', value: state[which] });
    input.addEventListener('input', () => (which === 'fg' ? setForeground(input.value) : setBackground(input.value)));
    return h(
      'button',
      { class: `color-chip ${which}`, title: which === 'fg' ? `Foreground colour ${state.fg}. Click to change` : `Background colour ${state.bg}. Click to change`, style: { background: state[which] }, onclick: () => input.click() },
      input,
    );
  };
  colorsEl.append(
    h('div', { class: 'chips' }, chip('bg'), chip('fg')),
    h(
      'div',
      { class: 'chip-tools' },
      h('button', { class: 'icon-btn tiny', title: 'Swap colours (X)', html: ICONS.swap, onclick: swapColors }),
      h('button', { class: 'chip-default', title: 'Black and white (D)', onclick: defaultColors }, h('span'), h('span')),
    ),
  );
}

// ---------- Switching tools ----------

/** Turns a tool on. `id` is a tool id, or a group id to use that group's last tool. */
export function setTool(id) {
  const g = TOOL_GROUPS.find((x) => x.id === id);
  if (g) id = S.last[g.id] || g.tools[0][0];
  if (!toolDef(id)) return;
  const prev = S.tool;
  S.tool = id;
  S.last[groupOf(id).id] = id;
  S.drag = null;
  if (prev === 'brush' && id !== 'brush') setDrawing(false);
  if (prev === 'hand' && id !== 'hand') setHandTool(false);
  if (isSelectTool(prev) && !isSelectTool(id)) setSelecting(false);
  if (inCrop() && id !== 'crop') exitCrop();
  // Tools that place things or act on a click do not pick layers up on the page.
  const clickTool = ['crop', 'eyedropper', 'retouch', 'text', 'zoom'].includes(id) || id.startsWith('shape:') || id.startsWith('frame:');
  canvas.skipTargetFind = clickTool || isSelectTool(id) || id === 'hand';
  canvas.selection = id === 'move';
  canvas.defaultCursor = clickTool ? (id === 'zoom' ? 'zoom-in' : id === 'text' ? 'text' : 'crosshair') : 'default';
  canvas.hoverCursor = clickTool ? canvas.defaultCursor : 'move';
  if (isSelectTool(id)) {
    setSelecting(true);
    setSelectTool(SELECT_KIND[id]);
  }
  if (id === 'brush') setDrawing(true);
  if (id === 'hand') setHandTool(true);
  if (clickTool && id !== 'text') canvas.discardActiveObject();
  canvas.requestRenderAll();
  refreshOverlay();
  renderColumn();
  renderOptions();
  emit('tool', id);
}

// ---------- Tool column ----------

let flyout = null;
function closeFlyout() {
  flyout?.remove();
  flyout = null;
}

function showFlyout(g, btn) {
  closeFlyout();
  const r = btn.getBoundingClientRect();
  flyout = h(
    'div',
    { class: 'tool-flyout', style: { left: `${r.right + 4}px`, top: `${r.top}px` } },
    g.tools.map(([id, label, icon]) =>
      h(
        'button',
        { class: 'tool-fly-item' + (id === S.tool ? ' on' : ''), onclick: () => (closeFlyout(), setTool(id)) },
        h('span', { html: ICONS[icon] }),
        h('span', { class: 'grow' }, label),
        h('span', { class: 'menu-key' }, g.key),
      ),
    ),
  );
  document.body.append(flyout);
  const fr = flyout.getBoundingClientRect();
  if (fr.bottom > window.innerHeight - 8) flyout.style.top = `${window.innerHeight - fr.height - 8}px`;
  setTimeout(() => document.addEventListener('mousedown', (e) => !flyout?.contains(e.target) && closeFlyout(), { once: true }));
}

function renderColumn() {
  if (!column) return;
  const tools = column.querySelector('.tool-list');
  tools.innerHTML = '';
  const seps = new Set(['marquee', 'crop', 'brush', 'text', 'hand']);
  for (const g of TOOL_GROUPS) {
    if (seps.has(g.id)) tools.append(h('div', { class: 'tool-sep' }));
    const id = g.tools.some((t) => t[0] === S.tool) ? S.tool : S.last[g.id] || g.tools[0][0];
    const [, label, icon] = g.tools.find((t) => t[0] === id);
    let hold = null;
    const btn = h('button', {
      class: 'tool-btn' + (g.tools.some((t) => t[0] === S.tool) ? ' on' : '') + (g.tools.length > 1 ? ' grouped' : ''),
      title: `${g.tools.length > 1 && g.id === 'shape' ? 'Shape' : g.tools.length > 1 && g.id === 'frame' ? 'Frame' : label} (${g.key})${g.tools.length > 1 ? '. Right-click for more' : ''}`,
      'data-tool': g.id,
      html: ICONS[icon],
      onclick: () => setTool(id),
      oncontextmenu: (e) => {
        e.preventDefault();
        if (g.tools.length > 1) showFlyout(g, btn);
      },
      onmousedown: () => {
        if (g.tools.length > 1) hold = setTimeout(() => showFlyout(g, btn), 450);
      },
      onmouseup: () => clearTimeout(hold),
      onmouseleave: () => clearTimeout(hold),
    });
    tools.append(btn);
  }
}

/** Builds the tool column. `libraries` is [{ id, label, icon, open }] for the panels of things to add. */
export function buildToolColumn(host, libraries) {
  column = host;
  host.innerHTML = '';
  colorsEl = h('div', { class: 'tool-colors' });
  host.append(
    h('div', { class: 'tool-list' }),
    colorsEl,
    h('div', { class: 'tool-sep' }),
    h(
      'div',
      { class: 'lib-list' },
      libraries.map((l) => h('button', { class: 'tool-btn lib', 'data-lib': l.id, title: l.label, onclick: l.open }, h('span', { html: ICONS[l.icon] }), h('span', { class: 'lib-label' }, l.short || l.label))),
    ),
  );
  renderColumn();
  renderColors();
}

/** Marks which library panel is open. */
export function markLibrary(id) {
  column?.querySelectorAll('.tool-btn.lib').forEach((b) => b.classList.toggle('on', b.dataset.lib === id));
}

// ---------- Options bar ----------

export function buildOptionsBar(host) {
  options = host;
  renderOptions();
}

export function renderOptions() {
  if (!options) return;
  options.innerHTML = '';
  const def = toolDef(S.tool);
  const body = h('div', { class: 'opt-body' });
  const hint = (t) => h('span', { class: 'opt-hint muted' }, t);
  const btn = (label, fn, extra = {}) => h('button', { class: 'btn small', onclick: fn, ...extra }, label);
  options.append(h('span', { class: 'opt-tool', html: ICONS[def[2]], title: def[1] }), h('span', { class: 'opt-name' }, def[1]), h('span', { class: 'opt-sep' }), body);

  const t = S.tool;
  if (t === 'move') {
    const list = selected();
    const none = !list.length;
    const ib = (icon, title, fn, dis = none) => iconButton(icon, title, fn, { disabled: dis });
    body.append(
      ib('alignLeft', 'Align left', () => align('left')),
      ib('alignCenter', 'Align centre', () => align('center')),
      ib('alignRight', 'Align right', () => align('right')),
      ib('alignTop', 'Align top', () => align('top')),
      ib('alignMiddle', 'Align middle', () => align('middle')),
      ib('alignBottom', 'Align bottom', () => align('bottom')),
      h('span', { class: 'opt-sep' }),
      ib('distH', 'Space evenly across', () => distribute('x'), list.length < 3),
      ib('distV', 'Space evenly down', () => distribute('y'), list.length < 3),
      h('span', { class: 'opt-sep' }),
      ib('front', 'Bring to front (Ctrl+Shift+])', () => arrange('front')),
      ib('up', 'Bring forward (Ctrl+])', () => arrange('forward')),
      ib('down', 'Send backward (Ctrl+[)', () => arrange('backward')),
      ib('back', 'Send to back (Ctrl+Shift+[)', () => arrange('back')),
      h('span', { class: 'opt-sep' }),
      ib('flipH', 'Flip horizontal', () => flip('x')),
      ib('flipV', 'Flip vertical', () => flip('y')),
      ib(list[0]?.locked ? 'lock' : 'unlock', 'Lock or unlock (Ctrl+L)', () => list.forEach(toggleLock)),
    );
    if (none) body.append(hint('Click a layer to select it. Drag to move it. Alt+drag skips snapping.'));
  } else if (isSelectTool(t)) {
    selectOptions(body);
  } else if (t === 'crop') {
    if (inCrop()) body.append(btn('Done', exitCrop, { class: 'btn small primary' }));
    body.append(hint(inCrop() ? 'Drag the photo inside its frame and pull a corner to zoom. Enter when done.' : 'Click a photo to crop it. Side handles crop too.'));
  } else if (t === 'eyedropper') {
    body.append(hint('Click the page to pick the foreground colour. Alt+click picks the background colour.'));
  } else if (t === 'retouch') {
    body.append(hint('Click a photo to open Spot heal and clone.'));
  } else if (t === 'brush') {
    drawOptions(body);
  } else if (t === 'text') {
    body.append(
      h(
        'div',
        { class: 'seg small' },
        [
          ['heading', 'Heading'],
          ['body', 'Body text'],
        ].map(([v, label]) => h('button', { class: S.textKind === v ? 'on' : '', onclick: () => ((S.textKind = v), renderOptions()) }, label)),
      ),
      hint('Click to add text, or drag to set its width. Click text to edit it. Esc finishes.'),
    );
  } else if (t.startsWith('shape:') || t.startsWith('frame:')) {
    const frame = t.startsWith('frame:');
    const g = groupOf(t);
    body.append(
      h('div', { class: 'opt-shapes' }, g.tools.map(([id, label, icon]) => iconButton(icon, label, () => setTool(id), { on: id === t }))),
      hint(frame ? 'Drag to draw a frame, then drop a photo on it.' : 'Drag to draw. Shift keeps it even. Fills with the foreground colour.'),
    );
  } else if (t === 'hand') {
    body.append(btn('Fit on screen', fitToScreen), btn('100%', () => zoomTo(1)), hint('Drag to move around the page. Hold Space with any tool to do the same.'));
  } else if (t === 'zoom') {
    body.append(btn('Zoom in', () => zoomBy(1.25)), btn('Zoom out', () => zoomBy(0.8)), btn('Fit on screen', fitToScreen), btn('100%', () => zoomTo(1)), hint('Click to zoom in, Alt+click to zoom out.'));
  }

  options.append(
    h('span', { class: 'grow' }),
    iconButton('undo', 'Undo (Ctrl+Z)', undo, { disabled: !canUndo() }),
    iconButton('redo', 'Redo (Ctrl+Y)', redo, { disabled: !canRedo() }),
  );
}

// ---------- Canvas clicks for each tool ----------

const sceneRect = (a, b, square) => {
  let w = b.x - a.x;
  let hh = b.y - a.y;
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(hh));
    w = Math.sign(w || 1) * s;
    hh = Math.sign(hh || 1) * s;
  }
  return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + hh), w: Math.abs(w), h: Math.abs(hh) };
};

function paintDrag(x, sx, sy, dpr) {
  const d = S.drag;
  if (!d) return;
  const r = sceneRect(d.a, d.b, d.square);
  x.save();
  x.lineWidth = dpr;
  x.setLineDash([5 * dpr, 4 * dpr]);
  x.strokeStyle = '#1f5e99';
  if (S.tool === 'shape:line') {
    x.beginPath();
    x.moveTo(sx(d.a.x), sy(d.a.y));
    x.lineTo(sx(d.b.x), sy(d.b.y));
    x.stroke();
  } else if (S.tool === 'shape:ellipse' || S.tool === 'frame:ellipse') {
    x.beginPath();
    x.ellipse(sx(r.x + r.w / 2), sy(r.y + r.h / 2), Math.abs(sx(r.x + r.w) - sx(r.x)) / 2, Math.abs(sy(r.y + r.h) - sy(r.y)) / 2, 0, 0, Math.PI * 2);
    x.stroke();
  } else x.strokeRect(sx(r.x), sy(r.y), sx(r.x + r.w) - sx(r.x), sy(r.y + r.h) - sy(r.y));
  x.restore();
}

let editingText = null;

export function initTools() {
  addPainter(paintDrag);
  dataReadJson('colors.json', null).then((c) => {
    if (c?.fg) state.fg = c.fg;
    if (c?.bg) state.bg = c.bg;
    setDrawColor(state.fg);
    renderColors();
  });

  canvas.on('text:editing:entered', ({ target }) => {
    editingText = target;
    canvas.skipTargetFind = false;
  });
  canvas.on('text:editing:exited', ({ target }) => {
    editingText = null;
    if (S.tool === 'text') {
      setTool('move');
      if (target && canvas.getObjects().includes(target)) canvas.setActiveObject(target);
      canvas.requestRenderAll();
    }
  });

  canvas.on('mouse:down', (opt) => {
    const e = opt.e;
    if (!state.doc || isSpaceDown() || e.button !== 0) return;
    const t = S.tool;
    const p = canvas.getScenePoint(e);
    if (t === 'text') {
      if (editingText && opt.target === editingText) return;
      const hit = objectAt(p);
      if (hit?.type === 'textbox' && !hit.locked) {
        canvas.setActiveObject(hit);
        hit.enterEditing(e);
        hit.selectionStart = hit.selectionEnd = hit.getSelectionStartFromPointer(e);
        canvas.requestRenderAll();
        return;
      }
      if (editingText) editingText.exitEditing();
      S.drag = { a: p, b: p };
      return;
    }
    if (t.startsWith('shape:') || t.startsWith('frame:')) {
      S.drag = { a: p, b: p, square: e.shiftKey };
      return;
    }
    if (t === 'crop') {
      if (inCrop()) return;
      const hit = objectAt(p);
      if (isPhoto(hit)) enterCrop(hit);
      else toast('Click a photo to crop it.');
      renderOptions();
      return;
    }
    if (t === 'retouch') {
      const hit = objectAt(p);
      if (isPhoto(hit)) openRetouch(hit);
      else toast('Click a photo to retouch it.');
      return;
    }
    if (t === 'eyedropper') {
      const c = sample(e);
      if (!c) return;
      if (e.altKey) setBackground(c);
      else setForeground(c);
      return;
    }
    if (t === 'zoom') {
      const pt = new fabric.Point(e.offsetX, e.offsetY);
      zoomTo(canvas.getZoom() * (e.altKey ? 0.8 : 1.25), pt);
    }
  });

  canvas.on('mouse:move', (opt) => {
    if (!S.drag) return;
    S.drag.b = canvas.getScenePoint(opt.e);
    S.drag.square = opt.e.shiftKey;
    refreshOverlay();
  });

  canvas.on('mouse:up', () => {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    refreshOverlay();
    const t = S.tool;
    const z = canvas.getZoom();
    const r = sceneRect(d.a, d.b, d.square);
    const dragged = Math.max(r.w, r.h) * z > 6;
    if (t === 'text') {
      const o = addText(S.textKind, dragged ? new fabric.Point(r.x + r.w / 2, d.a.y) : d.a);
      if (dragged && r.w * z > 20) {
        o.set({ width: r.w, textAlign: 'left' });
        o.initDimensions();
        o.setPositionByOrigin(new fabric.Point(r.x, d.a.y), 'left', 'top');
      } else o.setPositionByOrigin(d.a, 'center', 'center');
      o.setCoords();
      canvas.setActiveObject(o);
      o.enterEditing();
      o.selectAll();
      canvas.requestRenderAll();
      return;
    }
    let made = null;
    if (t.startsWith('shape:')) {
      const kind = t.slice(6);
      made = dragged ? addShapeBox(kind, r, d.a, d.b) : addShape(kind, d.a);
    } else if (t.startsWith('frame:')) {
      const kind = t.slice(6);
      made = dragged ? addFrameBox(kind, r) : addFrame(kind, d.a);
    }
    if (made) {
      setTool('move');
      canvas.setActiveObject(made);
      canvas.requestRenderAll();
    }
  });

  const refresh = () => S.tool === 'move' && renderOptions();
  ['selection:created', 'selection:updated', 'selection:cleared'].forEach((ev) => canvas.on(ev, refresh));
  on('history', renderOptions);
  on('crop', renderOptions);
  on('objects', refresh);
}

/** Single-letter tool keys. Returns true when the key was used. */
export function handleToolKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = e.key.toUpperCase();
  if (k === 'X') return swapColors(), true;
  if (k === 'D') return defaultColors(), true;
  const g = TOOL_GROUPS.find((x) => x.key === k);
  if (!g) return false;
  // Pressing the key of the active group again steps to its next tool.
  const inGroup = g.tools.findIndex((t) => t[0] === S.tool);
  if (inGroup >= 0 && g.tools.length > 1 && (e.shiftKey || g.id === 'marquee' || g.id === 'lasso')) setTool(g.tools[(inGroup + 1) % g.tools.length][0]);
  else setTool(g.id);
  return true;
}

export { designObjects };
