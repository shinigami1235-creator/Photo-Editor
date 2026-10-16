import { canvas } from './canvas.js';
import { record } from './history.js';
import { emit } from './state.js';
import { h, section, row, rangeField, toHex, toast } from './ui.js';
import { NEUTRAL, LOOKS, BANDS, adjustOf, adjustPixels, lookSettings, settingsOf, curveTable, autoSettings, bumpFilterRev } from './adjust.js';
import { BUILT_IN } from './luts.js';
import { pickFiles } from './platform.js';
import { registerBytes } from './assets.js';
import { parseCube } from './lut.js';

// The adjustment settings in the right panel: histogram and Auto, Looks, the
// Light, Colour, Effects, Detail and Blur sliders, the colour mixer, curves and
// levels, colour grading, photo filter and colour lookup. The same panel edits
// a photo's own settings and an adjustment layer.

const open = new Set(['Light']); // sections left expanded
const thumbs = new Map(); // source key -> [dataURL per look]
let focus = null; // { section, key } to scroll to after the next draw
let copied = null;

/** Opens a section and points at one slider the next time the panel draws. */
export function focusAdjust(sectionName, key) {
  open.add(sectionName);
  focus = { section: sectionName, key };
}

export const copiedSettings = () => copied;
export function copySettings(target) {
  copied = JSON.parse(JSON.stringify(target.settings()));
  toast('Adjustments copied.');
}
export function pasteSettings(target) {
  if (!copied) return;
  target.apply(JSON.parse(JSON.stringify(copied)), true);
}

// ---------- Targets ----------

let pending = null;
const previews = new WeakMap(); // photo -> small copy of its original, for live changes

/**
 * While a slider moves, a big photo is filtered at a smaller size so the page
 * keeps up. Letting go filters it at full size.
 */
function livePreview(img) {
  const src = img._originalElement;
  const nw = src.naturalWidth || src.width;
  const nh = src.naturalHeight || src.height;
  const s = Math.min(1, 1400 / Math.max(nw, nh));
  if (s > 0.9) return fullFilter(img);
  let p = previews.get(img);
  if (!p || p.src !== src) {
    const c = document.createElement('canvas');
    c.width = Math.round(nw * s);
    c.height = Math.round(nh * s);
    c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, c.width, c.height);
    p = { src, small: c, out: document.createElement('canvas') };
    previews.set(img, p);
  }
  const { small, out } = p;
  out.width = small.width;
  out.height = small.height;
  const data = small.getContext('2d').getImageData(0, 0, small.width, small.height);
  adjustPixels(data.data, small.width, small.height, settingsOf(img.filters?.find((x) => x.type === 'Adjust')));
  out.getContext('2d').putImageData(data, 0, 0);
  img._element = out;
  img._filterScalingX = out.width / nw;
  img._filterScalingY = out.height / nh;
  img.dirty = true;
  bumpFilterRev();
}

function fullFilter(img) {
  if (img._element !== img._filteredEl) img._element = img._filteredEl || img._originalElement;
  img._filterScalingX = 1;
  img._filterScalingY = 1;
  img.applyFilters();
  const el = img._element;
  const src = img._originalElement;
  if ((el.naturalWidth || el.width) === (src.naturalWidth || src.width)) {
    img._filterScalingX = 1;
    img._filterScalingY = 1;
  }
}

/** A photo as something the panel can edit. */
export function photoTarget(img) {
  return {
    key: img.getSrc(),
    settings: () => settingsOf(img.filters?.find((x) => x.type === 'Adjust')),
    apply(patch, commit) {
      const f = adjustOf(img);
      Object.assign(f, JSON.parse(JSON.stringify(patch)));
      if (commit) {
        cancelAnimationFrame(pending);
        pending = null;
        fullFilter(img);
        canvas.requestRenderAll();
        record();
        emit('adjusted', img);
        return;
      }
      // Filtering a phone photo takes a moment, so live changes are drawn once per frame.
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        livePreview(img);
        canvas.requestRenderAll();
      });
    },
    source: () => img._originalElement || img.getElement(),
    result: () => img.getElement(),
  };
}

// ---------- Helpers ----------

function collapsible(title, build, rerender) {
  const isOpen = open.has(title);
  const head = h(
    'button',
    {
      class: 'section-toggle',
      onclick: () => {
        if (open.has(title)) open.delete(title);
        else open.add(title);
        rerender();
      },
    },
    h('span', { class: 'section-title' }, title),
    h('span', { class: 'chev' + (isOpen ? ' open' : '') }, '›'),
  );
  return h('div', { class: 'section', 'data-section': title }, head, isOpen ? build() : null);
}

function smallCopy(el, side) {
  const nw = el.naturalWidth || el.width;
  const nh = el.naturalHeight || el.height;
  const c = document.createElement('canvas');
  const sc = Math.min(1, side / Math.max(nw, nh));
  c.width = Math.max(1, Math.round(nw * sc));
  c.height = Math.max(1, Math.round(nh * sc));
  c.getContext('2d', { willReadFrequently: true }).drawImage(el, 0, 0, c.width, c.height);
  return c;
}

function lookThumbs(target) {
  if (thumbs.has(target.key)) return thumbs.get(target.key);
  const el = target.source();
  const side = 72;
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const nw = el.naturalWidth || el.width;
  const nh = el.naturalHeight || el.height;
  const s = Math.min(nw, nh);
  ctx.drawImage(el, (nw - s) / 2, (nh - s) / 2, s, s, 0, 0, side, side);
  const base = ctx.getImageData(0, 0, side, side);
  const out = LOOKS.map((look) => {
    const px = new ImageData(new Uint8ClampedArray(base.data), side, side);
    adjustPixels(px.data, side, side, lookSettings(look));
    ctx.putImageData(px, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  });
  thumbs.set(target.key, out);
  return out;
}

/** Histogram of the adjusted picture, with how much of it is clipped to black or white. */
function histogramView(target) {
  const el = target.result();
  const c = smallCopy(el, 260);
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    bins[0][d[i]]++;
    bins[1][d[i + 1]]++;
    bins[2][d[i + 2]]++;
    if (d[i] <= 1 && d[i + 1] <= 1 && d[i + 2] <= 1) lo++;
    if (d[i] >= 254 || d[i + 1] >= 254 || d[i + 2] >= 254) hi++;
    n++;
  }
  const W = 256;
  const H = 90;
  const cv = h('canvas', { class: 'histogram', width: W * 2, height: H * 2 });
  const x = cv.getContext('2d');
  x.setTransform(2, 0, 0, 2, 0, 0);
  x.fillStyle = '#f7f8fa';
  x.fillRect(0, 0, W, H);
  let max = 1;
  for (const b of bins) for (let i = 2; i < 254; i++) max = Math.max(max, b[i]);
  x.globalCompositeOperation = 'multiply';
  ['rgba(220,60,60,0.55)', 'rgba(60,170,90,0.55)', 'rgba(50,100,210,0.55)'].forEach((col, k) => {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, H);
    for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.min(1, bins[k][i] / max) * (H - 4));
    x.lineTo(W, H);
    x.fill();
  });
  x.globalCompositeOperation = 'source-over';
  const pct = (v) => (n ? (v / n) * 100 : 0);
  const loP = pct(lo);
  const hiP = pct(hi);
  const tri = (left, on) => {
    x.fillStyle = on ? (left ? '#2f6bd6' : '#d23b3b') : 'rgba(16,28,43,0.18)';
    x.beginPath();
    if (left) x.moveTo(2, 2), x.lineTo(12, 2), x.lineTo(2, 12);
    else x.moveTo(W - 2, 2), x.lineTo(W - 12, 2), x.lineTo(W - 2, 12);
    x.fill();
  };
  tri(true, loP > 0.5);
  tri(false, hiP > 0.5);
  const fmt = (v) => (v < 0.1 ? '0%' : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);
  return h(
    'div',
    { class: 'stack' },
    cv,
    h('div', { class: 'row muted small' }, h('span', { class: 'grow', title: 'Pure black' }, `Black ${fmt(loP)}`), h('span', { title: 'Pure white in any channel' }, `White ${fmt(hiP)}`)),
  );
}

// ---------- Panel ----------

/** Draws the adjustment controls for `target` into `host`. */
export function drawDevelop(host, target, rerender) {
  const s = target.settings();
  const slider = (key, label, min = -100, max = 100, opts = {}) => {
    const el = rangeField(label, s[key], (v, c) => target.apply({ [key]: v }, c), { min, max, ...opts });
    el.dataset.key = key;
    el.addEventListener('dblclick', () => (target.apply({ [key]: NEUTRAL[key] }, true), rerender()));
    el.title = 'Double-click to reset';
    return el;
  };
  const neutral = JSON.stringify(s) === JSON.stringify(settingsOf(null));

  host.append(
    section(
      'Adjust',
      histogramView(target),
      row(
        h('button', { class: 'btn small grow', title: 'Shift+Ctrl+L sets the light, Shift+Ctrl+B the colour', onclick: () => (target.apply(autoSettings(target.source()), true), rerender()) }, 'Auto'),
        h('button', { class: 'btn small', title: 'Shift+Ctrl+C', onclick: () => copySettings(target) }, 'Copy'),
        h('button', { class: 'btn small', title: 'Shift+Ctrl+V', disabled: !copied, onclick: () => (pasteSettings(target), rerender()) }, 'Paste'),
        h('button', { class: 'btn small', disabled: neutral, onclick: () => (target.apply(JSON.parse(JSON.stringify(NEUTRAL)), true), rerender()) }, 'Reset'),
      ),
    ),
    collapsible(
      'Looks',
      () => {
        const urls = lookThumbs(target);
        const cur = JSON.stringify(s);
        const active = LOOKS.findIndex((l) => JSON.stringify(lookSettings(l)) === cur);
        return h(
          'div',
          { class: 'look-grid' },
          LOOKS.map((look, i) =>
            h(
              'button',
              { class: 'look' + (i === active ? ' on' : ''), title: look.name, onclick: () => (target.apply(lookSettings(look), true), rerender()) },
              h('img', { src: urls[i] }),
              h('span', {}, look.name),
            ),
          ),
        );
      },
      rerender,
    ),
    collapsible(
      'Light',
      () =>
        h(
          'div',
          { class: 'stack gap' },
          slider('exposure', 'Exposure'),
          slider('contrast', 'Contrast'),
          slider('brightness', 'Brightness'),
          slider('highlights', 'Highlights'),
          slider('shadows', 'Shadows'),
          slider('whites', 'Whites'),
          slider('blacks', 'Blacks'),
        ),
      rerender,
    ),
    collapsible(
      'Colour',
      () => h('div', { class: 'stack gap' }, slider('warmth', 'Warmth'), slider('tint', 'Tint'), slider('vibrance', 'Vibrance'), slider('saturation', 'Saturation')),
      rerender,
    ),
    collapsible('Colour mixer', () => mixerUI(target, s, rerender), rerender),
    collapsible(
      'Effects',
      () =>
        h(
          'div',
          { class: 'stack gap' },
          slider('clarity', 'Clarity'),
          slider('texture', 'Texture'),
          slider('dehaze', 'Dehaze'),
          slider('vignette', 'Vignette', 0, 100),
          slider('grain', 'Grain', 0, 100),
          s.grain ? slider('grainSize', 'Grain size', 1, 100) : null,
          slider('fade', 'Fade', 0, 100),
        ),
      rerender,
    ),
    collapsible(
      'Detail',
      () => h('div', { class: 'stack gap' }, slider('sharpen', 'Sharpen', 0, 100), slider('denoise', 'Noise reduction', 0, 100), slider('colorNoise', 'Colour noise', 0, 100)),
      rerender,
    ),
    collapsible(
      'Blur',
      () =>
        h(
          'div',
          { class: 'stack gap' },
          slider('blur', 'Blur', 0, 100),
          slider('motion', 'Motion blur', 0, 100),
          s.motion ? slider('motionAngle', 'Angle', -90, 90, { suffix: '°' }) : null,
          slider('tilt', 'Tilt-shift', 0, 100),
          s.tilt ? slider('tiltPos', 'Focus at', 0, 100, { suffix: '%' }) : null,
          s.tilt ? slider('tiltBand', 'Focus band', 0, 100, { suffix: '%' }) : null,
          slider('pixelate', 'Pixelate', 0, 100),
          h('p', { class: 'muted small' }, 'Tilt-shift keeps a band across the picture sharp and blurs above and below it, so a street looks like a model.'),
        ),
      rerender,
    ),
    collapsible('Curves and levels', () => curvesUI(target, s, rerender), rerender),
    collapsible(
      'Colour grading',
      () =>
        h(
          'div',
          { class: 'stack gap' },
          colorRow('Shadows', s.shadowsColor, (c) => target.apply({ shadowsColor: c }, true)),
          rangeField('Amount', s.shadowsAmount, (v, c) => target.apply({ shadowsAmount: v }, c), { min: 0, max: 100 }),
          colorRow('Highlights', s.highlightsColor, (c) => target.apply({ highlightsColor: c }, true)),
          rangeField('Amount', s.highlightsAmount, (v, c) => target.apply({ highlightsAmount: v }, c), { min: 0, max: 100 }),
          rangeField('Balance', s.balance, (v, c) => target.apply({ balance: v }, c), { min: -100, max: 100 }),
        ),
      rerender,
    ),
    collapsible(
      'Photo filter',
      () =>
        h(
          'div',
          { class: 'stack gap' },
          h(
            'div',
            { class: 'swatches small' },
            [
              ['#ec8a00', 'Warming'],
              ['#ffb24a', 'Warm gold'],
              ['#006dff', 'Cooling'],
              ['#5ab4ff', 'Sky blue'],
              ['#e8186e', 'Magenta'],
              ['#00a86b', 'Green'],
              ['#704214', 'Sepia'],
            ].map(([c, name]) => h('button', { class: 'swatch small', title: name, style: { background: c }, onclick: () => (target.apply({ filterColor: c, filterAmount: s.filterAmount || 35 }, true), rerender()) })),
          ),
          colorRow('Colour', s.filterColor, (c) => target.apply({ filterColor: c }, true)),
          slider('filterAmount', 'Density', 0, 100),
        ),
      rerender,
    ),
    collapsible('Colour lookup', () => lutUI(target, s, rerender), rerender),
  );

  if (focus) {
    const f = focus;
    focus = null;
    requestAnimationFrame(() => {
      const el = (f.key && host.querySelector(`[data-key="${f.key}"]`)) || host.querySelector(`[data-section="${f.section}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1400);
    });
  }
}

function colorRow(label, value, onChange) {
  const input = h('input', { type: 'color', class: 'color', value: toHex(value) });
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { class: 'row' }, h('span', { class: 'label grow' }, label), input);
}

// ---------- Colour mixer ----------

let mixerTab = 'hue';

function mixerUI(target, s, rerender) {
  const tabs = [
    ['hue', 'Hue'],
    ['sat', 'Saturation'],
    ['lum', 'Luminance'],
  ];
  const list = s.bw ? s.bwMix : s.mixer[mixerTab];
  const set = (i, v, c) => {
    if (s.bw) {
      const next = [...target.settings().bwMix];
      next[i] = v;
      target.apply({ bwMix: next }, c);
    } else {
      const m = JSON.parse(JSON.stringify(target.settings().mixer));
      m[mixerTab][i] = v;
      target.apply({ mixer: m }, c);
    }
  };
  return h(
    'div',
    { class: 'stack gap' },
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: s.bw, onchange: (e) => (target.apply({ bw: e.target.checked }, true), rerender()) }),
      'Black and white',
    ),
    s.bw
      ? h('p', { class: 'muted small' }, 'Each slider makes that colour lighter or darker in grey.')
      : h(
          'div',
          { class: 'seg small' },
          tabs.map(([v, label]) => h('button', { class: mixerTab === v ? 'on' : '', onclick: () => ((mixerTab = v), rerender()) }, label)),
        ),
    BANDS.map(([name, , col], i) => {
      const el = rangeField(name, list[i], (v, c) => set(i, v, c), { min: -100, max: 100 });
      el.querySelector('.label').prepend(h('span', { class: 'band-dot', style: { background: col } }));
      return el;
    }),
    h(
      'button',
      {
        class: 'link',
        onclick: () => {
          if (s.bw) target.apply({ bwMix: [0, 0, 0, 0, 0, 0, 0, 0] }, true);
          else target.apply({ mixer: { hue: [0, 0, 0, 0, 0, 0, 0, 0], sat: [0, 0, 0, 0, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 0, 0, 0] } }, true);
          rerender();
        },
      },
      'Reset mixer',
    ),
  );
}

// ---------- Colour lookup ----------

async function loadCube(target, rerender) {
  const files = await pickFiles({ extensions: ['cube'], label: 'Colour lookup (.cube)' });
  if (!files?.length) return;
  addCube(target, files[0].name, files[0].bytes, rerender);
}

/** Uses a .cube file's bytes on a target. */
export function addCube(target, name, bytes, rerender) {
  try {
    parseCube(new TextDecoder().decode(bytes));
  } catch (e) {
    toast(e.message, { error: true });
    return;
  }
  const url = registerBytes(bytes, 'application/x-cube');
  target.apply({ lut: { url, name: name.replace(/\.cube$/i, '') }, lutAmount: 100 }, true);
  rerender?.();
}

function lutUI(target, s, rerender) {
  return h(
    'div',
    { class: 'stack gap' },
    h(
      'select',
      {
        class: 'field',
        onchange: (e) => {
          const v = e.target.value;
          if (v === '__load') return loadCube(target, rerender);
          const b = BUILT_IN.find((x) => x.id === v);
          target.apply({ lut: b ? { url: b.id, name: b.name } : null }, true);
          rerender();
        },
      },
      h('option', { value: '', selected: !s.lut }, 'None'),
      BUILT_IN.map((b) => h('option', { value: b.id, selected: s.lut?.url === b.id }, b.name)),
      s.lut && !BUILT_IN.some((b) => b.id === s.lut.url) ? h('option', { value: s.lut.url, selected: true }, s.lut.name || 'Added file') : null,
      h('option', { value: '__load' }, 'Load a .cube file'),
    ),
    s.lut ? rangeField('Amount', s.lutAmount ?? 100, (v, c) => target.apply({ lutAmount: v }, c), { min: 0, max: 100, suffix: '%' }) : null,
    h('p', { class: 'muted small' }, 'A .cube file is a colour look from Premiere, DaVinci Resolve or a LUT pack. It is kept inside the design file.'),
  );
}

// ---------- Curves ----------

let channel = 'rgb';
const CH_COLOR = { rgb: '#101c2b', r: '#d23b3b', g: '#2f9e5b', b: '#1f5e99' };
const hists = new Map();

function sourceHistogram(target) {
  if (hists.has(target.key)) return hists.get(target.key);
  const c = smallCopy(target.source(), 400);
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const hist = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256) };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    hist.r[d[i]]++;
    hist.g[d[i + 1]]++;
    hist.b[d[i + 2]]++;
    hist.l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
  }
  hists.set(target.key, hist);
  return hist;
}

function curvesUI(target, s, rerender) {
  const hist = sourceHistogram(target);
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
  const send = (commit) => target.apply({ curves: JSON.parse(JSON.stringify(curves)) }, commit);
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
    send(false);
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
    send(false);
  });
  cv.addEventListener('pointerup', () => {
    if (drag < 0) return;
    drag = -1;
    send(true);
  });
  cv.addEventListener('dblclick', (e) => {
    const [x, y] = toVal(e);
    const pts = curves[channel];
    const i = pts.findIndex(([px, py]) => Math.abs(px - x) < 10 && Math.abs(py - y) < 14);
    if (i > 0 && i < pts.length - 1) {
      pts.splice(i, 1);
      draw();
      send(true);
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
  const levels = () => target.settings().levels;
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
          send(true);
        },
      },
      'Reset curve',
    ),
    h('div', { class: 'section-title sub' }, 'Levels'),
    rangeField('Black point', lv.black, (v, c) => target.apply({ levels: { ...levels(), black: Math.min(v, levels().white - 2) } }, c), { min: 0, max: 253 }),
    rangeField('Midtones', Math.round(lv.gamma * 100), (v, c) => target.apply({ levels: { ...levels(), gamma: v / 100 } }, c), { min: 20, max: 300 }),
    rangeField('White point', lv.white, (v, c) => target.apply({ levels: { ...levels(), white: Math.max(v, levels().black + 2) } }, c), { min: 2, max: 255 }),
    h(
      'button',
      {
        class: 'link',
        onclick: () => {
          target.apply({ levels: { black: 0, gamma: 1, white: 255 } }, true);
          rerender();
        },
      },
      'Reset levels',
    ),
  );
}

export { row, section };
