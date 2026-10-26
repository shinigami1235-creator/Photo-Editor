// One-click portrait fixes: the Quick fixes chips in Properties, the Image >
// Quick fixes menu and the Claude connector all run through here.

import { canvas } from './canvas.js';
import { emit } from './state.js';
import { record } from './history.js';
import { isPhoto } from './frames.js';
import { h, section, rangeField, toast } from './ui.js';
import { defineCommands } from './commands.js';
import { photoTarget } from './adjustpanel.js';
import { autoSettings, adjustPixels, NEUTRAL as ADJ_NEUTRAL } from './adjust.js';
import { FIXES, PRESETS, NONE, applyFixes, renderFixes } from './beauty.js';
import { defaults, saveDefaults } from './defaults.js';
import { runCommand } from './commands.js';

let busy = false;
export const isBusy = () => busy;
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

const current = (o) => ({ ...NONE, ...(o.beauty || {}) });

/**
 * Glow up's light and colour: half of Auto's light, lifted shadows, softer
 * highlights, richer colour and a touch of warmth. The photo keeps its own
 * colour mood, so a sunset stays a sunset.
 */
export function glowLook(source, before = {}) {
  const a = autoSettings(source, { tone: true, color: false });
  const add = (k, v) => Math.max(-100, Math.min(100, (before[k] || 0) + v));
  return {
    exposure: add('exposure', Math.round((a.exposure || 0) * 0.5)),
    whites: add('whites', Math.round((a.whites || 0) * 0.5)),
    blacks: add('blacks', Math.round((a.blacks || 0) * 0.5)),
    contrast: add('contrast', Math.max(4, Math.round((a.contrast || 0) * 0.5))),
    highlights: add('highlights', -12),
    shadows: add('shadows', 12),
    vibrance: add('vibrance', 14),
    warmth: add('warmth', 5),
    clarity: add('clarity', -5),
  };
}

/** What one button applies: the built-in amounts, or the ones saved as default. Glow up keeps its own mix. */
export function presetSet(id) {
  const set = { ...PRESETS[id].set };
  if (id === 'glow') return set;
  const q = defaults('quickFix');
  for (const k of Object.keys(set)) if (q[k] > 0) set[k] = q[k];
  return set;
}

/** Amounts for a set of fix ids, scaled by `k`, with exact `amounts` on top. */
export function settingsFor(ids = [], amounts = null, k = 1) {
  const s = { ...NONE };
  for (const id of ids) {
    if (!PRESETS[id]) throw new Error(`Unknown fix ${id}. Fixes: ${Object.keys(PRESETS).join(', ')}.`);
    for (const [key, v] of Object.entries(presetSet(id))) s[key] = Math.max(s[key], Math.min(100, Math.round(v * k)));
  }
  for (const [key, v] of Object.entries(amounts || {})) {
    if (!(key in NONE)) throw new Error(`Unknown amount ${key}. Amounts: ${Object.keys(NONE).join(', ')}.`);
    s[key] = Math.max(0, Math.min(100, +v || 0));
  }
  return s;
}

/** Runs fixes on a picture outside any design, Glow up's colour included. Returns { canvas, faces }. */
export async function renderLook(img, ids, settings, { key, say } = {}) {
  const r = await renderFixes(img, settings, { key, say });
  if (ids.includes('glow')) {
    const x = r.canvas.getContext('2d', { willReadFrequently: true });
    const d = x.getImageData(0, 0, r.canvas.width, r.canvas.height);
    adjustPixels(d.data, d.width, d.height, { ...ADJ_NEUTRAL, ...glowLook(r.canvas) });
    x.putImageData(d, 0, 0);
  }
  return r;
}

/** Which one-click fixes are on for a photo. */
export function activeFixes(o) {
  const s = current(o);
  return Object.keys(PRESETS).filter((id) => (id === 'glow' ? !!o.glowPrev : Object.keys(PRESETS[id].set).every((k) => s[k] > 0)));
}

/**
 * Turns one-click fixes on or off. `ids` are keys of PRESETS; `on` true, false
 * or 'toggle'; `amounts` sets exact values (0 to 100) by fix id. Returns a
 * message for the status bar.
 */
export async function quickFix(o, ids = [], { on = 'toggle', amounts = null, quiet = false } = {}) {
  if (!isPhoto(o)) throw new Error('Quick fixes work on photos.');
  if (busy) throw new Error('A quick fix is still running.');
  const s = current(o);
  const wasOn = activeFixes(o);
  let glow = null;
  for (const id of ids) {
    const p = PRESETS[id];
    if (!p) throw new Error(`Unknown fix ${id}. Fixes: ${Object.keys(PRESETS).join(', ')}.`);
    const turnOn = on === 'toggle' ? !wasOn.includes(id) : !!on;
    for (const [k, v] of Object.entries(presetSet(id))) s[k] = turnOn ? Math.max(s[k], v) : 0;
    if (id === 'glow') glow = turnOn;
  }
  if (amounts)
    for (const [k, v] of Object.entries(amounts)) {
      if (!(k in NONE)) throw new Error(`Unknown amount ${k}. Amounts: ${Object.keys(NONE).join(', ')}.`);
      s[k] = Math.max(0, Math.min(100, +v || 0));
    }
  busy = true;
  changed();
  const note = quiet ? null : toast('Working', { sticky: true });
  const say = (text, f) => {
    note?.text(text);
    if (f != null) note?.progress(f);
  };
  try {
    const r = await applyFixes(o, s, { say });
    if (glow === true && !o.glowPrev) {
      const t = photoTarget(o);
      const before = t.settings();
      o.glowPrev = JSON.parse(JSON.stringify(before));
      t.apply(glowLook(t.source(), before), true);
    } else if (glow === false && o.glowPrev) {
      photoTarget(o).apply(o.glowPrev, true);
      o.glowPrev = null;
    }
    canvas.requestRenderAll();
    record(true);
    emit('objects');
    const msg =
      r.faces === 0 && Object.keys(NONE).some((k) => k !== 'slimBody' && s[k] > 0)
        ? 'No face found in this photo, so only the body and colour fixes ran.'
        : r.faces == null
          ? 'Quick fixes are off.'
          : `Done${r.faces ? ` on ${r.faces} face${r.faces === 1 ? '' : 's'}` : ''}.`;
    return { message: msg, faces: r.faces, settings: o.beauty };
  } finally {
    note?.done();
    busy = false;
    changed();
  }
}

/** The Quick fixes section for a selected photo. */
export function quickPanel(o, rerender) {
  const on = activeFixes(o);
  const s = current(o);
  const chips = [];
  const run = async (ids, opts) => {
    for (const c of chips) {
      c.disabled = true;
      c.classList.toggle('working', ids.length === 1 && c.dataset.fix === ids[0]);
    }
    try {
      const r = await quickFix(o, ids, opts);
      toast(r.message);
    } catch (e) {
      toast(e.message, { error: true });
    }
    rerender();
  };
  const chip = (id) => {
    const b = h(
      'button',
      {
        'data-fix': id,
        class: 'fix-chip' + (on.includes(id) ? ' on' : '') + (id === 'glow' ? ' glow' : ''),
        disabled: busy,
        title: id === 'glow' ? 'Enhance faces, Smooth skin, Bright eyes, Whiten teeth and Auto light and colour in one click' : FIXES.find((f) => f.id === id)?.hint,
        onclick: () => run([id]),
      },
      PRESETS[id].label,
    );
    chips.push(b);
    return b;
  };
  const open = quickPanel.open;
  const tune = h(
    'div',
    { class: 'stack fix-tune', hidden: !open },
    FIXES.map((f) =>
      rangeField(f.label, s[f.id], (v, commit) => commit && run([], { amounts: { [f.id]: v } }), { min: 0, max: 100 }),
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn small grow', disabled: busy || !o.beauty, onclick: () => run(Object.keys(PRESETS), { on: false }) }, 'Take all off'),
      h(
        'button',
        {
          class: 'btn small grow',
          title: 'The buttons above apply these amounts from now on',
          onclick: async () => {
            const keep = Object.fromEntries(Object.entries(current(o)).filter(([, v]) => v > 0));
            if (!Object.keys(keep).length) return toast('Set a slider above 0 first.', { error: true });
            await saveDefaults('quickFix', keep);
            toast('Saved as default. The Quick fixes buttons now apply these amounts.');
          },
        },
        'Save as default',
      ),
    ),
  );
  return section(
    'Quick fixes',
    h('button', { class: 'btn primary wide touch-btn', disabled: busy, title: 'Touch up this photo, or put a touched-up copy beside it', onclick: () => runCommand('image.touchUp') }, 'Touch up'),
    h('div', { class: 'fix-grid' }, ['glow', 'smooth', 'slimFace', 'slimBody', 'enhance', 'eyes', 'teeth'].map(chip)),
    h(
      'button',
      {
        class: 'link small',
        onclick: (e) => {
          quickPanel.open = !quickPanel.open;
          tune.hidden = !quickPanel.open;
          e.currentTarget.textContent = quickPanel.open ? 'Hide fine tune' : 'Fine tune';
        },
      },
      open ? 'Hide fine tune' : 'Fine tune',
    ),
    tune,
  );
}

export function onBusyChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initQuickFixes({ photo, rerender }) {
  const defs = {};
  for (const [id, p] of Object.entries(PRESETS)) {
    defs[`image.fix.${id}`] = {
      label: p.label,
      run: async () => {
        try {
          toast((await quickFix(photo(), [id])).message);
        } catch (e) {
          toast(e.message, { error: true });
        }
        rerender();
      },
      enabled: () => !!photo() && !busy,
      checked: () => !!photo() && activeFixes(photo()).includes(id),
      also: 'retouch beauty portrait',
    };
  }
  defs['image.fix.off'] = {
    label: 'Take all quick fixes off',
    run: async () => {
      await quickFix(photo(), Object.keys(PRESETS), { on: false });
      rerender();
    },
    enabled: () => !!photo()?.beauty && !busy,
  };
  defineCommands(defs);
}
