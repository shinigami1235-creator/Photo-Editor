import { canvas } from './canvas.js';
import { record } from './history.js';
import { h, section, row, rangeField, toHex } from './ui.js';
import { NEUTRAL, LOOKS, adjustOf, adjustPixels, lookSettings, settingsOf, histogram, curveTable } from './adjust.js';

// The photo settings in the right panel: Looks, the adjustment sliders, curves
// and levels, and colour grading.

const open = new Set(['Adjust']); // sections left expanded
const thumbs = new Map(); // photo source -> [dataURL per look]
const hists = new Map(); // photo source -> histogram

let pending = null;
function apply(img, patch, commit) {
  const f = adjustOf(img);
  Object.assign(f, patch);
  if (commit) {
    cancelAnimationFrame(pending);
    pending = null;
    img.applyFilters();
    canvas.requestRenderAll();
    record();
    return;
  }
  // Filtering a phone photo takes a moment, so live changes are drawn once per frame.
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = null;
    img.applyFilters();
    canvas.requestRenderAll();
  });
}

function collapsible(title, build) {
  const isOpen = open.has(title);
  const head = h(
    'button',
    {
      class: 'section-toggle',
      onclick: () => {
        if (open.has(title)) open.delete(title);
        else open.add(title);
        el.replaceWith(collapsible(title, build));
      },
    },
    h('span', { class: 'section-title' }, title),
    h('span', { class: 'chev' + (isOpen ? ' open' : '') }, '›'),
  );
  const el = h('div', { class: 'section' }, head, isOpen ? build() : null);
  return el;
}

function sourceEl(img) {
  return img._originalElement || img.getElement();
}

function lookThumbs(img) {
  const key = img.getSrc();
  if (thumbs.has(key)) return thumbs.get(key);
  const el = sourceEl(img);
  const nw = el.naturalWidth || el.width;
  const nh = el.naturalHeight || el.height;
  const side = 72;
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // Centre square crop so every look shows the same part of the photo.
  const s = Math.min(nw, nh);
  ctx.drawImage(el, (nw - s) / 2, (nh - s) / 2, s, s, 0, 0, side, side);
  const base = ctx.getImageData(0, 0, side, side);
  const out = LOOKS.map((look) => {
    const px = new ImageData(new Uint8ClampedArray(base.data), side, side);
    adjustPixels(px.data, side, side, lookSettings(look));
    ctx.putImageData(px, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  });
  thumbs.set(key, out);
  return out;
}

function currentLook(f) {
  const cur = JSON.stringify(settingsOf(f));
  return LOOKS.findIndex((l) => JSON.stringify(lookSettings(l)) === cur);
}

export function drawAdjust(host, img, rerender) {
  const f = img.filters?.find((x) => x.type === 'Adjust');
  const s = settingsOf(f);
  const slider = (key, label, min = -100, max = 100) =>
    rangeField(label, s[key], (v, c) => apply(img, { [key]: v }, c), { min, max });

  host.append(
    collapsible('Adjust', () => {
      const urls = lookThumbs(img);
      const active = currentLook(f);
      return h(
        'div',
        { class: 'stack gap' },
        h(
          'div',
          { class: 'look-grid' },
          LOOKS.map((look, i) =>
            h(
              'button',
              {
                class: 'look' + (i === active ? ' on' : ''),
                title: look.name,
                onclick: () => {
                  apply(img, lookSettings(look), true);
                  rerender();
                },
              },
              h('img', { src: urls[i] }),
              h('span', {}, look.name),
            ),
          ),
        ),
        slider('brightness', 'Brightness'),
        slider('contrast', 'Contrast'),
        slider('saturation', 'Saturation'),
        slider('warmth', 'Warmth'),
        slider('tint', 'Tint'),
        slider('fade', 'Fade', 0, 100),
        slider('vignette', 'Vignette', 0, 100),
        slider('sharpen', 'Sharpen', 0, 100),
        slider('blur', 'Blur', 0, 100),
        h(
          'button',
          {
            class: 'link',
            onclick: () => {
              apply(img, JSON.parse(JSON.stringify(NEUTRAL)), true);
              rerender();
            },
          },
          'Reset all',
        ),
      );
    }),
    collapsible('Curves and levels', () => curvesUI(img, s, rerender)),
    collapsible('Colour grading', () =>
      h(
        'div',
        { class: 'stack gap' },
        colorRow('Shadows', s.shadowsColor, (c) => apply(img, { shadowsColor: c }, true)),
        rangeField('Amount', s.shadowsAmount, (v, c) => apply(img, { shadowsAmount: v }, c), { min: 0, max: 100 }),
        colorRow('Highlights', s.highlightsColor, (c) => apply(img, { highlightsColor: c }, true)),
        rangeField('Amount', s.highlightsAmount, (v, c) => apply(img, { highlightsAmount: v }, c), { min: 0, max: 100 }),
        rangeField('Balance', s.balance, (v, c) => apply(img, { balance: v }, c), { min: -100, max: 100 }),
      ),
    ),
  );
}

function colorRow(label, value, onChange) {
  const input = h('input', { type: 'color', class: 'color', value: toHex(value) });
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { class: 'row' }, h('span', { class: 'label grow' }, label), input);
}

// ---------- Curves ----------

let channel = 'rgb';
const CH_COLOR = { rgb: '#101c2b', r: '#d23b3b', g: '#2f9e5b', b: '#1f5e99' };

function curvesUI(img, s, rerender) {
  const key = img.getSrc();
  if (!hists.has(key)) hists.set(key, histogram(sourceEl(img)));
  const hist = hists.get(key);
  let curves = JSON.parse(JSON.stringify(s.curves));

  const W = 256;
  const H = 200;
  const cv = h('canvas', { class: 'curve-canvas', width: W * 2, height: H * 2 });
  const draw = () => {
    const ctx = cv.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f7f8fa';
    ctx.fillRect(0, 0, W, H);
    // Histogram behind the curve.
    const bins = hist[channel === 'rgb' ? 'l' : channel];
    let max = 1;
    for (let i = 2; i < 254; i++) max = Math.max(max, bins[i]);
    ctx.fillStyle = 'rgba(16,28,43,0.12)';
    for (let i = 0; i < 256; i++) {
      const bh = Math.min(1, bins[i] / max) * H;
      ctx.fillRect((i / 255) * W, H - bh, W / 255 + 0.5, bh);
    }
    ctx.strokeStyle = 'rgba(16,28,43,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / 4, 0);
      ctx.lineTo((W * i) / 4, H);
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(16,28,43,0.2)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(W, 0);
    ctx.stroke();
    const lut = curveTable(curves[channel]);
    ctx.strokeStyle = CH_COLOR[channel];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) {
      const px = (x / 255) * W;
      const py = H - (lut[x] / 255) * H;
      x ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    for (const [x, y] of curves[channel]) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = CH_COLOR[channel];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((x / 255) * W, H - (y / 255) * H, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };

  const toVal = (e) => {
    const r = cv.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 255), Math.round((1 - (e.clientY - r.top) / r.height) * 255)];
  };
  const clampPt = ([x, y]) => [Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y))];
  let drag = -1;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const [x, y] = toVal(e);
    const pts = curves[channel];
    drag = pts.findIndex(([px, py]) => Math.abs(px - x) < 10 && Math.abs(py - y) < 14);
    if (drag < 0) {
      pts.push(clampPt([x, y]));
      pts.sort((a, b) => a[0] - b[0]);
      drag = pts.findIndex((p) => p[0] === Math.min(255, Math.max(0, x)));
    }
    draw();
    apply(img, { curves }, false);
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag < 0) return;
    const pts = curves[channel];
    let [x, y] = clampPt(toVal(e));
    // Points keep their order along the curve.
    const lo = drag > 0 ? pts[drag - 1][0] + 1 : 0;
    const hi = drag < pts.length - 1 ? pts[drag + 1][0] - 1 : 255;
    x = Math.min(hi, Math.max(lo, x));
    pts[drag] = [x, y];
    draw();
    apply(img, { curves: JSON.parse(JSON.stringify(curves)) }, false);
  });
  cv.addEventListener('pointerup', () => {
    if (drag < 0) return;
    drag = -1;
    apply(img, { curves: JSON.parse(JSON.stringify(curves)) }, true);
  });
  cv.addEventListener('dblclick', (e) => {
    const [x, y] = toVal(e);
    const pts = curves[channel];
    const i = pts.findIndex(([px, py]) => Math.abs(px - x) < 10 && Math.abs(py - y) < 14);
    if (i > 0 && i < pts.length - 1) {
      pts.splice(i, 1);
      draw();
      apply(img, { curves: JSON.parse(JSON.stringify(curves)) }, true);
    }
  });

  const seg = h(
    'div',
    { class: 'seg' },
    [
      ['rgb', 'RGB'],
      ['r', 'Red'],
      ['g', 'Green'],
      ['b', 'Blue'],
    ].map(([v, label]) =>
      h('button', {
        class: channel === v ? 'on' : '',
        onclick: () => {
          channel = v;
          [...seg.children].forEach((b, i) => b.classList.toggle('on', ['rgb', 'r', 'g', 'b'][i] === v));
          draw();
        },
      }, label),
    ),
  );
  draw();

  const lv = s.levels;
  return h(
    'div',
    { class: 'stack gap' },
    seg,
    cv,
    h('p', { class: 'muted small' }, 'Click the line to add a point and drag it. Double-click a point to remove it.'),
    h(
      'button',
      {
        class: 'link',
        onclick: () => {
          curves[channel] = [
            [0, 0],
            [255, 255],
          ];
          draw();
          apply(img, { curves: JSON.parse(JSON.stringify(curves)) }, true);
        },
      },
      'Reset curve',
    ),
    h('div', { class: 'section-title sub' }, 'Levels'),
    rangeField('Black point', lv.black, (v, c) => apply(img, { levels: { ...adjustOf(img).levels, black: Math.min(v, adjustOf(img).levels.white - 2) } }, c), { min: 0, max: 253 }),
    rangeField('Midtones', Math.round(lv.gamma * 100), (v, c) => apply(img, { levels: { ...adjustOf(img).levels, gamma: v / 100 } }, c), { min: 20, max: 300 }),
    rangeField('White point', lv.white, (v, c) => apply(img, { levels: { ...adjustOf(img).levels, white: Math.max(v, adjustOf(img).levels.black + 2) } }, c), { min: 2, max: 255 }),
    h(
      'button',
      {
        class: 'link',
        onclick: () => {
          apply(img, { levels: { black: 0, gamma: 1, white: 255 } }, true);
          rerender();
        },
      },
      'Reset levels',
    ),
  );
}

export { row, section };
