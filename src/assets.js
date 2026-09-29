// Every photo, logo and cut-out lives here as a Blob with a blob: URL. Fabric
// objects reference the URL, which keeps undo snapshots small; the project
// file stores the blobs themselves.

const byUrl = new Map(); // url -> { blob, id }

export function registerBlob(blob) {
  const url = URL.createObjectURL(blob);
  byUrl.set(url, { blob, id: Math.random().toString(36).slice(2, 12) });
  return url;
}

export const registerBytes = (bytes, type) => registerBlob(new Blob([bytes], { type }));
export const blobFor = (url) => byUrl.get(url)?.blob ?? null;
export const assetIdFor = (url) => byUrl.get(url)?.id ?? null;
export const isAssetUrl = (s) => typeof s === 'string' && byUrl.has(s);

export function extFor(type) {
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[type] || 'bin';
}

export function typeFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[ext] || '';
}

export const isImageName = (name) => !!typeFor(name);

/** Loads a URL into an HTMLImageElement. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image could not be read'));
    img.src = url;
  });
}

/** Deep-walks a JSON value and swaps every string found in the map. */
export function swapStrings(value, map) {
  if (typeof value === 'string') return map.has(value) ? map.get(value) : value;
  if (Array.isArray(value)) return value.map((v) => swapStrings(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = swapStrings(value[k], map);
    return out;
  }
  return value;
}

/** Collects every asset URL used inside a JSON value. */
export function collectAssetUrls(value, found = new Set()) {
  if (typeof value === 'string') {
    if (byUrl.has(value)) found.add(value);
  } else if (Array.isArray(value)) value.forEach((v) => collectAssetUrls(v, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectAssetUrls(v, found));
  return found;
}
