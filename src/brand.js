import { dataReadJson, dataWriteJson, dataRead, dataWrite, dataDelete, pickFiles } from './platform.js';
import { registerBytes, typeFor, extFor, blobFor, isImageName } from './assets.js';
import { state, uid, emit } from './state.js';
import { pickColor } from './eyedropper.js';
import { h, modal, prompt, iconButton, toast, ICONS } from './ui.js';
import { fontPicker, addFontFile, isFontName } from './fonts.js';

// Brand kits: saved colours, a heading and body font, and logos, one kit per brand.

let kits = [];
const logoUrls = new Map(); // logo id -> asset url

export const currentKit = () => kits.find((k) => k.id === state.brandKitId) || null;
export const brandFont = (role) => currentKit()?.fonts?.[role] || null;
export const brandColors = () => currentKit()?.colors || [];
/** Every logo in every kit that has loaded: { id, name, url }. */
export const allLogos = () =>
  kits.flatMap((k) => k.logos.map((l) => ({ id: l.id, name: kits.length > 1 ? `${k.name}, ${l.name}` : l.name, url: logoUrls.get(l.id) }))).filter((l) => l.url);

export async function initBrand() {
  const saved = await dataReadJson('brand/kits.json', { current: null, kits: [] });
  kits = saved.kits || [];
  state.brandKitId = saved.current && kits.some((k) => k.id === saved.current) ? saved.current : kits[0]?.id || null;
  for (const k of kits) for (const logo of k.logos) await loadLogo(logo);
  emit('brand');
}

async function loadLogo(logo) {
  if (logoUrls.has(logo.id)) return logoUrls.get(logo.id);
  const bytes = await dataRead(`brand/logos/${logo.file}`);
  if (!bytes) return null;
  const url = registerBytes(bytes, typeFor(logo.file));
  logoUrls.set(logo.id, url);
  return url;
}

const save = () => dataWriteJson('brand/kits.json', { current: state.brandKitId, kits });

function changed() {
  save();
  emit('brand');
}

export async function newKit() {
  const name = await prompt('New brand kit', 'Name', '');
  if (!name) return;
  const kit = { id: uid(), name, colors: [], fonts: { heading: null, body: null }, logos: [] };
  kits.push(kit);
  state.brandKitId = kit.id;
  changed();
}

export async function renameKit() {
  const kit = currentKit();
  if (!kit) return;
  const name = await prompt('Rename brand kit', 'Name', kit.name);
  if (!name) return;
  kit.name = name;
  changed();
}

export async function deleteKit() {
  const kit = currentKit();
  if (!kit) return;
  const ok = await modal('Delete brand kit', h('p', {}, `Delete ${kit.name} with its ${kit.colors.length} colours and ${kit.logos.length} logos?`), [
    { label: 'Cancel', value: false },
    { label: 'Delete', value: true, primary: true },
  ]);
  if (!ok) return;
  for (const logo of kit.logos) await dataDelete(`brand/logos/${logo.file}`).catch(() => {});
  kits = kits.filter((k) => k !== kit);
  state.brandKitId = kits[0]?.id || null;
  changed();
}

export function selectKit(id) {
  state.brandKitId = id;
  changed();
}

export function addColor(hex) {
  const kit = currentKit();
  if (!kit || kit.colors.includes(hex)) return;
  kit.colors.push(hex);
  changed();
}

export function removeColor(hex) {
  const kit = currentKit();
  if (!kit) return;
  kit.colors = kit.colors.filter((c) => c !== hex);
  changed();
}

export function setKitFont(role, family) {
  const kit = currentKit();
  if (!kit) return;
  kit.fonts[role] = family;
  changed();
}

export async function addLogoBytes(name, bytes) {
  const kit = currentKit();
  if (!kit) return;
  const type = typeFor(name);
  const id = uid();
  const file = `${id}.${extFor(type)}`;
  await dataWrite(`brand/logos/${file}`, bytes);
  const logo = { id, name: name.replace(/\.[^.]+$/, ''), file };
  kit.logos.push(logo);
  logoUrls.set(id, registerBytes(bytes, type));
  changed();
}

export async function removeLogo(id) {
  const kit = currentKit();
  if (!kit) return;
  const logo = kit.logos.find((l) => l.id === id);
  if (!logo) return;
  await dataDelete(`brand/logos/${logo.file}`).catch(() => {});
  kit.logos = kit.logos.filter((l) => l.id !== id);
  changed();
}

/** Copies a picture already on the page into the kit as a logo. */
export async function addLogoFromUrl(url, name = 'Logo') {
  const blob = blobFor(url);
  if (!blob) return;
  await addLogoBytes(`${name}.${extFor(blob.type)}`, new Uint8Array(await blob.arrayBuffer()));
}

// ---------- Panel ----------

/**
 * Builds the Brand panel. `actions` are callbacks into the editor:
 * applyColor(hex), addHeading(), addBody(), addLogo(url), selectionColor().
 */
export function renderBrandPanel(el, actions) {
  el.innerHTML = '';
  const kit = currentKit();
  const select = h(
    'select',
    { class: 'field', onchange: (e) => selectKit(e.target.value) },
    kits.map((k) => h('option', { value: k.id, selected: k.id === state.brandKitId }, k.name)),
  );
  el.append(
    h(
      'div',
      { class: 'panel-block' },
      h('div', { class: 'row' }, kits.length ? select : h('span', { class: 'muted grow' }, 'No brand kits yet.'), iconButton('plus', 'New brand kit', newKit)),
      kit ? h('div', { class: 'row tight' }, h('button', { class: 'link', onclick: renameKit }, 'Rename'), h('button', { class: 'link danger', onclick: deleteKit }, 'Delete kit')) : null,
    ),
  );
  if (!kit) return;

  // Colours
  const picker = h('input', { type: 'color', class: 'hidden-color', value: actions.selectionColor() || '#14497a' });
  picker.addEventListener('change', () => addColor(picker.value));
  const swatches = h(
    'div',
    { class: 'swatches' },
    kit.colors.map((c) =>
      h(
        'button',
        {
          class: 'swatch',
          title: `${c}. Right-click to remove.`,
          style: { background: c },
          onclick: () => actions.applyColor(c),
          oncontextmenu: (e) => {
            e.preventDefault();
            removeColor(c);
          },
        },
      ),
    ),
    h('button', { class: 'swatch add', title: 'Add colour', onclick: () => picker.click(), html: '+' }),
    h('button', {
      class: 'swatch add',
      title: 'Add a colour picked from the page',
      html: ICONS.pipette,
      onclick: async () => {
        const c = await pickColor();
        if (c) addColor(c);
      },
    }),
    picker,
  );
  el.append(h('div', { class: 'panel-block' }, h('div', { class: 'section-title' }, 'Colours'), swatches));

  // Fonts
  const fontRow = (role, label, add) =>
    h(
      'div',
      { class: 'brand-font' },
      h('div', { class: 'row' }, h('span', { class: 'label grow' }, label), h('button', { class: 'link', onclick: add }, 'Add to page')),
      fontPicker(kit.fonts[role], (f) => setKitFont(role, f)),
    );
  el.append(
    h(
      'div',
      { class: 'panel-block' },
      h('div', { class: 'section-title' }, 'Fonts'),
      fontRow('heading', 'Heading', actions.addHeading),
      fontRow('body', 'Body', actions.addBody),
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            const files = await pickFiles({ extensions: ['ttf', 'otf', 'woff', 'woff2'], multiple: true, label: 'Fonts' });
            for (const f of files || []) {
              try {
                const fam = await addFontFile(f.name, f.bytes);
                toast(`${fam} added.`);
              } catch {
                toast(`${f.name} could not be read as a font.`, { error: true });
              }
            }
          },
        },
        'Add font file',
      ),
    ),
  );

  // Logos
  const grid = h(
    'div',
    { class: 'logo-grid' },
    kit.logos.map((logo) => {
      const url = logoUrls.get(logo.id);
      return h(
        'div',
        { class: 'logo-tile', title: logo.name },
        url ? h('img', { src: url, draggable: 'true', ondragstart: (e) => e.dataTransfer.setData('text/x-asset', url), onclick: () => actions.addLogo(url) }) : null,
        h('button', { class: 'tile-x', title: 'Remove logo', onclick: () => removeLogo(logo.id), html: '&times;' }),
      );
    }),
    h(
      'button',
      {
        class: 'logo-tile add',
        title: 'Add logo',
        onclick: async () => {
          const files = await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'], multiple: true, label: 'Images' });
          for (const f of files || []) if (isImageName(f.name)) await addLogoBytes(f.name, f.bytes);
        },
        html: '+',
      },
    ),
  );
  el.append(h('div', { class: 'panel-block' }, h('div', { class: 'section-title' }, 'Logos'), grid));
  void isFontName;
}
