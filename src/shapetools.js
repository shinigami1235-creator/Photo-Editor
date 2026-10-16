// Shape outlines, shape-to-polygon conversion and boolean operations.
import polygonClipping from 'polygon-clipping';

const TAU = Math.PI * 2;
const MAX_SEGMENTS = 256;
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function num(v, fallback) {
  const n = Number(v);
  return v === undefined || v === null || !Number.isFinite(n) ? fallback : n;
}

function round3(n) {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
}

// ---------------------------------------------------------------- shapePath

function toPathString(cmds) {
  return cmds.map((c) => c[0] + c.slice(1).map(round3).join(' ')).join(' ');
}

function polyCmds(pts) {
  const cmds = pts.map((p, i) => [i === 0 ? 'M' : 'L', p[0], p[1]]);
  cmds.push(['Z']);
  return cmds;
}

// Bounding box of M/L/C/Q commands, curves sampled.
function commandBounds(cmds) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  let cx = 0;
  let cy = 0;
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') {
      cx = c[1];
      cy = c[2];
      add(cx, cy);
    } else if (c[0] === 'C') {
      for (let i = 1; i <= 100; i++) {
        const t = i / 100;
        const u = 1 - t;
        add(
          u * u * u * cx + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
          u * u * u * cy + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
        );
      }
      cx = c[5];
      cy = c[6];
    } else if (c[0] === 'Q') {
      for (let i = 1; i <= 100; i++) {
        const t = i / 100;
        const u = 1 - t;
        add(
          u * u * cx + 2 * u * t * c[1] + t * t * c[3],
          u * u * cy + 2 * u * t * c[2] + t * t * c[4],
        );
      }
      cx = c[3];
      cy = c[4];
    }
  }
  return { minX, minY, maxX, maxY };
}

// Scale and move the commands so their bounds are exactly w x h, centred on 0,0.
function fitCommands(cmds, w, h) {
  const b = commandBounds(cmds);
  const sx = b.maxX > b.minX ? w / (b.maxX - b.minX) : 1;
  const sy = b.maxY > b.minY ? h / (b.maxY - b.minY) : 1;
  const mx = (b.minX + b.maxX) / 2;
  const my = (b.minY + b.maxY) / 2;
  return cmds.map((c) => {
    const out = [c[0]];
    for (let i = 1; i < c.length; i += 2) {
      out.push((c[i] - mx) * sx, (c[i + 1] - my) * sy);
    }
    return out;
  });
}

function starPoints(n, inner) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function bubbleCmds(w, h) {
  const k = 0.5523;
  const left = -w / 2;
  const right = w / 2;
  const top = -h / 2;
  const bot = -h / 2 + h * 0.8;
  const r = Math.min(0.18 * Math.min(w, h), (right - left) / 2, (bot - top) / 2);
  const x0 = left + r + 0.05 * w;
  const x1 = Math.min(x0 + 0.18 * w, right - r);
  const tipX = Math.max(left, x0 - 0.04 * w);
  const c = r * k;
  return [
    ['M', left + r, top],
    ['L', right - r, top],
    ['C', right - r + c, top, right, top + r - c, right, top + r],
    ['L', right, bot - r],
    ['C', right, bot - r + c, right - r + c, bot, right - r, bot],
    ['L', x1, bot],
    ['L', tipX, h / 2],
    ['L', x0, bot],
    ['L', left + r, bot],
    ['C', left + r - c, bot, left, bot - r + c, left, bot - r],
    ['L', left, top + r],
    ['C', left, top + r - c, left + r - c, top, left + r, top],
    ['Z'],
  ];
}

const HEART = [
  ['M', 0, -0.45],
  ['C', 0, -0.75, -0.3, -1, -0.6, -1],
  ['C', -0.85, -1, -1, -0.8, -1, -0.55],
  ['C', -1, -0.1, -0.45, 0.3, 0, 1],
  ['C', 0.45, 0.3, 1, -0.1, 1, -0.55],
  ['C', 1, -0.8, 0.85, -1, 0.6, -1],
  ['C', 0.3, -1, 0, -0.75, 0, -0.45],
  ['Z'],
];

/**
 * Build SVG path data for a preset shape centred on 0,0 inside a w x h box.
 * Uses only M, L, C, Q and Z. Kinds: star, burst, polygon, arrow, heart, bubble, cross.
 * @param {string} kind
 * @param {number} w
 * @param {number} h
 * @param {object} [opts] points, inner, sides, shaft, head, thick
 * @returns {string}
 */
export function shapePath(kind, w, h, opts = {}) {
  const sz = (v) => Math.max(Math.abs(num(v, 1)), 0.001);
  w = sz(w);
  h = sz(h);
  opts = opts || {};
  let cmds;
  switch (kind) {
    case 'star':
    case 'burst': {
      const burst = kind === 'burst';
      const n = Math.max(3, Math.round(num(opts.points, burst ? 16 : 5)));
      const inner = clamp(num(opts.inner, burst ? 0.8 : 0.45), 0.1, 0.95);
      cmds = fitCommands(polyCmds(starPoints(n, inner)), w, h);
      break;
    }
    case 'polygon': {
      const n = Math.max(3, Math.round(num(opts.sides, 6)));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * TAU) / n;
        pts.push([Math.cos(a), Math.sin(a)]);
      }
      cmds = fitCommands(polyCmds(pts), w, h);
      break;
    }
    case 'arrow': {
      const s = (clamp(num(opts.shaft, 0.4), 0.05, 1) * h) / 2;
      const hl = clamp(num(opts.head, 0.4), 0.05, 0.95) * w;
      const xh = w / 2 - hl;
      cmds = polyCmds([
        [-w / 2, -s],
        [xh, -s],
        [xh, -h / 2],
        [w / 2, 0],
        [xh, h / 2],
        [xh, s],
        [-w / 2, s],
      ]);
      break;
    }
    case 'heart':
      cmds = fitCommands(HEART, w, h);
      break;
    case 'bubble':
      cmds = bubbleCmds(w, h);
      break;
    case 'cross': {
      const t = clamp(num(opts.thick, 0.34), 0.05, 1) * Math.min(w, h);
      const a = Math.min(t, w) / 2;
      const b = Math.min(t, h) / 2;
      const x = w / 2;
      const y = h / 2;
      cmds = polyCmds([
        [-a, -y], [a, -y], [a, -b], [x, -b], [x, b], [a, b],
        [a, y], [-a, y], [-a, b], [-x, b], [-x, -b], [-a, -b],
      ]);
      break;
    }
    default:
      throw new Error(`Unknown shape kind: ${kind}`);
  }
  return toPathString(cmds);
}

/**
 * Parse SVG path data into Fabric-style command arrays (letters kept as written,
 * implicit repeats expanded; a repeated M becomes L).
 * @param {string} d
 * @returns {Array<Array<string|number>>}
 */
export function parsePathData(d) {
  if (typeof d !== 'string') throw new Error('Path data must be a string.');
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const letter = m[1];
    const up = letter.toUpperCase();
    const n = ARITY[up];
    if (n === 0) {
      out.push([letter]);
      continue;
    }
    const nums = (m[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(Number);
    if (nums.length < n) throw new Error(`Bad path data near "${letter}".`);
    for (let i = 0; i + n <= nums.length; i += n) {
      let l = letter;
      if (i > 0 && up === 'M') l = letter === 'M' ? 'L' : 'l';
      out.push([l, ...nums.slice(i, i + n)]);
    }
  }
  return out;
}

// ----------------------------------------------------------- objectPolygons

// Largest stretch the matrix applies to any direction.
function matrixScale(m) {
  const p = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3];
  const det = m[0] * m[3] - m[1] * m[2];
  return Math.sqrt((p + Math.sqrt(Math.max(0, p * p - 4 * det * det))) / 2);
}

// Angle step (radians) whose chord error on a circle of radius r stays under tol.
function arcStep(r, tol) {
  if (tol >= r) return Math.PI;
  return 2 * Math.acos(1 - tol / r);
}

function ellipseRing(rx, ry, tol) {
  const step = arcStep(Math.max(rx, ry), tol);
  const n = clamp(Math.ceil(TAU / step), 8, MAX_SEGMENTS);
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ring.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return ring;
}

function rectRing(width, height, rx, ry, tol) {
  const hw = width / 2;
  const hh = height / 2;
  rx = clamp(rx, 0, hw);
  ry = clamp(ry, 0, hh);
  if (rx === 0 || ry === 0) {
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  }
  const n = clamp(Math.ceil(Math.PI / 2 / arcStep(Math.max(rx, ry), tol)), 1, MAX_SEGMENTS);
  const corners = [
    [hw - rx, -hh + ry, -Math.PI / 2],
    [hw - rx, hh - ry, 0],
    [-hw + rx, hh - ry, Math.PI / 2],
    [-hw + rx, -hh + ry, Math.PI],
  ];
  const ring = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      ring.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
  }
  return ring;
}

function flattenCubic(emit, x0, y0, x1, y1, x2, y2, x3, y3, tol) {
  const m = Math.max(
    Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2),
    Math.hypot(x1 - 2 * x2 + x3, y1 - 2 * y2 + y3),
  );
  const n = clamp(Math.ceil(Math.sqrt((0.75 * m) / tol)), 1, MAX_SEGMENTS);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    emit(
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    );
  }
}

function flattenQuad(emit, x0, y0, x1, y1, x2, y2, tol) {
  const m = Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2);
  const n = clamp(Math.ceil(Math.sqrt(m / (4 * tol))), 1, MAX_SEGMENTS);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    emit(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}

// SVG elliptical arc (endpoint form) flattened to points ending at x2,y2.
function flattenArc(emit, x1, y1, rx, ry, rot, fa, fs, x2, y2, tol) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) {
    emit(x2, y2);
    return;
  }
  const phi = (rot * Math.PI) / 180;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }
  const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (!!fa === !!fs ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const th1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const th2 = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
  let dth = th2 - th1;
  if (!fs && dth > 0) dth -= TAU;
  if (fs && dth < 0) dth += TAU;
  const n = clamp(Math.ceil(Math.abs(dth) / arcStep(Math.max(rx, ry), tol)), 1, MAX_SEGMENTS);
  for (let i = 1; i < n; i++) {
    const t = th1 + (dth * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    emit(cx + ex * cp - ey * sp, cy + ex * sp + ey * cp);
  }
  emit(x2, y2);
}

// Walk Fabric-style path commands and return flattened rings in local coordinates.
function pathRings(path, ox, oy, tol) {
  const rings = [];
  let ring = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl = null;
  const emit = (x, y) => ring.push([x - ox, y - oy]);
  const finish = () => {
    if (ring && ring.length >= 3) rings.push(ring);
    ring = null;
  };
  const ensure = () => {
    if (!ring) {
      ring = [];
      emit(cx, cy);
      sx = cx;
      sy = cy;
    }
  };

  for (const seg of path) {
    if (!Array.isArray(seg) || typeof seg[0] !== 'string') throw new Error('Bad path command.');
    const op = seg[0];
    const up = op.toUpperCase();
    const rel = op !== up;
    const n = ARITY[up];
    if (n === undefined) throw new Error(`Unknown path command: ${op}`);
    if (up === 'Z') {
      finish();
      cx = sx;
      cy = sy;
      lastCtrl = null;
      continue;
    }
    for (let k = 1, g = 0; k + n <= seg.length; k += n, g++) {
      const a = (j) => Number(seg[k + j]);
      const bx = rel ? cx : 0;
      const by = rel ? cy : 0;
      const prev = lastCtrl;
      lastCtrl = null;
      if (up === 'M') {
        const x = a(0) + bx;
        const y = a(1) + by;
        if (g === 0) {
          finish();
          ring = [];
          emit(x, y);
          sx = x;
          sy = y;
        } else {
          ensure();
          emit(x, y);
        }
        cx = x;
        cy = y;
      } else if (up === 'L' || up === 'H' || up === 'V') {
        const x = up === 'V' ? cx : a(0) + bx;
        const y = up === 'H' ? cy : up === 'V' ? a(0) + by : a(1) + by;
        ensure();
        emit(x, y);
        cx = x;
        cy = y;
      } else if (up === 'C' || up === 'S') {
        let x1;
        let y1;
        let o = 0;
        if (up === 'C') {
          x1 = a(0) + bx;
          y1 = a(1) + by;
          o = 2;
        } else if (prev && prev.t === 'c') {
          x1 = 2 * cx - prev.x;
          y1 = 2 * cy - prev.y;
        } else {
          x1 = cx;
          y1 = cy;
        }
        const x2 = a(o) + bx;
        const y2 = a(o + 1) + by;
        const x = a(o + 2) + bx;
        const y = a(o + 3) + by;
        ensure();
        flattenCubic(emit, cx, cy, x1, y1, x2, y2, x, y, tol);
        lastCtrl = { x: x2, y: y2, t: 'c' };
        cx = x;
        cy = y;
      } else if (up === 'Q' || up === 'T') {
        let x1;
        let y1;
        let o = 0;
        if (up === 'Q') {
          x1 = a(0) + bx;
          y1 = a(1) + by;
          o = 2;
        } else if (prev && prev.t === 'q') {
          x1 = 2 * cx - prev.x;
          y1 = 2 * cy - prev.y;
        } else {
          x1 = cx;
          y1 = cy;
        }
        const x = a(o) + bx;
        const y = a(o + 1) + by;
        ensure();
        flattenQuad(emit, cx, cy, x1, y1, x, y, tol);
        lastCtrl = { x: x1, y: y1, t: 'q' };
        cx = x;
        cy = y;
      } else if (up === 'A') {
        const x = a(5) + bx;
        const y = a(6) + by;
        ensure();
        flattenArc(emit, cx, cy, a(0), a(1), a(2), a(3), a(4), x, y, tol);
        cx = x;
        cy = y;
      }
    }
  }
  finish();
  return rings;
}

// Transform, drop repeated points and close the ring. Returns null if it collapses.
function finishRing(ring, m) {
  const out = [];
  for (const [x, y] of ring) {
    const px = m[0] * x + m[2] * y + m[4];
    const py = m[1] * x + m[3] * y + m[5];
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - px) < 1e-9 && Math.abs(last[1] - py) < 1e-9) continue;
    out.push([px, py]);
  }
  while (
    out.length > 1 &&
    Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 &&
    Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9
  ) {
    out.pop();
  }
  if (out.length < 3) return null;
  out.push([out[0][0], out[0][1]]);
  return out;
}

/**
 * Convert one shape to page-space polygons (a polygon-clipping MultiPolygon).
 * geom types: rect, ellipse, circle, triangle, polygon, polyline, path.
 * Local coordinates are centred on the object. matrix is [a, b, c, d, e, f].
 * Curves are flattened to within `tolerance` page units (capped at 256 segments).
 * @param {object} geom
 * @param {number[]} matrix
 * @param {number} [tolerance]
 * @returns {Array}
 */
export function objectPolygons(geom, matrix, tolerance = 0.5) {
  if (!geom || typeof geom !== 'object') throw new Error('Missing shape description.');
  const m = matrix || [1, 0, 0, 1, 0, 0];
  if (m.length < 6 || m.slice(0, 6).some((v) => !Number.isFinite(v))) {
    throw new Error('The transform matrix needs six numbers.');
  }
  const tolPage = tolerance > 0 ? tolerance : 0.5;
  // Half the tolerance leaves margin, so filled areas stay close to the true shape.
  const tol = (tolPage * 0.5) / Math.max(matrixScale(m), 1e-9);
  const off = geom.pathOffset || { x: 0, y: 0 };
  const ox = num(off.x, 0);
  const oy = num(off.y, 0);

  let rings;
  switch (geom.type) {
    case 'rect':
      rings = [rectRing(num(geom.width, 0), num(geom.height, 0), num(geom.rx, 0), num(geom.ry, 0), tol)];
      break;
    case 'ellipse':
      rings = [ellipseRing(Math.abs(num(geom.rx, 0)), Math.abs(num(geom.ry, 0)), tol)];
      break;
    case 'circle': {
      const r = Math.abs(num(geom.radius, 0));
      rings = [ellipseRing(r, r, tol)];
      break;
    }
    case 'triangle': {
      const hw = num(geom.width, 0) / 2;
      const hh = num(geom.height, 0) / 2;
      rings = [[[-hw, hh], [0, -hh], [hw, hh]]];
      break;
    }
    case 'polygon':
    case 'polyline':
      if (!Array.isArray(geom.points)) throw new Error('A polygon needs a points list.');
      rings = [geom.points.map((p) => [p.x - ox, p.y - oy])];
      break;
    case 'path':
      if (!Array.isArray(geom.path)) throw new Error('A path needs a command list.');
      rings = pathRings(geom.path, ox, oy, tol);
      break;
    default:
      throw new Error(`Unknown shape type: ${geom.type}`);
  }

  const done = rings.map((r) => finishRing(r, m)).filter(Boolean);
  if (done.length === 0) return [];
  if (done.length === 1) return [[done[0]]];
  return polygonClipping.xor(...done.map((r) => [[r]]));
}

// ----------------------------------------------------------- booleanShapes

/**
 * Combine MultiPolygons. unite = union, subtract = first minus the rest,
 * intersect = common area, exclude = xor.
 * @param {'unite'|'subtract'|'intersect'|'exclude'} op
 * @param {Array[]} list
 * @returns {Array}
 */
export function booleanShapes(op, list) {
  if (!Array.isArray(list) || list.length === 0) throw new Error('No shapes to combine.');
  const [first, ...rest] = list;
  switch (op) {
    case 'unite':
      return polygonClipping.union(first, ...rest);
    case 'subtract':
      return polygonClipping.difference(first, ...rest);
    case 'intersect':
      return polygonClipping.intersection(first, ...rest);
    case 'exclude':
      return polygonClipping.xor(first, ...rest);
    default:
      throw new Error(`Unknown operation: ${op}`);
  }
}

// ---------------------------------------------------------- polygonsToPath

/**
 * Turn a MultiPolygon into M/L/Z path data plus its bounding box.
 * @param {Array} multiPolygon
 * @param {number} [decimals]
 * @returns {{d: string, left: number, top: number, width: number, height: number}}
 */
export function polygonsToPath(multiPolygon, decimals = 2) {
  const f = (v) => Number(v.toFixed(decimals));
  const parts = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of multiPolygon || []) {
    for (const ring of poly) {
      const pts = ring.map(([x, y]) => [f(x), f(y)]);
      if (pts.length > 1) {
        const a = pts[0];
        const z = pts[pts.length - 1];
        if (a[0] === z[0] && a[1] === z[1]) pts.pop();
      }
      if (pts.length < 3) continue;
      parts.push(`M${pts.map((p) => `${p[0]} ${p[1]}`).join('L')}Z`);
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (parts.length === 0) return { d: '', left: 0, top: 0, width: 0, height: 0 };
  return { d: parts.join(''), left: minX, top: minY, width: f(maxX - minX), height: f(maxY - minY) };
}
