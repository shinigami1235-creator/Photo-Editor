import { canvas } from './canvas.js';
import { h, toHex } from './ui.js';

// Picks a colour from the page. The next click on the canvas reads the pixel
// under the pointer; Esc cancels.

let active = null;

const hexOf = (d) => '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');

function sample(e) {
  const el = canvas.lowerCanvasEl;
  const r = el.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * el.width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * el.height);
  if (x < 0 || y < 0 || x >= el.width || y >= el.height) return null;
  return hexOf(el.getContext('2d').getImageData(x, y, 1, 1).data);
}

/** Resolves with the picked colour as #rrggbb, or null when cancelled. */
export function pickColor() {
  active?.cancel();
  return new Promise((resolve) => {
    const el = canvas.upperCanvasEl;
    const chip = h('div', { class: 'eyedrop-chip' }, h('span', { class: 'eyedrop-swatch' }), h('span', { class: 'eyedrop-hex' }));
    document.body.appendChild(chip);
    const move = (e) => {
      const c = sample(e);
      chip.style.display = c ? 'flex' : 'none';
      if (!c) return;
      chip.style.left = `${e.clientX + 16}px`;
      chip.style.top = `${e.clientY + 16}px`;
      chip.firstChild.style.background = c;
      chip.lastChild.textContent = c;
    };
    const down = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const c = sample(e);
      end(c ? toHex(c) : null);
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        end(null);
      }
    };
    const end = (c) => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('mousedown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('keydown', key, true);
      document.body.classList.remove('eyedropping');
      chip.remove();
      active = null;
      resolve(c);
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('mousedown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('keydown', key, true);
    document.body.classList.add('eyedropping');
    active = { cancel: () => end(null) };
  });
}
