import { canvas, fabric, place } from './canvas.js';
import { state, uid, emit } from './state.js';
import { record } from './history.js';
import { h } from './ui.js';

// The icon library: Lucide line icons and brand logos from Simple Icons, all
// stored in the app so they work offline. An icon lands on the page as a group
// of vector shapes that recolours like any shape.

let data = null;
const load = async () => (data ||= (await import('./icon-data.json')).default);

const POPULAR = [
  'phone', 'map-pin', 'clock', 'calendar', 'mail', 'globe', 'message-circle', 'send', 'link', 'qr-code',
  'check', 'circle-check', 'badge-check', 'star', 'heart', 'sparkles', 'gift', 'tag', 'percent', 'award',
  'shopping-bag', 'shopping-cart', 'truck', 'store', 'credit-card', 'wallet', 'shield-check', 'thumbs-up', 'smile', 'crown',
  'syringe', 'stethoscope', 'hospital', 'pill', 'droplet', 'leaf', 'sun', 'moon', 'flower', 'gem',
  'user', 'users', 'baby', 'scissors', 'wand-sparkles', 'camera', 'image', 'video', 'music', 'mic',
  'coffee', 'cake', 'cookie', 'candy', 'utensils', 'wine', 'package', 'box', 'home', 'building',
  'arrow-right', 'arrow-down', 'chevron-right', 'move-right', 'plus', 'minus', 'x', 'info', 'circle-alert', 'quote',
  'zap', 'flame', 'wifi', 'car', 'plane', 'bike', 'dumbbell', 'trophy', 'target', 'book-open',
];

const lineSvg = (inner, color = '#101c2b', width = 2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const brandSvg = (d, color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="${d}"/></svg>`;

async function toGroup(svg) {
  const { objects, options } = await fabric.loadSVGFromString(svg);
  const list = objects.filter(Boolean);
  return list.length === 1 && list[0].type !== 'group' ? new fabric.Group(list, options) : fabric.util.groupSVGElements(list, options);
}

/** Adds an icon to the middle of the page. */
export async function addIcon(entry, kind) {
  const color = kind === 'brand' ? entry.hex : '#101c2b';
  const svg = kind === 'brand' ? brandSvg(entry.d, color) : lineSvg(entry.s, color);
  const g = await toGroup(svg);
  g.set({ uid: uid(), name: kind === 'brand' ? entry.n : `Icon ${entry.n}`, iconKind: kind, iconColor: color, iconWidth: 2 });
  const size = Math.min(state.doc.width, state.doc.height) * 0.14;
  g.scale(size / Math.max(g.width, g.height));
  place(g);
  record();
  emit('objects');
  return g;
}

/** Recolours an icon, and for line icons sets the line width. */
export function styleIcon(g, { color, width }) {
  const walk = (o) => {
    if (o.type === 'group') return o.getObjects().forEach(walk);
    if (g.iconKind === 'line') o.set({ stroke: color ?? o.stroke, strokeWidth: width ?? o.strokeWidth });
    else o.set({ fill: color ?? o.fill });
  };
  walk(g);
  g.set({ iconColor: color ?? g.iconColor, iconWidth: width ?? g.iconWidth, dirty: true });
  canvas.requestRenderAll();
}

/** The Icons block for the Shapes tab. */
export function iconsBlock() {
  const grid = h('div', { class: 'icon-grid' });
  const brandGrid = h('div', { class: 'icon-grid' });
  const search = h('input', { class: 'field', placeholder: 'Search icons: phone, star, gift' });
  const count = h('p', { class: 'muted small' });
  const show = () => {
    if (!data) return;
    const q = search.value.trim().toLowerCase();
    let list;
    if (!q) list = POPULAR.map((n) => data.icons.find((i) => i.n === n)).filter(Boolean);
    else {
      const words = q.split(/\s+/);
      list = data.icons.filter((i) => words.every((w) => i.n.includes(w) || i.t.includes(w))).slice(0, 160);
    }
    grid.innerHTML = '';
    for (const i of list) grid.append(h('button', { class: 'icon-tile', title: i.n.replace(/-/g, ' '), onclick: () => addIcon(i, 'line'), html: lineSvg(i.s, 'currentColor', 1.8) }));
    count.textContent = q ? (list.length ? '' : `No icon matches "${search.value.trim()}".`) : `${data.icons.length} icons. Search to find more.`;
    brandGrid.innerHTML = '';
    for (const b of data.brands.filter((b) => !q || b.n.toLowerCase().includes(q)))
      brandGrid.append(h('button', { class: 'icon-tile', title: b.n, onclick: () => addIcon(b, 'brand'), html: brandSvg(b.d, b.hex) }));
  };
  search.addEventListener('input', show);
  search.addEventListener('keydown', (e) => e.stopPropagation());
  load().then(show);
  return h(
    'div',
    { class: 'panel-block' },
    h('div', { class: 'section-title' }, 'Icons'),
    search,
    grid,
    count,
    h('div', { class: 'section-title' }, 'Social and payment logos'),
    brandGrid,
  );
}
