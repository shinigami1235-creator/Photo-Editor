import { canvas, fabric, place, decorate } from './canvas.js';
import { state, uid, emit } from './state.js';
import { record } from './history.js';
import QR from './qr.js';

// A QR code on the page, drawn as vector squares so it prints sharp at any size.
// The link and colours stay on the object, so it can be edited later.

export const EC_LEVELS = [
  ['L', 'Low, 7%'],
  ['M', 'Medium, 15%'],
  ['Q', 'Quartile, 25%'],
  ['H', 'High, 30%'],
];

const QUIET = 4; // blank modules around the code, which scanners need

function pathFor(modules) {
  let d = '';
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      d += `M${x + QUIET} ${y + QUIET}h${end - x}v1h${x - end}z`;
      x = end;
    }
  });
  return d;
}

function build({ text, dark, light, ec }) {
  const code = QR.build(text, ec);
  const n = code.size + QUIET * 2;
  const bg = new fabric.Rect({ left: 0, top: 0, width: n, height: n, fill: light || 'rgba(0,0,0,0)', strokeWidth: 0, originX: 'left', originY: 'top' });
  const fg = new fabric.Path(pathFor(code.modules), { fill: dark, strokeWidth: 0, left: QUIET, top: QUIET, originX: 'left', originY: 'top' });
  return new fabric.Group([bg, fg], { objectCaching: true });
}

/** Adds a QR code for `text` in the middle of the page. */
export function addQr(text) {
  const g = build({ text, dark: '#101c2b', light: '#ffffff', ec: 'M' });
  g.set({ uid: uid(), name: 'QR code', qrText: text, qrDark: '#101c2b', qrLight: '#ffffff', qrEc: 'M' });
  const size = Math.min(state.doc.width, state.doc.height) * 0.3;
  g.scale(size / g.width);
  place(g);
  record();
  emit('objects');
  return g;
}

/** Rebuilds a QR code after its link, colours or error correction change. */
export function updateQr(old, patch) {
  const opts = { text: old.qrText, dark: old.qrDark, light: old.qrLight, ec: old.qrEc, ...patch };
  let g;
  try {
    g = build(opts);
  } catch {
    return null;
  }
  const shown = old.getScaledWidth();
  g.set({
    uid: old.uid,
    name: old.name,
    qrText: opts.text,
    qrDark: opts.dark,
    qrLight: opts.light,
    qrEc: opts.ec,
    angle: old.angle,
    opacity: old.opacity,
    shadow: old.shadow,
    flipX: old.flipX,
    flipY: old.flipY,
    locked: old.locked,
  });
  g.scale(shown / g.width);
  g.setPositionByOrigin(old.getCenterPoint(), 'center', 'center');
  decorate(g);
  const i = canvas.getObjects().indexOf(old);
  canvas.remove(old);
  canvas.insertAt(i, g);
  g.setCoords();
  canvas.setActiveObject(g);
  canvas.requestRenderAll();
  record();
  return g;
}
