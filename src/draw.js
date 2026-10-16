import { canvas, fabric, decorate } from './canvas.js';
import { uid } from './state.js';
import { h, toHex } from './ui.js';

// Drawing with brushes. Each stroke becomes its own object on the page and can
// be moved, recoloured or deleted like any shape.

export const BRUSHES = [
  { id: 'pen', label: 'Pen', size: 6, opacity: 100 },
  { id: 'marker', label: 'Marker', size: 22, opacity: 85 },
  { id: 'highlighter', label: 'Highlighter', size: 36, opacity: 40 },
  { id: 'spray', label: 'Spray', size: 40, opacity: 100 },
];

const S = { brush: 'pen', color: '#000000', size: 6, opacity: 100, on: false };

const rgba = (hex, a) => {
  const n = parseInt(toHex(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function makeBrush() {
  let b;
  if (S.brush === 'spray') {
    b = new fabric.SprayBrush(canvas);
    b.density = 30;
    b.dotWidth = Math.max(1, S.size / 14);
    b.randomOpacity = false;
  } else {
    b = new fabric.PencilBrush(canvas);
    b.decimate = 2;
    b.strokeLineCap = S.brush === 'highlighter' ? 'square' : 'round';
    b.strokeLineJoin = 'round';
  }
  b.width = S.size;
  b.color = rgba(S.color, S.opacity / 100);
  canvas.freeDrawingBrush = b;
}

let hooked = false;
export function setDrawing(on) {
  S.on = on;
  canvas.isDrawingMode = on;
  if (on) {
    canvas.discardActiveObject();
    makeBrush();
  }
  canvas.requestRenderAll();
  if (!hooked) {
    hooked = true;
    canvas.on('path:created', ({ path }) => {
      path.set({ uid: uid(), name: S.brush === 'spray' ? 'Spray' : 'Drawing' });
      if (S.brush === 'highlighter') path.set({ globalCompositeOperation: 'multiply' });
      decorate(path);
    });
  }
}

export const isDrawing = () => S.on;

/** The brush settings in the options bar. The colour is the foreground colour. */
export function drawOptions(el) {
  el.innerHTML = '';
  const num = (label, value, min, max, set, suffix) =>
    h(
      'label',
      { class: 'opt-num' },
      h('span', { class: 'label' }, label),
      h('input', { class: 'field num', type: 'number', min, max, value, oninput: (e) => (set(Math.max(min, Math.min(max, +e.target.value || min))), makeBrush()) }),
      h('span', { class: 'suffix' }, suffix),
    );
  el.append(
    h(
      'div',
      { class: 'seg small' },
      BRUSHES.map((b) =>
        h(
          'button',
          {
            class: S.brush === b.id ? 'on' : '',
            onclick: () => {
              S.brush = b.id;
              S.size = b.size;
              S.opacity = b.opacity;
              makeBrush();
              drawOptions(el);
            },
          },
          b.label,
        ),
      ),
    ),
    num('Size', S.size, 1, 400, (v) => (S.size = v), 'px'),
    num('Opacity', S.opacity, 5, 100, (v) => (S.opacity = v), '%'),
    h('span', { class: 'opt-hint muted' }, 'Draws in the foreground colour. Each stroke is its own layer.'),
  );
}

/** Follows the foreground colour. */
export function setDrawColor(c) {
  S.color = c;
  if (S.on) makeBrush();
}
