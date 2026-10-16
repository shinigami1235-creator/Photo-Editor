// Colour lookup tables: .cube parsing and fast application to RGBA pixels.

const NOT_CUBE = 'The file is not a .cube colour lookup.';

function triple(parts, from) {
  const v = [Number(parts[from]), Number(parts[from + 1]), Number(parts[from + 2])];
  return v.every(Number.isFinite) ? v : null;
}

/**
 * Parse an Adobe/Resolve .cube file.
 * Returns data in file order: red index changes fastest, then green, then blue.
 * @param {string} text
 * @returns {{kind: '3d'|'1d', size: number, title: string, domainMin: number[], domainMax: number[], data: Float32Array}}
 */
export function parseCube(text) {
  if (typeof text !== 'string') throw new Error(NOT_CUBE);
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  let size3 = 0;
  let size1 = 0;
  let title = '';
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];

  // First pass: keyword lines (they start with a letter).
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#' || !/^[A-Za-z]/.test(line)) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') {
      const q1 = line.indexOf('"');
      const q2 = line.lastIndexOf('"');
      title = q2 > q1 ? line.slice(q1 + 1, q2) : line.slice(5).trim();
    } else if (key === 'LUT_3D_SIZE') {
      size3 = Number(parts[1]);
    } else if (key === 'LUT_1D_SIZE') {
      size1 = Number(parts[1]);
    } else if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      const v = triple(parts, 1);
      if (!v) throw new Error(NOT_CUBE);
      if (key === 'DOMAIN_MIN') domainMin = v;
      else domainMax = v;
    } else if (key === 'LUT_3D_INPUT_RANGE' || key === 'LUT_1D_INPUT_RANGE') {
      const lo = Number(parts[1]);
      const hi = Number(parts[2]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        domainMin = [lo, lo, lo];
        domainMax = [hi, hi, hi];
      }
    }
  }

  let kind;
  let size;
  if (size3) {
    kind = '3d';
    size = size3;
    if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error(NOT_CUBE);
  } else if (size1) {
    kind = '1d';
    size = size1;
    if (!Number.isInteger(size) || size < 2 || size > 65536) throw new Error(NOT_CUBE);
  } else {
    throw new Error(NOT_CUBE);
  }
  for (let c = 0; c < 3; c++) {
    if (!(domainMax[c] > domainMin[c])) throw new Error(NOT_CUBE);
  }

  // Second pass: data lines.
  const count = kind === '3d' ? size * size * size : size;
  const data = new Float32Array(count * 3);
  let n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === '#' || /^[A-Za-z]/.test(line)) continue;
    if (n >= count) throw new Error(NOT_CUBE);
    const v = triple(line.split(/\s+/), 0);
    if (!v) throw new Error(NOT_CUBE);
    data[n * 3] = v[0];
    data[n * 3 + 1] = v[1];
    data[n * 3 + 2] = v[2];
    n++;
  }
  if (n !== count) throw new Error(NOT_CUBE);

  return { kind, size, title, domainMin, domainMax, data };
}

// For each 8-bit value: position in the LUT as a lower index and a fraction.
function indexTable(size, lo, hi, stride) {
  const off = new Int32Array(256);
  const frac = new Float64Array(256);
  for (let v = 0; v < 256; v++) {
    let t = (v / 255 - lo) / (hi - lo);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const pos = t * (size - 1);
    const i = Math.min(Math.floor(pos), size - 2);
    off[v] = i * stride;
    frac[v] = pos - i;
  }
  return { off, frac };
}

/**
 * Apply a LUT in place to RGBA pixels. Alpha is untouched.
 * Input 0..255 is read as 0..1 and looked up through the LUT's domain.
 * 3D LUTs use trilinear interpolation, 1D LUTs linear interpolation per channel.
 * @param {Uint8ClampedArray} rgba
 * @param {object} lut result of parseCube or lutFromImageFn
 * @param {number} [amount] blend with the original, 0..1
 */
export function applyLut(rgba, lut, amount = 1) {
  amount = amount < 0 ? 0 : amount > 1 ? 1 : Number(amount);
  if (!(amount > 0)) return;
  const { size, data, domainMin: lo, domainMax: hi } = lut;
  const len = rgba.length - (rgba.length % 4);

  if (lut.kind === '1d') {
    // Each channel is independent, so build the final 256-entry result once.
    const tables = [0, 1, 2].map((c) => {
      const idx = indexTable(size, lo[c], hi[c], 3);
      const out = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) {
        const i = idx.off[v] + c;
        const res = (data[i] + (data[i + 3] - data[i]) * idx.frac[v]) * 255;
        out[v] = v + (res - v) * amount;
      }
      return out;
    });
    const [tr, tg, tb] = tables;
    for (let p = 0; p < len; p += 4) {
      rgba[p] = tr[rgba[p]];
      rgba[p + 1] = tg[rgba[p + 1]];
      rgba[p + 2] = tb[rgba[p + 2]];
    }
    return;
  }

  const dr = 3;
  const dg = size * 3;
  const db = size * size * 3;
  const dgr = dg + dr;
  const dbr = db + dr;
  const dbg = db + dg;
  const dbgr = db + dg + dr;
  const R = indexTable(size, lo[0], hi[0], dr);
  const G = indexTable(size, lo[1], hi[1], dg);
  const B = indexTable(size, lo[2], hi[2], db);
  const rOff = R.off;
  const gOff = G.off;
  const bOff = B.off;
  const rFrac = R.frac;
  const gFrac = G.frac;
  const bFrac = B.frac;

  for (let p = 0; p < len; p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const o = rOff[r] + gOff[g] + bOff[b];
    const fr = rFrac[r];
    const fg = gFrac[g];
    const fb = bFrac[b];

    let a = data[o];
    let x00 = a + (data[o + dr] - a) * fr;
    a = data[o + dg];
    let x10 = a + (data[o + dgr] - a) * fr;
    a = data[o + db];
    let x01 = a + (data[o + dbr] - a) * fr;
    a = data[o + dbg];
    let x11 = a + (data[o + dbgr] - a) * fr;
    let y0 = x00 + (x10 - x00) * fg;
    let y1 = x01 + (x11 - x01) * fg;
    rgba[p] = r + ((y0 + (y1 - y0) * fb) * 255 - r) * amount;

    a = data[o + 1];
    x00 = a + (data[o + dr + 1] - a) * fr;
    a = data[o + dg + 1];
    x10 = a + (data[o + dgr + 1] - a) * fr;
    a = data[o + db + 1];
    x01 = a + (data[o + dbr + 1] - a) * fr;
    a = data[o + dbg + 1];
    x11 = a + (data[o + dbgr + 1] - a) * fr;
    y0 = x00 + (x10 - x00) * fg;
    y1 = x01 + (x11 - x01) * fg;
    rgba[p + 1] = g + ((y0 + (y1 - y0) * fb) * 255 - g) * amount;

    a = data[o + 2];
    x00 = a + (data[o + dr + 2] - a) * fr;
    a = data[o + dg + 2];
    x10 = a + (data[o + dgr + 2] - a) * fr;
    a = data[o + db + 2];
    x01 = a + (data[o + dbr + 2] - a) * fr;
    a = data[o + dbg + 2];
    x11 = a + (data[o + dbgr + 2] - a) * fr;
    y0 = x00 + (x10 - x00) * fg;
    y1 = x01 + (x11 - x01) * fg;
    rgba[p + 2] = b + ((y0 + (y1 - y0) * fb) * 255 - b) * amount;
  }
}

/**
 * Build a 3D LUT by sampling fn(r, g, b) -> [r, g, b] on a size^3 grid of 0..1 inputs.
 * @param {number} size 2..256
 * @param {(r: number, g: number, b: number) => number[]} fn
 * @returns {{kind: '3d', size: number, title: string, domainMin: number[], domainMax: number[], data: Float32Array}}
 */
export function lutFromImageFn(size, fn) {
  if (!Number.isInteger(size) || size < 2 || size > 256) {
    throw new Error('LUT size must be a whole number from 2 to 256.');
  }
  const data = new Float32Array(size * size * size * 3);
  const k = 1 / (size - 1);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const v = fn(r * k, g * k, b * k);
        data[i++] = v[0];
        data[i++] = v[1];
        data[i++] = v[2];
      }
    }
  }
  return { kind: '3d', size, title: '', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}
