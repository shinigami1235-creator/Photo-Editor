import { canvas, fabric, selected } from './canvas.js';
import { state, emit } from './state.js';
import { record } from './history.js';
import { h, modal } from './ui.js';
import { defineCommands } from './commands.js';
import { showPage, syncCurrentPage } from './pages.js';
import { selectObjects } from './objects.js';

// Check design: the things worth fixing before a post goes out, like
// DesignCraft's preflight. Photos stretched past their own size, empty
// frames, text running off the page or under a story's buttons.

const label = (o) => (String(o.type).toLowerCase() === 'textbox' ? `"${o.text.split('\n')[0].slice(0, 28)}"` : o.name || 'a layer');

/** Pixels per inch a photo prints at, for designs set up for print. */
const ppiOf = (o) => (state.doc.dpi || 72) / Math.max(0.01, Math.abs(o.scaleX));

export async function checkDesign({ quiet = false } = {}) {
  if (!state.doc) return [];
  syncCurrentPage();
  const issues = [];
  const { width: W, height: H, dpi } = state.doc;
  const story = Math.abs(W / H - 9 / 16) < 0.02;
  for (let p = 0; p < state.doc.pages.length; p++) {
    const list = await fabric.util.enlivenObjects(state.doc.pages[p].objects);
    const where = state.doc.pages.length > 1 ? ` on page ${p + 1}` : '';
    for (const o of list) {
      if (!o.visible || o.isAdjustment) continue;
      const type = String(o.type).toLowerCase();
      o.setCoords();
      const r = o.getBoundingRect();
      if (type === 'image') {
        const s = Math.abs(o.scaleX);
        if (dpi >= 150) {
          const ppi = Math.round(ppiOf(o));
          if (ppi < 150) issues.push({ page: p, uid: o.uid, text: `${o.name || 'A photo'}${where} prints at ${ppi} ppi, so it will look soft on paper. Upscale it or use a bigger photo.` });
        } else if (s > 1.3) {
          issues.push({ page: p, uid: o.uid, text: `${o.name || 'A photo'}${where} is shown at ${Math.round(s * 100)}% of its own size, so it may look soft. Image > Upscale makes it sharper.` });
        }
      }
      if (o.isFrame && type !== 'image') issues.push({ page: p, uid: o.uid, text: `An empty frame${where} still needs a photo.` });
      if (type === 'textbox') {
        const out = r.left < -1 || r.top < -1 || r.left + r.width > W + 1 || r.top + r.height > H + 1;
        if (out) issues.push({ page: p, uid: o.uid, text: `The text ${label(o)}${where} runs past the edge of the page.` });
        else if (story && (r.top < H * 0.13 || r.top + r.height > H * 0.82)) issues.push({ page: p, uid: o.uid, text: `The text ${label(o)}${where} sits where Instagram puts its buttons in a story.` });
        if (o.fontFamily && document.fonts && !document.fonts.check(`16px "${o.fontFamily}"`)) issues.push({ page: p, uid: o.uid, text: `The font ${o.fontFamily}${where} is not on this computer, so another font shows instead.` });
      }
    }
  }
  if (!quiet) emit('preflight', issues);
  return issues;
}

async function checkDialog() {
  const issues = await checkDesign();
  const body = h(
    'div',
    { class: 'stack gap' },
    issues.length
      ? issues.map((i) =>
          h(
            'div',
            { class: 'row issue' },
            h('span', { class: 'grow' }, i.text),
            h(
              'button',
              {
                class: 'btn small',
                onclick: async () => {
                  document.querySelector('.modal-back')?.remove();
                  if (i.page !== state.pageIndex) await showPage(i.page);
                  const o = canvas.getObjects().find((x) => x.uid === i.uid);
                  if (o) selectObjects([o]);
                },
              },
              'Show',
            ),
          ),
        )
      : h('p', {}, 'Nothing to fix. The photos are sharp enough, frames are filled and the text stays on the page.'),
  );
  await modal('Check design', body, [{ label: 'Close', value: true, primary: true }], { wide: true });
}

// ---------- Pins ----------

const one = () => (selected().length === 1 ? selected()[0] : null);

function setPin(patch) {
  for (const o of selected()) {
    const next = patch === null ? {} : { ...(o.pin || {}), ...patch };
    o.pin = Object.keys(next).length ? next : null;
  }
  record(true);
  emit('objects');
}

export function init() {
  const has = () => selected().length > 0;
  const pin = () => one()?.pin || {};
  defineCommands({
    'file.check': { label: 'Check design', run: checkDialog, enabled: () => !!state.doc, also: 'preflight low resolution blurry' },
    'layer.pin.auto': { label: 'Nearest side', run: () => setPin(null), enabled: has, checked: () => has() && !pin().h && !pin().v, also: 'pin other sizes' },
    'layer.pin.left': { label: 'Stick to the left', run: () => setPin({ h: 'left' }), enabled: has, checked: () => pin().h === 'left', also: 'pin' },
    'layer.pin.right': { label: 'Stick to the right', run: () => setPin({ h: 'right' }), enabled: has, checked: () => pin().h === 'right', also: 'pin' },
    'layer.pin.top': { label: 'Stick to the top', run: () => setPin({ v: 'top' }), enabled: has, checked: () => pin().v === 'top', also: 'pin' },
    'layer.pin.bottom': { label: 'Stick to the bottom', run: () => setPin({ v: 'bottom' }), enabled: has, checked: () => pin().v === 'bottom', also: 'pin' },
    'layer.pin.center': { label: 'Stay centred', run: () => setPin({ h: 'center', v: 'middle' }), enabled: has, checked: () => pin().h === 'center' && pin().v === 'middle', also: 'pin' },
    'layer.pin.stretch': { label: 'Stretch with the page', run: () => setPin({ h: 'stretch', v: 'stretch' }), enabled: has, checked: () => pin().h === 'stretch', also: 'pin' },
  });
}
