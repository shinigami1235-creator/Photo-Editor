// Before and after from two photos: a new design with the photos side by side
// or stacked, faces lined up at the same size, angle and place, and labels.

import { canvas, fabric, decorate } from './canvas.js';
import { newDoc, uid, emit } from './state.js';
import { record } from './history.js';
import { openDocument } from './pages.js';
import { loadImage, registerBlob } from './assets.js';
import { makeBadge, setBadgeSize, LABEL_COLORS, TAG_COLORS } from './badge.js';
import { defaults, saveDefaults } from './defaults.js';
import { state } from './state.js';
import { isPhoto } from './frames.js';

export const LABEL_OPACITY = 0;
import { detectFaces, similarity, invert } from './faces.js';
import { detectPose, BODY_POINTS } from './pose.js';
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
function cropToCell(img, cell, { s: s0, ang, anchor, target, feather = false }, grow) {
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
  if (grow >= 1.33 || feather) {
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
function label(text, cell, anchor, colors, layerOpacity = 1, sizePct = 100) {
  const size = Math.round(Math.min(cell.w, cell.h) * 0.06);
  const margin = Math.round(Math.min(cell.w, cell.h) * 0.045);
  const g = makeBadge({ text, ...LABEL_COLORS, ...colors, opacity: 0.85, layerOpacity, size, name: `${text} label`, at: { x: anchor === 'right' ? cell.x + cell.w - margin : cell.x + margin, y: 0, anchor } });
  g.set({ top: cell.y + cell.h - g.height - margin });
  g.setCoords();
  if (sizePct !== 100) setBadgeSize(g, sizePct);
  return g;
}

const MIN_SCORE = 0.3;

/** Body points both photos found, as [beforePoints, afterPoints]. */
function sharedBodyPoints(bPose, aPose) {
  const b = [];
  const a = [];
  for (const i of BODY_POINTS) {
    if (bPose[i].score >= MIN_SCORE && aPose[i].score >= MIN_SCORE) {
      b.push([bPose[i].x, bPose[i].y]);
      a.push([aPose[i].x, aPose[i].y]);
    }
  }
  return [b, a];
}

/**
 * Lines the after body up with the before body. The before photo fills its
 * cell as shot; the after is moved, scaled and turned so its shoulders, elbows,
 * hips and knees land where the before's do. Returns null when the two
 * disagree too much to trust (a wrong point, or a very different pose).
 */
function bodyPlans(bImg, aImg, bPts, aPts, cells) {
  const pb = plan(bImg, null, cells[0], null);
  const dst = bPts.map(([x, y]) => [(x - pb.anchor[0]) * pb.s * pb.grow + pb.target[0], (y - pb.anchor[1]) * pb.s * pb.grow + pb.target[1]]);
  const m = similarity(aPts, dst);
  const s = Math.hypot(m[0], m[1]);
  const ang = Math.atan2(m[1], m[0]);
  const nb = Math.hypot(bImg.naturalWidth || bImg.width, bImg.naturalHeight || bImg.height);
  const na = Math.hypot(aImg.naturalWidth || aImg.width, aImg.naturalHeight || aImg.height);
  // Relative to picture size, the bodies should be within 2x of each other and turned under 15 degrees.
  const rel = (s / (pb.s * pb.grow)) * (na / nb);
  if (!(rel > 0.5 && rel < 2) || Math.abs(ang) > (15 * Math.PI) / 180) return null;
  const inv = invert(m);
  const iw = aImg.naturalWidth || aImg.width;
  const ih = aImg.naturalHeight || aImg.height;
  const cell = cells[1];
  const covers = [[0, 0], [cell.w, 0], [0, cell.h], [cell.w, cell.h]].every(([x, y]) => {
    const u = inv[0] * x - inv[1] * y + inv[2];
    const v = inv[1] * x + inv[0] * y + inv[3];
    return u >= 0 && v >= 0 && u <= iw && v <= ih;
  });
  return [pb, { s, ang, anchor: [0, 0], target: [m[2], m[3]], grow: 1, feather: !covers }];
}

/** Lays two loaded pictures into a new design. */
async function compose({ bImg, aImg, bFaces, aFaces, align, level = true, bodies = null, names, layout, labels, labelColors, labelOpacity = LABEL_OPACITY, labelSize = 100, name, gap, background }) {
  const L = LAYOUTS[layout] || LAYOUTS.side;
  const bothFaces = !bodies && align && bFaces.length > 0 && aFaces.length > 0;
  const doc = newDoc({ name, width: L.width, height: L.height });
  doc.pages[0].background = background;
  await openDocument(doc);
  const cs = cells(layout, L.width, L.height, gap);
  const eyeTarget = { dist: Math.min(cs[0].w * 0.27, cs[0].h * 0.18), y: layout === 'stack' ? 0.42 : 0.4 };
  const bodyPlan = bodies ? bodyPlans(bImg, aImg, bodies[0], bodies[1], cs) : null;
  const plans = bodyPlan || [plan(bImg, bothFaces ? bFaces[0] : null, cs[0], eyeTarget, level), plan(aImg, bothFaces ? aFaces[0] : null, cs[1], eyeTarget, level)];
  // Lined-up faces zoom together so they stay the same size.
  const shared = bodyPlan ? 1 : Math.max(plans[0].grow, plans[1].grow);
  const out = [];
  for (const [i, img, text] of [
    [0, bImg, labels?.[0] || names.photoNames?.[0] || 'Before'],
    [1, aImg, labels?.[1] || names.photoNames?.[1] || 'After'],
  ]) {
    const cell = cs[i];
    const crop = cropToCell(img, cell, plans[i], bothFaces || bodyPlan ? shared : plans[i].grow);
    const blob = await new Promise((r) => crop.canvas.toBlob(r, 'image/jpeg', 0.93));
    const el = await loadImage(registerBlob(blob));
    const photo = new fabric.FabricImage(el, { uid: uid(), name: `${text} photo`, frameShape: { kind: 'rect', r: 0 }, left: cell.x, top: cell.y, scaleX: 1 / crop.k, scaleY: 1 / crop.k, sourceName: names.files[i] });
    decorate(photo);
    canvas.add(photo);
    out.push(photo);
  }
  const k = Math.max(0, Math.min(100, +labelOpacity)) / 100;
  if (labels?.[0]) canvas.add(label(labels[0], cs[0], 'left', labelColors, k, labelSize));
  if (labels?.[1]) canvas.add(label(labels[1], cs[1], layout === 'stack' ? 'left' : 'right', labelColors, k, labelSize));
  return { cells: cs, aligned: bodyPlan ? 'body' : bothFaces ? 'face' : false, photos: out, size: [L.width, L.height] };
}

/** Label settings, with the saved defaults filling anything left out. */
function labelLook({ labelColors, labelOpacity, labelSize }) {
  const L = defaults('labels');
  return { labelColors: labelColors || { fill: L.fill, color: L.color }, labelOpacity: labelOpacity ?? L.opacity, labelSize: labelSize ?? L.size };
}

function tagLook({ tag, tagColors, tagSize }) {
  const T = defaults('tag');
  return { tag: tag || T.text, tagColors: tagColors || { fill: T.fill, color: T.color }, tagSize: tagSize ?? T.size };
}

const finish = () => {
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  record(true);
  emit('objects');
};

/**
 * Makes the design. before and after are { url, name }. labels can be empty
 * to leave them off. Returns { aligned, faces: [before, after] }.
 */
export async function makeBeforeAfter({ before, after, layout = 'side', labels = ['Before', 'After'], labelColors, labelOpacity, labelSize, align = 'auto', name = 'Before and after', gap = 8, background = '#ffffff' }) {
  ({ labelColors, labelOpacity, labelSize } = labelLook({ labelColors, labelOpacity, labelSize }));
  align = align === true ? 'auto' : align || 'off';
  const [bImg, aImg] = await Promise.all([loadImage(before.url), loadImage(after.url)]);
  const [bFaces, aFaces] = align === 'off' || align === 'body' ? [[], []] : await Promise.all([detectFaces(bImg, { key: before.url }), detectFaces(aImg, { key: after.url })]);
  // A face that fills a good part of the photo means a face shot; otherwise
  // it's a body shot (or the head is cropped out) and the body lines them up.
  const bigFace = (f, img) => f.length > 0 && f[0].box.h / (img.naturalHeight || img.height) >= 0.2;
  const faceShot = bigFace(bFaces, bImg) && bigFace(aFaces, aImg);
  let bodies = null;
  if (align === 'body' || (align === 'auto' && !faceShot)) {
    const [bPose, aPose] = await Promise.all([detectPose(bImg, { key: before.url }), detectPose(aImg, { key: after.url })]);
    const [bp, ap] = sharedBodyPoints(bPose, aPose);
    if (bp.length >= 3) bodies = [bp, ap];
  }
  const useFaces = align === 'face' || (align === 'auto' && !bodies);
  const r = await compose({ bImg, aImg, bFaces: useFaces ? bFaces : [], aFaces: useFaces ? aFaces : [], align: useFaces, bodies, names: { files: [before.name, after.name] }, layout, labels, labelColors, labelOpacity, labelSize, name, gap, background });
  finish();
  return { aligned: r.aligned, faces: [bFaces.length, aFaces.length], body_points: bodies ? bodies[0].length : 0, photos: r.photos, layout, size: r.size };
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

/** The tag that marks a touched-up photo as a simulation, top right of `box`. */
function simTag(box, text, colors, sizePct = 100, photoId = null) {
  // The same share of the photo's width whatever its shape, so a wide photo
  // doesn't get a huge tag and a narrow one a tiny one.
  const size = Math.max(10, Math.round(Math.min(box.w * 0.026, box.h * 0.035)));
  const margin = Math.round(Math.min(box.w, box.h) * 0.025);
  const g = makeBadge({ text, ...TAG_COLORS, ...colors, size, kind: 'tag', name: 'Simulated goal tag', at: { x: box.x + box.w - margin, y: box.y + margin, anchor: 'right' } });
  g.badge.photo = photoId;
  if (sizePct !== 100) setBadgeSize(g, sizePct);
  return g;
}

/** The part of a layer that shows on the page. */
function visibleBox(o) {
  const b = o.getBoundingRect();
  const x = Math.max(0, b.left);
  const y = Math.max(0, b.top);
  return { x, y, w: Math.min(state.doc.width, b.left + b.width) - x, h: Math.min(state.doc.height, b.top + b.height) - y };
}

/**
 * Touches up a photo already on the page. The fixes stay live for Fine tune,
 * and the Simulated goal tag goes on the photo unless it already has one.
 */
export async function touchUpLayer(o, { fixes, amount, amounts = null, tag, tagColors, tagSize } = {}) {
  const { quickFix } = await import('./quickfix.js');
  const D = defaults('touchUp');
  fixes = fixes || D.fixes;
  const settings = { ...goalAmounts(fixes, amount ?? D.amount), ...(amounts || {}) };
  ({ tag, tagColors, tagSize } = tagLook({ tag, tagColors, tagSize }));
  const r = await quickFix(o, fixes.includes('glow') ? ['glow'] : [], { on: true, amounts: settings, quiet: true });
  if (!canvas.getObjects().some((t) => t.badge?.kind === 'tag' && t.badge.photo === o.uid)) canvas.add(simTag(visibleBox(o), tag, tagColors, tagSize, o.uid));
  finish();
  return { faces: r.faces, fixes, amounts: settings, layer: o.uid };
}

/**
 * Touch up side by side: the photo as it is today beside a touched-up copy,
 * as a new design. photo is { url, name }; fixes are slimFace, slimBody,
 * smooth and glow; amount is 0 to 100 on the goal scale.
 */
export async function makeTouchUpPair({ photo, fixes, amount, amounts = null, layout, labels, labelColors, labelOpacity, labelSize, tag, tagColors, tagSize, name, gap = 8, background = '#ffffff' }) {
  const { quickFix } = await import('./quickfix.js');
  const D = defaults('touchUp');
  fixes = fixes || D.fixes;
  layout = layout || D.layout;
  labels = labels || D.labels;
  ({ labelColors, labelOpacity, labelSize } = labelLook({ labelColors, labelOpacity, labelSize }));
  ({ tag, tagColors, tagSize } = tagLook({ tag, tagColors, tagSize }));
  const settings = { ...goalAmounts(fixes, amount ?? D.amount), ...(amounts || {}) };
  const img = await loadImage(photo.url);
  // A body goal shows the whole photo, since zooming to the face hides the body.
  const faces = await detectFaces(img, { key: photo.url });
  const r = await compose({ bImg: img, aImg: img, bFaces: faces, aFaces: faces, align: !fixes.includes('slimBody'), level: false, names: { files: [photo.name, photo.name], photoNames: ['Original', 'Touched up'] }, layout, labels, labelColors, labelOpacity, labelSize, name: name || `${photo.name.replace(/\.[^.]+$/, '')} touch up`, gap, background });
  const goal = r.photos[1];
  await quickFix(goal, fixes.includes('glow') ? ['glow'] : [], { on: true, amounts: settings, quiet: true });
  canvas.add(simTag(r.cells[1], tag, tagColors, tagSize, goal.uid));
  finish();
  return { faces: faces.length, fixes, amounts: settings, goal_layer: goal.uid, layout, size: r.size };
}

export const makeGoalPreview = makeTouchUpPair;

/** What happened with lining up, for the status bar. */
export function alignMessage(r, align) {
  if (r.aligned === 'face') return 'Lined up by the faces.';
  if (r.aligned === 'body') return `Lined up by the body (${r.body_points} points matched).`;
  if (align === 'off') return 'Before and after made.';
  return 'No face or body points matched in both photos, so each is centred as shot.';
}

// ---------- Windows ----------

/** Window state from the saved defaults. */
function startState(kind) {
  const L = defaults('labels');
  const T = defaults('tag');
  return {
    ...defaults(kind),
    showLabels: L.show,
    labelOpacity: L.opacity,
    labelSize: L.size,
    labelColors: { fill: L.fill, color: L.color },
    tagColors: { fill: T.fill, color: T.color },
    tagSize: T.size,
    tagText: T.text,
  };
}

const saveLabels = (S) => saveDefaults('labels', { show: S.showLabels, opacity: S.labelOpacity, size: S.labelSize, ...S.labelColors });
const saveTag = (S) => saveDefaults('tag', { size: S.tagSize, ...S.tagColors });

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
      ui.rangeField('Label size', S.labelSize, (v) => (S.labelSize = v), { min: 30, max: 150, suffix: '%' }),
      colorRow('Labels', S.labelColors),
    );
  };
  const segOf = (S, key, opts) => {
    const el = h(
      'div',
      { class: 'seg ba-seg' },
      opts.map(([id, text, title]) => h('button', { class: id === S[key] ? 'on' : '', title: title || '', onclick: (e) => ((S[key] = id), [...el.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)), S.onChange?.()) }, text)),
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
  const saveButton = (save) =>
    h('button', {
      class: 'btn small ba-save',
      onclick: async () => {
        await save();
        ui.toast('Saved as default. New files start from these settings.');
      },
    }, 'Save as default');
  return { ...ui, colorRow, labelsRow, layoutSeg, segOf, pickBox, saveButton };
}

/** The Before and after window: pick two photos, a layout and the labels. */
export async function beforeAfterDialog({ pickPhoto, confirmDiscard }) {
  const { h, modal, toast, labelsRow, layoutSeg, segOf, pickBox, saveButton } = await parts();
  const S = { before: null, after: null, ...startState('beforeAfter') };
  S.align = S.align === true ? 'auto' : S.align || 'off';
  const body = h(
    'div',
    { class: 'stack gap ba-dialog' },
    h('div', { class: 'ba-picks' }, pickBox(S, 'before', 'Before photo', pickPhoto), pickBox(S, 'after', 'After photo', pickPhoto)),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Layout'), layoutSeg(S)),
    labelsRow(S),
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Line up'), segOf(S, 'align', [['auto', 'Auto', 'Faces for face shots, bodies for body shots'], ['face', 'Faces', 'By the eyes'], ['body', 'Bodies', 'By the shoulders, elbows, hips and knees'], ['off', 'Off', 'Each photo centred as shot']])),
    h('p', { class: 'muted small' }, 'Face shots line up by the eyes. Body shots, with or without the head, line up by the shoulders, elbows, hips and knees, with the after matched to how the before was framed.'),
    saveButton(async () => {
      await saveDefaults('beforeAfter', { layout: S.layout, labels: S.labels, align: S.align });
      await saveLabels(S);
    }),
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
    const r = await makeBeforeAfter({ before: S.before, after: S.after, layout: S.layout, labels: S.showLabels ? S.labels : [], labelColors: S.labelColors, labelOpacity: S.labelOpacity, labelSize: S.labelSize, align: S.align });
    toast(alignMessage(r, S.align));
  } finally {
    note.done();
  }
}

/** Photos on the current page, in stacking order. */
export const pagePhotos = () => canvas.getObjects().filter((o) => isPhoto(o) && !o.isAdjustment);

/**
 * The Touch up window. With photos on the page it works on the one picked
 * there; with one photo it can also put the original beside it; with none it
 * asks for a picture.
 */
export async function touchUpDialog({ pickPhoto, confirmDiscard, target = null }) {
  const { h, modal, toast, rangeField, labelsRow, layoutSeg, segOf, pickBox, colorRow, saveButton } = await parts();
  const { PRESETS } = await import('./beauty.js');
  const photos = state.doc ? pagePhotos() : [];
  const S = { photo: null, ...startState('touchUp') };
  S.fixes = new Set(S.fixes);
  S.target = (target && photos.includes(target) ? target : photos[photos.length - 1])?.uid || null;
  const chips = h(
    'div',
    { class: 'fix-grid' },
    Object.keys(GOAL_MAX).map((id) =>
      h('button', { class: 'fix-chip' + (S.fixes.has(id) ? ' on' : ''), onclick: (e) => (S.fixes.has(id) ? S.fixes.delete(id) : S.fixes.add(id), e.currentTarget.classList.toggle('on', S.fixes.has(id))) }, PRESETS[id].label),
    ),
  );
  const pairBits = h('div', { class: 'stack gap ba-pair' }, h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Layout'), layoutSeg(S)), labelsRow(S));
  const sideBySide = () => !photos.length || (photos.length === 1 && S.sideBySide);
  const sync = () => (pairBits.hidden = !sideBySide());
  let source;
  if (!photos.length) source = pickBox(S, 'photo', 'Patient photo', pickPhoto);
  else if (photos.length === 1)
    source = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.sideBySide, onchange: (e) => ((S.sideBySide = e.target.checked), sync()) }), 'Keep the original beside it');
  else
    source = h(
      'div',
      { class: 'field-row' },
      h('span', { class: 'label' }, 'Photo'),
      segOf(S, 'target', photos.map((o, i) => [o.uid, o.name || `Photo ${i + 1}`])),
    );
  sync();
  const body = h(
    'div',
    { class: 'stack gap ba-dialog' },
    source,
    h('div', { class: 'field-row' }, h('span', { class: 'label' }, 'Touch up'), chips),
    rangeField('Amount', S.amount, (v) => (S.amount = v), { min: 0, max: 100 }),
    pairBits,
    colorRow('Tag', S.tagColors),
    rangeField('Tag size', S.tagSize, (v) => (S.tagSize = v), { min: 30, max: 150, suffix: '%' }),
    h('p', { class: 'muted small' }, 'Even 100 stays within what a program can reach. Select the photo afterwards to fine tune each fix. The Simulated goal tag and the labels are layers you can drag anywhere.'),
    saveButton(async () => {
      await saveDefaults('touchUp', { fixes: [...S.fixes], amount: S.amount, sideBySide: S.sideBySide, layout: S.layout, labels: S.labels });
      await saveLabels(S);
      await saveTag(S);
    }),
  );
  const ok = await modal('Touch up', body, [
    { label: 'Cancel', value: false },
    { label: 'Apply', value: true, primary: true },
  ]);
  if (!ok) return;
  if (!S.fixes.size) return toast('Pick at least one touch up.', { error: true });
  const opts = { fixes: [...S.fixes], amount: S.amount, tagColors: S.tagColors, tagSize: S.tagSize };
  const pair = { layout: S.layout, labels: S.showLabels ? S.labels : [], labelColors: S.labelColors, labelOpacity: S.labelOpacity, labelSize: S.labelSize };
  let photo = S.photo;
  if (!photos.length && !photo) return toast('Pick the patient photo.', { error: true });
  if (sideBySide()) {
    if (photos.length === 1) {
      const o = photos[0];
      photo = { url: o.beautyBase || o.getSrc(), name: o.sourceName || o.name || 'Photo' };
    }
    if (!(await confirmDiscard())) return;
  }
  const note = toast('Touching up', { sticky: true });
  try {
    const r = sideBySide() ? await makeTouchUpPair({ photo, ...opts, ...pair }) : await touchUpLayer(photos.find((o) => o.uid === S.target), opts);
    toast(r.faces || !S.fixes.has('slimFace') ? 'Touched up.' : 'No face found, so only the body and colour touch ups ran.');
  } catch (e) {
    toast(e.message || String(e), { error: true });
  } finally {
    note.done();
  }
}
