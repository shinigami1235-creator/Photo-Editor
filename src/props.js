import { canvas, fabric, selected } from './canvas.js';
import { state, currentPage, emit, on, markDirty } from './state.js';
import { record } from './history.js';
import { h, section, row, numberField, rangeField, iconButton, toHex, toast } from './ui.js';
import { fontPicker, ensureFont } from './fonts.js';
import { brandColors } from './brand.js';
import { toggleLock, arrange, flip, duplicateSelected, removeSelected, groupSelected, ungroupSelected, dropPhoto, addText } from './objects.js';
import { align, distribute } from './guides.js';
import { enterCrop, exitCrop, inCrop, isPhoto, isEmptyFrame, setPhotoShape } from './frames.js';
import { restoreBackground } from './bgremove.js';
import { openCutout } from './refine.js';
import { drawAdjust } from './adjustpanel.js';
import { applyCurve } from './objects.js';
import { pickFiles } from './platform.js';
import { registerBytes, typeFor } from './assets.js';
import { BLEND_MODES, WARPS, clipBaseOf } from './layerfx.js';
import { toggleLayerMask, invertLayerMask, removeLayerMask, selectFromLayer, textBehindSubject } from './selection.js';
import { startMaskPaint } from './maskpaint.js';
import { pickColor } from './eyedropper.js';
import { saveTextStyle } from './textstyles.js';
import { updateQr, EC_LEVELS } from './qrcode.js';
import { styleIcon } from './icons.js';
import { viewSettings, toggleRulers, toggleSafeZone, clearGuides } from './rulers.js';
import { openRetouch } from './retouch.js';
import { upscalePhoto, upscaleLimit } from './upscale.js';

// The right-hand panel: settings for whatever is selected, or the page.

let host = null;
let actions = {};

export function initProps(el, a) {
  host = el;
  actions = a;
  const refresh = () => render();
  canvas.on('selection:created', refresh);
  canvas.on('selection:updated', refresh);
  canvas.on('selection:cleared', refresh);
  canvas.on('object:modified', refresh);
  canvas.on('text:editing:exited', refresh);
  on('view', refresh);
  render();
}

let raf = 0;
export function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}

function set(objs, props, commit) {
  objs.forEach((o) => {
    o.set(props);
    if (o.type === 'textbox') {
      o.initDimensions();
      if (o.curve) applyCurve(o);
    }
    o.setCoords();
  });
  canvas.requestRenderAll();
  if (commit) {
    record();
    emit('objects');
  }
}

/** Colour picker, hex box and brand swatches. */
function colorField(label, value, onChange, { allowNone = false } = {}) {
  const none = !value || value === 'transparent';
  const input = h('input', { type: 'color', class: 'color', value: toHex(none ? '#000000' : value) });
  const hex = h('input', { class: 'field hex', value: none ? 'None' : toHex(value) });
  input.addEventListener('input', () => {
    hex.value = input.value;
    onChange(input.value, false);
  });
  input.addEventListener('change', () => onChange(input.value, true));
  hex.addEventListener('change', () => {
    const v = hex.value.trim();
    if (allowNone && (v === '' || /^none$/i.test(v))) return onChange(null, true);
    const c = v.startsWith('#') ? v : '#' + v;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) {
      input.value = toHex(c);
      onChange(toHex(c), true);
    }
  });
  const swatches = brandColors().map((c) =>
    h('button', {
      class: 'swatch small',
      title: c,
      style: { background: c },
      onclick: () => {
        input.value = c;
        hex.value = c;
        onChange(c, true);
      },
    }),
  );
  return h(
    'div',
    { class: 'color-field' },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'label grow' }, label),
      h('button', {
        class: 'icon-btn tiny',
        title: 'Pick a colour from the page',
        html: iconSvg('pipette'),
        onclick: async () => {
          const c = await pickColor();
          if (!c) return;
          input.value = c;
          hex.value = c;
          onChange(c, true);
        },
      }),
      input,
      hex,
      allowNone ? h('button', { class: 'link', title: 'No colour', onclick: () => onChange(null, true) }, 'None') : null,
    ),
    swatches.length ? h('div', { class: 'swatches small' }, swatches) : null,
  );
}

/** Fill as a solid colour or a linear or radial gradient between two colours. */
function fillField(label, targets, { allowNone = false } = {}) {
  const o = targets[0];
  const g = o.fill && typeof o.fill === 'object' && o.fill.colorStops ? o.fill : null;
  const kind = g ? g.type : 'solid';
  const stops = g ? [...g.colorStops].sort((a, b) => a.offset - b.offset) : null;
  const a = g ? toHex(stops[0].color) : toHex(o.fill || '#14497a');
  const b = g ? toHex(stops[stops.length - 1].color) : '#ffffff';
  const angle = g && g.type === 'linear' ? Math.round((Math.atan2(g.coords.y2 - g.coords.y1, g.coords.x2 - g.coords.x1) * 180) / Math.PI) : 90;
  const make = (k, c1, c2, ang) => {
    if (k === 'solid') return c1;
    const colorStops = [
      { offset: 0, color: c1 },
      { offset: 1, color: c2 },
    ];
    if (k === 'radial')
      return new fabric.Gradient({ type: 'radial', gradientUnits: 'percentage', coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.5 }, colorStops });
    const r = (ang * Math.PI) / 180;
    return new fabric.Gradient({
      type: 'linear',
      gradientUnits: 'percentage',
      coords: { x1: 0.5 - Math.cos(r) / 2, y1: 0.5 - Math.sin(r) / 2, x2: 0.5 + Math.cos(r) / 2, y2: 0.5 + Math.sin(r) / 2 },
      colorStops,
    });
  };
  const state = { kind, a, b, angle };
  const commit = (c) => set(targets, { fill: make(state.kind, state.a, state.b, state.angle) }, c);
  const seg = h(
    'div',
    { class: 'seg small' },
    [
      ['solid', 'Solid'],
      ['linear', 'Linear'],
      ['radial', 'Radial'],
    ].map(([v, text]) =>
      h('button', {
        class: kind === v ? 'on' : '',
        onclick: () => {
          state.kind = v;
          commit(true);
          render();
        },
      }, text),
    ),
  );
  const kids = [h('div', { class: 'row' }, h('span', { class: 'label grow' }, label), seg)];
  if (kind === 'solid') kids.push(colorField('Colour', o.fill, (c, cm) => set(targets, { fill: c }, cm), { allowNone }));
  else {
    kids.push(
      colorField('From', a, (c, cm) => ((state.a = c), commit(cm))),
      colorField('To', b, (c, cm) => ((state.b = c), commit(cm))),
    );
    if (kind === 'linear') kids.push(rangeField('Angle', angle, (v, cm) => ((state.angle = v), commit(cm)), { min: -180, max: 180, suffix: '°' }));
  }
  return h('div', { class: 'stack gap' }, ...kids);
}

const typeName = (o) =>
  isEmptyFrame(o) ? 'Frame' : isPhoto(o) ? 'Photo' : { textbox: 'Text', rect: 'Rectangle', ellipse: 'Circle', triangle: 'Triangle', line: 'Line', group: 'Group', activeselection: 'Selection' }[o.type] || 'Object';

function draw() {
  if (!host || !state.doc) return;
  host.innerHTML = '';
  const list = selected();
  if (inCrop()) {
    host.append(
      section('Crop', h('p', { class: 'muted' }, 'Drag the photo to move it inside the frame and pull a corner to zoom. Press Enter when done.'), h('button', { class: 'btn primary wide', onclick: exitCrop }, 'Done')),
    );
    return;
  }
  if (!list.length) return drawPage();
  if (list.length > 1) return drawMulti(list);
  const o = list[0];
  host.append(h('div', { class: 'props-head' }, h('span', { class: 'props-type' }, typeName(o)), h('span', { class: 'props-name' }, o.name || '')));
  if (o.type === 'textbox') {
    drawText(o);
    host.append(section(null, h('button', { class: 'btn wide', title: 'Keeps this look in the Text tab to use again', onclick: saveTextStyle }, 'Save as text style')));
  }
  else if (isEmptyFrame(o)) drawFrame(o);
  else if (isPhoto(o)) drawPhoto(o);
  else if (o.type === 'line') drawLine(o);
  else if (o.qrText != null) drawQr(o);
  else if (o.iconKind) drawIcon(o);
  else if (o.type === 'group') host.append(section('Group', h('button', { class: 'btn wide', onclick: ungroupSelected }, 'Ungroup')));
  else drawShape(o);
  drawEffects(o);
  drawTransform(o);
  drawArrange([o]);
}

// ---------- Page ----------

function drawPage() {
  const page = currentPage();
  host.append(
    h('div', { class: 'props-head' }, h('span', { class: 'props-type' }, 'Page'), h('span', { class: 'props-name' }, `${state.pageIndex + 1} of ${state.doc.pages.length}`)),
    section(
      'Design',
      h(
        'label',
        { class: 'stack' },
        h('span', { class: 'label' }, 'Name'),
        h('input', {
          class: 'field',
          value: state.doc.name,
          onchange: (e) => {
            state.doc.name = e.target.value.trim() || 'Untitled design';
            markDirty();
            emit('doc-name');
          },
        }),
      ),
      h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Size'), h('span', {}, `${state.doc.width} × ${state.doc.height} px`), h('button', { class: 'link', onclick: actions.resize }, 'Resize')),
      state.doc.slides > 1 ? h('p', { class: 'muted small' }, `Panorama carousel of ${state.doc.slides} slides. Export saves each slide as its own picture.`) : null,
      h('button', { class: 'btn wide', title: 'Makes a copy of this design for each size you pick, with the layout moved to fit', onclick: actions.otherSizes }, 'Make other sizes'),
    ),
    section(
      'View',
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: viewSettings().rulers, onchange: (e) => toggleRulers(e.target.checked) }), 'Rulers (Ctrl+R)'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: viewSettings().safe, onchange: (e) => toggleSafeZone(e.target.checked) }), 'Story safe zone'),
      page.guides?.length ? h('button', { class: 'link', onclick: () => (clearGuides(), render()) }, `Clear ${page.guides.length} guide${page.guides.length > 1 ? 's' : ''}`) : h('p', { class: 'muted small' }, 'Drag from a ruler onto the page to add a guide.'),
    ),
    section(
      'Background',
      colorField('Colour', page.background, (c, commit) => {
        page.background = c || '#ffffff';
        canvas.requestRenderAll();
        if (commit) record();
      }),
    ),
  );
}

// ---------- Text ----------

function drawText(o) {
  const t = [o];
  const bold = o.fontWeight === 'bold' || +o.fontWeight >= 600;
  const alignBtn = (v, icon, title) => iconButton(icon, title, () => (set(t, { textAlign: v }, true), render()), { on: o.textAlign === v });
  host.append(
    section(
      'Text',
      fontPicker(o.fontFamily, async (f) => {
        await ensureFont(f);
        fabric.cache.clearFontCache(f);
        set(t, { fontFamily: f }, true);
      }),
      row(
        numberField('Size', o.fontSize, (v, c) => set(t, { fontSize: Math.max(1, v) }, c), { min: 1, step: 1 }),
        iconButton('bold', 'Bold', () => (set(t, { fontWeight: bold ? 'normal' : 'bold' }, true), render()), { on: bold }),
        iconButton('italic', 'Italic', () => (set(t, { fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }, true), render()), { on: o.fontStyle === 'italic' }),
        iconButton('underline', 'Underline', () => (set(t, { underline: !o.underline }, true), render()), { on: o.underline }),
      ),
      row(alignBtn('left', 'tLeft', 'Align left'), alignBtn('center', 'tCenter', 'Align centre'), alignBtn('right', 'tRight', 'Align right'), alignBtn('justify', 'tJustify', 'Justify')),
      fillField('Fill', t),
      rangeField('Curve', o.curve || 0, (v, c) => {
        o.curve = v;
        applyCurve(o);
        canvas.requestRenderAll();
        if (c) record();
      }, { min: -100, max: 100 }),
      row(
        numberField('Letter spacing', o.charSpacing, (v, c) => set(t, { charSpacing: v }, c), { step: 10 }),
        numberField('Line height', o.lineHeight, (v, c) => set(t, { lineHeight: Math.max(0.5, v) }, c), { step: 0.05, min: 0.5 }),
      ),
      h(
        'button',
        {
          class: 'link',
          onclick: () => {
            const upper = o.text === o.text.toUpperCase();
            set(t, { text: upper ? o.text.toLowerCase() : o.text.toUpperCase() }, true);
          },
        },
        'Change case',
      ),
    ),
    section(
      'Outline',
      colorField('Colour', o.stroke || '#000000', (c, commit) => set(t, { stroke: c, strokeWidth: o.strokeWidth || Math.max(1, Math.round(o.fontSize / 20)) }, commit)),
      rangeField('Width', o.strokeWidth || 0, (v, c) => set(t, { strokeWidth: v, stroke: v ? o.stroke || '#000000' : null }, c), { min: 0, max: Math.max(20, Math.round(o.fontSize / 4)), step: 0.5 }),
    ),
  );
}

// ---------- Shapes ----------

function drawShape(o) {
  const t = [o];
  const kids = [
    fillField('Fill', t, { allowNone: true }),
    colorField('Border', o.stroke, (c, commit) => set(t, { stroke: c, strokeWidth: c ? o.strokeWidth || 4 : 0 }, commit), { allowNone: true }),
    rangeField('Border width', o.strokeWidth || 0, (v, c) => set(t, { strokeWidth: v, stroke: v ? o.stroke || '#111111' : null }, c), { min: 0, max: 60 }),
  ];
  if (o.type === 'rect') {
    const maxR = Math.min(o.width, o.height) / 2;
    kids.push(rangeField('Corner radius', o.rx || 0, (v, c) => set(t, { rx: v, ry: v }, c), { min: 0, max: Math.round(maxR) }));
  }
  host.append(section('Shape', ...kids));
}

function drawLine(o) {
  const t = [o];
  host.append(
    section(
      'Line',
      colorField('Colour', o.stroke, (c, commit) => set(t, { stroke: c }, commit)),
      rangeField('Width', o.strokeWidth, (v, c) => set(t, { strokeWidth: Math.max(1, v) }, c), { min: 1, max: 60 }),
      row(
        h('button', { class: 'btn small', onclick: () => set(t, { strokeDashArray: null }, true) }, 'Solid'),
        h('button', { class: 'btn small', onclick: () => set(t, { strokeDashArray: [o.strokeWidth * 3, o.strokeWidth * 2] }, true) }, 'Dashed'),
        h('button', { class: 'btn small', onclick: () => set(t, { strokeDashArray: [0.01, o.strokeWidth * 2], strokeLineCap: 'round' }, true) }, 'Dotted'),
      ),
    ),
  );
}

// ---------- Frames and photos ----------

async function pickPhotoInto(target) {
  const files = await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp'], label: 'Images' });
  if (!files?.length) return;
  const url = registerBytes(files[0].bytes, typeFor(files[0].name));
  await dropPhoto(url, null, target);
  render();
}

function drawFrame(o) {
  host.append(
    section(
      'Frame',
      h('p', { class: 'muted' }, 'Drop a photo on the frame or pick one.'),
      h('button', { class: 'btn primary wide', onclick: () => pickPhotoInto(o) }, 'Add photo'),
    ),
  );
}

function drawPhoto(o) {
  const shape = o.frameShape || { kind: 'rect', r: 0 };
  const radiusDisplay = (shape.r || 0) * o.scaleX;
  const maxR = (Math.min(o.width, o.height) * o.scaleX) / 2;
  const shapeBtn = (kind, r, icon, title) =>
    iconButton(icon, title, () => (setPhotoShape(o, kind, r), record(), render()), {
      on: shape.kind === kind && (kind !== 'rect' || (r > 0) === radiusDisplay > 0),
    });
  host.append(
    section(
      'Photo',
      row(
        h('button', { class: 'btn', onclick: () => enterCrop(o), html: `${iconSvg('crop')} Crop` }),
        h('button', { class: 'btn', onclick: () => pickPhotoInto(o) }, 'Replace'),
      ),
      row(h('span', { class: 'label grow' }, 'Shape'), shapeBtn('rect', 0, 'rect', 'Rectangle'), shapeBtn('rect', Math.round(maxR * 0.2), 'rounded', 'Rounded'), shapeBtn('arch', 0, 'arch', 'Arch'), shapeBtn('ellipse', 0, 'circle', 'Circle')),
      shape.kind === 'rect' && radiusDisplay > 0
        ? rangeField('Corner radius', radiusDisplay, (v, c) => {
            setPhotoShape(o, 'rect', v);
            if (c) record();
          }, { min: 1, max: Math.round(maxR) })
        : null,
      rangeField('Rotate photo', o.innerAngle || 0, (v, c) => {
        o.set({ innerAngle: v, dirty: true });
        canvas.requestRenderAll();
        if (c) record();
      }, { min: -180, max: 180, suffix: '°' }),
      row(
        h('span', { class: 'label grow' }, 'Flip photo'),
        iconButton('flipH', 'Flip photo horizontally', () => (o.set({ innerFlipX: !o.innerFlipX, dirty: true }), canvas.requestRenderAll(), record())),
        iconButton('flipV', 'Flip photo vertically', () => (o.set({ innerFlipY: !o.innerFlipY, dirty: true }), canvas.requestRenderAll(), record())),
      ),
      h('p', { class: 'muted small' }, 'Side handles crop the photo. Double-click to move it inside the frame. Rotate and flip turn the photo while the frame stays put.'),
    ),
    section(
      'Background',
      o.originalSrc
        ? row(
            h('button', { class: 'btn', onclick: () => openCutout(o), html: `${iconSvg('magic')} Edit cut-out` }),
            h('button', { class: 'btn', onclick: () => restoreBackground(o) }, 'Restore background'),
          )
        : h('button', { class: 'btn primary wide', onclick: () => openCutout(o), html: `${iconSvg('magic')} Remove background` }),
      h('button', { class: 'btn wide', title: 'Copies the person or product to a layer in front of your text', onclick: () => textBehindSubject(o, () => addText('heading')) }, 'Text behind subject'),
    ),
    section(
      'Retouch',
      h('button', { class: 'btn wide', title: 'Spot heal and clone', onclick: () => openRetouch(o) }, 'Spot heal and clone'),
      upscaleRow(o),
    ),
  );
  drawAdjust(host, o, render);
}

function upscaleRow(o) {
  const el = o.getElement();
  const w = el.naturalWidth || el.width;
  const hh = el.naturalHeight || el.height;
  const max = upscaleLimit(o);
  return h(
    'div',
    { class: 'stack' },
    row(
      h('button', { class: 'btn grow', disabled: max < 2, title: `${w * 2} × ${hh * 2} px`, onclick: () => upscalePhoto(o, 2).then(render) }, 'Upscale 2×'),
      h('button', { class: 'btn grow', disabled: max < 4, title: `${w * 4} × ${hh * 4} px`, onclick: () => upscalePhoto(o, 4).then(render) }, 'Upscale 4×'),
    ),
    h('p', { class: 'muted small' }, `This photo is ${w} × ${hh} px.`),
  );
}

// ---------- QR codes and icons ----------

function drawQr(o) {
  const link = h('textarea', { class: 'field', rows: 3, value: o.qrText });
  link.addEventListener('keydown', (e) => e.stopPropagation());
  link.addEventListener('change', () => {
    const v = link.value.trim();
    if (!v) return;
    if (!updateQr(o, { text: v })) toast('That text is too long for a QR code.', { error: true });
  });
  host.append(
    section(
      'QR code',
      h('label', { class: 'stack' }, h('span', { class: 'label' }, 'Link or text'), link),
      colorField('Squares', o.qrDark, (c, commit) => commit && updateQr(o, { dark: c })),
      colorField('Background', o.qrLight, (c, commit) => commit && updateQr(o, { light: c || 'rgba(0,0,0,0)' }), { allowNone: true }),
      h(
        'label',
        { class: 'field-row' },
        h('span', { class: 'label' }, 'Error correction'),
        h(
          'select',
          { class: 'field', onchange: (e) => updateQr(o, { ec: e.target.value }) },
          EC_LEVELS.map(([v, name]) => h('option', { value: v, selected: o.qrEc === v }, name)),
        ),
      ),
      h('p', { class: 'muted small' }, 'Dark squares on a light background scan best. Test it with your phone before printing.'),
    ),
  );
}

function drawIcon(o) {
  host.append(
    section(
      'Icon',
      colorField('Colour', o.iconColor, (c, commit) => {
        styleIcon(o, { color: c });
        if (commit) record();
      }),
      o.iconKind === 'line'
        ? rangeField('Line width', o.iconWidth ?? 2, (v, c) => {
            styleIcon(o, { width: v });
            if (c) record();
          }, { min: 0.5, max: 4, step: 0.25 })
        : null,
    ),
  );
}

// ---------- Shared ----------

function drawEffects(o) {
  const t = [o];
  const sh = o.shadow;
  const setShadow = (patch, commit) => {
    const base = sh ? { color: sh.color, blur: sh.blur, offsetX: sh.offsetX, offsetY: sh.offsetY } : { color: 'rgba(0,0,0,0.35)', blur: 20, offsetX: 6, offsetY: 8 };
    set(t, { shadow: new fabric.Shadow({ ...base, ...patch }) }, commit);
  };
  const kids = [
    rangeField('Opacity', Math.round((o.opacity ?? 1) * 100), (v, c) => set(t, { opacity: v / 100 }, c), { min: 0, max: 100, suffix: '%' }),
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: !!sh,
        onchange: (e) => {
          if (e.target.checked) setShadow({}, true);
          else set(t, { shadow: null }, true);
          render();
        },
      }),
      'Shadow',
    ),
  ];
  if (sh) {
    kids.push(
      colorField('Shadow colour', toHex(sh.color), (c, commit) => setShadow({ color: withAlpha(c, alphaOf(sh.color)) }, commit)),
      rangeField('Shadow opacity', Math.round(alphaOf(sh.color) * 100), (v, c) => setShadow({ color: withAlpha(toHex(sh.color), v / 100) }, c), { min: 0, max: 100, suffix: '%' }),
      rangeField('Blur', sh.blur, (v, c) => setShadow({ blur: v }, c), { min: 0, max: 120 }),
      row(numberField('Offset X', sh.offsetX, (v, c) => setShadow({ offsetX: v }, c)), numberField('Offset Y', sh.offsetY, (v, c) => setShadow({ offsetY: v }, c))),
    );
  }
  kids.push(
    h(
      'label',
      { class: 'field-row' },
      h('span', { class: 'label' }, 'Blend'),
      h(
        'select',
        { class: 'field', onchange: (e) => set(t, { globalCompositeOperation: e.target.value }, true) },
        BLEND_MODES.map(([v, name]) => h('option', { value: v, selected: (o.globalCompositeOperation || 'source-over') === v }, name)),
      ),
    ),
  );

  // Outline and glow follow the layer's visible shape, so they suit cut-outs and text.
  const toggle = (label, onNow, turnOn, turnOff) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: onNow,
        onchange: (e) => {
          set(t, e.target.checked ? turnOn : turnOff, true);
          render();
        },
      }),
      label,
    );
  kids.push(toggle('Outline', o.outlineWidth > 0, { outlineWidth: 8, outlineColor: o.outlineColor || '#ffffff' }, { outlineWidth: 0 }));
  if (o.outlineWidth > 0) {
    kids.push(
      colorField('Outline colour', o.outlineColor || '#ffffff', (c, commit) => set(t, { outlineColor: c }, commit)),
      rangeField('Outline width', o.outlineWidth, (v, c) => set(t, { outlineWidth: Math.max(1, v) }, c), { min: 1, max: 80 }),
    );
  }
  kids.push(toggle('Glow', o.glowSize > 0, { glowSize: 24, glowColor: o.glowColor || '#ffd76a', glowStrength: o.glowStrength ?? 60 }, { glowSize: 0 }));
  if (o.glowSize > 0) {
    kids.push(
      colorField('Glow colour', o.glowColor || '#ffd76a', (c, commit) => set(t, { glowColor: c }, commit)),
      rangeField('Glow size', o.glowSize, (v, c) => set(t, { glowSize: Math.max(1, v) }, c), { min: 1, max: 150 }),
      rangeField('Glow strength', o.glowStrength ?? 60, (v, c) => set(t, { glowStrength: v }, c), { min: 1, max: 100, suffix: '%' }),
    );
  }
  host.append(section('Effects', ...kids));

  // Warp bends the whole layer: text, photo or shape.
  const warp = [
    h(
      'label',
      { class: 'field-row' },
      h('span', { class: 'label' }, 'Style'),
      h(
        'select',
        {
          class: 'field',
          onchange: (e) => {
            set(t, { warp: e.target.value || null, warpBend: e.target.value ? o.warpBend || 40 : 0 }, true);
            render();
          },
        },
        WARPS.map(([v, name]) => h('option', { value: v, selected: (o.warp || '') === v }, name)),
      ),
    ),
  ];
  if (o.warp) warp.push(rangeField('Bend', o.warpBend || 0, (v, c) => set(t, { warpBend: v }, c), { min: -100, max: 100, suffix: '%' }));
  host.append(section('Warp', ...warp));

  // Layer mask and clipping.
  const layerKids = [
    h(
      'label',
      { class: 'check', title: clipBaseOf(o) ? 'Shows this layer only inside the layer below it' : 'Needs a layer below' },
      h('input', {
        type: 'checkbox',
        checked: !!o.clipBelow,
        disabled: !clipBaseOf(o) && !o.clipBelow,
        onchange: (e) => {
          set(t, { clipBelow: e.target.checked }, true);
          render();
        },
      }),
      'Clip to layer below',
    ),
  ];
  layerKids.push(
    row(
      h('button', { class: 'btn', title: 'Hide or bring back parts of this layer with a soft brush', onclick: () => startMaskPaint(o, 'brush') }, 'Paint mask'),
      h('button', { class: 'btn', title: 'Drag across the layer to fade it out', onclick: () => startMaskPaint(o, 'fade') }, 'Fade out'),
    ),
  );
  if (o.layerMask) {
    layerKids.push(
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', checked: o.maskOn !== false, onchange: () => (toggleLayerMask(o), render()) }),
        'Mask on',
      ),
      row(
        h('button', { class: 'btn', onclick: () => invertLayerMask(o).then(render) }, 'Invert mask'),
        h('button', { class: 'btn', onclick: () => selectFromLayer(o) }, 'Select shape'),
      ),
      h('button', { class: 'btn wide', onclick: () => (removeLayerMask(o), render()) }, 'Delete mask'),
    );
  } else layerKids.push(h('p', { class: 'muted small' }, 'A selection from the Select tab can also hide or keep parts of this layer.'));
  host.append(section('Layer', ...layerKids));
}

function alphaOf(c) {
  const m = String(c).match(/rgba\([^)]*,\s*([\d.]+)\)/);
  return m ? +m[1] : 1;
}
function withAlpha(hex, a) {
  const n = parseInt(toHex(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawTransform(o) {
  const r = o.getBoundingRect();
  const w = o.getScaledWidth();
  const hh = o.getScaledHeight();
  const setSize = (dim, v, commit) => {
    if (v <= 0) return;
    if (o.type === 'textbox' && dim === 'w') set([o], { width: v / o.scaleX }, commit);
    else if (isPhoto(o) || o.type === 'group' || o.type === 'textbox') {
      const s = dim === 'w' ? v / o.width : v / o.height;
      set([o], { scaleX: s, scaleY: s }, commit);
    } else set([o], dim === 'w' ? { scaleX: v / o.width } : { scaleY: v / o.height }, commit);
    if (commit) render();
  };
  host.append(
    section(
      'Position',
      row(
        numberField('X', Math.round(r.left), (v, c) => set([o], { left: o.left + (v - o.getBoundingRect().left) }, c)),
        numberField('Y', Math.round(r.top), (v, c) => set([o], { top: o.top + (v - o.getBoundingRect().top) }, c)),
      ),
      row(numberField('W', Math.round(w), (v, c) => setSize('w', v, c), { min: 1 }), numberField('H', Math.round(hh), (v, c) => setSize('h', v, c), { min: 1 })),
      row(
        numberField('Rotate', Math.round(o.angle), (v, c) => {
          o.rotate(v);
          o.setCoords();
          canvas.requestRenderAll();
          if (c) record();
        }, { suffix: '°' }),
        iconButton('flipH', 'Flip horizontal', () => flip('x')),
        iconButton('flipV', 'Flip vertical', () => flip('y')),
      ),
    ),
  );
}

function drawArrange(list) {
  const o = list[0];
  host.append(
    section(
      'Arrange',
      alignRow(),
      row(
        iconButton('front', 'Bring to front', () => arrange('front')),
        iconButton('up', 'Bring forward', () => arrange('forward')),
        iconButton('down', 'Send backward', () => arrange('backward')),
        iconButton('back', 'Send to back', () => arrange('back')),
        h('span', { class: 'grow' }),
        iconButton(o.locked ? 'lock' : 'unlock', o.locked ? 'Unlock' : 'Lock', () => toggleLock(o), { on: o.locked }),
        iconButton('copy', 'Duplicate', () => duplicateSelected()),
        iconButton('trash', 'Delete', removeSelected),
      ),
    ),
  );
}

function alignRow() {
  return row(
    iconButton('alignLeft', 'Align left', () => align('left')),
    iconButton('alignCenter', 'Align centre', () => align('center')),
    iconButton('alignRight', 'Align right', () => align('right')),
    iconButton('alignTop', 'Align top', () => align('top')),
    iconButton('alignMiddle', 'Align middle', () => align('middle')),
    iconButton('alignBottom', 'Align bottom', () => align('bottom')),
  );
}

function drawMulti(list) {
  const texts = list.filter((o) => o.type === 'textbox');
  const fills = list.filter((o) => o.type !== 'image' && o.type !== 'line' && o.type !== 'group');
  host.append(...[
    h('div', { class: 'props-head' }, h('span', { class: 'props-type' }, 'Selection'), h('span', { class: 'props-name' }, `${list.length} objects`)),
    section(
      'Align',
      alignRow(),
      row(
        iconButton('distH', 'Space evenly across', () => distribute('x'), { disabled: list.length < 3 }),
        iconButton('distV', 'Space evenly down', () => distribute('y'), { disabled: list.length < 3 }),
      ),
    ),
    fills.length ? section('Colour', fillField('Fill', fills)) : null,
    texts.length
      ? section(
          'Text',
          fontPicker(texts[0].fontFamily, async (f) => {
            await ensureFont(f);
            set(texts, { fontFamily: f }, true);
          }),
        )
      : null,
    section(
      'Arrange',
      rangeField('Opacity', Math.round((list[0].opacity ?? 1) * 100), (v, c) => set(list, { opacity: v / 100 }, c), { min: 0, max: 100, suffix: '%' }),
      row(
        h('button', { class: 'btn', onclick: groupSelected, html: `${iconSvg('group')} Group` }),
        h('span', { class: 'grow' }),
        iconButton('copy', 'Duplicate', () => duplicateSelected()),
        iconButton('trash', 'Delete', removeSelected),
      ),
    ),
  ].filter(Boolean));
}

import { ICONS } from './ui.js';
const iconSvg = (n) => ICONS[n];
