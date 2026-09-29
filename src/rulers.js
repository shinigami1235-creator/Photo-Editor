import { canvas } from './canvas.js';
import { state, currentPage, on, emit, markDirty } from './state.js';
import { addPainter, refreshOverlay } from './selection.js';
import { dataReadJson, dataWriteJson } from './platform.js';

// Rulers along the top and left of the workspace, guides dragged out of them,
// the Instagram story safe zone and the slide edges of a panorama carousel.

const SIZE = 20;
const view = { rulers: false, safe: false };
let top = null;
let left = null;
let corner = null;
let drag = null; // { axis, index or -1 for new, pos }

export const viewSettings = () => view;

export async function initRulers() {
  Object.assign(view, await dataReadJson('view.json', {}));
  const ws = document.getElementById('workspace');
  top = document.createElement('canvas');
  top.className = 'ruler ruler-top';
  left = document.createElement('canvas');
  left.className = 'ruler ruler-left';
  corner = document.createElement('div');
  corner.className = 'ruler-corner';
  corner.title = 'Guides: drag from a ruler onto the page. Drag a guide back onto its ruler to remove it.';
  ws.append(top, left, corner);
  top.addEventListener('pointerdown', (e) => start(e, 'y'));
  left.addEventListener('pointerdown', (e) => start(e, 'x'));
  canvas.on('after:render', draw);
  addPainter(paint);
  on('page', () => refresh());
  on('doc', () => refresh());
  window.addEventListener('resize', () => refresh());
  apply();
}

function apply() {
  document.body.classList.toggle('show-rulers', view.rulers);
  document.getElementById('rulers-btn')?.classList.toggle('on', view.rulers);
  refresh();
  emit('view');
}

function refresh() {
  draw();
  refreshOverlay();
}

export function toggleRulers(v = !view.rulers) {
  view.rulers = v;
  dataWriteJson('view.json', view);
  apply();
}

export function toggleSafeZone(v = !view.safe) {
  view.safe = v;
  dataWriteJson('view.json', view);
  refresh();
  emit('view');
}

const guides = () => (currentPage().guides ||= []);

export function clearGuides() {
  currentPage().guides = [];
  markDirty();
  refresh();
}

// A tick step that keeps labels about 60 screen pixels apart.
function step(z) {
  const want = 60 / z;
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s >= want) return s;
  return 10000;
}

function drawRuler(cv, axis) {
  const dpr = window.devicePixelRatio || 1;
  const ws = cv.parentElement.getBoundingClientRect();
  const len = axis === 'x' ? ws.width : ws.height;
  const w = axis === 'x' ? len : SIZE;
  const h = axis === 'x' ? SIZE : len;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
  }
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.fillStyle = '#f7f8fa';
  x.fillRect(0, 0, w, h);
  if (!state.doc) return;
  const v = canvas.viewportTransform;
  const z = v[0];
  const off = axis === 'x' ? v[4] : v[5];
  const pageLen = axis === 'x' ? state.doc.width : state.doc.height;
  // The page's own stretch of the ruler is white.
  x.fillStyle = '#ffffff';
  if (axis === 'x') x.fillRect(off, 0, pageLen * z, SIZE);
  else x.fillRect(0, off, SIZE, pageLen * z);
  const s = step(z);
  const from = Math.floor(-off / z / s) * s;
  const to = (len - off) / z;
  x.strokeStyle = '#8a94a3';
  x.fillStyle = '#6b7686';
  x.font = '10px "IBM Plex Sans", system-ui, sans-serif';
  x.lineWidth = 1;
  x.beginPath();
  for (let p = from; p <= to; p += s / 5) {
    const sp = Math.round(off + p * z) + 0.5;
    const major = Math.abs(p / s - Math.round(p / s)) < 1e-6;
    const tick = major ? SIZE : SIZE * 0.3;
    if (axis === 'x') {
      x.moveTo(sp, SIZE);
      x.lineTo(sp, SIZE - tick);
    } else {
      x.moveTo(SIZE, sp);
      x.lineTo(SIZE - tick, sp);
    }
    if (major) {
      const label = String(Math.round(p));
      if (axis === 'x') x.fillText(label, sp + 3, 9);
      else {
        x.save();
        x.translate(9, sp + 3);
        x.rotate(-Math.PI / 2);
        x.textAlign = 'right';
        x.fillText(label, 0, 0);
        x.restore();
      }
    }
  }
  x.stroke();
  // Guide markers.
  x.fillStyle = '#1f5e99';
  for (const g of guides()) {
    if (g.axis !== (axis === 'x' ? 'x' : 'y')) continue;
    const sp = off + g.pos * z;
    x.beginPath();
    if (axis === 'x') {
      x.moveTo(sp - 5, 0);
      x.lineTo(sp + 5, 0);
      x.lineTo(sp, 8);
    } else {
      x.moveTo(0, sp - 5);
      x.lineTo(0, sp + 5);
      x.lineTo(8, sp);
    }
    x.fill();
  }
  x.strokeStyle = '#cfd5de';
  x.beginPath();
  if (axis === 'x') {
    x.moveTo(0, SIZE - 0.5);
    x.lineTo(w, SIZE - 0.5);
  } else {
    x.moveTo(SIZE - 0.5, 0);
    x.lineTo(SIZE - 0.5, h);
  }
  x.stroke();
}

function draw() {
  if (!top || !view.rulers) return;
  drawRuler(top, 'x');
  drawRuler(left, 'y');
}

/** Page position under the pointer along one axis. */
function pagePos(e, axis) {
  const r = canvas.upperCanvasEl.getBoundingClientRect();
  const v = canvas.viewportTransform;
  return axis === 'x' ? (e.clientX - r.left - v[4]) / v[0] : (e.clientY - r.top - v[5]) / v[3];
}

// Dragging from the top ruler makes a horizontal guide (it sits at a y) and
// from the left ruler a vertical one. A marker on a ruler moves an existing guide.
function start(e, axis) {
  if (!state.doc || e.button !== 0) return;
  e.preventDefault();
  const rulerAxis = axis === 'y' ? 'x' : 'y'; // the ruler's own direction
  const v = canvas.viewportTransform;
  const off = rulerAxis === 'x' ? v[4] : v[5];
  const at = rulerAxis === 'x' ? e.offsetX : e.offsetY;
  // Grab an existing guide's marker when the press lands on one.
  const index = guides().findIndex((g) => g.axis === axis && Math.abs(off + g.pos * v[0] - at) < 6);
  drag = { axis, index, pos: index >= 0 ? guides()[index].pos : pagePos(e, axis) };
  const move = (ev) => {
    drag.pos = Math.round(pagePos(ev, axis));
    const r = canvas.upperCanvasEl.getBoundingClientRect();
    drag.out = axis === 'x' ? ev.clientX < r.left + SIZE : ev.clientY < r.top + SIZE;
    if (drag.index >= 0) guides()[drag.index].pos = drag.pos;
    refresh();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (drag.index >= 0 && drag.out) guides().splice(drag.index, 1);
    else if (drag.index < 0 && !drag.out) guides().push({ axis, pos: drag.pos });
    drag = null;
    markDirty();
    refresh();
    emit('view');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function paint(x, sx, sy, dpr) {
  if (!state.doc) return;
  const W = state.doc.width;
  const H = state.doc.height;
  // Story safe zone: Instagram covers about the top 250 and bottom 340 pixels of a 1080 x 1920 story.
  if (view.safe) {
    const t = H * (250 / 1920);
    const b = H * (340 / 1920);
    x.fillStyle = 'rgba(163, 27, 27, 0.14)';
    x.fillRect(sx(0), sy(0), sx(W) - sx(0), sy(t) - sy(0));
    x.fillRect(sx(0), sy(H - b), sx(W) - sx(0), sy(H) - sy(H - b));
    x.strokeStyle = 'rgba(163, 27, 27, 0.7)';
    x.setLineDash([6 * dpr, 4 * dpr]);
    x.lineWidth = dpr;
    x.strokeRect(sx(0), sy(t), sx(W) - sx(0), sy(H - b) - sy(t));
    x.setLineDash([]);
    x.fillStyle = 'rgba(163, 27, 27, 0.85)';
    x.font = `${11 * dpr}px "IBM Plex Sans", system-ui, sans-serif`;
    x.fillText('Keep text inside the dashed box', sx(0) + 8 * dpr, sy(t) - 6 * dpr);
  }
  // Carousel slide edges.
  const n = state.doc.slides || 0;
  if (n > 1) {
    x.strokeStyle = 'rgba(31, 94, 153, 0.8)';
    x.lineWidth = dpr;
    x.setLineDash([8 * dpr, 6 * dpr]);
    x.fillStyle = 'rgba(16, 28, 43, 0.75)';
    x.font = `600 ${11 * dpr}px "IBM Plex Sans", system-ui, sans-serif`;
    for (let i = 0; i < n; i++) {
      const x0 = (W * i) / n;
      if (i) {
        x.beginPath();
        x.moveTo(sx(x0), sy(0));
        x.lineTo(sx(x0), sy(H));
        x.stroke();
      }
      const label = `Slide ${i + 1}`;
      const tw = x.measureText(label).width + 12 * dpr;
      x.fillRect(sx(x0) + 6 * dpr, sy(0) + 6 * dpr, tw, 18 * dpr);
      x.fillStyle = '#fff';
      x.fillText(label, sx(x0) + 12 * dpr, sy(0) + 19 * dpr);
      x.fillStyle = 'rgba(16, 28, 43, 0.75)';
    }
    x.setLineDash([]);
  }
  // Guides.
  const list = [...guides()];
  if (drag && drag.index < 0 && !drag.out) list.push({ axis: drag.axis, pos: drag.pos });
  x.strokeStyle = '#1fb6d6';
  x.lineWidth = dpr;
  for (const g of list) {
    x.beginPath();
    if (g.axis === 'x') {
      x.moveTo(sx(g.pos), 0);
      x.lineTo(sx(g.pos), x.canvas.height);
    } else {
      x.moveTo(0, sy(g.pos));
      x.lineTo(x.canvas.width, sy(g.pos));
    }
    x.stroke();
  }
  if (drag && !drag.out) {
    x.fillStyle = '#101c2b';
    x.font = `${11 * dpr}px "IBM Plex Sans", system-ui, sans-serif`;
    const label = `${drag.pos} px`;
    if (drag.axis === 'x') x.fillText(label, sx(drag.pos) + 6 * dpr, 34 * dpr);
    else x.fillText(label, 26 * dpr, sy(drag.pos) - 6 * dpr);
  }
}
