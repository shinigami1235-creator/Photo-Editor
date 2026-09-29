// Small DOM helpers: element builder, dialogs, toasts, fields.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/**
 * Shows a dialog. `buttons` is [{ label, value, primary }]. Resolves with the
 * clicked button's value, or null on Escape / close.
 */
export function modal(title, body, buttons = [{ label: 'OK', value: true, primary: true }], { wide = false } = {}) {
  return new Promise((resolve) => {
    const close = (v) => {
      document.removeEventListener('keydown', key, true);
      back.remove();
      resolve(v);
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const p = buttons.find((b) => b.primary);
        if (p) {
          e.preventDefault();
          e.stopPropagation();
          close(typeof p.value === 'function' ? p.value() : p.value);
        }
      }
    };
    const back = h(
      'div',
      { class: 'modal-back', onmousedown: (e) => e.target === back && close(null) },
      h(
        'div',
        { class: 'modal' + (wide ? ' wide' : '') },
        h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', title: 'Close', onclick: () => close(null), html: ICONS.close })),
        h('div', { class: 'modal-body' }, body),
        h(
          'div',
          { class: 'modal-foot' },
          buttons.map((b) =>
            h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label),
          ),
        ),
      ),
    );
    document.body.appendChild(back);
    document.addEventListener('keydown', key, true);
    setTimeout(() => back.querySelector('input, select, .btn.primary')?.focus(), 0);
  });
}

export function prompt(title, label, value = '') {
  const input = h('input', { class: 'field', value });
  return modal(title, h('label', { class: 'stack' }, h('span', { class: 'label' }, label), input), [
    { label: 'Cancel', value: null },
    { label: 'OK', value: () => input.value.trim() || null, primary: true },
  ]);
}

let toastEl = null;
/** A message in the bottom corner. Returns an updater; call .done() to remove it. */
export function toast(text, { sticky = false, error = false } = {}) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toasts' });
    document.body.appendChild(toastEl);
  }
  const bar = h('div', { class: 'toast-bar' });
  const label = h('span', {}, text);
  const t = h('div', { class: 'toast' + (error ? ' error' : '') }, label, bar);
  toastEl.appendChild(t);
  const done = () => t.remove();
  if (!sticky) setTimeout(done, error ? 6000 : 2800);
  return {
    text: (s) => (label.textContent = s),
    progress: (f) => {
      bar.style.width = `${Math.round(f * 100)}%`;
      bar.style.display = 'block';
    },
    done,
  };
}

export function numberField(label, value, onInput, { min, max, step = 1, suffix } = {}) {
  const input = h('input', { class: 'field num', type: 'number', value: round(value), min, max, step });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) onInput(v, false);
  });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) onInput(v, true);
  });
  return h('label', { class: 'num-field' }, h('span', { class: 'label' }, label), input, suffix ? h('span', { class: 'suffix' }, suffix) : null);
}

export function rangeField(label, value, onInput, { min = 0, max = 100, step = 1, suffix = '' } = {}) {
  const out = h('span', { class: 'range-value' }, `${round(value)}${suffix}`);
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    out.textContent = `${round(+input.value)}${suffix}`;
    onInput(+input.value, false);
  });
  input.addEventListener('change', () => onInput(+input.value, true));
  return h('label', { class: 'range-field' }, h('span', { class: 'label' }, label), input, out);
}

const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

export function section(title, ...children) {
  return h('div', { class: 'section' }, title ? h('div', { class: 'section-title' }, title) : null, ...children);
}

export function row(...children) {
  return h('div', { class: 'row' }, ...children);
}

export function iconButton(icon, title, onclick, { on = false, disabled = false } = {}) {
  return h('button', { class: 'icon-btn' + (on ? ' on' : ''), title, onclick, disabled, html: ICONS[icon] || icon });
}

export function toHex(c) {
  if (!c || typeof c !== 'string') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('').toLowerCase();
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + m.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('');
  return '#000000';
}

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONS = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  shapes: svg('<rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="16" cy="16" r="5"/>'),
  frames: svg('<rect x="4" y="3" width="16" height="18" rx="2" stroke-dasharray="3 2.5"/><path d="M4 16l5-5 4 4 3-3 4 4"/>'),
  photos: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>'),
  brand: svg('<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="7.5" r="1.3" fill="currentColor"/><circle cx="16" cy="10" r="1.3" fill="currentColor"/><path d="M12 21c-1.5 0-2-1-2-2s1-2 2.5-2H15"/>'),
  templates: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  alignLeft: svg('<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>'),
  alignCenter: svg('<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>'),
  alignRight: svg('<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>'),
  alignTop: svg('<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>'),
  alignMiddle: svg('<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>'),
  alignBottom: svg('<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>'),
  distH: svg('<path d="M3 4v16M21 4v16"/><rect x="9" y="8" width="6" height="8" rx="1"/>'),
  distV: svg('<path d="M4 3h16M4 21h16"/><rect x="8" y="9" width="8" height="6" rx="1"/>'),
  flipH: svg('<path d="M12 3v18"/><path d="M9 7L4 12l5 5V7zM15 7l5 5-5 5V7z"/>'),
  flipV: svg('<path d="M3 12h18"/><path d="M7 9l5-5 5 5H7zM7 15l5 5 5-5H7z"/>'),
  front: svg('<rect x="8" y="8" width="12" height="12" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M4 16V5a1 1 0 011-1h11"/>'),
  back: svg('<rect x="4" y="4" width="12" height="12" rx="1"/><path d="M20 8v11a1 1 0 01-1 1H8"/>'),
  bold: svg('<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/>', 'stroke-width="2.2"'),
  italic: svg('<path d="M10 5h8M6 19h8M14 5l-4 14"/>'),
  underline: svg('<path d="M7 4v7a5 5 0 0010 0V4M5 20h14"/>'),
  tLeft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  tCenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  tRight: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  tJustify: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
  crop: svg('<path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14"/>'),
  magic: svg('<path d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20L14 10"/><path d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>'),
  group: svg('<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/><rect x="7" y="7" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/>'),
  ungroup: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  magnet: svg('<path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3z"/><path d="M6 7h4M14 7h4"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>'),
  rect: svg('<rect x="4" y="5" width="16" height="14" rx="1"/>'),
  rounded: svg('<rect x="4" y="5" width="16" height="14" rx="4"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/>'),
  triangle: svg('<path d="M12 4l9 16H3z"/>'),
  line: svg('<path d="M4 20L20 4"/>'),
  arch: svg('<path d="M6 21V11a6 6 0 0112 0v10z"/>'),
  brush: svg('<path d="M18.4 3.6a2 2 0 012.8 2.8L11 16.6 7.4 13z"/><path d="M7 14c-2 0-3.5 1.5-3.5 3.5 0 1.5-.5 2.5-1.5 3 3 .5 7-.5 7-4z"/>'),
  ruler: svg('<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>'),
  qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h1M20 14h1"/>'),
  pipette: svg('<path d="M14.5 5.5l4 4"/><path d="M17.8 2.8a2.2 2.2 0 013.1 3.1l-2.4 2.4-3.1-3.1z"/><path d="M15.4 5.2L5 15.6V19h3.4L18.8 8.6"/>'),
  wand: svg('<path d="M4 20L15 9"/><path d="M15 4v2M20 9h-2M18.5 5.5l-1.4 1.4M12 3l.6 1.4M21 12l-1.4-.6"/>'),
  lasso: svg('<ellipse cx="12" cy="9" rx="8" ry="5" stroke-dasharray="3 2"/><path d="M9 13.5c-1 2 0 4 2 4.5 1 .3 1 1.5 0 2"/>'),
  heading: svg('<path d="M6 4v16M18 4v16M6 12h12"/>', 'stroke-width="2.2"'),
};

/** The app icon: a gold photo frame on navy, drawn the Cygnus Tools way. */
export function appLogo(size = 28) {
  return `<svg viewBox="0 0 512 512" width="${size}" height="${size}" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#101C2B"/><rect x="100" y="118" width="312" height="276" rx="34" fill="none" stroke="#E0B45A" stroke-width="26"/><circle cx="330" cy="196" r="30" fill="#fff"/><clipPath id="lc${size}"><rect x="113" y="131" width="286" height="250" rx="22"/></clipPath><g clip-path="url(#lc${size})"><path d="M113 381 L236 238 L330 381 Z" fill="#CFD5DE"/><path d="M200 381 L302 276 L399 381 Z" fill="#1F5E99"/></g></svg>`;
}
