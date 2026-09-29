// Camera RAW files, decoded on this computer with LibRaw (libraw-wasm). The
// result becomes an ordinary PNG photo in the design.

export const RAW_EXTENSIONS = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'mrw', 'kdc', 'dcr', 'rwl'];
export const isRawName = (name) => RAW_EXTENSIONS.includes(name.split('.').pop().toLowerCase());

let LibRaw = null;

/** Decodes a RAW file to a PNG Blob. */
export async function decodeRaw(bytes) {
  if (!LibRaw) LibRaw = (await import('libraw-wasm')).default;
  const raw = new LibRaw();
  try {
    await raw.open(new Uint8Array(bytes), { useCameraWb: true, outputBps: 8, outputColor: 1, userQual: 3 });
    const img = await raw.imageData();
    if (!img) throw new Error('no image');
    const { width, height, colors, data } = img;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += colors) {
      rgba[i * 4] = data[j];
      rgba[i * 4 + 1] = data[j + (colors > 1 ? 1 : 0)];
      rgba[i * 4 + 2] = data[j + (colors > 2 ? 2 : 0)];
      rgba[i * 4 + 3] = 255;
    }
    const c = new OffscreenCanvas(width, height);
    c.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    return c.convertToBlob({ type: 'image/png' });
  } finally {
    raw.dispose();
  }
}
