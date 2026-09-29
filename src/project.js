import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { blobFor, assetIdFor, extFor, typeFor, registerBytes, swapStrings, collectAssetUrls } from './assets.js';
import { customFont, registerFont } from './fonts.js';
import { uid } from './state.js';

// A design file is a .zip holding project.json, the pictures in assets/ and any
// added fonts in fonts/. Every object stays editable when it is opened again.

const FORMAT = 'photo-editor';

function fontFamilies(pages) {
  const set = new Set();
  const walk = (o) => {
    if (o.fontFamily) set.add(o.fontFamily);
    o.objects?.forEach(walk);
  };
  pages.forEach((p) => p.objects.forEach(walk));
  return [...set];
}

export async function buildZip(doc, pages = doc.pages) {
  const plain = pages.map((p) => ({ id: p.id, background: p.background, objects: p.objects, selections: p.selections || [], guides: p.guides || [] }));
  const files = {};
  const map = new Map();
  for (const url of collectAssetUrls(plain)) {
    const blob = blobFor(url);
    const name = `assets/${assetIdFor(url)}.${extFor(blob.type)}`;
    map.set(url, name);
    files[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  const fonts = [];
  for (const family of fontFamilies(plain)) {
    const f = customFont(family);
    if (!f) continue;
    const file = `fonts/${family.replace(/[\\/:*?"<>|]/g, '_')}.${f.ext}`;
    files[file] = [f.bytes, { level: 0 }];
    fonts.push({ family, file });
  }
  const json = {
    format: FORMAT,
    version: 1,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    slides: doc.slides || 0,
    pages: swapStrings(plain, map),
    fonts,
  };
  files['project.json'] = strToU8(JSON.stringify(json));
  return zipSync(files, { level: 6 });
}

export async function readZip(bytes) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('not a design file');
  }
  if (!files['project.json']) throw new Error('not a design file');
  const json = JSON.parse(strFromU8(files['project.json']));
  if (json.format !== FORMAT) throw new Error('not a design file');
  const map = new Map();
  for (const name of Object.keys(files)) {
    if (name.startsWith('assets/')) map.set(name, registerBytes(files[name], typeFor(name)));
  }
  for (const { family, file } of json.fonts || []) {
    if (files[file]) await registerFont(family, files[file], file.split('.').pop(), false).catch(() => {});
  }
  const pages = swapStrings(json.pages, map).map((p) => ({ id: p.id || uid(), background: p.background || '#ffffff', objects: p.objects || [], selections: p.selections || [], guides: p.guides || [], thumb: null }));
  return { id: uid(), name: json.name || 'Untitled design', width: json.width, height: json.height, dpi: json.dpi || 72, slides: json.slides || 0, pages };
}
