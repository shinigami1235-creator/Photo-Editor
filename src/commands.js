import { h } from './ui.js';

// Every action the menus, shortcuts and command search can run. A command has
// a label, an optional shortcut, run() and optional enabled() and checked().
// The menu bar is built from MENUS below, which lists command ids in order.

const registry = new Map();

/** Adds or replaces commands. `defs` maps id to { label, keys, run, enabled, checked }. */
export function defineCommands(defs) {
  for (const [id, d] of Object.entries(defs)) registry.set(id, { id, ...d });
}

export const command = (id) => registry.get(id);
export const allCommands = () => [...registry.values()];

export function isEnabled(c) {
  try {
    return !c.enabled || !!c.enabled();
  } catch {
    return false;
  }
}

export async function runCommand(id) {
  const c = registry.get(id);
  if (!c || !isEnabled(c)) return false;
  closeMenus();
  await c.run();
  return true;
}

// ---------- Shortcuts ----------

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

/** "Ctrl+Shift+S" style key name for a keydown event. */
function keyName(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (e.code?.startsWith('Digit')) k = e.code.slice(5);
  else if (e.code?.startsWith('Key')) k = e.code.slice(3);
  else if (k === ' ') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  parts.push(k === '+' ? '=' : k);
  return parts.join('+');
}

/** Normalises "Shift+Ctrl+S" to the order keyName uses. */
function normal(keys) {
  const p = keys.split('+');
  const k = p.pop();
  const order = ['Ctrl', 'Alt', 'Shift'].filter((m) => p.includes(m));
  return [...order, k.length === 1 ? k.toUpperCase() : k].join('+');
}

/** Finds the command for a keydown. Returns its id or null. */
export function commandForKey(e) {
  const name = keyName(e);
  if (!name) return null;
  for (const c of registry.values()) {
    if (!c.keys) continue;
    const list = Array.isArray(c.keys) ? c.keys : [c.keys];
    if (list.some((k) => normal(k) === name)) return c.id;
  }
  return null;
}

/** The first shortcut of a command, written the way the menus show it. */
export function shortcutLabel(c) {
  if (!c?.keys) return '';
  const k = Array.isArray(c.keys) ? c.keys[0] : c.keys;
  return isMac ? k.replace(/Ctrl/g, 'Cmd').replace(/Alt/g, 'Option') : k;
}

// ---------- Menus ----------

let menus = [];
let bar = null;
let openMenu = null; // { name, el }

/**
 * `list` is [{ name, items }], where an item is a command id, '-' for a
 * separator, or { label, items } for a submenu.
 */
export function buildMenuBar(host, list) {
  menus = list;
  bar = host;
  host.innerHTML = '';
  for (const m of list) {
    const btn = h('button', { class: 'menu-top', 'data-menu': m.name }, m.name);
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (openMenu?.name === m.name) closeMenus();
      else showMenu(m, btn);
    });
    btn.addEventListener('mouseenter', () => {
      if (openMenu && openMenu.name !== m.name) showMenu(m, btn);
    });
    host.append(btn);
  }
}

function itemsEl(items, depth = 0) {
  const el = h('div', { class: 'menu-pop' + (depth ? ' sub' : '') });
  let lastSep = true;
  for (const it of items) {
    if (it === '-') {
      if (!lastSep) el.append(h('div', { class: 'menu-sep' }));
      lastSep = true;
      continue;
    }
    if (typeof it === 'object') {
      const kids = typeof it.items === 'function' ? it.items() : it.items;
      const row = h('div', { class: 'menu-item has-sub' + (kids.length ? '' : ' off') }, h('span', { class: 'menu-check' }), h('span', { class: 'menu-label' }, it.label), h('span', { class: 'menu-arrow' }, '›'));
      if (kids.length) {
        let sub = null;
        row.addEventListener('mouseenter', () => {
          el.querySelectorAll(':scope > .menu-item > .menu-pop').forEach((s) => s.remove());
          sub = itemsEl(kids, depth + 1);
          row.append(sub);
          const r = sub.getBoundingClientRect();
          if (r.right > window.innerWidth) sub.classList.add('left');
          if (r.bottom > window.innerHeight) sub.style.top = `${Math.max(-r.top + 8, window.innerHeight - r.bottom - 8)}px`;
        });
      }
      el.append(row);
      lastSep = false;
      continue;
    }
    const c = registry.get(it);
    if (!c) continue;
    const on = isEnabled(c);
    let checked = false;
    try {
      checked = !!c.checked?.();
    } catch {
      checked = false;
    }
    const row = h(
      'div',
      { class: 'menu-item' + (on ? '' : ' off'), 'data-cmd': c.id },
      h('span', { class: 'menu-check' }, checked ? '✓' : ''),
      h('span', { class: 'menu-label' }, c.label),
      h('span', { class: 'menu-key' }, shortcutLabel(c)),
    );
    row.addEventListener('mouseenter', () => el.querySelectorAll(':scope > .menu-item > .menu-pop').forEach((s) => s.remove()));
    row.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      if (!on) return;
      runCommand(c.id);
    });
    el.append(row);
    lastSep = false;
  }
  if (el.lastChild?.classList.contains('menu-sep')) el.lastChild.remove();
  return el;
}

function showMenu(m, btn) {
  closeMenus();
  const pop = itemsEl(m.items);
  const r = btn.getBoundingClientRect();
  pop.style.left = `${r.left}px`;
  pop.style.top = `${r.bottom}px`;
  document.body.append(pop);
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 4) pop.style.left = `${Math.max(4, window.innerWidth - pr.width - 4)}px`;
  btn.classList.add('open');
  openMenu = { name: m.name, el: pop, btn };
  setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escape, true);
  });
}

function outside(e) {
  if (openMenu && !openMenu.el.contains(e.target) && !bar.contains(e.target)) closeMenus();
}
function escape(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeMenus();
  }
}

export function closeMenus() {
  if (!openMenu) return;
  openMenu.el.remove();
  openMenu.btn.classList.remove('open');
  openMenu = null;
  document.removeEventListener('mousedown', outside, true);
  document.removeEventListener('keydown', escape, true);
}

/** Every command with the menu path it sits under, for the search box. */
export function menuPaths() {
  const out = new Map();
  const walk = (items, path) => {
    for (const it of items) {
      if (it === '-') continue;
      if (typeof it === 'object') walk(typeof it.items === 'function' ? it.items() : it.items, [...path, it.label]);
      else if (!out.has(it)) out.set(it, path);
    }
  };
  for (const m of menus) walk(m.items, [m.name]);
  return out;
}

// ---------- Command search ----------

/** Ctrl+F: type part of a command's name and press Enter to run it. */
export function commandSearch() {
  if (document.querySelector('.palette-back')) return;
  closeMenus();
  const paths = menuPaths();
  const all = allCommands().filter((c) => c.label && !c.hidden);
  const input = h('input', { class: 'field palette-input', placeholder: 'Search commands, like "curves" or "shadow"' });
  const list = h('div', { class: 'palette-list' });
  let hits = [];
  let at = 0;
  const score = (c, q) => {
    const label = c.label.toLowerCase();
    const where = (paths.get(c.id) || []).join(' ').toLowerCase();
    if (!q) return 1;
    if (label.startsWith(q)) return 4;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 3;
    if (label.includes(q)) return 2;
    if ((label + ' ' + where + ' ' + (c.also || '')).includes(q)) return 1;
    // Every word of the query somewhere.
    const words = q.split(/\s+/).filter(Boolean);
    return words.length > 1 && words.every((w) => (label + ' ' + where + ' ' + (c.also || '')).includes(w)) ? 1 : 0;
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    hits = all
      .map((c) => [c, score(c, q)])
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || a[0].label.localeCompare(b[0].label))
      .slice(0, 40)
      .map(([c]) => c);
    at = Math.min(at, Math.max(0, hits.length - 1));
    list.innerHTML = '';
    hits.forEach((c, i) => {
      const on = isEnabled(c);
      const row = h(
        'div',
        { class: 'palette-row' + (i === at ? ' on' : '') + (on ? '' : ' off'), onmousedown: (e) => (e.preventDefault(), go(c)) },
        h('span', { class: 'palette-label' }, c.label),
        h('span', { class: 'palette-path' }, (paths.get(c.id) || []).join(' › ')),
        h('span', { class: 'menu-key' }, shortcutLabel(c)),
      );
      list.append(row);
    });
    if (!hits.length) list.append(h('div', { class: 'palette-empty muted' }, 'No command matches.'));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => back.remove();
  const go = (c) => {
    if (!isEnabled(c)) return;
    close();
    runCommand(c.id);
  };
  input.addEventListener('input', () => {
    at = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') (at = Math.min(hits.length - 1, at + 1)), draw(), e.preventDefault();
    else if (e.key === 'ArrowUp') (at = Math.max(0, at - 1)), draw(), e.preventDefault();
    else if (e.key === 'Enter' && hits[at]) go(hits[at]);
  });
  const back = h('div', { class: 'palette-back', onmousedown: (e) => e.target === back && close() }, h('div', { class: 'palette' }, input, list));
  document.body.append(back);
  draw();
  input.focus();
}
