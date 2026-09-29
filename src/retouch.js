import { canvas } from './canvas.js';
import { emit } from './state.js';
import { record } from './history.js';
import { registerBlob, loadImage, blobFor } from './assets.js';
import { swapElement } from './bgremove.js';
import { canvasBlob } from './layerfx.js';
import { h, ICONS, toast } from './ui.js';

// The retouch editor. Spot heal paints over a mark and fills it from nearby
// skin or surface, matching the light around it. Clone copies from a spot you
// pick with Alt+click. Works on the photo at its own resolution.

/** Jacobi relaxation of the masked cells of D, with the rest held fixed. */
function relax(D, mask, w, hh, iters) {
  for (let it = 0; it < iters; it++) {
    for (let y = 1; y < hh - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i]) D[i] = (D[i - 1] + D[i + 1] + D[i - w] + D[i + w]) * 0.25;
      }
    }
  }
}

/**
 * Fills the masked cells of D smoothly from the values around them. Large areas
 * are solved on a smaller grid first, then refined at full size.
 */
function membrane(D, mask, w, hh) {
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < D.length; i++) if (!mask[i]) (sum += D[i]), cnt++;
  const mean = cnt ? sum / cnt : 0;
  for (let i = 0; i < D.length; i++) if (mask[i]) D[i] = mean;
  const big = Math.max(w, hh);
  if (big > 96) {
    const f = Math.ceil(big / 64);
    const sw = Math.ceil(w / f);
    const sh = Math.ceil(hh / f);
    const sd = new Float32Array(sw * sh);
    const sm = new Uint8Array(sw * sh);
    const cntd = new Float32Array(sw * sh);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const j = Math.floor(y / f) * sw + Math.floor(x / f);
        if (mask[i]) sm[j] = 1;
        else {
          sd[j] += D[i];
          cntd[j]++;
        }
      }
    }
    for (let j = 0; j < sd.length; j++) {
      if (sm[j] || !cntd[j]) {
        sm[j] = 1;
        sd[j] = mean;
      } else sd[j] /= cntd[j];
    }
    relax(sd, sm, sw, sh, 300);
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const fx = Math.min(sw - 1, Math.max(0, x / f - 0.5));
        const fy = Math.min(sh - 1, Math.max(0, y / f - 0.5));
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const x1 = Math.min(sw - 1, x0 + 1);
        const y1 = Math.min(sh - 1, y0 + 1);
        const ax = fx - x0;
        const ay = fy - y0;
        D[i] = (sd[y0 * sw + x0] * (1 - ax) + sd[y0 * sw + x1] * ax) * (1 - ay) + (sd[y1 * sw + x0] * (1 - ax) + sd[y1 * sw + x1] * ax) * ay;
      }
    }
    relax(D, mask, w, hh, 40);
  } else relax(D, mask, w, hh, Math.max(60, big * 3));
}

export async function openRetouch(obj) {
  if (!obj || obj.type !== 'image') return;
  const img = await loadImage(obj.getSrc());
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const work = document.createElement('canvas');
  work.width = W;
  work.height = H;
  const wx = work.getContext('2d', { willReadFrequently: true });
  wx.drawImage(img, 0, 0);

  const S = {
    tool: 'heal',
    size: Math.max(8, Math.round(Math.max(W, H) / 60)),
    hard: 40,
    source: null, // clone source point in image pixels
    offset: null,
    undo: [],
    redo: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    stroke: null,
    pointer: null,
    space: false,
    busy: false,
    changed: false,
  };

  const cv = h('canvas', { class: 'cut-canvas' });
  const stage = h('div', { class: 'cut-stage' }, cv);
  const side = h('div', { class: 'cut-side' });
  const status = h('div', { class: 'cut-status muted small' });
  const back = h(
    'div',
    { class: 'modal-back cut-back' },
    h(
      'div',
      { class: 'cut-modal' },
      h('div', { class: 'modal-head' }, h('h2', {}, 'Retouch'), h('button', { class: 'icon-btn', title: 'Close', onclick: () => close(false), html: ICONS.close })),
      h('div', { class: 'cut-body' }, stage, side),
      h(
        'div',
        { class: 'modal-foot' },
        status,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => close(true) }, 'Apply'),
      ),
    ),
  );
  document.body.appendChild(back);
  const say = (t) => (status.textContent = t || '');

  // ---------- Layout and drawing ----------
  let fit = { scale: 1, ox: 0, oy: 0, base: 1 };
  function layout() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    cv.style.width = `${r.width}px`;
    cv.style.height = `${r.height}px`;
    const base = Math.min((r.width - 40) / W, (r.height - 40) / H);
    const scale = base * S.zoom;
    fit = { base, scale, ox: (r.width - W * scale) / 2 + S.panX, oy: (r.height - H * scale) / 2 + S.panY };
    draw();
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#e3e8ee';
    x.fillRect(0, 0, cv.width, cv.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(work, fit.ox, fit.oy, W * fit.scale, H * fit.scale);
    const toS = (p) => [fit.ox + p.x * fit.scale, fit.oy + p.y * fit.scale];
    if (S.stroke?.kind === 'heal' && S.stroke.points.length) {
      x.strokeStyle = 'rgba(224,180,90,0.55)';
      x.lineWidth = S.size * fit.scale;
      x.lineCap = 'round';
      x.lineJoin = 'round';
      x.beginPath();
      S.stroke.points.forEach((p, i) => (i ? x.lineTo(...toS(p)) : x.moveTo(...toS(p))));
      if (S.stroke.points.length === 1) x.lineTo(...toS(S.stroke.points[0]));
      x.stroke();
    }
    if (S.pointer && !S.space) {
      const [px, py] = toS(S.pointer);
      const r = (S.size / 2) * fit.scale;
      x.lineWidth = 1;
      x.strokeStyle = '#fff';
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.stroke();
      x.strokeStyle = '#101c2b';
      x.beginPath();
      x.arc(px, py, r + 1, 0, Math.PI * 2);
      x.stroke();
      // Where the clone brush is reading from.
      if (S.tool === 'clone' && S.source) {
        const at = S.offset ? { x: S.pointer.x + S.offset.x, y: S.pointer.y + S.offset.y } : S.source;
        const [sx, sy] = toS(at);
        x.strokeStyle = '#e0b45a';
        x.beginPath();
        x.moveTo(sx - 7, sy);
        x.lineTo(sx + 7, sy);
        x.moveTo(sx, sy - 7);
        x.lineTo(sx, sy + 7);
        x.stroke();
        x.beginPath();
        x.arc(sx, sy, r, 0, Math.PI * 2);
        x.stroke();
      }
    }
  }
  const ro = new ResizeObserver(layout);
  ro.observe(stage);

  // ---------- Side panel ----------
  function drawSide() {
    side.innerHTML = '';
    const tool = (v, label, key) => h('button', { class: S.tool === v ? 'on' : '', title: `${label} (${key})`, onclick: () => setTool(v) }, label);
    const slider = (label, value, min, max, set, suffix = '') => {
      const out = h('span', { class: 'range-value' }, `${value}${suffix}`);
      const input = h('input', { type: 'range', min, max, value });
      input.addEventListener('input', () => {
        set(+input.value);
        out.textContent = `${input.value}${suffix}`;
        draw();
      });
      return h('label', { class: 'range-field' }, h('span', { class: 'label' }, label), input, out);
    };
    side.append(
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, 'Tool'),
        h('div', { class: 'seg' }, tool('heal', 'Spot heal', 'J'), tool('clone', 'Clone', 'S')),
        slider('Brush size', S.size, 2, Math.round(Math.max(W, H) / 4), (v) => (S.size = v), ' px'),
        S.tool === 'clone' ? slider('Hardness', S.hard, 0, 100, (v) => (S.hard = v), '%') : null,
        h(
          'p',
          { class: 'muted small' },
          S.tool === 'heal'
            ? 'Paint over a spot, a stray hair or a speck of dust. It fills from the area around it when you let go. Use it on product shots and backgrounds, and keep it off treatment results in before-and-after photos.'
            : S.source
              ? 'Paint to copy from the gold cross. Alt+click somewhere else to pick a new spot.'
              : 'Alt+click the spot to copy from, then paint where it should go.',
        ),
      ),
      h(
        'div',
        { class: 'section' },
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'icon-btn', title: 'Undo (Ctrl+Z)', disabled: !S.undo.length || S.busy, onclick: () => step(-1), html: ICONS.undo }),
          h('button', { class: 'icon-btn', title: 'Redo (Ctrl+Y)', disabled: !S.redo.length || S.busy, onclick: () => step(1), html: ICONS.redo }),
          h('span', { class: 'grow' }),
          h('button', { class: 'icon-btn', title: 'Fit', onclick: resetView, html: ICONS.fit }),
        ),
        h('p', { class: 'muted small' }, 'Scroll to zoom. Hold Space and drag to move around. [ and ] change the brush size.'),
      ),
    );
  }
  function setTool(t) {
    S.tool = t;
    drawSide();
    draw();
  }
  function resetView() {
    S.zoom = 1;
    S.panX = 0;
    S.panY = 0;
    layout();
  }
  drawSide();

  // ---------- Undo ----------
  function remember(x0, y0, w, hh) {
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    w = Math.min(W - x0, Math.ceil(w));
    hh = Math.min(H - y0, Math.ceil(hh));
    if (w <= 0 || hh <= 0) return null;
    return { x: x0, y: y0, data: wx.getImageData(x0, y0, w, hh) };
  }
  function push(before) {
    if (!before) return;
    S.undo.push(before);
    if (S.undo.length > 40) S.undo.shift();
    S.redo = [];
    S.changed = true;
    drawSide();
  }
  function step(dir) {
    const from = dir < 0 ? S.undo : S.redo;
    const to = dir < 0 ? S.redo : S.undo;
    const rec = from.pop();
    if (!rec) return;
    to.push({ x: rec.x, y: rec.y, data: wx.getImageData(rec.x, rec.y, rec.data.width, rec.data.height) });
    wx.putImageData(rec.data, rec.x, rec.y);
    S.changed = true;
    drawSide();
    draw();
  }

  // ---------- Clone ----------
  let snap = null;
  function cloneDab(p) {
    const r = S.size / 2;
    const d = Math.ceil(r * 2);
    const dab = document.createElement('canvas');
    dab.width = d;
    dab.height = d;
    const dx = dab.getContext('2d');
    dx.drawImage(snap, p.x + S.offset.x - r, p.y + S.offset.y - r, d, d, 0, 0, d, d);
    const g = dx.createRadialGradient(r, r, r * (S.hard / 100), r, r, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dx.globalCompositeOperation = 'destination-in';
    dx.fillStyle = g;
    dx.fillRect(0, 0, d, d);
    wx.drawImage(dab, p.x - r, p.y - r);
  }

  // ---------- Heal ----------
  async function heal(points) {
    const r = S.size / 2;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
    const band = Math.ceil(r * 0.6) + 2;
    const bx = Math.max(0, Math.floor(x0 - band));
    const by = Math.max(0, Math.floor(y0 - band));
    const bw = Math.min(W, Math.ceil(x1 + band)) - bx;
    const bh = Math.min(H, Math.ceil(y1 + band)) - by;
    if (bw < 3 || bh < 3) return;
    // The painted area as a soft mask over the box.
    const mc = document.createElement('canvas');
    mc.width = bw;
    mc.height = bh;
    const mx = mc.getContext('2d', { willReadFrequently: true });
    mx.strokeStyle = '#fff';
    mx.fillStyle = '#fff';
    mx.lineWidth = S.size;
    mx.lineCap = 'round';
    mx.lineJoin = 'round';
    mx.beginPath();
    points.forEach((p, i) => (i ? mx.lineTo(p.x - bx, p.y - by) : mx.moveTo(p.x - bx, p.y - by)));
    if (points.length === 1) {
      mx.arc(points[0].x - bx, points[0].y - by, r, 0, Math.PI * 2);
      mx.fill();
    } else mx.stroke();
    const md = mx.getImageData(0, 0, bw, bh).data;
    const n = bw * bh;
    const inMask = new Uint8Array(n);
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      alpha[i] = md[i * 4 + 3] / 255;
      inMask[i] = alpha[i] > 0.02 ? 1 : 0;
    }
    // Soften the edge of the fill a little.
    const tgt = wx.getImageData(bx, by, bw, bh);
    const T = tgt.data;

    // Pick the nearby patch whose surroundings match best.
    const ring = [];
    for (let i = 0; i < n; i++) if (!inMask[i]) ring.push(i);
    const far = Math.max(bw, bh);
    let best = null;
    for (const dist of [0.9, 1.4, 2]) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const ox = Math.round(Math.cos(ang) * far * dist);
        const oy = Math.round(Math.sin(ang) * far * dist);
        if (bx + ox < 0 || by + oy < 0 || bx + ox + bw > W || by + oy + bh > H) continue;
        const src = wx.getImageData(bx + ox, by + oy, bw, bh).data;
        let score = 0;
        const stride = Math.max(1, Math.floor(ring.length / 400));
        for (let k = 0; k < ring.length; k += stride) {
          const i = ring[k] * 4;
          score += (T[i] - src[i]) ** 2 + (T[i + 1] - src[i + 1]) ** 2 + (T[i + 2] - src[i + 2]) ** 2;
        }
        // Inside the patch, prefer an even texture over edges and other spots.
        let vari = 0;
        for (let k = 0; k < n; k += Math.max(1, Math.floor(n / 400))) {
          if (!inMask[k]) continue;
          const i = k * 4;
          const j = Math.min(n - 1, k + 1) * 4;
          vari += Math.abs(src[i] - src[j]) + Math.abs(src[i + 1] - src[j + 1]) + Math.abs(src[i + 2] - src[j + 2]);
        }
        score += vari * 40;
        if (!best || score < best.score) best = { score, src };
      }
      if (best) break;
    }
    if (!best) return toast('There is no room around this spot to heal from. Try Clone.');
    const Sd = best.src;

    // Match the light: carry the difference at the edge of the painted area
    // smoothly into it (a membrane fill), then add it to the copied patch.
    const diff = [0, 1, 2].map((c) => {
      const D = new Float32Array(n);
      for (let i = 0; i < n; i++) if (!inMask[i]) D[i] = T[i * 4 + c] - Sd[i * 4 + c];
      membrane(D, inMask, bw, bh);
      return D;
    });
    for (let i = 0; i < n; i++) {
      if (!inMask[i]) continue;
      const a = Math.min(1, alpha[i] * 1.15);
      for (let c = 0; c < 3; c++) {
        const v = Sd[i * 4 + c] + diff[c][i];
        T[i * 4 + c] = Math.max(0, Math.min(255, T[i * 4 + c] * (1 - a) + v * a));
      }
    }
    push(remember(bx, by, bw, bh));
    wx.putImageData(tgt, bx, by);
  }

  // ---------- Pointer ----------
  const toImage = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left - fit.ox) / fit.scale, y: (e.clientY - r.top - fit.oy) / fit.scale };
  };
  let pan = null;
  cv.addEventListener('pointerdown', async (e) => {
    cv.setPointerCapture(e.pointerId);
    if (S.space || e.button === 1) {
      pan = { x: e.clientX, y: e.clientY, px: S.panX, py: S.panY };
      return;
    }
    if (e.button !== 0 || S.busy) return;
    const p = toImage(e);
    if (S.tool === 'clone') {
      if (e.altKey) {
        S.source = p;
        S.offset = null;
        drawSide();
        draw();
        return;
      }
      if (!S.source) return say('Alt+click the spot to copy from first.');
      S.offset = S.offset || { x: S.source.x - p.x, y: S.source.y - p.y };
      snap = document.createElement('canvas');
      snap.width = W;
      snap.height = H;
      snap.getContext('2d').drawImage(work, 0, 0);
      S.stroke = { kind: 'clone', last: p, box: [p.x, p.y, p.x, p.y], before: snap };
      cloneDab(p);
    } else S.stroke = { kind: 'heal', points: [p] };
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = toImage(e);
    S.pointer = p;
    if (pan) {
      S.panX = pan.px + e.clientX - pan.x;
      S.panY = pan.py + e.clientY - pan.y;
      return layout();
    }
    const st = S.stroke;
    if (st?.kind === 'heal') {
      const l = st.points[st.points.length - 1];
      if (Math.hypot(p.x - l.x, p.y - l.y) > S.size * 0.15) st.points.push(p);
    } else if (st?.kind === 'clone') {
      const stepLen = Math.max(1, S.size * 0.15);
      const d = Math.hypot(p.x - st.last.x, p.y - st.last.y);
      for (let t = stepLen; t <= d; t += stepLen) cloneDab({ x: st.last.x + ((p.x - st.last.x) * t) / d, y: st.last.y + ((p.y - st.last.y) * t) / d });
      if (d >= stepLen) st.last = p;
      st.box = [Math.min(st.box[0], p.x), Math.min(st.box[1], p.y), Math.max(st.box[2], p.x), Math.max(st.box[3], p.y)];
    }
    draw();
  });
  const end = async () => {
    if (pan) {
      pan = null;
      return;
    }
    const st = S.stroke;
    S.stroke = null;
    if (!st) return;
    if (st.kind === 'clone') {
      // Undo keeps the area the stroke covered, read from the copy made at its start.
      const r = S.size / 2 + 2;
      const [a, b, c, d] = st.box;
      const x0 = Math.max(0, Math.floor(a - r));
      const y0 = Math.max(0, Math.floor(b - r));
      const w = Math.min(W - x0, Math.ceil(c - a + 2 * r));
      const hh = Math.min(H - y0, Math.ceil(d - b + 2 * r));
      push({ x: x0, y: y0, data: st.before.getContext('2d').getImageData(x0, y0, w, hh) });
      snap = null;
    } else {
      S.busy = true;
      say('Healing');
      await new Promise((r) => setTimeout(r, 10));
      try {
        await heal(st.points);
      } finally {
        S.busy = false;
        say('');
      }
    }
    drawSide();
    draw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => {
    S.pointer = null;
    draw();
  });
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const ix = (mx - fit.ox) / fit.scale;
      const iy = (my - fit.oy) / fit.scale;
      S.zoom = Math.min(40, Math.max(0.5, S.zoom * Math.pow(0.999, e.deltaY)));
      const scale = fit.base * S.zoom;
      S.panX = mx - ix * scale - (r.width - W * scale) / 2;
      S.panY = my - iy * scale - (r.height - H * scale) / 2;
      layout();
    },
    { passive: false },
  );

  // ---------- Keys ----------
  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    e.stopPropagation();
    if (k === 'escape') return close(false);
    if (k === 'enter') return close(true);
    if (mod && k === 'z' && !e.shiftKey) return e.preventDefault(), step(-1);
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return e.preventDefault(), step(1);
    if (e.code === 'Space') {
      e.preventDefault();
      S.space = true;
      cv.style.cursor = 'grab';
      return;
    }
    if (mod) return;
    if (k === 'j') setTool('heal');
    if (k === 's') setTool('clone');
    if (k === '[' || k === ']') {
      S.size = Math.max(2, Math.round(S.size * (k === ']' ? 1.2 : 1 / 1.2)));
      drawSide();
      draw();
    }
  };
  const onKeyUp = (e) => {
    if (e.code === 'Space') {
      S.space = false;
      cv.style.cursor = '';
    }
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);

  async function close(apply) {
    if (S.busy) return;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    ro.disconnect();
    back.remove();
    if (!apply || !S.changed) return;
    const jpeg = blobFor(obj.getSrc())?.type === 'image/jpeg';
    const blob = jpeg ? await new Promise((r) => work.toBlob(r, 'image/jpeg', 0.95)) : await canvasBlob(work);
    const url = registerBlob(blob);
    await swapElement(obj, url);
    if (obj.filters?.length) obj.applyFilters();
    canvas.requestRenderAll();
    record(true);
    emit('objects');
  }
}
