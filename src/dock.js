import { h, ICONS } from './ui.js';
import { emit, on } from './state.js';
import { historySteps, jumpTo } from './history.js';
import { dataReadJson, dataWriteJson } from './platform.js';

// The panels on the right, stacked in two groups the way Photoshop docks them:
// Properties and Adjustments on top, Layers and History below. The icon rail
// beside them brings a panel forward.

const panels = []; // { id, label, icon, group, el, onShow }
const shown = { top: 'properties', bottom: 'layers' };
let dockEl = null;
let railEl = null;
let split = 0.55; // share of the height the top group takes
let collapsed = false;

/** Adds a panel. Returns its element, which keeps its contents while hidden. */
export function addPanel({ id, label, icon, group, onShow }) {
  const el = h('div', { class: 'dock-panel', 'data-panel': id });
  panels.push({ id, label, icon, group, el, onShow });
  return el;
}

export const panelShown = (id) => !collapsed && Object.values(shown).includes(id);

/** Brings a panel to the front of its group and opens the dock if it was closed. */
export function showPanel(id) {
  const p = panels.find((x) => x.id === id);
  if (!p) return;
  shown[p.group] = id;
  collapsed = false;
  layout();
  save();
}

export function toggleDock() {
  collapsed = !collapsed;
  layout();
  save();
}
export const dockCollapsed = () => collapsed;

const save = () => dataWriteJson('dock.json', { shown, split, collapsed });

export async function buildDock(dock, rail) {
  dockEl = dock;
  railEl = rail;
  const saved = await dataReadJson('dock.json', null);
  if (saved) {
    Object.assign(shown, saved.shown || {});
    split = saved.split || split;
    collapsed = !!saved.collapsed;
  }
  dock.innerHTML = '';
  for (const group of ['top', 'bottom']) {
    const g = h('div', { class: `dock-group ${group}` }, h('div', { class: 'dock-tabs' }), h('div', { class: 'dock-body' }));
    for (const p of panels.filter((x) => x.group === group)) g.lastChild.append(p.el);
    dock.append(g);
    if (group === 'top') {
      const bar = h('div', { class: 'dock-split', title: 'Drag to resize' });
      bar.addEventListener('pointerdown', (e) => {
        bar.setPointerCapture(e.pointerId);
        const r = dock.getBoundingClientRect();
        const move = (ev) => {
          split = Math.min(0.85, Math.max(0.15, (ev.clientY - r.top) / r.height));
          layout();
        };
        const up = () => {
          bar.removeEventListener('pointermove', move);
          bar.removeEventListener('pointerup', up);
          save();
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
      });
      dock.append(bar);
    }
  }
  layout();
}

function layout() {
  if (!dockEl) return;
  document.body.classList.toggle('dock-closed', collapsed);
  dockEl.style.setProperty('--split', String(split));
  for (const group of ['top', 'bottom']) {
    const g = dockEl.querySelector(`.dock-group.${group}`);
    const tabs = g.querySelector('.dock-tabs');
    tabs.innerHTML = '';
    for (const p of panels.filter((x) => x.group === group)) {
      tabs.append(h('button', { class: 'dock-tab' + (shown[group] === p.id ? ' on' : ''), onclick: () => showPanel(p.id) }, p.label));
      const on = shown[group] === p.id && !collapsed;
      const was = p.el.style.display !== 'none' && p.el.isConnected && p.el.dataset.on === '1';
      p.el.style.display = shown[group] === p.id ? '' : 'none';
      p.el.dataset.on = on ? '1' : '0';
      if (on && !was) p.onShow?.();
    }
  }
  railEl.innerHTML = '';
  for (const p of panels) {
    railEl.append(
      h('button', {
        class: 'rail-icon' + (panelShown(p.id) ? ' on' : ''),
        title: p.label,
        html: ICONS[p.icon],
        onclick: () => (panelShown(p.id) ? toggleDock() : showPanel(p.id)),
      }),
    );
  }
  railEl.append(h('span', { class: 'grow' }), h('button', { class: 'rail-icon', title: collapsed ? 'Show panels' : 'Hide panels', html: ICONS[collapsed ? 'left' : 'right'], onclick: toggleDock }));
  emit('dock');
}

// ---------- History panel ----------

export function historyPanel(el) {
  const draw = () => {
    if (el.dataset.on !== '1') return;
    el.innerHTML = '';
    const { steps, current } = historySteps();
    const list = h('div', { class: 'history-list' });
    steps.forEach((label, i) =>
      list.append(
        h(
          'button',
          { class: 'history-row' + (i === current ? ' on' : '') + (i > current ? ' undone' : ''), onclick: () => jumpTo(i) },
          h('span', { class: 'history-dot', html: i === 0 ? ICONS.photos : ICONS.history }),
          h('span', { class: 'grow' }, label),
        ),
      ),
    );
    el.append(list, h('p', { class: 'muted small pad' }, 'Click a step to go back to it. Steps below it stay until you change something. Each page keeps its own history.'));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  on('history', draw);
  on('page', draw);
  return draw;
}
