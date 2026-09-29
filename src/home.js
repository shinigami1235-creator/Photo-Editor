import { SIZE_PRESETS } from './state.js';
import { isDesktop, dataReadJson, dataWriteJson, baseName } from './platform.js';
import { h, ICONS, appLogo } from './ui.js';

// The start screen: new design sizes, open, and recent designs.

const MAX_RECENT = 12;

export async function recentList() {
  return dataReadJson('recent.json', []);
}

/** Remembers a saved or opened design file (desktop only, since it reopens by path). */
export async function rememberRecent(path, name, thumb) {
  if (!isDesktop || !path) return;
  const list = (await recentList()).filter((r) => r.path !== path);
  list.unshift({ path, name, thumb, at: Date.now() });
  await dataWriteJson('recent.json', list.slice(0, MAX_RECENT));
}

export async function forgetRecent(path) {
  await dataWriteJson('recent.json', (await recentList()).filter((r) => r.path !== path));
}

/**
 * Shows the start screen. `actions` = { create(preset), open(), openRecent(entry), close() }.
 * `canClose` is false on first launch.
 */
export async function showHome(actions, { canClose = true } = {}) {
  document.querySelector('.home-back')?.remove();
  const recent = await recentList();
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', key, true);
  };
  const key = (e) => {
    if (e.key === 'Escape' && canClose) {
      e.stopPropagation();
      close();
    }
  };
  const card = (p) => {
    const r = p.width / p.height;
    return h(
      'button',
      {
        class: 'home-preset',
        onclick: () => {
          close();
          actions.create(p);
        },
      },
      h('span', { class: 'home-shape-box' }, h('span', { class: 'home-shape', style: { width: `${r >= 1 ? 64 : 64 * r}px`, height: `${r >= 1 ? 64 / r : 64}px` } })),
      h('span', { class: 'preset-name' }, p.name),
      h('span', { class: 'muted small' }, `${p.width} × ${p.height} px`),
    );
  };
  const back = h(
    'div',
    { class: 'modal-back home-back' },
    h(
      'div',
      { class: 'home' },
      h(
        'div',
        { class: 'home-head' },
        h('div', { class: 'home-title' }, h('span', { html: appLogo(48) }), h('div', {}, h('h1', { class: 'wordmark dark' }, 'Photo ', h('span', {}, 'Editor')), h('p', { class: 'muted' }, 'Posts, carousels and flyers.'))),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                close();
                actions.open();
              },
            },
            'Open design or picture',
          ),
          canClose ? h('button', { class: 'icon-btn', title: 'Close', onclick: close, html: ICONS.close }) : null,
        ),
      ),
      h('div', { class: 'section-title' }, 'New design'),
      h(
        'div',
        { class: 'home-presets' },
        SIZE_PRESETS.map(card),
        h(
          'button',
          {
            class: 'home-preset custom',
            onclick: () => {
              close();
              actions.custom();
            },
          },
          h('span', { class: 'home-shape-box' }, h('span', { html: ICONS.plus })),
          h('span', { class: 'preset-name' }, 'Custom size'),
          h('span', { class: 'muted small' }, 'Any width and height'),
        ),
        h(
          'button',
          {
            class: 'home-preset custom',
            onclick: () => {
              close();
              actions.carousel();
            },
          },
          h('span', { class: 'home-shape-box' }, h('span', { class: 'home-carousel' }, h('span'), h('span'), h('span'))),
          h('span', { class: 'preset-name' }, 'Panorama carousel'),
          h('span', { class: 'muted small' }, '2 to 10 slides'),
        ),
      ),
      h('div', { class: 'section-title' }, 'Recent designs'),
      recent.length
        ? h(
            'div',
            { class: 'home-recent' },
            recent.map((r) =>
              h(
                'button',
                {
                  class: 'home-file',
                  title: r.path,
                  onclick: () => {
                    close();
                    actions.openRecent(r);
                  },
                },
                h('span', { class: 'home-thumb' }, r.thumb ? h('img', { src: r.thumb }) : null),
                h('span', { class: 'home-file-name' }, r.name || baseName(r.path)),
                h('span', { class: 'muted small' }, new Date(r.at).toLocaleDateString()),
              ),
            ),
          )
        : h('p', { class: 'muted' }, isDesktop ? 'Designs you save or open show here.' : 'Recent designs show here in the desktop app.'),
    ),
  );
  document.body.appendChild(back);
  document.addEventListener('keydown', key, true);
}


// ---------- Keyboard shortcuts ----------

export const SHORTCUTS = [
  ['Ctrl+N', 'New design'],
  ['Ctrl+O', 'Open design or picture'],
  ['Ctrl+S / Ctrl+Shift+S', 'Save / Save as'],
  ['Ctrl+E', 'Export'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut, paste. A pasted screenshot becomes a photo'],
  ['Ctrl+D or Ctrl+J', 'Duplicate'],
  ['Ctrl+G / Ctrl+Shift+G', 'Group / Ungroup'],
  ['Ctrl+A', 'Select all'],
  ['Ctrl+L', 'Lock or unlock'],
  ['Ctrl+] / Ctrl+[', 'Forward / Backward (add Shift for front / back)'],
  ['Arrow keys', 'Nudge 1 px, 10 px with Shift'],
  ['Delete', 'Delete'],
  ['Enter', 'Edit text, or crop a photo'],
  ['T, R, O, L, F', 'Add text, rectangle, circle, line, frame'],
  ['B', 'Draw'],
  ['S', 'Select tab: M rectangle or ellipse, L lasso or polygon, W wand'],
  ['Shift / Alt while selecting', 'Add to / subtract from the selection'],
  ['Ctrl+Shift+I', 'Invert the selection'],
  ['Ctrl+J / Ctrl+Shift+J', 'Copy / cut the selection to a new layer (Ctrl+J with no selection duplicates)'],
  ['Delete with a selection', 'Hide that area of the layer'],
  ['Esc or Ctrl+D with a selection', 'Deselect'],
  ['Space + drag', 'Pan'],
  ['Ctrl + wheel', 'Zoom'],
  ['Ctrl+0 / Ctrl+1', 'Fit to screen / Actual size'],
  ['Ctrl+R', 'Rulers'],
  ['X, [ and ] while painting a mask', 'Switch Hide and Show, brush size'],
  ['J and S in Retouch', 'Spot heal, Clone. Alt+click picks the clone source'],
  ['Alt while dragging', 'Move without snapping'],
  ['?', 'This list'],
];
