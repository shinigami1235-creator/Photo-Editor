import { canvas, fabric, selected } from './canvas.js';
import { emit, uid } from './state.js';
import { record } from './history.js';
import { dataReadJson, dataWriteJson } from './platform.js';
import { ensureFont } from './fonts.js';
import { applyCurve, addText } from './objects.js';
import { h, prompt, toast } from './ui.js';

// Saved text looks: font, size, colour or gradient, outline, shadow, glow and
// warp. Click one to apply it to the selected text, or to add new text with it.

const FILE = 'text-styles.json';
const KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'textAlign', 'lineHeight', 'charSpacing',
  'stroke', 'strokeWidth', 'opacity', 'curve', 'outlineColor', 'outlineWidth', 'glowColor', 'glowSize', 'glowStrength', 'warp', 'warpBend',
];

let styles = [];
let loaded = false;

export async function loadTextStyles() {
  styles = await dataReadJson(FILE, []);
  loaded = true;
  emit('text-styles');
  return styles;
}

export const textStyles = () => styles;

const save = () => dataWriteJson(FILE, styles);

function styleOf(t) {
  const s = {};
  for (const k of KEYS) s[k] = t[k] ?? null;
  s.fill = typeof t.fill === 'object' && t.fill?.toObject ? { gradient: t.fill.toObject() } : t.fill;
  s.shadow = t.shadow ? t.shadow.toObject() : null;
  return s;
}

export async function saveTextStyle() {
  const [t] = selected();
  if (!t || t.type !== 'textbox') return toast('Select a text first.');
  const name = await prompt('Save text style', 'Name', `Style ${styles.length + 1}`);
  if (!name) return;
  if (!loaded) await loadTextStyles();
  styles.push({ id: uid(), name, style: styleOf(t) });
  await save();
  emit('text-styles');
}

export async function deleteTextStyle(id) {
  styles = styles.filter((s) => s.id !== id);
  await save();
  emit('text-styles');
}

async function applyTo(t, s) {
  if (s.fontFamily) await ensureFont(s.fontFamily);
  const props = {};
  for (const k of KEYS) if (k in s) props[k] = s[k];
  props.fill = s.fill?.gradient ? new fabric.Gradient(s.fill.gradient) : s.fill;
  props.shadow = s.shadow ? new fabric.Shadow(s.shadow) : null;
  t.set(props);
  t.initDimensions();
  if (t.curve) applyCurve(t);
  else if (t.path) t.set({ path: null });
  t.dirty = true;
  t.setCoords();
}

/** Applies a style to the selected texts, or adds a new text with it. */
export async function useTextStyle(entry) {
  let list = selected().filter((o) => o.type === 'textbox');
  if (!list.length) list = [addText('heading')];
  for (const t of list) await applyTo(t, entry.style);
  canvas.requestRenderAll();
  record();
  emit('objects');
}

/** The Text styles block for the Text tab. */
export function textStylesBlock() {
  const wrap = h('div', { class: 'panel-block' });
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(
      h('div', { class: 'row' }, h('div', { class: 'section-title grow' }, 'Text styles'), h('button', { class: 'link', onclick: saveTextStyle }, 'Save selected')),
      styles.length
        ? h(
            'div',
            { class: 'style-list' },
            styles.map((s) => {
              const st = s.style;
              const color = typeof st.fill === 'string' ? st.fill : '#1b222c';
              return h(
                'button',
                {
                  class: 'style-item',
                  title: 'Click to use. Right-click to delete.',
                  onclick: () => useTextStyle(s),
                  oncontextmenu: (e) => {
                    e.preventDefault();
                    deleteTextStyle(s.id);
                  },
                },
                h(
                  'span',
                  {
                    class: 'style-sample',
                    style: {
                      fontFamily: st.fontFamily ? `"${st.fontFamily}"` : null,
                      fontWeight: st.fontWeight,
                      fontStyle: st.fontStyle,
                      color: /^#fff(fff)?$/i.test(color) ? '#1b222c' : color,
                      background: /^#fff(fff)?$/i.test(color) ? '#cfd5de' : null,
                    },
                  },
                  s.name,
                ),
              );
            }),
          )
        : h('p', { class: 'muted small' }, 'Select a text you like and press Save selected to reuse its look.'),
    );
  };
  draw();
  if (!loaded) loadTextStyles().then(draw);
  return wrap;
}
