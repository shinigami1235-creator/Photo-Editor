// Before and after from two photos: a new design with the photos side by side
// or stacked, faces lined up at the same size, angle and place, and labels.

import { canvas, fabric, decorate } from './canvas.js';
import { state, newDoc, uid } from './state.js';
import { record } from './history.js';
import { openDocument } from './pages.js';
import { loadImage, registerBlob } from './assets.js';
import { brandFont } from './brand.js';
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

function label(text, cell, align) {
  const size = Math.round(Math.min(cell.w, cell.h) * 0.065);
  const t = new fabric.Textbox(text.toUpperCase(), {
    uid: uid(),
    name: `${text} label`,
    fontFamily: brandFont('heading') || 'Arial',
    fontWeight: 'bold',
    fontSize: size,
    charSpacing: 180,
    fill: '#ffffff',
    textAlign: 'center',
    width: size * (text.length * 0.95 + 1.6),
  });
  t.initDimensions();
  const padX = size * 0.7;
  const padY = size * 0.35;
  const bg = new fabric.Rect({ left: 0, top: 0, width: t.width + padX * 2, height: t.height + padY * 2, rx: size * 0.3, ry: size * 0.3, fill: '#101c2b', opacity: 0.82 });
  t.set({ left: padX, top: padY });
  const g = new fabric.Group([bg, t], { uid: uid(), name: `${text} label` });
  const margin = Math.round(Math.min(cell.w, cell.h) * 0.045);
  g.set({ left: align === 'right' ? cell.x + cell.w - g.width - margin : cell.x + margin, top: cell.y + cell.h - g.height - margin });
  g.setCoords();
  decorate(g);
  return g;
}

/** Lays two loaded pictures into a new design. */
async function compose({ bImg, aImg, bFaces, aFaces, align, level = true, names, layout, labels, name, gap, background }) {
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
    [0, bImg, labels[0] || 'Before'],
    [1, aImg, labels[1] || 'After'],
  ]) {
    const cell = cs[i];
    const crop = cropToCell(img, cell, plans[i], bothFaces ? shared : plans[i].grow);
    const blob = await new Promise((r) => crop.canvas.toBlob(r, 'image/jpeg', 0.93));
    const el = await loadImage(registerBlob(blob));
    const photo = new fabric.FabricImage(el, { uid: uid(), name: `${text} photo`, frameShape: { kind: 'rect', r: 0 }, left: cell.x, top: cell.y, scaleX: 1 / crop.k, scaleY: 1 / crop.k, sourceName: names[i] });
    decorate(photo);
    canvas.add(photo);
    out.push(photo);
  }
  if (labels[0]) canvas.add(label(labels[0], cs[0], 'left'));
  if (labels[1]) canvas.add(label(labels[1], cs[1], layout === 'stack' ? 'left' : 'right'));
  return { cells: cs, aligned: bothFaces, photos: out, size: [L.width, L.height] };
}

const finish = () => {
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  record(true);
};

/**
 * Makes the design. before and after are { url, name }. Returns
 * { aligned, faces: [before, after] } where faces counts the faces found.
 */
export async function makeBeforeAfter({ before, after, layout = 'side', labels = ['Before', 'After'], align = true, name = 'Before and after', gap = 8, background = '#ffffff' }) {
  const [bImg, aImg] = await Promise.all([loadImage(before.url), loadImage(after.url)]);
  const [bFaces, aFaces] = align ? await Promise.all([detectFaces(bImg, { key: before.url }), detectFaces(aImg, { key: after.url })]) : [[], []];
  const r = await compose({ bImg, aImg, bFaces, aFaces, align, names: [before.name, after.name], layout, labels, name, gap, background });
  finish();
  return { aligned: r.aligned, faces: [bFaces.length, aFaces.length], photos: r.photos, layout, size: r.size };
}

// How far a goal preview pushes the one-click amounts.
export const STRENGTHS = { light: 0.7, medium: 1.2, strong: 1.7 };

/** The gold tag on a goal preview that marks it as a simulation. */
function simTag(cell, text = 'Simulated goal') {
  const size = Math.round(Math.min(cell.w, cell.h) * 0.042);
  const t = new fabric.Textbox(text.toUpperCase(), { fontFamily: brandFont('heading') || 'Arial', fontWeight: 'bold', fontSize: size, charSpacing: 160, fill: '#101c2b', textAlign: 'center', width: size * (text.length * 0.95 + 1.6) });
  t.initDimensions();
  const padX = size * 0.8;
  const padY = size * 0.4;
  const bg = new fabric.Rect({ left: 0, top: 0, width: t.width + padX * 2, height: t.height + padY * 2, rx: size * 0.4, ry: size * 0.4, fill: '#e0b45a' });
  t.set({ left: padX, top: padY });
  const g = new fabric.Group([bg, t], { uid: uid(), name: 'Simulated goal tag' });
  const margin = Math.round(Math.min(cell.w, cell.h) * 0.045);
  g.set({ left: cell.x + cell.w - g.width - margin, top: cell.y + margin });
  g.setCoords();
  decorate(g);
  return g;
}

/**
 * A goal preview: the photo as it is today beside a simulated goal with the
 * chosen fixes applied, tagged as a simulation. photo is { url, name };
 * fixes are Quick fixes ids. Returns { faces, fixes, amounts }.
 */
export async function makeGoalPreview({ photo, fixes = ['slimFace', 'slimBody'], amounts = null, strength = 'medium', layout = 'side', labels = ['Today', 'Goal'], name, tag = 'Simulated goal', gap = 8, background = '#ffffff', say }) {
  const { renderLook, settingsFor } = await import('./quickfix.js');
  const img = await loadImage(photo.url);
  const settings = settingsFor(fixes, amounts, STRENGTHS[strength] || 1);
  const goal = await renderLook(img, fixes, settings, { key: photo.url, say });
  // The eyes stay where they were, so the faces from the original line both up.
  // A body goal shows the whole photo, since zooming to the face hides the body.
  const faces = await detectFaces(img, { key: photo.url });
  const r = await compose({ bImg: img, aImg: goal.canvas, bFaces: faces, aFaces: faces, align: !fixes.includes('slimBody'), level: false, names: [photo.name, photo.name], layout, labels, name: name || `${photo.name.replace(/\.[^.]+$/, '')} goal preview`, gap, background });
  canvas.add(simTag(r.cells[1], tag || 'Simulated goal'));
  finish();
  return { faces: faces.length, fixes, amounts: settings, layout, size: r.size };
}

/** The Before and after window: pick two photos, a layout and the labels. */
export async function beforeAfterDialog({ pickPhoto, confirmDiscard }) {
  const { h, modal, toast } = await import('./ui.js');
  const S = { before: null, after: null, layout: 'side', labels: ['Before', 'After'], align: true };
  const pickBox = (which, title) => {
    const nameEl = h('span', { class: 'ba-file' }, 'None picked');
    return h('button', { class: 'ba-pick', onclick: () => pick(which, nameEl) }, h('strong', {}, title), nameEl);
  };
  const pick = async (which, el) => {
    const f = await pickPhoto();
    if (!f) return;
    S[which] = f;
    el.textContent = f.name;
    el.parentElement.classList.add('picked');
  };
  const seg = h(
    'div',
    { class: 'seg ba-seg' },
    Object.entries(LAYOUTS).map(([id, l]) =>
      h('button', { class: id === S.layout ? 'on' : '', title: `${l.label}, ${l.width} × ${l.height}`, onclick: (e) => ((S.layout = id), [...seg.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget))) }, l.short),
    ),
  );
  const field = (i) => h('input', { class: 'field', value: S.labels[i], oninput: (e) => (S.labels[i] = e.target.value) });
  const body = h(
    'div',
    { class: 'stack gap ba-dialog' },
    h('div', { class: 'ba-picks' }, pickBox('before', 'Before photo'), pickBox('after', 'After photo')),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Layout'), seg),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Labels'), h('div', { class: 'ba-labels' }, field(0), field(1))),
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
  const note = toast('Lining up the faces', { sticky: true });
  try {
    const r = await makeBeforeAfter({ before: S.before, after: S.after, layout: S.layout, labels: S.labels, align: S.align });
    toast(r.aligned || !S.align ? 'Before and after made.' : `No face found in the ${r.faces[0] ? 'after' : 'before'} photo, so both are centred instead.`);
  } finally {
    note.done();
  }
}

/** The Goal preview window: one photo, which fixes, how strong. */
export async function goalPreviewDialog({ pickPhoto, confirmDiscard }) {
  const { h, modal, toast } = await import('./ui.js');
  const { PRESETS } = await import('./beauty.js');
  const S = { photo: null, fixes: new Set(['slimFace', 'slimBody']), strength: 'medium', layout: 'side', labels: ['Today', 'Goal'] };
  const nameEl = h('span', { class: 'ba-file' }, 'None picked');
  const pickBtn = h(
    'button',
    {
      class: 'ba-pick',
      onclick: async () => {
        const f = await pickPhoto();
        if (!f) return;
        S.photo = f;
        nameEl.textContent = f.name;
        pickBtn.classList.add('picked');
      },
    },
    h('strong', {}, 'Patient photo'),
    nameEl,
  );
  const chips = h(
    'div',
    { class: 'fix-grid' },
    ['slimFace', 'slimBody', 'smooth', 'glow'].map((id) =>
      h('button', { class: 'fix-chip' + (S.fixes.has(id) ? ' on' : ''), onclick: (e) => (S.fixes.has(id) ? S.fixes.delete(id) : S.fixes.add(id), e.currentTarget.classList.toggle('on', S.fixes.has(id))) }, PRESETS[id].label),
    ),
  );
  const segOf = (opts, key) => {
    const el = h(
      'div',
      { class: 'seg ba-seg' },
      opts.map(([id, text]) => h('button', { class: id === S[key] ? 'on' : '', onclick: (e) => ((S[key] = id), [...el.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget))) }, text)),
    );
    return el;
  };
  const strength = segOf([['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']], 'strength');
  strength.style.gridTemplateColumns = '1fr 1fr 1fr';
  const layout = segOf(Object.entries(LAYOUTS).map(([id, l]) => [id, l.short]), 'layout');
  const field = (i) => h('input', { class: 'field', value: S.labels[i], oninput: (e) => (S.labels[i] = e.target.value) });
  const body = h(
    'div',
    { class: 'stack gap ba-dialog' },
    pickBtn,
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Goal'), chips),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Strength'), strength),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Layout'), layout),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Labels'), h('div', { class: 'ba-labels' }, field(0), field(1))),
    h('p', { class: 'muted small' }, 'The goal side carries a Simulated goal tag, since it shows what the program aims for and not a result yet.'),
  );
  const ok = await modal('Goal preview', body, [
    { label: 'Cancel', value: false },
    { label: 'Create', value: true, primary: true },
  ]);
  if (!ok) return;
  if (!S.photo) return toast('Pick the patient photo.', { error: true });
  if (!S.fixes.size) return toast('Pick at least one goal.', { error: true });
  if (!(await confirmDiscard())) return;
  const note = toast('Making the goal', { sticky: true });
  try {
    const r = await makeGoalPreview({ photo: S.photo, fixes: [...S.fixes], strength: S.strength, layout: S.layout, labels: S.labels, say: (t, f) => (note.text(t), f != null && note.progress(f)) });
    toast(r.faces ? 'Goal preview made.' : 'No face found, so only Slim body and colour ran.');
  } catch (e) {
    toast(e.message || String(e), { error: true });
  } finally {
    note.done();
  }
}
