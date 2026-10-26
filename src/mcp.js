// Answers requests from the Claude connector (mcp/photo-editor-mcp.mjs).
// The desktop app's local server (src-tauri/src/bridge.rs) passes each request
// here as an "mcp-request" event; the reply goes back through mcp_reply.
// Help > Let Claude control this app switches the server on and off.

import { canvas, fabric, designObjects, selected } from './canvas.js';
import { state, newDoc, emit, currentPage } from './state.js';
import { record } from './history.js';
import { isPhoto } from './frames.js';
import { ensureFont } from './fonts.js';
import { addText, addShape, addPhoto, selectObjects, duplicateSelected, applyLock, arrange, applyCurve, PATH_SHAPES } from './objects.js';
import { openDocument, showPage, syncCurrentPage } from './pages.js';
import { buildZip } from './project.js';
import { renderPage, encodeCanvas, MIME } from './exporter.js';
import { isDesktop, readPath, writeFile, joinPath, baseName, dataReadJson, dataWriteJson } from './platform.js';
import { allCommands, isEnabled, menuPaths, defineCommands } from './commands.js';
import { selectSubject, hideArea, deselect, setTarget, textBehindSubject, subjectError } from './selection.js';
import { photoTarget, addCube } from './adjustpanel.js';
import { addAdjustmentLayer, layerTarget, ADJ_KINDS } from './adjustlayers.js';
import { NEUTRAL, BANDS, autoSettings } from './adjust.js';
import { BLEND_MODES } from './layerfx.js';
import { upscalePhoto, upscaleLimit } from './upscale.js';
import { toast } from './ui.js';
import { quickFix, activeFixes, settingsFor, renderLook } from './quickfix.js';
import { detectFaces } from './faces.js';
import { makeBeforeAfter, makeGoalPreview, LAYOUTS, GOAL_MAX, GOAL_DEFAULT } from './beforeafter.js';
import { updateBadge, setLabelOpacity, setLabelSize, setBadgeSize, pageLabels } from './badge.js';
import { listDir } from './platform.js';
import { loadImage } from './assets.js';

let host = {};
let enabled = false;
let tauri = null;

const say = (text) => {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = `Claude: ${text}`;
};
const fail = (msg) => {
  throw new Error(msg);
};
const round = (v) => Math.round(v * 10) / 10;

// ---------- Layers ----------

function kindOf(o) {
  if (o.isAdjustment) return 'adjustment';
  if (o.type === 'textbox' || o.type === 'i-text' || o.type === 'text') return 'text';
  if (o.type === 'image') return 'photo';
  if (o.isFrame) return 'frame';
  if (o.badge) return 'label';
  if (o.type === 'group') return 'group';
  if (o.type === 'line') return 'line';
  return 'shape';
}

function changed(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (!(k in NEUTRAL)) continue;
    if (JSON.stringify(v) !== JSON.stringify(NEUTRAL[k])) out[k] = v;
  }
  return out;
}

function describe(o, i) {
  const b = o.getBoundingRect();
  const d = {
    id: o.uid,
    name: o.name || kindOf(o),
    kind: kindOf(o),
    order: i + 1,
    visible: o.visible !== false,
    locked: !!o.locked,
    ...(o.badge ? { label_text: o.badge.text, label_color: o.badge.color, label_box_color: o.badge.fill, label_size: Math.round(o.scaleX * 100) } : {}),
    opacity: Math.round((o.opacity ?? 1) * 100),
    blend: BLEND_MODES.find(([v]) => v === (o.globalCompositeOperation || 'source-over'))?.[1] || 'Normal',
    x: round(b.left),
    y: round(b.top),
    width: round(b.width),
    height: round(b.height),
    angle: round(o.angle || 0),
  };
  if (d.kind === 'text') Object.assign(d, { text: o.text, font_family: o.fontFamily, font_size: o.fontSize, font_weight: o.fontWeight, color: typeof o.fill === 'string' ? o.fill : 'gradient', align: o.textAlign });
  if (d.kind === 'shape' || d.kind === 'frame') d.color = typeof o.fill === 'string' ? o.fill : o.fill ? 'gradient' : null;
  if (d.kind === 'photo') {
    const el = o.getElement();
    d.pixels = `${el.naturalWidth || el.width} × ${el.naturalHeight || el.height}`;
    const f = o.filters?.find((x) => x.type === 'Adjust');
    const adj = changed(f);
    if (Object.keys(adj).length) d.adjustments = adj;
  }
  if (d.kind === 'adjustment') Object.assign(d, { adjustment: o.adjKind, settings: changed(o.adjust) });
  if (o.layerMask) d.mask = o.maskOn === false ? 'off' : 'on';
  if (o.clipBelow) d.clipped_to_layer_below = true;
  if (o.shadow) d.shadow = true;
  return d;
}

function layer(id) {
  if (id == null || id === '') fail('Give the layer id from list_layers.');
  const objs = designObjects();
  const o = objs.find((x) => x.uid === id) || objs.find((x) => (x.name || '').toLowerCase() === String(id).toLowerCase());
  if (!o) fail(`No layer with the id or name "${id}". Call list_layers for the ids.`);
  return o;
}

const layersJson = () =>
  designObjects()
    .map(describe)
    .reverse();

// Moves a layer so its box's top-left corner lands on x, y.
function moveTo(o, x, y) {
  const b = o.getBoundingRect();
  o.set({ left: o.left + (x ?? b.left) - b.left, top: o.top + (y ?? b.top) - b.top });
  o.setCoords();
}

const BLEND_BY_NAME = new Map(BLEND_MODES.flatMap(([v, n]) => [[n.toLowerCase(), v], [v, v]]));

async function setProps(o, p) {
  const kind = kindOf(o);
  if (p.name != null) o.name = String(p.name);
  if (p.visible != null) o.visible = !!p.visible;
  if (p.opacity != null) o.opacity = Math.max(0, Math.min(100, +p.opacity)) / 100;
  if (p.blend != null) {
    const v = BLEND_BY_NAME.get(String(p.blend).toLowerCase());
    if (!v) fail(`Unknown blend "${p.blend}". Use one of: ${BLEND_MODES.map(([, n]) => n).join(', ')}.`);
    o.globalCompositeOperation = v;
  }
  if (kind === 'text') {
    if (p.text != null) o.set({ text: String(p.text) });
    if (p.font_family) {
      await ensureFont(p.font_family);
      o.set({ fontFamily: p.font_family });
    }
    if (p.font_size != null) o.set({ fontSize: +p.font_size });
    if (p.font_weight != null) o.set({ fontWeight: p.font_weight });
    if (p.italic != null) o.set({ fontStyle: p.italic ? 'italic' : 'normal' });
    if (p.align) o.set({ textAlign: p.align });
    if (p.letter_spacing != null) o.set({ charSpacing: +p.letter_spacing });
    if (p.line_height != null) o.set({ lineHeight: +p.line_height });
    if (p.curve != null) {
      o.curve = +p.curve;
      applyCurve(o);
    }
    if (p.width != null) o.set({ width: +p.width });
    o.initDimensions?.();
  } else if (p.width != null || p.height != null) {
    const b = o.getBoundingRect();
    const sx = p.width != null ? +p.width / b.width : null;
    const sy = p.height != null ? +p.height / b.height : null;
    const keep = p.keep_proportions !== false;
    const fx = sx ?? (keep ? sy : 1);
    const fy = sy ?? (keep ? sx : 1);
    o.set({ scaleX: o.scaleX * (keep && sx && sy ? Math.min(sx, sy) : fx), scaleY: o.scaleY * (keep && sx && sy ? Math.min(sx, sy) : fy) });
  }
  if (p.color != null) o.set(kind === 'line' ? { stroke: p.color } : { fill: p.color });
  if (p.outline_width != null || p.outline_color != null) {
    const w = p.outline_width != null ? +p.outline_width : o.strokeWidth || 2;
    o.set({ strokeWidth: w, stroke: w ? p.outline_color || o.stroke || '#000000' : null });
  }
  if (p.corner_radius != null && o.type === 'rect') o.set({ rx: +p.corner_radius, ry: +p.corner_radius });
  if (p.shadow !== undefined) {
    const s = p.shadow;
    o.set({ shadow: s ? new fabric.Shadow({ color: s.color || 'rgba(0,0,0,0.35)', blur: s.blur ?? 20, offsetX: s.x ?? 0, offsetY: s.y ?? 8 }) : null });
  }
  if (p.flip_x != null) o.set({ flipX: !!p.flip_x });
  if (p.flip_y != null) o.set({ flipY: !!p.flip_y });
  if (p.angle != null) {
    const c = o.getCenterPoint();
    o.set({ angle: +p.angle });
    o.setPositionByOrigin(c, 'center', 'center');
  }
  o.setCoords();
  if (p.x != null || p.y != null) moveTo(o, p.x, p.y);
  if (p.locked != null) {
    o.locked = !!p.locked;
    applyLock(o);
  }
  if (p.order) {
    if (!['front', 'back', 'forward', 'backward'].includes(p.order)) fail('order is front, back, forward or backward.');
    selectObjects([o]);
    arrange(p.order);
  }
  o.dirty = true;
}

const done = () => {
  canvas.requestRenderAll();
  record(true);
  emit('objects');
};

// Turns { hue: { Red: -40 } } into the eight-band arrays the mixer stores.
function normalizeAdjust(settings, current) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (k === 'mixer' && v && typeof v === 'object') {
      const cur = JSON.parse(JSON.stringify(current.mixer || NEUTRAL.mixer));
      for (const part of ['hue', 'sat', 'lum']) {
        const src = v[part] ?? v[{ sat: 'saturation', lum: 'luminance' }[part]];
        if (!src) continue;
        if (Array.isArray(src)) cur[part] = src.slice(0, 8);
        else for (const [band, amount] of Object.entries(src)) {
          const i = BANDS.findIndex(([n]) => n.toLowerCase() === band.toLowerCase());
          if (i < 0) fail(`Unknown colour band "${band}". Use ${BANDS.map(([n]) => n).join(', ')}.`);
          cur[part][i] = +amount;
        }
      }
      out.mixer = cur;
    } else if (k === 'bwMix' && v && !Array.isArray(v)) {
      const cur = [...(current.bwMix || NEUTRAL.bwMix)];
      for (const [band, amount] of Object.entries(v)) {
        const i = BANDS.findIndex(([n]) => n.toLowerCase() === band.toLowerCase());
        if (i >= 0) cur[i] = +amount;
      }
      out.bwMix = cur;
    } else if (k === 'lut' && typeof v === 'string') {
      out.lut = BUILTIN_LUTS[v.toLowerCase()] || fail(`Unknown built-in look "${v}". Use ${Object.keys(BUILTIN_LUTS).filter((n) => !n.startsWith('builtin:')).join(', ')}, or lut_file for a .cube file.`);
    } else if (k in NEUTRAL) out[k] = v;
    else fail(`Unknown setting "${k}". Settings: ${Object.keys(NEUTRAL).join(', ')}.`);
  }
  return out;
}

let BUILTIN_LUTS = {};

async function readFileAt(path) {
  if (isDesktop) return readPath(path);
  const res = await fetch(path);
  if (!res.ok) fail(`${path} could not be read.`);
  return new Uint8Array(await res.arrayBuffer());
}
async function exists(path) {
  if (!isDesktop) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('file_exists', { path });
}

async function pageImage(maxSize) {
  syncCurrentPage();
  const m = Math.min(1, maxSize / Math.max(state.doc.width, state.doc.height));
  return renderPage(currentPage(), m);
}

// ---------- Tools ----------

const TOOLS = {
  async get_status() {
    const sel = selected().map((o) => o.uid);
    return {
      text: JSON.stringify({
        design: state.doc.name,
        file: state.path || null,
        unsaved_changes: !!state.dirty,
        width: state.doc.width,
        height: state.doc.height,
        dpi: state.doc.dpi,
        page: state.pageIndex + 1,
        pages: state.doc.pages.length,
        layers: designObjects().length,
        selected_layer_ids: sel,
        background: currentPage().background,
      }),
    };
  },

  async list_layers() {
    return { text: JSON.stringify({ top_first: layersJson() }) };
  },

  async preview({ max_size = 1024, quality = 0.85 } = {}) {
    const el = await pageImage(Math.max(128, Math.min(2048, +max_size || 1024)));
    return { text: `Page ${state.pageIndex + 1} of ${state.doc.pages.length}, ${state.doc.width} × ${state.doc.height} px, shown at ${el.width} × ${el.height}.`, image: el.toDataURL('image/jpeg', quality) };
  },

  async open_file({ path, discard_changes = false }) {
    if (!path) fail('Give the full path of a design (.zip), picture or RAW file.');
    if (state.dirty && !discard_changes) fail('The open design has unsaved changes. Save it with save_design first, or call again with discard_changes true.');
    const bytes = await readFileAt(path);
    await host.openBytes({ name: baseName(path), path: isDesktop ? path : null, bytes });
    say(`opened ${baseName(path)}`);
    return { text: `Opened ${baseName(path)}: ${state.doc.width} × ${state.doc.height} px with ${designObjects().length} layers.` };
  },

  async new_design({ width = 1080, height = 1350, name = 'Untitled design', background = '#ffffff', discard_changes = false } = {}) {
    if (state.dirty && !discard_changes) fail('The open design has unsaved changes. Save it with save_design first, or call again with discard_changes true.');
    const doc = newDoc({ name, width: Math.round(+width), height: Math.round(+height) });
    doc.pages[0].background = background;
    await openDocument(doc);
    say(`new design ${width} × ${height}`);
    return { text: `New design "${name}", ${doc.width} × ${doc.height} px.` };
  },

  async go_to_page({ page }) {
    const i = Math.round(+page) - 1;
    if (!(i >= 0 && i < state.doc.pages.length)) fail(`Pages run from 1 to ${state.doc.pages.length}.`);
    await showPage(i);
    return { text: `Showing page ${i + 1}.` };
  },

  async place_photo({ path, x, y, width, height, fit, name }) {
    if (!path) fail('Give the full path of the picture.');
    const bytes = await readFileAt(path);
    const url = await host.pictureUrl(baseName(path), bytes);
    const o = await addPhoto(url);
    if (name) o.name = name;
    const W = state.doc.width;
    const H = state.doc.height;
    if (fit === 'cover' || fit === 'contain') {
      const b = o.getBoundingRect();
      const s = (fit === 'cover' ? Math.max : Math.min)(W / b.width, H / b.height);
      o.set({ scaleX: o.scaleX * s, scaleY: o.scaleY * s });
      o.setPositionByOrigin(new fabric.Point(W / 2, H / 2), 'center', 'center');
      o.setCoords();
    }
    await setProps(o, { x, y, width, height });
    done();
    say(`placed ${baseName(path)}`);
    return { text: JSON.stringify({ placed: describe(o, designObjects().indexOf(o)) }) };
  },

  async select_layers({ ids = [] }) {
    const list = ids.map(layer);
    if (!list.length) canvas.discardActiveObject();
    else selectObjects(list);
    if (list.length === 1) setTarget(list[0]);
    canvas.requestRenderAll();
    emit('selection');
    return { text: `Selected ${list.length} layer${list.length === 1 ? '' : 's'}.` };
  },

  async set_layer({ id, ...props }) {
    let o = layer(id);
    if (o.badge) {
      const { text, color, box_color, size, ...rest } = props;
      if (text != null || color || box_color) o = updateBadge(o, { ...(text != null ? { text: String(text) } : {}), ...(color ? { color } : {}), ...(box_color ? { fill: box_color } : {}) });
      if (size != null) setBadgeSize(o, size);
      props = rest;
    }
    await setProps(o, props);
    done();
    say(`changed ${o.name || kindOf(o)}`);
    return { text: JSON.stringify({ layer: describe(o, designObjects().indexOf(o)) }) };
  },

  async add_text({ text = 'Text', style = 'heading', ...props }) {
    const o = addText(style === 'body' ? 'body' : 'heading');
    o.set({ text: String(text) });
    o.initDimensions();
    await setProps(o, props);
    done();
    say('added text');
    return { text: JSON.stringify({ added: describe(o, designObjects().indexOf(o)) }) };
  },

  async add_shape({ shape = 'rect', ...props }) {
    const kinds = ['rect', 'rounded', 'ellipse', 'triangle', 'line', ...Object.keys(PATH_SHAPES)];
    if (!kinds.includes(shape)) fail(`shape is one of ${kinds.join(', ')}.`);
    const o = addShape(shape);
    await setProps(o, props);
    done();
    say(`added ${shape}`);
    return { text: JSON.stringify({ added: describe(o, designObjects().indexOf(o)) }) };
  },

  async duplicate_layer({ id }) {
    const o = layer(id);
    selectObjects([o]);
    const copies = (await duplicateSelected()) || [];
    done();
    return { text: JSON.stringify({ copies: copies.map((c) => describe(c, designObjects().indexOf(c))) }) };
  },

  async delete_layers({ ids = [] }) {
    const list = ids.map(layer);
    canvas.discardActiveObject();
    canvas.remove(...list);
    done();
    say(`deleted ${list.length} layer${list.length === 1 ? '' : 's'}`);
    return { text: `Deleted ${list.length} layer${list.length === 1 ? '' : 's'}.` };
  },

  async adjust_photo({ id, settings = {}, auto, reset = false, lut_file }) {
    const o = layer(id);
    if (!isPhoto(o)) fail(`"${o.name}" is a ${kindOf(o)}. adjust_photo works on photos; use add_adjustment_layer to change everything below a point.`);
    const t = photoTarget(o);
    if (reset) t.apply(JSON.parse(JSON.stringify(NEUTRAL)), true);
    if (auto) t.apply(autoSettings(t.source(), { tone: auto !== 'colour' && auto !== 'color', color: auto !== 'tone' }), true);
    const patch = normalizeAdjust(settings, t.settings());
    if (Object.keys(patch).length) t.apply(patch, true);
    if (lut_file) addCube(t, baseName(lut_file), await readFileAt(lut_file));
    emit('objects');
    say(`adjusted ${o.name || 'photo'}`);
    return { text: JSON.stringify({ layer: describe(o, designObjects().indexOf(o)) }) };
  },

  async add_adjustment_layer({ kind, settings = {}, above, only_layer_below = false, name, lut_file }) {
    if (!ADJ_KINDS[kind]) fail(`kind is one of ${Object.keys(ADJ_KINDS).join(', ')}.`);
    if (above) selectObjects([layer(above)]);
    else canvas.discardActiveObject();
    const o = addAdjustmentLayer(kind, { name });
    const t = layerTarget(o);
    const patch = normalizeAdjust(settings, t.settings());
    if (Object.keys(patch).length) t.apply(patch, true);
    if (lut_file) addCube(t, baseName(lut_file), await readFileAt(lut_file));
    if (only_layer_below) o.clipBelow = true;
    done();
    say(`added ${ADJ_KINDS[kind].name}`);
    return { text: JSON.stringify({ added: describe(o, designObjects().indexOf(o)) }) };
  },

  async remove_background({ id, as_new_layer = false }) {
    let o = layer(id);
    if (!isPhoto(o)) fail(`"${o.name}" is a ${kindOf(o)}. Remove background works on photos.`);
    if (as_new_layer) {
      selectObjects([o]);
      [o] = (await duplicateSelected(0)) || [o];
      o.name = 'Cut-out';
    }
    say('finding the subject');
    if (!(await selectSubject('new', o))) fail(`The subject could not be found${subjectError ? `: ${subjectError}` : '.'}`);
    await hideArea(o, 'outside', { quiet: true });
    deselect();
    done();
    say('background removed');
    return { text: JSON.stringify({ layer: describe(o, designObjects().indexOf(o)), note: 'The background is hidden with a layer mask. Delete the mask to bring it back.' }) };
  },

  async text_behind_subject({ id, text }) {
    const o = layer(id);
    if (!isPhoto(o)) fail(`"${o.name}" is a ${kindOf(o)}. Text behind subject works on photos.`);
    say('finding the subject');
    await textBehindSubject(o, () => addText('heading'));
    const t = canvas.getActiveObject();
    if (text && t?.type === 'textbox') {
      t.set({ text: String(text) });
      t.initDimensions();
      done();
    }
    return { text: JSON.stringify({ top_first: layersJson() }) };
  },

  async upscale({ id, factor = 2 }) {
    const o = layer(id);
    if (!isPhoto(o)) fail(`"${o.name}" is a ${kindOf(o)}. Upscale works on photos.`);
    const f = +factor === 4 ? 4 : 2;
    if (upscaleLimit(o) < f) fail(`This photo is too big to upscale ${f}×. The limit is 8192 pixels wide.`);
    say(`upscaling ${f}×`);
    await upscalePhoto(o, f);
    emit('objects');
    return { text: JSON.stringify({ layer: describe(o, designObjects().indexOf(o)) }) };
  },

  async list_commands({ filter = '' } = {}) {
    const paths = menuPaths();
    const q = String(filter).toLowerCase();
    const list = allCommands()
      .filter((c) => !BLOCKED.has(c.id) && !c.id.startsWith('tool.') && !c.id.startsWith('window.'))
      .map((c) => ({ id: c.id, label: c.label, menu: (paths.get(c.id) || []).join(' > '), enabled: isEnabled(c) }))
      .filter((c) => !q || c.id.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || c.menu.toLowerCase().includes(q));
    return { text: JSON.stringify(list) };
  },

  async run_command({ id, layer_ids }) {
    if (BLOCKED.has(id)) fail(`${id} opens a file picker or a window that needs a person. ${BLOCKED.get(id)}`);
    const c = allCommands().find((x) => x.id === id);
    if (!c) fail(`No command "${id}". Call list_commands to see them.`);
    if (layer_ids?.length) selectObjects(layer_ids.map(layer));
    if (!isEnabled(c)) fail(`${c.label} cannot run right now. Most commands need the right layer selected first.`);
    const before = document.querySelectorAll('.modal-back').length;
    const run = Promise.resolve(c.run());
    const finished = await Promise.race([run.then(() => true), new Promise((r) => setTimeout(() => r(false), 20000))]);
    const dialog = document.querySelectorAll('.modal-back').length > before ? document.querySelector('.modal-back:last-of-type h2, .modal-back:last-of-type .modal-head')?.textContent : null;
    say(c.label);
    if (dialog) return { text: `${c.label} opened the "${dialog.trim()}" window in Photo Editor. Ask Gid to finish it there.` };
    return { text: finished ? `Ran ${c.label}.` : `${c.label} is still running.` };
  },

  async save_design({ path, overwrite = false } = {}) {
    let p = path || state.path;
    if (!p) fail('This design has no file yet. Give a full path ending in .zip.');
    if (!/\.zip$/i.test(p)) p += '.zip';
    if (p !== state.path && !overwrite && (await exists(p))) fail(`${p} already exists. Call again with overwrite true to replace it.`);
    syncCurrentPage();
    await writeFile(p, await buildZip(state.doc), 'application/zip');
    if (isDesktop) state.path = p;
    state.dirty = false;
    emit('dirty');
    host.rememberRecent?.(p, state.doc.name, state.doc.pages[0]?.thumb);
    say(`saved ${baseName(p)}`);
    return { text: `Saved ${p}.` };
  },

  async retouch({ id, fixes = [], on = true, amounts }) {
    const o = layer(id);
    if (!isPhoto(o)) fail(`"${o.name}" is a ${kindOf(o)}. Quick fixes work on photos.`);
    const ids = fixIds(fixes);
    say(`quick fixes: ${ids.join(', ') || 'amounts'}`);
    const r = await quickFix(o, ids, { on, amounts });
    return { text: JSON.stringify({ message: r.message, faces: r.faces, amounts: r.settings, on: activeFixes(o) }) };
  },

  async detect_faces({ id }) {
    const o = layer(id);
    if (!isPhoto(o)) fail(`"${o.name}" is a ${kindOf(o)}. Faces are found in photos.`);
    const src = o.beautyBase || o.getSrc();
    const faces = await detectFaces(await loadImage(src), { key: src });
    return {
      text: JSON.stringify({
        faces: faces.map((f) => ({ x: Math.round(f.box.x), y: Math.round(f.box.y), width: Math.round(f.box.w), height: Math.round(f.box.h), eye_distance: Math.round(f.parts.eyeDist), tilt_degrees: round((f.parts.angle * 180) / Math.PI), score: round(f.score) })),
        note: 'Positions are in the photo\'s own pixels.',
      }),
    };
  },

  async before_after(args) {
    const { before, after, layout = 'side', labels = ['Before', 'After'], align_faces = true, name, discard_changes = false } = args;
    if (!before || !after) fail('Give full paths for the before photo and the after photo.');
    if (!LAYOUTS[layout]) fail(`layout is one of ${Object.keys(LAYOUTS).join(', ')}.`);
    if (state.dirty && !discard_changes) fail('The open design has unsaved changes. Save it with save_design first, or call again with discard_changes true.');
    const r = await pairDesign({ before, after, layout, labels, align_faces, name, labelColors: labelColors(args), labelOpacity: await labelOpacityOf(args), labelSize: (await labelSizes(args)).labelSize });
    say('before and after made');
    return { text: JSON.stringify({ design: state.doc.name, ...r, layers: layersJson() }) };
  },

  async list_files({ folder, extensions, include_folders = false }) {
    if (!folder) fail('Give the full path of a folder.');
    if (!isDesktop) fail('Folders can only be listed in the desktop app.');
    const exts = (extensions || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'zip']).map((e) => String(e).toLowerCase().replace(/^\./, ''));
    const all = await listDir(folder);
    const list = all
      .filter((f) => (f.folder ? include_folders : exts.includes((f.name.split('.').pop() || '').toLowerCase())))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((f) => ({ name: f.name, path: joinPath(folder, f.name), folder: f.folder || undefined, size_kb: f.folder ? undefined : Math.round(f.size / 1024), modified: new Date(f.modified).toISOString().slice(0, 16).replace('T', ' ') }));
    return { text: JSON.stringify({ folder, count: list.length, files: list }) };
  },

  async batch_retouch({ files = [], fixes = [], amounts, output_folder, suffix = '-retouched', format = 'jpg', quality = 0.92, overwrite = false }) {
    if (!files.length) fail('Give the photos to retouch as full paths.');
    if (!output_folder) fail('Give the folder to save the results in.');
    const fmt = String(format).toLowerCase().replace('jpeg', 'jpg');
    if (!MIME[fmt]) fail('format is png, jpg or webp.');
    const ids = fixIds(fixes);
    const settings = settingsFor(ids, amounts);
    const done = [];
    for (let i = 0; i < files.length; i++) {
      const path = files[i];
      say(`retouching ${i + 1} of ${files.length}`);
      const stem = baseName(path).replace(/\.[^.]+$/, '');
      const outPath = joinPath(output_folder, `${stem}${suffix}.${fmt}`);
      if (!overwrite && (await exists(outPath))) {
        done.push({ file: path, skipped: `${outPath} already exists` });
        continue;
      }
      try {
        const img = await loadImage(await host.pictureUrl(baseName(path), await readFileAt(path)));
        const r = await renderLook(img, ids, settings, { key: path });
        await writeFile(outPath, await encodeCanvas(r.canvas, { format: fmt, quality: +quality }), MIME[fmt]);
        done.push({ file: path, saved: outPath, faces: r.faces });
      } catch (e) {
        done.push({ file: path, error: e.message || String(e) });
      }
    }
    say(`retouched ${done.filter((d) => d.saved).length} of ${files.length}`);
    return { text: JSON.stringify({ results: done }) };
  },

  async batch_before_after(args) {
    const { pairs = [], output_folder, layout = 'side', labels = ['Before', 'After'], align_faces = true, format = 'jpg', quality = 0.92, save_designs = true, overwrite = false, discard_changes = false } = args;
    if (!pairs.length) fail('Give pairs as [{ before, after, name }] with full paths.');
    if (!output_folder) fail('Give the folder to save the results in.');
    if (!LAYOUTS[layout]) fail(`layout is one of ${Object.keys(LAYOUTS).join(', ')}.`);
    const fmt = String(format).toLowerCase().replace('jpeg', 'jpg');
    if (!MIME[fmt]) fail('format is png, jpg or webp.');
    if (state.dirty && !discard_changes) fail('The open design has unsaved changes. Save it with save_design first, or call again with discard_changes true.');
    const results = [];
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const stem = (p.name || `${baseName(p.after).replace(/\.[^.]+$/, '')} before and after`).replace(/[\\/:*?"<>|]+/g, '-');
      const picture = joinPath(output_folder, `${stem}.${fmt}`);
      const design = joinPath(output_folder, `${stem}.zip`);
      say(`before and after ${i + 1} of ${pairs.length}`);
      try {
        if (!overwrite && ((await exists(picture)) || (save_designs && (await exists(design))))) {
          results.push({ name: stem, skipped: 'already exists' });
          continue;
        }
        const r = await pairDesign({ before: p.before, after: p.after, layout, labels: p.labels || labels, align_faces, name: stem, labelColors: labelColors(args), labelOpacity: await labelOpacityOf(args), labelSize: (await labelSizes(args)).labelSize });
        syncCurrentPage();
        const el = await renderPage(currentPage(), 1);
        await writeFile(picture, await encodeCanvas(el, { format: fmt, quality: +quality }), MIME[fmt]);
        if (save_designs) {
          await writeFile(design, await buildZip(state.doc), 'application/zip');
          if (isDesktop) state.path = design;
          state.dirty = false;
          emit('dirty');
        }
        results.push({ name: stem, picture, design: save_designs ? design : undefined, faces_lined_up: r.aligned, faces_found: r.faces });
      } catch (e) {
        results.push({ name: stem, error: e.message || String(e) });
      }
    }
    return { text: JSON.stringify({ results }) };
  },

  async set_labels({ opacity, size }) {
    if (opacity == null && size == null) fail('Give opacity, size or both.');
    if (opacity != null && !(opacity >= 0 && opacity <= 100)) fail('opacity is 0 to 100.');
    if (size != null && !(size >= 30 && size <= 150)) fail('size is 30 to 150 percent.');
    const n = pageLabels().length;
    if (!n) fail('This page has no labels. The Simulated goal tag is not a label: use set_layer with opacity or size for it.');
    if (opacity != null) setLabelOpacity(opacity);
    if (size != null) setLabelSize(size);
    done();
    return { text: `Set ${n} label${n === 1 ? '' : 's'}${opacity != null ? ` to ${opacity}% opacity` : ''}${opacity != null && size != null ? ' and' : ''}${size != null ? ` to ${size}% size` : ''}.` };
  },

  async goal_preview(args) {
    const { photo, layout = 'side', labels = ['Today', 'Goal'], name, discard_changes = false } = args;
    if (!photo) fail('Give the full path of the patient photo.');
    if (!LAYOUTS[layout]) fail(`layout is one of ${Object.keys(LAYOUTS).join(', ')}.`);
    const opts = goalOptions(args);
    if (state.dirty && !discard_changes) fail('The open design has unsaved changes. Save it with save_design first, or call again with discard_changes true.');
    const r = await makeGoalPreview({ photo: await loadPath(photo), ...opts, labelOpacity: await labelOpacityOf(args), ...(await labelSizes(args)), layout, labels, name });
    say('goal preview made');
    return { text: JSON.stringify({ design: state.doc.name, ...r, note: 'The goal side carries a Simulated goal tag. Keep it on whenever the picture is shown. Fine tune the goal with retouch on goal_layer and amounts, and move the tag or labels with set_layer.', layers: layersJson() }) };
  },

  async batch_goal_preview(args) {
    const { photos = [], output_folder, layout = 'side', labels = ['Today', 'Goal'], format = 'jpg', quality = 0.92, save_designs = true, overwrite = false, discard_changes = false } = args;
    if (!photos.length) fail('Give the patient photos as full paths.');
    if (!output_folder) fail('Give the folder to save the results in.');
    if (!LAYOUTS[layout]) fail(`layout is one of ${Object.keys(LAYOUTS).join(', ')}.`);
    const opts = goalOptions(args);
    const fmt = String(format).toLowerCase().replace('jpeg', 'jpg');
    if (!MIME[fmt]) fail('format is png, jpg or webp.');
    if (state.dirty && !discard_changes) fail('The open design has unsaved changes. Save it with save_design first, or call again with discard_changes true.');
    const results = [];
    for (let i = 0; i < photos.length; i++) {
      const item = typeof photos[i] === 'string' ? { photo: photos[i] } : photos[i];
      const stem = (item.name || `${baseName(item.photo).replace(/\.[^.]+$/, '')} goal preview`).replace(/[\\/:*?"<>|]+/g, '-');
      const picture = joinPath(output_folder, `${stem}.${fmt}`);
      const design = joinPath(output_folder, `${stem}.zip`);
      say(`goal preview ${i + 1} of ${photos.length}`);
      try {
        if (!overwrite && ((await exists(picture)) || (save_designs && (await exists(design))))) {
          results.push({ name: stem, skipped: 'already exists' });
          continue;
        }
        const r = await makeGoalPreview({ photo: await loadPath(item.photo), ...opts, labelOpacity: await labelOpacityOf(args), ...(await labelSizes(args)), layout, labels: item.labels || labels, name: stem });
        syncCurrentPage();
        const el = await renderPage(currentPage(), 1);
        await writeFile(picture, await encodeCanvas(el, { format: fmt, quality: +quality }), MIME[fmt]);
        if (save_designs) {
          await writeFile(design, await buildZip(state.doc), 'application/zip');
          if (isDesktop) state.path = design;
          state.dirty = false;
          emit('dirty');
        }
        results.push({ name: stem, picture, design: save_designs ? design : undefined, faces_found: r.faces });
      } catch (e) {
        results.push({ name: stem, error: e.message || String(e) });
      }
    }
    return { text: JSON.stringify({ results }) };
  },

  async export_image({ path, format, scale = 1, quality = 0.92, transparent = false, pages = 'current', overwrite = false }) {
    if (!path) fail('Give a full path for the picture, or a folder when exporting all pages.');
    const fmt = (format || (path.match(/\.(png|jpe?g|webp)$/i)?.[1] || 'png')).toLowerCase().replace('jpeg', 'jpg');
    if (!MIME[fmt]) fail('format is png, jpg or webp.');
    syncCurrentPage();
    const list = pages === 'all' ? state.doc.pages : [currentPage()];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const file = pages === 'all' ? joinPath(path, `${state.doc.name.replace(/[\\/:*?"<>|]+/g, '-')}-${String(i + 1).padStart(2, '0')}.${fmt}`) : /\.(png|jpe?g|webp)$/i.test(path) ? path : `${path}.${fmt}`;
      if (!overwrite && (await exists(file))) fail(`${file} already exists. Call again with overwrite true to replace it.`);
      const el = await renderPage(list[i], +scale === 2 ? 2 : 1, { transparent: fmt !== 'jpg' && transparent });
      await writeFile(file, await encodeCanvas(el, { format: fmt, quality: +quality }), MIME[fmt]);
      out.push(file);
    }
    say(`exported ${out.length} file${out.length === 1 ? '' : 's'}`);
    return { text: `Exported ${out.join(', ')}.` };
  },
};


// Short names a person or another assistant might use for the fixes.
const FIX_ALIAS = { glow_up: 'glow', glowup: 'glow', glow: 'glow', smooth_skin: 'smooth', smoothen: 'smooth', smooth: 'smooth', skin: 'smooth', slim_face: 'slimFace', slimface: 'slimFace', face: 'slimFace', slim_body: 'slimBody', slimbody: 'slimBody', body: 'slimBody', enhance_faces: 'enhance', enhance: 'enhance', restore: 'enhance', bright_eyes: 'eyes', eyes: 'eyes', whiten_teeth: 'teeth', teeth: 'teeth' };

// Label opacity: what the call gives, or what Gid last picked in the windows.
async function labelSizes(a) {
  const saved = await dataReadJson('settings/beforeafter.json', {});
  const pick = (v, fallback, what) => {
    if (v == null) return fallback ?? 100;
    if (!(v >= 30 && v <= 150)) fail(`${what} is 30 to 150 percent.`);
    return +v;
  };
  return { labelSize: pick(a.label_size, saved.labelSize, 'label_size'), tagSize: pick(a.tag_size, saved.tagSize, 'tag_size') };
}

async function labelOpacityOf(a) {
  if (a.label_opacity != null) {
    if (!(a.label_opacity >= 0 && a.label_opacity <= 100)) fail('label_opacity is 0 to 100.');
    return +a.label_opacity;
  }
  return (await dataReadJson('settings/beforeafter.json', {})).labelOpacity ?? 0;
}

const labelColors = (a) => ({ ...(a.label_box_color ? { fill: a.label_box_color } : {}), ...(a.label_color ? { color: a.label_color } : {}) });
const tagColors = (a) => ({ ...(a.tag_box_color ? { fill: a.tag_box_color } : {}), ...(a.tag_color ? { color: a.tag_color } : {}) });

function goalOptions(a) {
  const fixes = fixIds(a.fixes || ['slim_face']);
  for (const f of fixes) if (!GOAL_MAX[f]) fail(`Goals are slim_face, slim_body, smooth and glow, not ${f}.`);
  const amount = a.amount ?? GOAL_DEFAULT;
  if (!(amount >= 0 && amount <= 100)) fail('amount is 0 to 100.');
  return { fixes, amount, amounts: a.amounts, labelColors: labelColors(a), tagColors: tagColors(a), tag: a.tag_text || 'Simulated goal' };
}

const fixIds = (fixes = []) => fixes.map((f) => FIX_ALIAS[String(f).toLowerCase().replace(/[\s-]+/g, '_')] || f);

async function loadPath(path) {
  return { name: baseName(path), url: await host.pictureUrl(baseName(path), await readFileAt(path)) };
}

async function pairDesign({ before, after, layout, labels, align_faces, name, labelColors, labelOpacity, labelSize }) {
  const load = async (path) => ({ name: baseName(path), url: await host.pictureUrl(baseName(path), await readFileAt(path)) });
  const [b, a] = await Promise.all([load(before), load(after)]);
  const r = await makeBeforeAfter({ before: b, after: a, layout, labels, labelColors, labelOpacity, labelSize, align: align_faces, name: name || `${baseName(after).replace(/\.[^.]+$/, '')} before and after` });
  return { aligned: r.aligned, faces: r.faces, layout, size: r.size };
}

// Commands that open a picker or a window. Each points at the tool to use instead.
const BLOCKED = new Map([
  ['file.open', 'Use open_file with a path.'],
  ['file.place', 'Use place_photo with a path.'],
  ['file.save', 'Use save_design.'],
  ['file.saveas', 'Use save_design with a path.'],
  ['file.export', 'Use export_image.'],
  ['file.new', 'Use new_design.'],
  ['file.home', 'Use new_design or open_file.'],
  ['file.batch', 'Gid runs batch export himself. Use batch_retouch or batch_before_after for groups of photos.'],
  ['file.beforeAfter', 'Use before_after with two paths.'],
  ['file.goalPreview', 'Use goal_preview with the photo path.'],
  ['file.sizes', 'Gid runs Make other sizes himself.'],
  ['file.template', 'Gid saves templates himself.'],
  ['file.print', 'Gid opens the print preview himself.'],
  ['type.font', 'Gid adds font files himself.'],
  ['help.search', 'Use list_commands.'],
  ['help.mcp', 'Gid switches Claude control himself.'],
  ['image.cutout', 'Use remove_background, or ask Gid to open the cut-out editor.'],
  ['image.retouch', 'Retouching needs a person painting.'],
  ['image.crop', 'Use set_layer to move or resize instead.'],
]);

// ---------- Wiring ----------

export async function handle(body) {
  let req;
  try {
    req = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return { error: 'The request was not JSON.' };
  }
  const fn = TOOLS[req.method];
  if (!fn) return { error: `Unknown tool ${req.method}.` };
  if (!state.doc) {
    const open = document.querySelector('.modal-back:last-of-type h2, .modal-back:last-of-type .modal-head')?.textContent?.trim();
    return { error: open ? `Photo Editor is waiting on its "${open}" window. Ask Gid to answer it.` : 'Photo Editor is still starting.' };
  }
  try {
    return await fn(req.params || {});
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

async function api() {
  if (!tauri) {
    const [core, event] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
    tauri = { core, event };
  }
  return tauri;
}

async function setEnabled(on, { quiet = false } = {}) {
  if (isDesktop) {
    const { core } = await api();
    try {
      if (on) await core.invoke('mcp_start');
      else await core.invoke('mcp_stop');
    } catch (e) {
      toast(`Claude control could not start: ${e}`, { error: true });
      return;
    }
  }
  enabled = on;
  await dataWriteJson('settings/claude.json', { enabled: on });
  document.body.classList.toggle('claude-on', on);
  const chip = document.getElementById('claude-chip');
  if (chip) chip.hidden = !on;
  if (!quiet) toast(on ? 'Claude control is on.' : 'Claude control is off.');
}

export async function init(h) {
  host = h;
  const { BUILT_IN } = await import('./luts.js');
  for (const l of BUILT_IN) {
    BUILTIN_LUTS[l.name.toLowerCase()] = { url: l.id, name: l.name };
    BUILTIN_LUTS[l.id] = { url: l.id, name: l.name };
  }
  defineCommands({
    'help.mcp': { label: 'Let Claude control this app', run: () => setEnabled(!enabled), checked: () => enabled, global: true },
  });
  if (isDesktop) {
    const { core, event } = await api();
    await event.listen('mcp-request', async (e) => {
      const { id, body } = e.payload;
      let reply;
      try {
        reply = JSON.stringify(await handle(body));
      } catch (err) {
        reply = JSON.stringify({ error: String(err) });
      }
      await core.invoke('mcp_reply', { id, body: reply });
    });
  }
  // The browser build has no server; tests call this directly.
  window.__mcp = handle;
  const saved = await dataReadJson('settings/claude.json', {});
  if (saved.enabled) await setEnabled(true, { quiet: true });
}
