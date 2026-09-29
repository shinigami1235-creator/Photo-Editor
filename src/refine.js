import { canvas, decorate } from './canvas.js';
import { loadImage, registerBlob } from './assets.js';
import { record } from './history.js';
import { emit } from './state.js';
import { h, toast, ICONS } from './ui.js';
import { loadModel, runModel, modelRect, compose, swapElement } from './bgremove.js';

// The cut-out editor. Drag a box around the subject so the model only looks
// inside it, run the model, then fix what it got wrong with the Erase and
// Restore brushes. Every step can be undone. The box and strokes are saved on
// the photo, so the cut-out can be edited again later.

const WORK_MAX = 1600; // longest side of the preview, in pixels
const clone = (s) => JSON.parse(JSON.stringify(s));
const boxKey = (b) => JSON.stringify(b ?? null);

export async function openCutout(obj) {
  if (!obj || obj.type !== 'image') return;
  const source = obj.originalSrc || obj.getSrc();
  const img = await loadImage(source);
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  const ws = Math.min(1, WORK_MAX / Math.max(natW, natH));
  const work = new OffscreenCanvas(Math.round(natW * ws), Math.round(natH * ws));
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(img, 0, 0, work.width, work.height);
  const pic = wctx.getImageData(0, 0, work.width, work.height);
  const preview = new OffscreenCanvas(work.width, work.height);

  const S = {
    tool: 'box', // box | brush | wand | lasso
    mode: 'erase', // erase | restore
    contiguous: true,
    brushPx: Math.round(Math.max(natW, natH) / 40),
    tol: 35,
    view: 'checks',
    hist: [clone(obj.cutout || { box: null, ranBox: undefined, strokes: [] })],
    idx: 0,
    masks: new Map(),
    busy: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    live: null, // stroke or box being drawn
    pointer: null,
    space: false,
  };
  const cur = () => S.hist[S.idx];

  // ---------- Layout ----------
  const cv = h('canvas', { class: 'cut-canvas' });
  const status = h('div', { class: 'cut-status muted small' });
  const side = h('div', { class: 'cut-side' });
  const stage = h('div', { class: 'cut-stage' }, cv);
  const back = h(
    'div',
    { class: 'modal-back cut-back' },
    h(
      'div',
      { class: 'cut-modal' },
      h('div', { class: 'modal-head' }, h('h2', {}, 'Cut-out'), h('button', { class: 'icon-btn', title: 'Close', onclick: () => close(false), html: ICONS.close })),
      h('div', { class: 'cut-body' }, stage, side),
      h(
        'div',
        { class: 'modal-foot' },
        status,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn', title: 'Keeps this photo as it is and adds the cut-out on top', onclick: () => close(true, true) }, 'Apply as new photo'),
        h('button', { class: 'btn primary', onclick: () => close(true) }, 'Apply'),
      ),
    ),
  );
  document.body.appendChild(back);
  const say = (t) => (status.textContent = t || '');

  // ---------- Model ----------
  async function maskFor(box) {
    const key = boxKey(box);
    if (S.masks.has(key)) return S.masks.get(key);
    S.busy = true;
    drawSide();
    try {
      const provider = await loadModel((t) => say(t));
      say(provider === 'gpu' ? 'Finding the subject' : 'Finding the subject on the CPU');
      const mask = await runModel(img, modelRect(box, natW, natH));
      S.masks.set(key, mask);
      say('');
      return mask;
    } finally {
      S.busy = false;
      drawSide();
    }
  }

  async function run() {
    if (S.busy) return;
    try {
      const s = clone(cur());
      await maskFor(s.box);
      s.ranBox = s.box;
      push(s);
    } catch (e) {
      console.error(e);
      say(`Background removal failed: ${e.message}`);
    }
  }

  // ---------- History ----------
  function push(s) {
    S.hist = S.hist.slice(0, S.idx + 1);
    S.hist.push(clone(s));
    S.idx = S.hist.length - 1;
    recompose();
  }
  async function step(dir) {
    const next = S.idx + dir;
    if (next < 0 || next >= S.hist.length || S.busy) return;
    S.idx = next;
    recompose();
  }

  async function recompose() {
    const s = cur();
    let mask = null;
    if (s.ranBox !== undefined) {
      try {
        mask = await maskFor(s.ranBox);
      } catch (e) {
        say(`Background removal failed: ${e.message}`);
      }
    }
    const rect = modelRect(s.ranBox ?? null, work.width, work.height);
    const out = compose(pic, mask, rect, s.strokes);
    preview.getContext('2d').putImageData(out, 0, 0);
    drawSide();
    draw();
  }

  // ---------- Drawing ----------
  let fit = { scale: 1, ox: 0, oy: 0 };
  function layout() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    cv.style.width = `${r.width}px`;
    cv.style.height = `${r.height}px`;
    const base = Math.min((r.width - 40) / work.width, (r.height - 40) / work.height);
    const scale = base * S.zoom;
    fit = {
      base,
      scale,
      ox: (r.width - work.width * scale) / 2 + S.panX,
      oy: (r.height - work.height * scale) / 2 + S.panY,
      dpr,
    };
    draw();
  }

  let checks = null;
  function checkPattern(ctx) {
    if (checks) return checks;
    const t = new OffscreenCanvas(16, 16);
    const c = t.getContext('2d');
    c.fillStyle = '#cfd2d8';
    c.fillRect(0, 0, 16, 16);
    c.fillStyle = '#f2f3f5';
    c.fillRect(0, 0, 8, 8);
    c.fillRect(8, 8, 8, 8);
    checks = ctx.createPattern(t, 'repeat');
    return checks;
  }

  function draw() {
    const ctx = cv.getContext('2d');
    const { scale, ox, oy, dpr } = fit;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#e3e8ee';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const iw = work.width * scale;
    const ih = work.height * scale;
    ctx.fillStyle = S.view === 'white' ? '#ffffff' : S.view === 'black' ? '#000000' : checkPattern(ctx);
    ctx.fillRect(ox, oy, iw, ih);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(preview, ox, oy, iw, ih);

    const box = S.live?.kind === 'box' ? S.live.box : cur().box;
    if (box) {
      const [x0, y0, x1, y1] = box.map((v, i) => (i % 2 ? oy + v * ih : ox + v * iw));
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.rect(ox, oy, iw, ih);
      ctx.rect(x0, y1, x1 - x0, y0 - y1);
      ctx.fill('evenodd');
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#1f5e99';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }

    if (S.live?.kind === 'stroke') {
      const st = S.live.stroke;
      ctx.strokeStyle = st.mode === 'erase' ? 'rgba(255,80,80,0.45)' : 'rgba(70,210,120,0.45)';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = st.size * iw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      st.points.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * iw, oy + y * ih) : ctx.moveTo(ox + x * iw, oy + y * ih)));
      if (st.points.length === 1) ctx.arc(ox + st.points[0][0] * iw, oy + st.points[0][1] * ih, (st.size * iw) / 2, 0, Math.PI * 2);
      st.points.length === 1 ? ctx.fill() : ctx.stroke();
    }

    if (S.live?.kind === 'lasso' && S.live.points.length > 1) {
      ctx.fillStyle = 'rgba(70,210,120,0.25)';
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      S.live.points.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * iw, oy + y * ih) : ctx.moveTo(ox + x * iw, oy + y * ih)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (S.pointer && S.tool === 'brush' && !S.space) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(S.pointer.x, S.pointer.y, (S.brushPx / natW) * iw * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.beginPath();
      ctx.arc(S.pointer.x, S.pointer.y, (S.brushPx / natW) * iw * 0.5 + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ---------- Side panel ----------
  function drawSide() {
    const s = cur();
    const ran = s.ranBox !== undefined;
    const stale = ran && boxKey(s.ranBox) !== boxKey(s.box);
    const tool = (id, label, key) =>
      h('button', { class: 'btn' + (S.tool === id ? ' on' : ''), title: `${label} (${key})`, onclick: () => setTool(id) }, label);
    const seg = (items) =>
      h(
        'div',
        { class: 'seg' },
        items.map(([v, label]) =>
          h('button', {
            class: S.view === v ? 'on' : '',
            onclick: () => {
              S.view = v;
              drawSide();
              draw();
            },
          }, label),
        ),
      );
    side.innerHTML = '';
    side.append(
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, 'Subject'),
        h('p', { class: 'muted small' }, 'Drag a box around the subject so the model only looks inside it. Leave it empty to use the whole picture.'),
        h(
          'div',
          { class: 'row' },
          tool('box', 'Box', 'M'),
          s.box ? h('button', { class: 'link', onclick: () => push({ ...clone(s), box: null }) }, 'Clear box') : null,
        ),
        h(
          'button',
          { class: 'btn wide' + (!ran || stale ? ' primary' : ''), disabled: S.busy, onclick: run },
          S.busy ? 'Working' : ran && !stale ? 'Run again' : 'Remove background',
        ),
        stale ? h('p', { class: 'muted small' }, 'The box changed. Press Remove background to use it.') : null,
      ),
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, 'Touch up'),
        S.tool !== 'lasso'
          ? h(
              'div',
              { class: 'seg' },
              [
                ['erase', 'Erase (E)'],
                ['restore', 'Restore (R)'],
              ].map(([v, label]) => h('button', { class: S.mode === v ? 'on' : '', onclick: () => setMode(v) }, label)),
            )
          : null,
        h('div', { class: 'row' }, tool('brush', 'Brush', 'B'), tool('wand', 'Wand', 'W'), tool('lasso', 'Lasso', 'L')),
        S.tool === 'lasso'
          ? h(
              'button',
              { class: 'btn wide', title: 'Ctrl+Shift+I', disabled: lastLasso() < 0 || S.busy, onclick: invertLasso },
              lastLasso() >= 0 && !cur().strokes[lastLasso()].keep ? 'Invert selection: removing inside' : 'Invert selection',
            )
          : null,
        S.tool === 'brush' ? slider('Brush size', S.brushPx, 2, Math.round(Math.max(natW, natH) / 4), (v) => (S.brushPx = v), ' px') : null,
        S.tool !== 'lasso' ? slider('Tolerance', S.tol, 0, 100, (v) => (S.tol = v), '') : null,
        S.tool === 'wand'
          ? h(
              'label',
              { class: 'check' },
              h('input', { type: 'checkbox', checked: S.contiguous, onchange: (e) => (S.contiguous = e.target.checked) }),
              'Connected area only',
            )
          : null,
        h(
          'p',
          { class: 'muted small' },
          S.tool === 'wand'
            ? 'Click a colour to take the area around it. Tolerance sets how far the colour can drift. Untick Connected area only to take that colour everywhere in the picture.'
            : S.tool === 'lasso'
              ? 'Draw around what you want to keep and everything outside it is removed. Hold Shift while you start the next outline to add it to the selection. Invert selection flips it so only what is inside gets removed.'
              : 'Start each stroke on the colour you want to erase or restore. The brush only changes colours within the tolerance of that colour, so a stroke that spills onto the subject leaves it alone. Set tolerance to 100 to change everything under the brush.',
        ),
      ),
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, 'Preview'),
        seg([
          ['checks', 'Checks'],
          ['white', 'White'],
          ['black', 'Black'],
        ]),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'icon-btn', title: 'Undo (Ctrl+Z)', disabled: S.idx === 0 || S.busy, onclick: () => step(-1), html: ICONS.undo }),
          h('button', { class: 'icon-btn', title: 'Redo (Ctrl+Y)', disabled: S.idx === S.hist.length - 1 || S.busy, onclick: () => step(1), html: ICONS.redo }),
          h('span', { class: 'grow' }),
          h('button', { class: 'icon-btn', title: 'Fit', onclick: resetView, html: ICONS.fit }),
        ),
        h('p', { class: 'muted small' }, 'Scroll to zoom. Hold Space and drag to move around.'),
      ),
    );
  }

  function slider(label, value, min, max, set, suffix) {
    const out = h('span', { class: 'range-value' }, `${value}${suffix}`);
    const input = h('input', { type: 'range', min, max, value });
    input.addEventListener('input', () => {
      set(+input.value);
      out.textContent = `${input.value}${suffix}`;
      draw();
    });
    return h('label', { class: 'range-field' }, h('span', { class: 'label' }, label), input, out);
  }

  /** Index of the newest lasso selection in the current step, or -1. */
  function lastLasso() {
    const st = cur().strokes;
    for (let i = st.length - 1; i >= 0; i--) if (st[i].kind === 'lasso' && st[i].polys) return i;
    return -1;
  }

  function invertLasso() {
    const i = lastLasso();
    if (i < 0 || S.busy) return;
    const s = clone(cur());
    s.strokes[i].keep = !s.strokes[i].keep;
    push(s);
  }

  function setMode(m) {
    S.mode = m;
    if (S.tool === 'box' || S.tool === 'lasso') S.tool = 'brush';
    drawSide();
    draw();
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

  // ---------- Pointer ----------
  const toImage = (e) => {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return {
      sx,
      sy,
      x: Math.min(1, Math.max(0, (sx - fit.ox) / (work.width * fit.scale))),
      y: Math.min(1, Math.max(0, (sy - fit.oy) / (work.height * fit.scale))),
    };
  };

  let pan = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = toImage(e);
    if (S.space || e.button === 1) {
      pan = { x: e.clientX, y: e.clientY, px: S.panX, py: S.panY };
      return;
    }
    if (e.button !== 0 || S.busy) return;
    if (S.tool === 'box') S.live = { kind: 'box', start: [p.x, p.y], box: [p.x, p.y, p.x, p.y] };
    else if (S.tool === 'brush') S.live = { kind: 'stroke', stroke: { mode: S.mode, size: S.brushPx / natW, tol: S.tol, points: [[p.x, p.y]] } };
    else if (S.tool === 'lasso') S.live = { kind: 'lasso', add: e.shiftKey && lastLasso() >= 0, points: [[p.x, p.y]] };
    else if (S.tool === 'wand') {
      const st = clone(cur());
      st.strokes.push({ kind: 'wand', mode: S.mode, x: p.x, y: p.y, tol: S.tol, contiguous: S.contiguous });
      push(st);
      return;
    }
    draw();
  });
  cv.addEventListener('pointermove', (e) => {
    const p = toImage(e);
    S.pointer = { x: p.sx, y: p.sy };
    if (pan) {
      S.panX = pan.px + e.clientX - pan.x;
      S.panY = pan.py + e.clientY - pan.y;
      layout();
      return;
    }
    if (S.live?.kind === 'box') {
      const [sx, sy] = S.live.start;
      S.live.box = [Math.min(sx, p.x), Math.min(sy, p.y), Math.max(sx, p.x), Math.max(sy, p.y)];
    } else if (S.live?.kind === 'lasso') {
      const pts = S.live.points;
      const [lx, ly] = pts[pts.length - 1];
      if (Math.hypot((p.x - lx) * work.width, (p.y - ly) * work.height) > 2) pts.push([p.x, p.y]);
    } else if (S.live?.kind === 'stroke') {
      const pts = S.live.stroke.points;
      const [lx, ly] = pts[pts.length - 1];
      if (Math.hypot((p.x - lx) * work.width, (p.y - ly) * work.height) > 1.5) pts.push([p.x, p.y]);
    }
    draw();
  });
  const end = () => {
    if (pan) {
      pan = null;
      return;
    }
    const live = S.live;
    S.live = null;
    if (!live) return;
    const s = clone(cur());
    if (live.kind === 'box') {
      const [x0, y0, x1, y1] = live.box;
      if ((x1 - x0) * work.width < 8 || (y1 - y0) * work.height < 8) return draw();
      s.box = live.box;
    } else if (live.kind === 'lasso') {
      if (live.points.length < 3) return draw();
      // Shift adds this outline to the newest selection, so both areas are kept.
      if (live.add) s.strokes[lastLasso()].polys.push(live.points);
      else s.strokes.push({ kind: 'lasso', keep: true, polys: [live.points] });
    } else s.strokes.push(live.stroke);
    push(s);
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
      // Keep the pixel under the cursor in place while zooming.
      const ix = (mx - fit.ox) / fit.scale;
      const iy = (my - fit.oy) / fit.scale;
      S.zoom = Math.min(20, Math.max(0.5, S.zoom * Math.pow(0.999, e.deltaY)));
      const scale = fit.base * S.zoom;
      S.panX = mx - ix * scale - (r.width - work.width * scale) / 2;
      S.panY = my - iy * scale - (r.height - work.height * scale) / 2;
      layout();
    },
    { passive: false },
  );

  // ---------- Keys ----------
  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    e.stopPropagation();
    if (k === 'escape') return close(false);
    if (k === 'enter') return close(true);
    if (mod && k === 'z' && !e.shiftKey) return e.preventDefault(), step(-1);
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return e.preventDefault(), step(1);
    if (mod && e.shiftKey && k === 'i') return e.preventDefault(), invertLasso();
    if (e.code === 'Space') {
      e.preventDefault();
      S.space = true;
      cv.style.cursor = 'grab';
      return;
    }
    if (mod) return;
    if (k === 'm') setTool('box');
    if (k === 'b') setTool('brush');
    if (k === 'w') setTool('wand');
    if (k === 'l') setTool('lasso');
    if (k === 'e') setMode('erase');
    if (k === 'r') setMode('restore');
    if (k === '[' || k === ']') {
      S.brushPx = Math.max(2, Math.round(S.brushPx * (k === ']' ? 1.2 : 1 / 1.2)));
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
  const ro = new ResizeObserver(layout);
  ro.observe(stage);

  // ---------- Close ----------
  let closing = false;
  async function close(apply, asNew = false) {
    if (closing) return;
    if (apply && S.busy) return;
    closing = true;
    const s = cur();
    if (apply && (s.ranBox !== undefined || s.strokes.length)) {
      say('Applying');
      try {
        const full = new OffscreenCanvas(natW, natH);
        const fctx = full.getContext('2d');
        fctx.drawImage(img, 0, 0);
        const fullPic = fctx.getImageData(0, 0, natW, natH);
        const mask = s.ranBox !== undefined ? await maskFor(s.ranBox) : null;
        const out = compose(fullPic, mask, modelRect(s.ranBox ?? null, natW, natH), s.strokes);
        fctx.putImageData(out, 0, 0);
        const url = registerBlob(await full.convertToBlob({ type: 'image/png' }));
        let target = obj;
        if (asNew) {
          target = await obj.clone();
          target.set({ uid: Math.random().toString(36).slice(2, 12), name: 'Cut-out' });
          decorate(target);
          canvas.insertAt(canvas.getObjects().indexOf(obj) + 1, target);
        }
        target.originalSrc = source;
        target.cutout = clone(s);
        await swapElement(target, url);
        if (asNew) canvas.setActiveObject(target);
        canvas.fire('object:modified', { target });
        record(true);
      } catch (e) {
        console.error(e);
        toast(`The cut-out could not be applied: ${e.message}`, { error: true });
      }
    }
    ro.disconnect();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    back.remove();
    emit('selection');
    emit('page-props');
  }

  drawSide();
  layout();
  await recompose();
}
