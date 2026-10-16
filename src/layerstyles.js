import { canvas, fabric, selected } from './canvas.js';
import { state, emit } from './state.js';
import { record } from './history.js';
import { toast } from './ui.js';
import { defineCommands } from './commands.js';
import { showPanel } from './dock.js';

// Layer > Layer style: turn each style on or off for the selected layers, and
// copy one layer's styles onto others.

const STYLE_KEYS = ['shadow', 'outlineWidth', 'outlineColor', 'glowSize', 'glowColor', 'glowStrength', 'innerShadow', 'innerGlow', 'bevel', 'colorOverlay', 'gradientOverlay'];
let copied = null;

const list = () => selected().filter((o) => !o.isAdjustment);

const STYLES = {
  shadow: { label: 'Drop shadow', on: (o) => !!o.shadow, add: () => ({ shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: 20, offsetX: 6, offsetY: 8 }) }), remove: { shadow: null } },
  innerShadow: { label: 'Inner shadow', on: (o) => !!o.innerShadow, add: () => ({ innerShadow: { color: '#000000', opacity: 50, blur: 12, x: 4, y: 6 } }), remove: { innerShadow: null } },
  glow: { label: 'Outer glow', on: (o) => o.glowSize > 0, add: (o) => ({ glowSize: 24, glowColor: o.glowColor || '#ffd76a', glowStrength: o.glowStrength ?? 60 }), remove: { glowSize: 0 } },
  innerGlow: { label: 'Inner glow', on: (o) => !!o.innerGlow, add: () => ({ innerGlow: { color: '#fff3c4', size: 16, opacity: 75 } }), remove: { innerGlow: null } },
  bevel: { label: 'Bevel', on: (o) => !!o.bevel, add: () => ({ bevel: { size: 10, depth: 60, angle: 135 } }), remove: { bevel: null } },
  stroke: { label: 'Stroke', on: (o) => o.outlineWidth > 0, add: (o) => ({ outlineWidth: 8, outlineColor: o.outlineColor || '#ffffff' }), remove: { outlineWidth: 0 } },
  colorOverlay: { label: 'Colour overlay', on: (o) => !!o.colorOverlay, add: () => ({ colorOverlay: { color: state.fg || '#e0b45a', opacity: 100 } }), remove: { colorOverlay: null } },
  gradientOverlay: { label: 'Gradient overlay', on: (o) => !!o.gradientOverlay, add: () => ({ gradientOverlay: { from: '#e0b45a', to: '#14497a', angle: 90, opacity: 100 } }), remove: { gradientOverlay: null } },
};

function apply(fn) {
  for (const o of list()) {
    o.set(fn(o));
    o.dirty = true;
  }
  canvas.requestRenderAll();
  record(true);
  emit('objects');
}

export function init() {
  const defs = {};
  for (const [id, st] of Object.entries(STYLES)) {
    defs[`layer.style.${id}`] = {
      label: st.label,
      run: () => {
        const first = list()[0];
        const turnOn = !st.on(first);
        apply((o) => (turnOn ? st.add(o) : st.remove));
        if (turnOn) showPanel('properties');
      },
      enabled: () => list().length > 0,
      checked: () => list().length > 0 && st.on(list()[0]),
      also: 'layer style effect fx',
    };
  }
  defs['layer.style.copy'] = {
    label: 'Copy layer style',
    run: () => {
      const o = list()[0];
      copied = {};
      for (const k of STYLE_KEYS) copied[k] = o[k] && typeof o[k] === 'object' && !(o[k] instanceof fabric.Shadow) ? JSON.parse(JSON.stringify(o[k])) : o[k];
      copied.shadow = o.shadow ? new fabric.Shadow(o.shadow.toObject()) : null;
      toast('Layer style copied.');
    },
    enabled: () => list().length === 1,
  };
  defs['layer.style.paste'] = {
    label: 'Paste layer style',
    run: () => apply(() => ({ ...JSON.parse(JSON.stringify({ ...copied, shadow: null })), shadow: copied.shadow ? new fabric.Shadow(copied.shadow.toObject()) : null })),
    enabled: () => !!copied && list().length > 0,
  };
  defs['layer.style.clear'] = {
    label: 'Clear layer style',
    run: () => apply(() => ({ shadow: null, outlineWidth: 0, glowSize: 0, innerShadow: null, innerGlow: null, bevel: null, colorOverlay: null, gradientOverlay: null })),
    enabled: () => list().length > 0,
  };
  defineCommands(defs);
}
