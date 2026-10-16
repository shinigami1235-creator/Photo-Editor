import { canvas, selected } from './canvas.js';
import { state, emit, on } from './state.js';
import { h, modal, toast, rangeField } from './ui.js';
import { defineCommands } from './commands.js';
import { isPhoto } from './frames.js';
import { photoTarget, copySettings, pasteSettings, copiedSettings, addCube } from './adjustpanel.js';
import { layerTarget } from './adjustlayers.js';
import { autoSettings, NEUTRAL } from './adjust.js';
import { onLutLoaded } from './luts.js';
import { bumpRender } from './layerfx.js';
import { selectColorRange, rangeWeight, pagePixels } from './selection.js';
import { pickColor } from './eyedropper.js';

// Commands for adjusting photos: Auto tone and colour, copying adjustments
// between photos, colour range selection, and .cube files dropped on the page.

const one = () => (selected().length === 1 ? selected()[0] : null);
const target = () => {
  const o = one();
  if (isPhoto(o)) return photoTarget(o);
  if (o?.isAdjustment) return layerTarget(o);
  return null;
};

function auto(tone, color) {
  const t = target();
  if (!t) return;
  t.apply(autoSettings(t.source(), { tone, color }), true);
  emit('objects');
}

// ---------- Colour range ----------

async function colorRangeDialog() {
  const src = pagePixels();
  const sc = Math.min(1, 300 / Math.max(src.width, src.height));
  const pw = Math.max(1, Math.round(src.width * sc));
  const ph = Math.max(1, Math.round(src.height * sc));
  const small = document.createElement('canvas');
  small.width = pw;
  small.height = ph;
  small.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, pw, ph);
  const pix = small.getContext('2d').getImageData(0, 0, pw, ph).data;
  const S = { mode: 'color', color: [pix[0], pix[1], pix[2]], fuzz: 40 };
  const preview = h('canvas', { class: 'range-preview', width: pw, height: ph, title: 'Click the picture to pick the colour' });
  const swatch = h('span', { class: 'eyedrop-swatch' });
  const draw = () => {
    const x = preview.getContext('2d');
    const img = x.createImageData(pw, ph);
    for (let i = 0; i < pix.length; i += 4) {
      const v = Math.round(rangeWeight(S.mode, pix[i], pix[i + 1], pix[i + 2], S.color, S.fuzz) * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    swatch.style.background = `rgb(${S.color.join(',')})`;
  };
  preview.addEventListener('click', (e) => {
    const r = preview.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * pw);
    const y = Math.floor(((e.clientY - r.top) / r.height) * ph);
    const i = (y * pw + x) * 4;
    S.color = [pix[i], pix[i + 1], pix[i + 2]];
    S.mode = 'color';
    draw();
    drawSeg();
  });
  const seg = h('div', { class: 'seg small' });
  const drawSeg = () => {
    seg.innerHTML = '';
    for (const [v, label] of [
      ['color', 'Picked colour'],
      ['highlights', 'Highlights'],
      ['midtones', 'Midtones'],
      ['shadows', 'Shadows'],
      ['skin', 'Skin'],
    ])
      seg.append(h('button', { class: S.mode === v ? 'on' : '', onclick: () => ((S.mode = v), draw(), drawSeg()) }, label));
  };
  drawSeg();
  draw();
  const body = h(
    'div',
    { class: 'stack gap' },
    h('p', { class: 'muted small' }, 'White in the preview gets selected, grey gets selected partly. Click the preview to pick a colour.'),
    seg,
    h(
      'div',
      { class: 'row' },
      swatch,
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            back?.style.setProperty('display', 'none');
            const c = await pickColor();
            back?.style.removeProperty('display');
            if (!c) return;
            const n = parseInt(c.slice(1), 16);
            S.color = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
            S.mode = 'color';
            draw();
            drawSeg();
          },
        },
        'Pick from the page',
      ),
    ),
    rangeField('Fuzziness', S.fuzz, (v) => ((S.fuzz = v), draw()), { min: 1, max: 100 }),
    preview,
  );
  let back = null;
  setTimeout(() => (back = document.querySelector('.modal-back:last-of-type')));
  const ok = await modal('Colour range', body, [
    { label: 'Cancel', value: false },
    { label: 'Select', value: true, primary: true },
  ]);
  if (ok) selectColorRange(S, 'new');
}

export function init() {
  defineCommands({
    'image.autotone': { label: 'Auto tone', keys: 'Shift+Ctrl+L', run: () => auto(true, false), enabled: () => !!target() },
    'image.autocolor': { label: 'Auto colour', keys: 'Shift+Ctrl+B', run: () => auto(false, true), enabled: () => !!target(), also: 'white balance' },
    'image.resetAdj': { label: 'Reset adjustments', run: () => (target().apply(JSON.parse(JSON.stringify(NEUTRAL)), true), emit('objects')), enabled: () => !!target() },
    'edit.copyAdj': { label: 'Copy adjustments', keys: 'Shift+Ctrl+C', run: () => copySettings(target()), enabled: () => !!target(), also: 'settings sync' },
    'edit.pasteAdj': {
      label: 'Paste adjustments',
      keys: 'Shift+Ctrl+V',
      run: () => {
        // Pasting works on several photos at once.
        for (const o of selected()) {
          const t = isPhoto(o) ? photoTarget(o) : o.isAdjustment ? layerTarget(o) : null;
          if (t) pasteSettings(t);
        }
        emit('objects');
      },
      enabled: () => !!copiedSettings() && selected().some((o) => isPhoto(o) || o.isAdjustment),
    },
    'select.colorRange': { label: 'Colour range', run: colorRangeDialog, enabled: () => !!state.doc, also: 'skin highlights shadows' },
  });

  // A .cube file dropped on the page goes on the selected photo or adjustment layer.
  on('cube-dropped', ({ name, bytes }) => {
    const t = target();
    if (!t) return toast('Select a photo or an adjustment layer, then drop the .cube file again.');
    addCube(t, name, bytes);
    emit('objects');
  });

  // When a LUT file finishes loading, photos using it are filtered again.
  onLutLoaded((url) => {
    bumpRender();
    for (const o of canvas.getObjects()) {
      const f = o.filters?.find((x) => x.type === 'Adjust');
      if (f?.lut?.url === url) o.applyFilters();
    }
    canvas.requestRenderAll();
  });
}
