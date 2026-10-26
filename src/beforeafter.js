// Before and after from two photos: a new design with the photos side by side
// or stacked, faces lined up at the same size, angle and place, and labels.

import { canvas, fabric, decorate } from './canvas.js';
import { newDoc, uid } from './state.js';
import { record } from './history.js';
import { openDocument } from './pages.js';
import { loadImage, registerBlob } from './assets.js';
import { makeBadge, LABEL_COLORS, TAG_COLORS } from './badge.js';

export const LABEL_OPACITY = 0;
import { detectFaces } from './faces.js';
import { blurAlphaCanvas } from './pixels.js';

export const LAYOUTS = {
  side: { label: 'Side by side', short: 'Side by side', width: 1080, height: 1350 },
  stack: { label: 'Top and bottom', short: 'Stacked', width: 1080, height: 1350 },
  square: { label: 'Side by side, square', short: 'Square', width: 1080, height: 1080 },
  wide: { label: 'Side by side, wide', short: 'Wide', width: 1920, height: 1080 },
};

function cells(layout, W, H, gap) {
  if (layout === 'stack') {
    const ch = (H - gap) / 2;
    return [{ x: 0, y: 0, w: W, h: ch }, { x: 0, y: ch + gap, w: W, h: ch }];
  }
  const cw = (W - gap) / 2;
  return [{ x: 0, y: 0, w: cw, h: H }, { x: cw + gap, y: 0, w: cw, h: H }];
}

/**
 * Where a photo sits in a cell. With a face, the eyes land on the same spot at
 * the same distance apart and level; without one, the photo fills the cell
 * centred. `grow` is how much it has to zoom in to cover the whole cell.
 */
function plan(img, face, cell, eyeTarget, level = true) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  let s;
  let ang = 0;
  let anchor;
  let target;
  if (face) {
    const p = face.parts;
    s = eyeTarget.dist / p.eyeDist;
    ang = level ? -p.angle : 0;
    anchor = p.eyeMid;
    target = [cell.w * 0.5, cell.h * eyeTarget.y];
  } else {
    s = Math.max(cell.w / iw, cell.h / ih);
    anchor = [iw / 2, ih / 2];
    target = [cell.w / 2, cell.h / 2];
  }
  const covers = (sc) => {
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    for (const [cx, cy] of [[0, 0], [cell.w, 0], [0, cell.h], [cell.w, cell.h]]) {
      const dx = (cx - target[0]) / sc, dy = (cy - target[1]) / sc;
      const ux = anchor[0] + dx * cos - dy * sin, uy = anchor[1] + dx * sin + dy * cos;
      if (ux < 0 || uy < 0 || ux > iw || uy > ih) return false;
    }
    return true;
  };
  if (face && !level) {
    // Same photo on both sides: zoom toward the face only while the photo
    // still fills the cell, then slide it so the face sits as close to the
    // eye line as the edges allow.
    const cover = Math.max(cell.w / iw, cell.h / ih);
    s = Math.max(cover, Math.min(s, cover * 2));
    const tx = Math.min(0, Math.max(cell.w - iw * s, target[0] - anchor[0] * s));
    const ty = Math.min(0, Math.max(cell.h - ih * s, target[1] - anchor[1] * s));
    return { s, ang: 0, anchor, target: [anchor[0] * s + tx, anchor[1] * s + ty], grow: 1 };
  }
  // Zoom in up to a third to cover the cell. Past that the face goes soft, so
  // the blurred backdrop fills what is left.
  let grow = 1;
  while (!covers(s * grow) && grow < 1.33) grow *= 1.03;
  return { s, ang, anchor, target, grow };
}

/** Renders a planned photo at up to 2x the cell so the result stays sharp. */
function cropToCell(img, cell, { s: s0, ang, anchor, target }, grow) {
  const s = s0 * grow;
  const k = Math.min(2, Math.max(1, 1 / s));
  const c = document.createElement('canvas');
  c.width = Math.round(cell.w * k);
  c.height = Math.round(cell.h * k);
  const x = c.getContext('2d');
  // Behind the photo, a blurred copy fills the cell, so a face close to the
  // edge of its photo leaves soft edges here instead of blank ones.
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const cover = Math.max(c.width / iw, c.height / ih) * 1.1;
  x.filter = `blur(${Math.round(Math.max(c.width, c.height) * 0.03)}px) brightness(0.9)`;
  x.drawImage(img, (c.width - iw * cover) / 2, (c.height - ih * cover) / 2, iw * cover, ih * cover);
  x.filter = 'none';
  const place = (ctx) => {
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(k, k);
    ctx.translate(target[0], target[1]);
    ctx.rotate(ang);
    ctx.scale(s, s);
    ctx.translate(-anchor[0], -anchor[1]);
  };
  if (grow >= 1.33) {
    // The photo runs out inside the cell: fade its edge into the backdrop.
    const top = document.createElement('canvas');
    top.width = c.width;
    top.height = c.height;
    const tx = top.getContext('2d');
    place(tx);
    tx.fillStyle = '#fff';
    tx.fillRect(0, 0, iw, ih);
    blurAlphaCanvas(top, Math.max(c.width, c.height) * 0.02);
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    place(tx);
    tx.drawImage(img, 0, 0);
    x.drawImage(top, 0, 0);
  } else {
    place(x);
    x.drawImage(img, 0, 0);
  }
  return { canvas: c, k };
}

/** A label in the bottom corner of a cell. */
function label(text, cell, anchor, colors, layerOpacity = 1) {
  const size = Math.round(Math.min(cell.w, cell.h) * 0.06);
  const margin = Math.round(Math.min(cell.w, cell.h) * 0.045);
  const g = makeBadge({ text, ...LABEL_COLORS, ...colors, opacity: 0.85, layerOpacity, size, name: `${text} label`, at: { x: anchor === 'right' ? cell.x + cell.w - margin : cell.x + margin, y: 0, anchor } });
  g.set({ top: cell.y + cell.h - g.height - margin });
  g.setCoords();
  return g;
}

/** Lays two loaded pictures into a new design. */
async function compose({ bImg, aImg, bFaces, aFaces, align, level = true, names, layout, labels, labelColors, labelOpacity = LABEL_OPACITY, name, gap, background }) {
  const L = LAYOUTS[layout] || LAYOUTS.side;
  const bothFaces = align && bFaces.length > 0 && aFaces.length > 0;
  const doc = newDoc({ name, width: L.width, height: L.height });
  doc.pages[0].background = background;
  await openDocument(doc);
  const cs = cells(layout, L.width, L.height, gap);
  const eyeTarget = { dist: Math.min(cs[0].w * 0.27, cs[0].h * 0.18), y: layout === 'stack' ? 0.42 : 0.4 };
  const plans = [plan(bImg, bothFaces ? bFaces[0] : null, cs[0], eyeTarget, level), plan(aImg, bothFaces ? aFaces[0] : null, cs[1], eyeTarget, level)];
  // Lined-up faces zoom together so they stay the same size.
  const shared = Math.max(plans[0].grow, plans[1].grow);
  const out = [];
  for (const [i, img, text] of [
    [0, bImg, labels?.[0] || names.photoNames?.[0] || 'Before'],
    [1, aImg, labels?.[1] || names.photoNames?.[1] || 'After'],
  ]) {
    const cell = cs[i];
    const crop = cropToCell(img, cell, plans[i], bothFaces ? shared : plans[i].grow);
    const blob = await new Promise((r) => crop.canvas.toBlob(r, 'image/jpeg', 0.93));
    const el = await loadImage(registerBlob(blob));
    const photo = new fabric.FabricImage(el, { uid: uid(), name: `${text} photo`, frameShape: { kind: 'rect', r: 0 }, left: cell.x, top: cell.y, scaleX: 1 / crop.k, scaleY: 1 / crop.k, sourceName: names.files[i] });
    decorate(photo);
    canvas.add(photo);
    out.push(photo);
  }
  const k = Math.max(0, Math.min(100, +labelOpacity)) / 100;
  if (labels?.[0]) canvas.add(label(labels[0], cs[0], 'left', labelColors, k));
  if (labels?.[1]) canvas.add(label(labels[1], cs[1], layout === 'stack' ? 'left' : 'right', labelColors, k));
  return { cells: cs, aligned: bothFaces, photos: out, size: [L.width, L.height] };
}

const finish = () => {
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  record(true);
};

/**
 * Makes the design. before and after are { url, name }. labels can be empty
 * to leave them off. Returns { aligned, faces: [before, after] }.
 */
export async function makeBeforeAfter({ before, after, layout = 'side', labels = ['Before', 'After'], labelColors, labelOpacity, align = true, name = 'Before and after', gap = 8, background = '#ffffff' }) {
  const [bImg, aImg] = await Promise.all([loadImage(before.url), loadImage(after.url)]);
  const [bFaces, aFaces] = align ? await Promise.all([detectFaces(bImg, { key: before.url }), detectFaces(aImg, { key: after.url })]) : [[], []];
  const r = await compose({ bImg, aImg, bFaces, aFaces, align, names: { files: [before.name, after.name] }, layout, labels, labelColors, labelOpacity, name, gap, background });
  finish();
  return { aligned: r.aligned, faces: [bFaces.length, aFaces.length], photos: r.photos, layout, size: r.size };
}

/**
 * Goal amounts at the top of the Amount slider. Kept to what a program can
 * reach, so even the full amount reads as the same person.
 */
export const GOAL_MAX = {
  slimFace: { slimFace: 32 },
  slimBody: { slimBody: 40 },
  smooth: { smooth: 35 },
  glow: { enhance: 25, smooth: 25, eyes: 30, teeth: 25 },
};
export const GOAL_DEFAULT = 40;

/** Fix amounts for a goal at `amount` (0 to 100 on the slider). */
export function goalAmounts(fixes, amount = GOAL_DEFAULT) {
  const k = Math.max(0, Math.min(100, +amount)) / 100;
  const s = { enhance: 0, smooth: 0, eyes: 0, teeth: 0, slimFace: 0, slimBody: 0 };
  for (const id of fixes) {
    if (!GOAL_MAX[id]) throw new Error(`Goals are ${Object.keys(GOAL_MAX).join(', ')}.`);
    for (const [key, v] of Object.entries(GOAL_MAX[id])) s[key] = Math.max(s[key], Math.round(v * k));
  }
  return s;
}

/** The tag on a goal preview that marks it as a simulation, at the top of the goal side. */
function simTag(cell, text, colors) {
  const size = Math.round(Math.min(cell.w, cell.h) * 0.04);
  const margin = Math.round(Math.min(cell.w, cell.h) * 0.025);
  return makeBadge({ text, ...TAG_COLORS, ...colors, size, kind: 'tag', name: 'Simulated goal tag', at: { x: cell.x + cell.w - margin, y: cell.y + margin, anchor: 'right' } });
}

/**
 * A goal preview: the photo as it is today beside a simulated goal, tagged as
 * a simulation. photo is { url, name }; fixes are slimFace, slimBody, smooth
 * and glow; amount is 0 to 100 on the goal scale, or `amounts` sets exact fix
 * amounts. The goal photo keeps its fixes editable with Fine tune.
 */
export async function makeGoalPreview({ photo, fixes = ['slimFace'], amount = GOAL_DEFAULT, amounts = null, layout = 'side', labels = ['Today', 'Goal'], labelColors, labelOpacity, tag = 'Simulated goal', tagColors, name, gap = 8, background = '#ffffff' }) {
  const { quickFix } = await import('./quickfix.js');
  const settings = { ...goalAmounts(fixes, amount), ...(amounts || {}) };
  const img = await loadImage(photo.url);
  // A body goal shows the whole photo, since zooming to the face hides the body.
  const faces = await detectFaces(img, { key: photo.url });
  const r = await compose({ bImg: img, aImg: img, bFaces: faces, aFaces: faces, align: !fixes.includes('slimBody'), level: false, names: { files: [photo.name, photo.name], photoNames: ['Today', 'Goal'] }, layout, labels, labelColors, labelOpacity, name: name || `${photo.name.replace(/\.[^.]+$/, '')} goal preview`, gap, background });
  const goal = r.photos[1];
  await quickFix(goal, fixes.includes('glow') ? ['glow'] : [], { on: true, amounts: settings, quiet: true });
  canvas.add(simTag(r.cells[1], tag || 'Simulated goal', tagColors));
  finish();
  return { faces: faces.length, fixes, amounts: settings, goal_layer: goal.uid, layout, size: r.size };
}

// ---------- Windows ----------

const SAVED = 'settings/beforeafter.json';

/** Colours and label choices from last time, so a clinic's theme sticks. */
async function remembered() {
  const { dataReadJson } = await import('./platform.js');
  const d = await dataReadJson(SAVED, {});
  return { labelColors: { ...LABEL_COLORS, ...d.labelColors }, tagColors: { ...TAG_COLORS, ...d.tagColors }, showLabels: d.showLabels !== false, labelOpacity: d.labelOpacity ?? LABEL_OPACITY };
}

async function remember(S) {
  const { dataWriteJson } = await import('./platform.js');
  await dataWriteJson(SAVED, { labelColors: S.labelColors, tagColors: S.tagColors, showLabels: S.showLabels, labelOpacity: S.labelOpacity });
}

async function parts() {
  const ui = await import('./ui.js');
  const { brandColors } = await import('./brand.js');
  const { h } = ui;
  const colorPick = (obj, key, title) => {
    const input = h('input', { type: 'color', class: 'color', title, value: obj[key], oninput: (e) => (obj[key] = e.target.value) });
    const swatches = brandColors()
      .slice(0, 5)
      .map((c) => h('button', { class: 'swatch small', title: c, style: { background: c }, onclick: () => ((obj[key] = c), (input.value = c)) }));
    return h('span', { class: 'ba-color' }, input, swatches);
  };
  const colorRow = (text, obj) => h('div', { class: 'field-row' }, h('span', { class: 'label' }, text), h('div', { class: 'ba-colors' }, h('span', { class: 'muted small' }, 'Box'), colorPick(obj, 'fill', `${text} box colour`), h('span', { class: 'muted small' }, 'Words'), colorPick(obj, 'color', `${text} word colour`)));
  const labelsRow = (S) => {
    const fields = h('div', { class: 'ba-labels' }, [0, 1].map((i) => h('input', { class: 'field', value: S.labels[i], disabled: !S.showLabels, oninput: (e) => (S.labels[i] = e.target.value) })));
    return h(
      'div',
      { class: 'stack' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.showLabels, onchange: (e) => ((S.showLabels = e.target.checked), [...fields.children].forEach((f) => (f.disabled = !S.showLabels))) }), 'Show labels'),
      fields,
      ui.rangeField('Label opacity', S.labelOpacity, (v) => (S.labelOpacity = v), { min: 0, max: 100 }),
    );
  };
  const segOf = (S, key, opts, cols) => {
    const el = h(
      'div',
      { class: 'seg ba-seg', style: cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : null },
      opts.map(([id, text, title]) => h('button', { class: id === S[key] ? 'on' : '', title: title || '', onclick: (e) => ((S[key] = id), [...el.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget))) }, text)),
    );
    return el;
  };
  const layoutSeg = (S) => segOf(S, 'layout', Object.entries(LAYOUTS).map(([id, l]) => [id, l.short, `${l.label}, ${l.width} × ${l.height}`]));
  const pickBox = (S, key, title, pickPhoto) => {
    const nameEl = h('span', { class: 'ba-file' }, 'None picked');
    const b = h(
      'button',
      {
        class: 'ba-pick',
        onclick: async () => {
          const f = await pickPhoto();
          if (!f) return;
          S[key] = f;
          nameEl.textContent = f.name;
          b.classList.add('picked');
        },
      },
      h('strong', {}, title),
      nameEl,
    );
    return b;
  };
  return { ...ui, colorRow, labelsRow, layoutSeg, pickBox };
}

/** The Before and after window: pick two photos, a layout and the labels. */
export async function beforeAfterDialog({ pickPhoto, confirmDiscard }) {
  const { h, modal, toast, colorRow, labelsRow, layoutSeg, pickBox } = await parts();
  const S = { before: null, after: null, layout: 'side', labels: ['Before', 'After'], align: true, ...(await remembered()) };
  const body = h(
    'div',
    { class: 'stack gap ba-dialog' },
    h('div', { class: 'ba-picks' }, pickBox(S, 'before', 'Before photo', pickPhoto), pickBox(S, 'after', 'After photo', pickPhoto)),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Layout'), layoutSeg(S)),
    labelsRow(S),
    colorRow('Labels', S.labelColors),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (S.align = e.target.checked) }), 'Line up the faces'),
    h('p', { class: 'muted small' }, 'Both faces are matched for size, angle and place, so the only difference left is the result.'),
  );
  const ok = await modal('Before and after', body, [
    { label: 'Cancel', value: false },
    { label: 'Create', value: true, primary: true },
  ]);
  if (!ok) return;
  if (!S.before || !S.after) return toast('Pick a before photo and an after photo.', { error: true });
  if (!(await confirmDiscard())) return;
  await remember(S);
  const note = toast('Lining up the faces', { sticky: true });
  try {
    const r = await makeBeforeAfter({ before: S.before, after: S.after, layout: S.layout, labels: S.showLabels ? S.labels : [], labelColors: S.labelColors, labelOpacity: S.labelOpacity, align: S.align });
    toast(r.aligned || !S.align ? 'Before and after made.' : `No face found in the ${r.faces[0] ? 'after' : 'before'} photo, so both are centred instead.`);
  } finally {
    note.done();
  }
}

/** The Goal preview window: one photo, which goals, how far. */
export async function goalPreviewDialog({ pickPhoto, confirmDiscard }) {
  const { h, modal, toast, rangeField, colorRow, labelsRow, layoutSeg, pickBox } = await parts();
  const { PRESETS } = await import('./beauty.js');
  const S = { photo: null, fixes: new Set(['slimFace']), amount: GOAL_DEFAULT, layout: 'side', labels: ['Today', 'Goal'], ...(await remembered()) };
  const chips = h(
    'div',
    { class: 'fix-grid' },
    Object.keys(GOAL_MAX).map((id) =>
      h('button', { class: 'fix-chip' + (S.fixes.has(id) ? ' on' : ''), onclick: (e) => (S.fixes.has(id) ? S.fixes.delete(id) : S.fixes.add(id), e.currentTarget.classList.toggle('on', S.fixes.has(id))) }, PRESETS[id].label),
    ),
  );
  const body = h(
    'div',
    { class: 'stack gap ba-dialog' },
    pickBox(S, 'photo', 'Patient photo', pickPhoto),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Goal'), chips),
    rangeField('Amount', S.amount, (v) => (S.amount = v), { min: 0, max: 100 }),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Layout'), layoutSeg(S)),
    labelsRow(S),
    colorRow('Labels', S.labelColors),
    colorRow('Tag', S.tagColors),
    h('p', { class: 'muted small' }, 'Even 100 stays within what a program can reach. Select the goal photo afterwards to fine tune each fix. The Simulated goal tag and the labels are layers you can drag anywhere.'),
  );
  const ok = await modal('Goal preview', body, [
    { label: 'Cancel', value: false },
    { label: 'Create', value: true, primary: true },
  ]);
  if (!ok) return;
  if (!S.photo) return toast('Pick the patient photo.', { error: true });
  if (!S.fixes.size) return toast('Pick at least one goal.', { error: true });
  if (!(await confirmDiscard())) return;
  await remember(S);
  const note = toast('Making the goal', { sticky: true });
  try {
    const r = await makeGoalPreview({ photo: S.photo, fixes: [...S.fixes], amount: S.amount, layout: S.layout, labels: S.showLabels ? S.labels : [], labelColors: S.labelColors, labelOpacity: S.labelOpacity, tagColors: S.tagColors });
    toast(r.faces || !S.fixes.has('slimFace') ? 'Goal preview made.' : 'No face found, so only the body and colour goals ran.');
  } catch (e) {
    toast(e.message || String(e), { error: true });
  } finally {
    note.done();
  }
}
