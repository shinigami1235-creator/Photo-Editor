// File access. Inside the desktop app this goes through the Rust commands in
// src-tauri/src/lib.rs; in a plain browser (used for testing) it falls back to
// file inputs, downloads and IndexedDB.

export const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

let tauri = null;
async function api() {
  if (!tauri) {
    const [core, dialog, event] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/event'),
    ]);
    tauri = { core, dialog, event };
  }
  return tauri;
}

const toBytes = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));
export const baseName = (p) => p.split(/[\\/]/).pop();

/** Opens files. Returns [{ name, path, bytes }] or null when cancelled. */
export async function pickFiles({ extensions, multiple = false, label = 'Files' }) {
  if (isDesktop) {
    const { core, dialog } = await api();
    let picked = await dialog.open({ multiple, filters: [{ name: label, extensions }] });
    if (!picked) return null;
    if (!Array.isArray(picked)) picked = [picked];
    const out = [];
    for (const path of picked) {
      const bytes = toBytes(await core.invoke('read_file', { path }));
      out.push({ name: baseName(path), path, bytes });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = extensions.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const files = [...input.files];
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Reads a file by path (desktop only). */
export async function readPath(path) {
  const { core } = await api();
  return toBytes(await core.invoke('read_file', { path }));
}

/** Asks where to save. Returns a path on desktop, the file name in the browser, or null. */
export async function pickSavePath({ defaultName, extensions, label }) {
  if (!isDesktop) return defaultName;
  const { dialog } = await api();
  return dialog.save({ defaultPath: defaultName, filters: [{ name: label, extensions }] });
}

/** Asks for a folder. Returns a path on desktop, '' in the browser (downloads), or null. */
export async function pickFolder() {
  if (!isDesktop) return '';
  const { dialog } = await api();
  return dialog.open({ directory: true });
}

export function joinPath(dir, name) {
  if (!dir) return name;
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

export async function writeFile(path, bytes, mime = 'application/octet-stream') {
  if (isDesktop) {
    const { core } = await api();
    await core.invoke('write_file', toBytes(bytes), { headers: { 'x-path': encodeURIComponent(path) } });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName(path);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- App data (brand kits, templates, autosave) ----------

let idb = null;
function openIdb() {
  if (idb) return idb;
  idb = new Promise((resolve, reject) => {
    const req = indexedDB.open('photo-editor', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idb;
}
async function idbDo(mode, fn) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function dataRead(rel) {
  try {
    if (isDesktop) {
      const { core } = await api();
      return toBytes(await core.invoke('data_read', { rel }));
    }
    const v = await idbDo('readonly', (s) => s.get(rel));
    return v ? toBytes(v) : null;
  } catch {
    return null;
  }
}

export async function dataWrite(rel, bytes) {
  if (isDesktop) {
    const { core } = await api();
    await core.invoke('data_write', toBytes(bytes), { headers: { 'x-rel': encodeURIComponent(rel) } });
    return;
  }
  await idbDo('readwrite', (s) => s.put(toBytes(bytes).slice(), rel));
}

export async function dataList(dir) {
  try {
    if (isDesktop) {
      const { core } = await api();
      return await core.invoke('data_list', { dir });
    }
    const keys = await idbDo('readonly', (s) => s.getAllKeys());
    const prefix = dir.replace(/\/?$/, '/');
    return keys.filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => k.slice(prefix.length)).sort();
  } catch {
    return [];
  }
}

export async function dataDelete(rel) {
  if (isDesktop) {
    const { core } = await api();
    await core.invoke('data_delete', { rel });
    return;
  }
  await idbDo('readwrite', (s) => s.delete(rel));
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export async function dataReadJson(rel, fallback) {
  const bytes = await dataRead(rel);
  if (!bytes) return fallback;
  try {
    return JSON.parse(dec.decode(bytes));
  } catch {
    return fallback;
  }
}
export const dataWriteJson = (rel, value) => dataWrite(rel, enc.encode(JSON.stringify(value)));

// ---------- Fonts ----------

const FALLBACK_FONTS = [
  'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
  'Courier New', 'Franklin Gothic Medium', 'Georgia', 'Impact', 'Lucida Sans Unicode', 'Palatino Linotype',
  'Segoe Print', 'Segoe Script', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  'DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Serif',
];

export async function systemFonts() {
  if (isDesktop) {
    try {
      const { core } = await api();
      const list = await core.invoke('list_fonts');
      if (list.length) return list;
    } catch (e) {
      console.warn('list_fonts failed', e);
    }
  }
  return FALLBACK_FONTS.filter((f) => document.fonts.check(`12px "${f}"`));
}

// ---------- Background removal model ----------

export async function modelBytes(onProgress) {
  if (!isDesktop) {
    // Browser testing: the model sits in public/models when present.
    const res = await fetch('/models/isnet-general-use.onnx');
    if (!res.ok) throw new Error('model missing');
    return new Uint8Array(await res.arrayBuffer());
  }
  const { core, event } = await api();
  if (!(await core.invoke('model_ready'))) {
    const unlisten = await event.listen('model-progress', (e) => {
      const [received, total] = e.payload;
      onProgress?.(received, total);
    });
    try {
      await core.invoke('model_download');
    } finally {
      unlisten();
    }
  }
  return toBytes(await core.invoke('model_read'));
}
