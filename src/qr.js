// QR encoder from the Cygnus Tools Post maker: byte mode, versions 1 to 40.

var QR = (function () {
  var ECC_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };
  var BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };
  var FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* How many 8 bit codewords a version holds once the fixed patterns are out. */
  function rawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var aligns = Math.floor(version / 7) + 2;
      result -= (25 * aligns - 10) * aligns - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }
  function totalCodewords(version) {
    return Math.floor(rawDataModules(version) / 8);
  }
  function dataCodewords(version, ec) {
    return totalCodewords(version) - ECC_PER_BLOCK[ec][version] * BLOCKS[ec][version];
  }
  function alignPositions(version) {
    if (version === 1) return [];
    var count = Math.floor(version / 7) + 2;
    var step = (version === 32) ? 26
      : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    var out = [6];
    for (var pos = version * 4 + 10; out.length < count; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  /* Galois field arithmetic over 0x11D, the field the spec uses. */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }
  function generator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function remainder(data, degree) {
    var gen = generator(degree);
    var out = new Array(degree).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ out[0];
      out.shift();
      out.push(0);
      for (var j = 0; j < degree; j++) out[j] ^= mul(gen[j + 1], factor);
    }
    return out;
  }

  function utf8(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
        var pair = 0x10000 + ((code - 0xD800) << 10) + (text.charCodeAt(++i) - 0xDC00);
        out.push(0xF0 | (pair >> 18), 0x80 | ((pair >> 12) & 0x3F), 0x80 | ((pair >> 6) & 0x3F), 0x80 | (pair & 0x3F));
      } else {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    return out;
  }

  function encode(text, ec) {
    var bytes = utf8(text);
    var version = 0;
    for (var v = 1; v <= 40; v++) {
      var countBits = v < 10 ? 8 : 16;
      if (4 + countBits + bytes.length * 8 <= dataCodewords(v, ec) * 8) {
        version = v;
        break;
      }
    }
    if (!version) {
      var mostBytes = Math.floor((dataCodewords(40, ec) * 8 - 20) / 8);
      throw new Error('That link is ' + bytes.length + ' characters. At this setting a QR code holds '
        + mostBytes + ', so shorten the link or drop the error correction.');
    }

    var bits = [];
    function push(value, length) {
      for (var i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }
    push(4, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    for (var b = 0; b < bytes.length; b++) push(bytes[b], 8);

    var capacity = dataCodewords(version, ec) * 8;
    push(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    var pad = [0xEC, 0x11];
    for (var p = 0; bits.length < capacity; p++) push(pad[p % 2], 8);

    var words = [];
    for (var w = 0; w < bits.length; w += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[w + k];
      words.push(byte);
    }

    /* Split into blocks, work out the check bytes, then interleave the lot. */
    var blockCount = BLOCKS[ec][version];
    var eccLength = ECC_PER_BLOCK[ec][version];
    var shortLength = Math.floor(dataCodewords(version, ec) / blockCount);
    var longCount = dataCodewords(version, ec) % blockCount;
    var blocks = [];
    var at = 0;
    for (var i2 = 0; i2 < blockCount; i2++) {
      var length = shortLength + (i2 >= blockCount - longCount ? 1 : 0);
      var chunk = words.slice(at, at + length);
      at += length;
      blocks.push({ data: chunk, ecc: remainder(chunk, eccLength) });
    }
    var out = [];
    for (var c = 0; c < shortLength + 1; c++) {
      for (var bl = 0; bl < blocks.length; bl++) {
        if (c < blocks[bl].data.length) out.push(blocks[bl].data[c]);
      }
    }
    for (var e = 0; e < eccLength; e++) {
      for (var bl2 = 0; bl2 < blocks.length; bl2++) out.push(blocks[bl2].ecc[e]);
    }
    return { version: version, codewords: out, ec: ec };
  }

  function build(text, ec) {
    var encoded = encode(text, ec);
    var version = encoded.version;
    var size = version * 4 + 17;
    var modules = [];
    var reserved = [];
    for (var i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      reserved.push(new Array(size).fill(false));
    }
    function set(x, y, dark) {
      modules[y][x] = dark;
      reserved[y][x] = true;
    }

    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var x = cx + dx;
          var y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          var far = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, far !== 2 && far !== 4);
        }
      }
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    for (var t = 8; t < size - 8; t++) {
      set(t, 6, t % 2 === 0);
      set(6, t, t % 2 === 0);
    }

    var aligns = alignPositions(version);
    for (var a = 0; a < aligns.length; a++) {
      for (var b2 = 0; b2 < aligns.length; b2++) {
        var skipCorner = (a === 0 && b2 === 0) || (a === 0 && b2 === aligns.length - 1) || (a === aligns.length - 1 && b2 === 0);
        if (skipCorner) continue;
        for (var ay = -2; ay <= 2; ay++) {
          for (var ax = -2; ax <= 2; ax++) {
            set(aligns[b2] + ax, aligns[a] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
          }
        }
      }
    }

    set(8, size - 8, true);

    /* Hold the format and version areas back so data never lands on them. */
    for (var f = 0; f < 9; f++) {
      if (!reserved[f][8]) set(8, f, false);
      if (!reserved[8][f]) set(f, 8, false);
    }
    for (var f2 = 0; f2 < 8; f2++) {
      if (!reserved[8][size - 1 - f2]) set(size - 1 - f2, 8, false);
      if (!reserved[size - 1 - f2][8]) set(8, size - 1 - f2, false);
    }
    if (version >= 7) {
      var rem = version;
      for (var r = 0; r < 12; r++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
      var versionBits = (version << 12) | rem;
      for (var vb = 0; vb < 18; vb++) {
        var bit = ((versionBits >> vb) & 1) === 1;
        var vx = Math.floor(vb / 3);
        var vy = size - 11 + (vb % 3);
        set(vx, vy, bit);
        set(vy, vx, bit);
      }
    }

    /* Walk the data up and down the two module wide columns. */
    var bitIndex = 0;
    var data = encoded.codewords;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var side = 0; side < 2; side++) {
          var x2 = right - side;
          var upward = ((right + 1) & 2) === 0;
          var y2 = upward ? size - 1 - vert : vert;
          if (reserved[y2][x2]) continue;
          var dark = false;
          if (bitIndex < data.length * 8) {
            dark = ((data[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1) === 1;
          }
          modules[y2][x2] = dark;
          bitIndex++;
        }
      }
    }

    function maskAt(mask, x, y) {
      switch (mask) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return (x * y) % 2 + (x * y) % 3 === 0;
        case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
        default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      }
    }

    function putFormat(mask) {
      var value = (FORMAT_BITS[ec] << 3) | mask;
      var rem2 = value;
      for (var i3 = 0; i3 < 10; i3++) rem2 = (rem2 << 1) ^ ((rem2 >> 9) * 0x537);
      var bitsOut = ((value << 10) | rem2) ^ 0x5412;
      for (var i4 = 0; i4 <= 5; i4++) modules[i4][8] = ((bitsOut >> i4) & 1) === 1;
      modules[7][8] = ((bitsOut >> 6) & 1) === 1;
      modules[8][8] = ((bitsOut >> 7) & 1) === 1;
      modules[8][7] = ((bitsOut >> 8) & 1) === 1;
      for (var i5 = 9; i5 < 15; i5++) modules[8][14 - i5] = ((bitsOut >> i5) & 1) === 1;
      for (var i6 = 0; i6 < 8; i6++) modules[8][size - 1 - i6] = ((bitsOut >> i6) & 1) === 1;
      for (var i7 = 8; i7 < 15; i7++) modules[size - 15 + i7][8] = ((bitsOut >> i7) & 1) === 1;
      modules[size - 8][8] = true;
    }

    function applyMask(mask) {
      for (var y3 = 0; y3 < size; y3++) {
        for (var x3 = 0; x3 < size; x3++) {
          if (!reserved[y3][x3] && maskAt(mask, x3, y3)) modules[y3][x3] = !modules[y3][x3];
        }
      }
    }

    function penalty() {
      var score = 0;
      var dark = 0;
      for (var y4 = 0; y4 < size; y4++) {
        for (var x4 = 0; x4 < size; x4++) if (modules[y4][x4]) dark++;
      }
      /* Runs of five or more, counted along rows and then down columns. */
      function runs(get) {
        for (var a2 = 0; a2 < size; a2++) {
          var run = 1;
          for (var b3 = 1; b3 < size; b3++) {
            if (get(a2, b3) === get(a2, b3 - 1)) {
              run++;
              if (run === 5) score += 3;
              else if (run > 5) score += 1;
            } else run = 1;
          }
        }
      }
      runs(function (r, c) { return modules[r][c]; });
      runs(function (c, r) { return modules[r][c]; });
      /* Two by two blocks of one colour. */
      for (var y5 = 0; y5 < size - 1; y5++) {
        for (var x5 = 0; x5 < size - 1; x5++) {
          var first = modules[y5][x5];
          if (first === modules[y5][x5 + 1] && first === modules[y5 + 1][x5] && first === modules[y5 + 1][x5 + 1]) score += 3;
        }
      }
      /* The finder-like run, which a scanner can mistake for a corner. */
      var pattern = [true, false, true, true, true, false, true];
      function finderLike(get) {
        for (var a3 = 0; a3 < size; a3++) {
          for (var b4 = 0; b4 <= size - 7; b4++) {
            var hit = true;
            for (var k2 = 0; k2 < 7; k2++) {
              if (get(a3, b4 + k2) !== pattern[k2]) { hit = false; break; }
            }
            if (!hit) continue;
            var before = true;
            for (var q = Math.max(0, b4 - 4); q < b4; q++) if (get(a3, q)) before = false;
            var after = true;
            for (var q2 = b4 + 7; q2 < Math.min(size, b4 + 11); q2++) if (get(a3, q2)) after = false;
            if (before || after) score += 40;
          }
        }
      }
      finderLike(function (r, c) { return modules[r][c]; });
      finderLike(function (c, r) { return modules[r][c]; });
      /* How far off an even split of dark and light the whole code is. */
      var total = size * size;
      var off = Math.floor(Math.abs(dark * 20 - total * 10) / total);
      score += off * 10;
      return score;
    }

    var best = -1;
    var bestScore = Infinity;
    var snapshot = modules.map(function (row) { return row.slice(); });
    for (var mask = 0; mask < 8; mask++) {
      modules = snapshot.map(function (row) { return row.slice(); });
      applyMask(mask);
      putFormat(mask);
      var s = penalty();
      if (s < bestScore) {
        bestScore = s;
        best = mask;
      }
    }
    modules = snapshot.map(function (row) { return row.slice(); });
    applyMask(best);
    putFormat(best);

    return { modules: modules, size: size, version: version, ec: ec, mask: best };
  }

  return { build: build };
})();

export default QR;
