import { canvas, designObjects, selected } from './canvas.js';
import { on } from './state.js';
import { record } from './history.js';
import { h, ICONS } from './ui.js';
import { toggleLock, selectObjects, duplicateSelected, removeSelected, groupSelected } from './objects.js';
import { isPhoto, isEmptyFrame } from './frames.js';
import { BLEND_MODES, hasFx } from './layerfx.js';
import {
  isSelecting,
  selectionTarget,
  setTarget,
  selectFromLayer,
  hasSelection,
  hideArea,
  setLayerMask,
  toggleLayerMask,
  removeLayerMask,
  mergeLayers,
  layerBelow,
} from './selection.js';

// Layers panel: top of the list is the front of the page. Blend mode and
// opacity for the chosen layer sit above the list, layer actions below it.

let host = null;

export function initLayers(el) {
  host = el;
  const refresh = () => render();
  ['object:added', 'object:removed', 'object:modified', 'selection:created', 'selection:updated', 'selection:cleared', 'text:changed'].forEach((e) =>
    canvas.on(e, refresh),
  );
  on('objects', refresh);
  on('page', refresh);
  on('selection-target', refresh);
  on('selection-mask', refresh);
}

const icon = (o) =>
  isEmptyFrame(o) ? 'frames' : isPhoto(o) ? 'image' : { textbox: 'text', rect: 'rect', ellipse: 'circle', triangle: 'triangle', line: 'line', group: 'group' }[o.type] || 'shapes';

const label = (o) => {
  if (o.type === 'textbox') return o.text.split('\n')[0].slice(0, 40) || 'Text';
  return o.name || 'Object';
};

let raf = 0;
export function render() {
  if (!host || host.offsetParent === null) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}

let dragFrom = null;

/** The layer the panel's controls act on. */
function current() {
  if (isSelecting()) return selectionTarget();
  const list = selected();
  return list.length === 1 ? list[0] : null;
}

function change(o, props) {
  o.set(props);
  o.dirty = true;
  canvas.requestRenderAll();
}

function draw() {
  host.innerHTML = '';
  const objs = designObjects();
  const cur = current();
  const sel = new Set(isSelecting() ? [cur].filter(Boolean) : selected());
  if (!objs.length) {
    host.append(h('p', { class: 'muted pad' }, 'The page is empty.'));
    return;
  }

  // Blend mode and opacity, like the top of Photoshop's layers panel.
  const opacity = h('input', { type: 'range', min: 0, max: 100, value: Math.round((cur?.opacity ?? 1) * 100), disabled: !cur });
  const opOut = h('span', { class: 'range-value' }, `${Math.round((cur?.opacity ?? 1) * 100)}%`);
  opacity.addEventListener('input', () => {
    opOut.textContent = `${opacity.value}%`;
    if (cur) change(cur, { opacity: opacity.value / 100 });
  });
  opacity.addEventListener('change', () => cur && record());
  host.append(
    h(
      'div',
      { class: 'layer-top' },
      h(
        'select',
        {
          class: 'field',
          title: 'Blend mode',
          disabled: !cur,
          onchange: (e) => {
            change(cur, { globalCompositeOperation: e.target.value });
            record();
          },
        },
        BLEND_MODES.map(([v, name]) => h('option', { value: v, selected: (cur?.globalCompositeOperation || 'source-over') === v }, name)),
      ),
      h('label', { class: 'layer-opacity', title: 'Opacity' }, opacity, opOut),
    ),
  );

  const list = h('div', { class: 'layer-list' });
  [...objs].reverse().forEach((o) => {
    const index = objs.indexOf(o);
    const shown = o.type === 'textbox' && (!o.name || o.name === 'Text' || o.name === 'Heading') ? label(o) : o.name || label(o);
    const name = h('span', { class: 'layer-name' }, shown);
    const rowEl = h(
      'div',
      {
        class: 'layer' + (sel.has(o) ? ' on' : '') + (o.visible ? '' : ' hidden') + (o.clipBelow ? ' clipped' : ''),
        draggable: 'true',
        onclick: (e) => {
          if (isSelecting()) return setTarget(o);
          if (!o.visible) return;
          if (e.ctrlKey || e.shiftKey) {
            const next = sel.has(o) ? [...sel].filter((x) => x !== o) : [...sel, o];
            selectObjects(next);
          } else selectObjects([o]);
        },
        ondblclick: () => rename(o, name),
        ondragstart: (e) => {
          dragFrom = index;
          e.dataTransfer.effectAllowed = 'move';
        },
        ondragover: (e) => {
          e.preventDefault();
          rowEl.classList.add('drop');
        },
        ondragleave: () => rowEl.classList.remove('drop'),
        ondrop: (e) => {
          e.preventDefault();
          rowEl.classList.remove('drop');
          if (dragFrom == null || dragFrom === index) return;
          const moving = objs[dragFrom];
          canvas.moveObjectTo(moving, index);
          dragFrom = null;
          canvas.requestRenderAll();
          record();
          draw();
        },
      },
      o.clipBelow ? h('span', { class: 'layer-clip', title: 'Clipped to the layer below', html: '&#8627;' }) : null,
      h('span', {
        class: 'layer-icon',
        title: 'Ctrl+click to select the shape of this layer',
        html: ICONS[icon(o)],
        onclick: (e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          e.stopPropagation();
          selectFromLayer(o, e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'new');
        },
      }),
      name,
      o.layerMask
        ? h(
            'button',
            {
              class: 'layer-chip' + (o.maskOn === false ? ' off' : ''),
              title: o.maskOn === false ? 'Mask is off. Click to turn it on' : 'Layer mask. Click to turn it off',
              onclick: (e) => {
                e.stopPropagation();
                toggleLayerMask(o);
              },
            },
            'mask',
          )
        : null,
      hasFx(o) && (o.outlineWidth > 0 || o.glowSize > 0 || (o.warp && o.warpBend)) ? h('span', { class: 'layer-chip', title: 'Has effects' }, 'fx') : null,
      h('button', {
        class: 'icon-btn tiny' + (o.locked ? ' on' : ''),
        title: o.locked ? 'Unlock' : 'Lock',
        html: ICONS[o.locked ? 'lock' : 'unlock'],
        onclick: (e) => {
          e.stopPropagation();
          toggleLock(o);
        },
      }),
      h('button', {
        class: 'icon-btn tiny',
        title: o.visible ? 'Hide' : 'Show',
        html: ICONS[o.visible ? 'eye' : 'eyeOff'],
        onclick: (e) => {
          e.stopPropagation();
          o.visible = !o.visible;
          if (!o.visible && sel.has(o) && !isSelecting()) canvas.discardActiveObject();
          canvas.requestRenderAll();
          record();
          draw();
        },
      }),
    );
    list.append(rowEl);
  });
  host.append(list);

  // Layer actions.
  const many = !isSelecting() && selected().length > 1;
  const below = cur ? layerBelow(cur) : null;
  const act = (text, title, fn, disabled = false, on = false) => h('button', { class: 'btn small' + (on ? ' on' : ''), title, disabled, onclick: fn }, text);
  host.append(
    h(
      'div',
      { class: 'layer-actions' },
      act('Duplicate', 'Ctrl+J', () => duplicateSelected(), !cur || isSelecting()),
      act(
        'Clip',
        'Show this layer only inside the layer below it',
        () => {
          change(cur, { clipBelow: !cur.clipBelow });
          record();
          draw();
        },
        !cur || !below,
        !!cur?.clipBelow,
      ),
      act(
        cur?.layerMask ? 'Delete mask' : 'Add mask',
        cur?.layerMask ? 'Removes the mask and shows the whole layer' : hasSelection() ? 'Keeps the selected area and hides the rest' : 'Adds an empty mask to hide parts of this layer later',
        async () => {
          if (cur.layerMask) return removeLayerMask(cur);
          if (hasSelection()) return hideArea(cur, 'outside');
          const c = document.createElement('canvas');
          c.width = c.height = 8;
          const x = c.getContext('2d');
          x.fillStyle = '#fff';
          x.fillRect(0, 0, 8, 8);
          await setLayerMask(cur, c);
          record(true);
          draw();
        },
        !cur,
      ),
      many
        ? act('Merge', 'Flattens the selected layers into one photo layer', () => mergeLayers(selected()))
        : act('Merge down', 'Flattens this layer into the one below', () => mergeLayers([below, cur]), !cur || !below),
      many ? act('Group', 'Ctrl+G', groupSelected) : null,
      act('Delete', 'Delete', () => (isSelecting() ? cur && (canvas.remove(cur), record()) : removeSelected()), !cur && !many),
    ),
  );
}

function rename(o, span) {
  const input = h('input', { class: 'field layer-input', value: o.name || label(o) });
  span.replaceWith(input);
  input.focus();
  input.select();
  const done = (save) => {
    if (save) {
      o.name = input.value.trim() || o.name;
      record();
    }
    draw();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
}
