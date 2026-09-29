import { canvas, fabric, designObjects } from './canvas.js';
import { systemFonts, dataRead, dataWrite, dataReadJson, dataWriteJson } from './platform.js';
import { emit } from './state.js';

// Fonts come from two places: the ones installed on the computer, and font
// files you add (stored with brand kits and inside each design that uses them).

let installed = [];
const custom = new Map(); // family -> { bytes, ext }

export const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];
export const isFontName = (n) => FONT_EXTENSIONS.includes(n.split('.').pop().toLowerCase());

export async function initFonts() {
  installed = await systemFonts();
  // Font files added in earlier sessions.
  const index = await dataReadJson('fonts/index.json', []);
  for (const { family, file } of index) {
    const bytes = await dataRead('fonts/' + file);
    if (bytes) await registerFont(family, bytes, file.split('.').pop(), false).catch(() => {});
  }
  emit('fonts');
}

export function allFonts() {
  return [...new Set([...custom.keys(), ...installed])].sort((a, b) => a.localeCompare(b));
}
export const customFonts = () => [...custom.keys()];
export const customFont = (family) => custom.get(family);

function familyFromFile(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_](regular|normal|book)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/** Adds a font file. Returns the family name it is used under. */
export async function registerFont(family, bytes, ext = 'ttf', persist = true) {
  family = family || 'Custom font';
  if (!custom.has(family)) {
    // A variable font covers a weight range, so bold uses its real bold instead of a fake one.
    const range = weightRange(bytes);
    const face = new FontFace(family, bytes.slice().buffer, range ? { weight: range } : {});
    await face.load();
    document.fonts.add(face);
    custom.set(family, { bytes, ext });
  }
  if (persist) {
    const file = family.replace(/[\\/:*?"<>|]/g, '_') + '.' + ext;
    await dataWrite('fonts/' + file, bytes);
    const index = (await dataReadJson('fonts/index.json', [])).filter((f) => f.family !== family);
    index.push({ family, file });
    await dataWriteJson('fonts/index.json', index);
  }
  fontReady(family);
  emit('fonts');
  return family;
}

export const addFontFile = (name, bytes) =>
  registerFont(familyFromBytes(bytes) || familyFromFile(name), bytes, name.split('.').pop().toLowerCase());

/** Reads the family name from a TTF/OTF name table. WOFF files fall back to the file name. */
function familyFromBytes(bytes) {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = v.getUint32(0);
    if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
    const numTables = v.getUint16(4);
    let nameOff = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (v.getUint32(rec) === 0x6e616d65) nameOff = v.getUint32(rec + 8);
    }
    if (nameOff < 0) return null;
    const count = v.getUint16(nameOff + 2);
    const strings = nameOff + v.getUint16(nameOff + 4);
    const found = {};
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12;
      const platform = v.getUint16(r);
      const lang = v.getUint16(r + 4);
      const id = v.getUint16(r + 6);
      const len = v.getUint16(r + 8);
      const off = strings + v.getUint16(r + 10);
      if (id !== 1 && id !== 16) continue;
      let s = '';
      if (platform === 3 && (lang === 0x409 || !found[id])) {
        for (let j = 0; j < len; j += 2) s += String.fromCharCode(v.getUint16(off + j));
      } else if (platform === 1 && !found[id]) {
        for (let j = 0; j < len; j++) s += String.fromCharCode(v.getUint8(off + j));
      } else continue;
      if (s) found[id] = s;
    }
    return found[16] || found[1] || null;
  } catch {
    return null;
  }
}

/** Reads the weight axis of a variable TTF/OTF, as "400 900". Null for static fonts and WOFF. */
function weightRange(bytes) {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = v.getUint32(0);
    if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
    const numTables = v.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (v.getUint32(rec) !== 0x66766172) continue; // 'fvar'
      const off = v.getUint32(rec + 8);
      const axesOff = off + v.getUint16(off + 4);
      const axisCount = v.getUint16(off + 8);
      const axisSize = v.getUint16(off + 10);
      for (let a = 0; a < axisCount; a++) {
        const p = axesOff + a * axisSize;
        if (v.getUint32(p) === 0x77676874) {
          // 'wght', stored as 16.16 fixed point
          const min = v.getInt32(p + 4) / 65536;
          const max = v.getInt32(p + 12) / 65536;
          return `${Math.round(min)} ${Math.round(max)}`;
        }
      }
    }
  } catch {
    /* not a readable font */
  }
  return null;
}

/** Text measured before a font finished loading is measured again. */
export function fontReady(family) {
  fabric.cache.clearFontCache(family);
  for (const o of designObjects()) {
    if (o.type === 'textbox' && o.fontFamily === family) {
      o.initDimensions();
      o.setCoords();
    }
  }
  canvas?.requestRenderAll();
}

export async function ensureFont(family) {
  if (!family) return;
  try {
    await document.fonts.load(`16px "${family}"`);
    await document.fonts.load(`bold 16px "${family}"`);
  } catch {
    /* installed fonts load on use */
  }
}

export async function ensureFontsFor(objects) {
  const families = new Set();
  const walk = (o) => {
    if (o.fontFamily) families.add(o.fontFamily);
    o.objects?.forEach(walk);
  };
  objects.forEach(walk);
  await Promise.all([...families].map(ensureFont));
  families.forEach((f) => fabric.cache.clearFontCache(f));
}

// ---------- Font picker ----------

/** A searchable dropdown where each name is drawn in its own font. */
export function fontPicker(current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'font-picker';
  const button = document.createElement('button');
  button.className = 'field font-button';
  button.textContent = current || 'Choose a font';
  button.style.fontFamily = `"${current}"`;
  wrap.appendChild(button);

  button.onclick = () => {
    if (wrap.querySelector('.font-pop')) return close();
    const pop = document.createElement('div');
    pop.className = 'font-pop';
    const search = document.createElement('input');
    search.className = 'field';
    search.placeholder = 'Search fonts';
    const list = document.createElement('div');
    list.className = 'font-list';
    pop.append(search, list);
    wrap.appendChild(pop);
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const names = allFonts().filter((f) => !q || f.toLowerCase().includes(q)).slice(0, 400);
      for (const f of names) {
        const item = document.createElement('div');
        item.className = 'font-item' + (f === current ? ' on' : '');
        item.textContent = f;
        item.style.fontFamily = `"${f}"`;
        item.onclick = () => {
          close();
          button.textContent = f;
          button.style.fontFamily = `"${f}"`;
          onPick(f);
        };
        list.appendChild(item);
      }
    };
    search.oninput = fill;
    fill();
    search.focus();
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
  };
  const outside = (e) => {
    if (!wrap.contains(e.target)) close();
  };
  const close = () => {
    wrap.querySelector('.font-pop')?.remove();
    document.removeEventListener('mousedown', outside);
  };
  return wrap;
}
