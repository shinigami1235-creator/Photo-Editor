import { canvas, fabric, decorate } from './canvas.js';
import { uid } from './state.js';
import { brandColors } from './brand.js';
import { h, rangeField, toHex } from './ui.js';

// Drawing with brushes. Each stroke becomes its own object on the page and can
// be moved, recoloured or deleted like any shape.

export const BRUSHES = [
  { id: 'pen', label: 'Pen', size: 6, opacity: 100 },
  { id: 'marker', label: 'Marker', size: 22, opacity: 85 },
  { id: 'highlighter', label: 'Highlighter', size: 36, opacity: 40 },
  { id: 'spray', label: 'Spray', size: 40, opacity: 100 },
];

const S = { brush: 'pen', color: '#111111', size: 6, opacity: 100, on: false };

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

export function drawPanel(el) {
  const pick = h('input', { type: 'color', class: 'color', value: S.color });
  pick.addEventListener('input', () => {
    S.color = pick.value;
    makeBrush();
  });
  el.append(
    h(
      'div',
      { class: 'panel-block' },
      h('p', { class: 'muted small' }, 'Draw on the page with the mouse or a pen tablet. Each stroke is its own object, so select it to move or delete it.'),
      h(
        'div',
        { class: 'tile-grid tight' },
        BRUSHES.map((b) =>
          h(
            'button',
            {
              class: 'tile' + (S.brush === b.id ? ' on' : ''),
              onclick: () => {
                S.brush = b.id;
                S.size = b.size;
                S.opacity = b.opacity;
                makeBrush();
                el.innerHTML = '';
                drawPanel(el);
              },
            },
            h('span', { html: brushIcon(b.id) }),
            h('span', {}, b.label),
          ),
        ),
      ),
      h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Colour'), pick),
      h(
        'div',
        { class: 'swatches small' },
        [...brandColors(), '#111111', '#ffffff', '#e63946', '#f4a261', '#2a9d8f'].map((c) =>
          h('button', {
            class: 'swatch small',
            title: c,
            style: { background: c },
            onclick: () => {
              S.color = c;
              pick.value = toHex(c);
              makeBrush();
            },
          }),
        ),
      ),
      rangeField('Size', S.size, (v) => ((S.size = v), makeBrush()), { min: 1, max: 200, suffix: ' px' }),
      rangeField('Opacity', S.opacity, (v) => ((S.opacity = v), makeBrush()), { min: 5, max: 100, suffix: '%' }),
    ),
  );
}

function brushIcon(id) {
  const svg = (d) => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  if (id === 'pen') return svg('<path d="M4 20c4-1 5-6 9-8s5-6 7-8"/>');
  if (id === 'marker') return svg('<path d="M4 18c4-2 7-8 16-10" stroke-width="4"/>');
  if (id === 'highlighter') return svg('<path d="M3 15h18" stroke-width="7" stroke-opacity=".45" stroke-linecap="square"/>');
  return svg('<circle cx="8" cy="9" r="1" fill="currentColor"/><circle cx="12" cy="7" r="1" fill="currentColor"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="13" r="1" fill="currentColor"/><circle cx="13" cy="15" r="1" fill="currentColor"/><circle cx="17" cy="8" r="1" fill="currentColor"/><circle cx="7" cy="15" r="1" fill="currentColor"/>');
}
