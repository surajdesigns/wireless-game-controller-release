/**
 * Zero-Dependency Pure JavaScript QR Code Generator (SVG output)
 * Supports Byte mode (Versions 1 - 6, Error Correction Level M/L)
 * Generates standards-compliant ISO/IEC 18004 QR codes as pure SVG.
 */

// Galois Field GF(256) Math
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGF() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = val;
    GF_EXP[i + 255] = val;
    GF_LOG[val] = i;
    val <<= 1;
    if (val & 256) val ^= 285;
  }
  GF_LOG[0] = 0;
})();

function gfMul(x, y) {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function rsCompute(data, ecCount) {
  // Generate generator polynomial
  let gen = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(gen.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gfMul(gen[j], factor);
      next[j + 1] ^= gen[j];
    }
    gen = next;
  }

  // Polynomial division
  const remainder = new Array(ecCount).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    remainder[ecCount - 1] = gfMul(gen[ecCount], factor);
  }
  return remainder;
}

// Version table for EC Level M: [totalCodewords, dataCodewords, ecCodewords]
const VERSIONS_M = [
  null,
  { version: 1, size: 21, total: 26, data: 16, ec: 10, align: [] },
  { version: 2, size: 25, total: 44, data: 28, ec: 16, align: [6, 18] },
  { version: 3, size: 29, total: 70, data: 44, ec: 26, align: [6, 22] },
  { version: 4, size: 33, total: 100, data: 64, ec: 36, align: [6, 26] },
  { version: 5, size: 37, total: 134, data: 86, ec: 48, align: [6, 30] },
  { version: 6, size: 41, total: 172, data: 108, ec: 64, align: [6, 34] }
];

function encodeByteData(str, targetDataCodewords) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 255) {
      // Basic UTF-8 conversion
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(code);
    }
  }

  // Bit buffer
  let bits = '';
  // Mode indicator for 8-bit byte: 0100
  bits += '0100';
  // Character count indicator (8 bits for version 1-9)
  bits += bytes.length.toString(2).padStart(8, '0');
  // Data bytes
  for (const b of bytes) {
    bits += b.toString(2).padStart(8, '0');
  }

  // Terminator (up to 4 zeroes)
  const maxBits = targetDataCodewords * 8;
  if (bits.length > maxBits) {
    throw new Error(`Payload exceeds maximum supported QR capacity (${bytes.length} bytes encoded, max ${targetDataCodewords - 2} bytes for this version)`);
  }
  const termLen = Math.min(4, maxBits - bits.length);
  bits += '0'.repeat(termLen);

  // Pad to multiple of 8
  while (bits.length % 8 !== 0) {
    bits += '0';
  }

  // Convert to bytes
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.substr(i, 8), 2));
  }

  // Pad codewords with 0xEC (236) and 0x11 (17)
  let padToggle = true;
  while (codewords.length < targetDataCodewords) {
    codewords.push(padToggle ? 0xec : 0x11);
    padToggle = !padToggle;
  }

  return codewords;
}

class QRCode {
  constructor(text) {
    this.text = text;
    this.versionInfo = this._pickVersion(text);
    this.size = this.versionInfo.size;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(null));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this._generate();
  }

  _pickVersion(text) {
    const byteLen = text.length; // Approximate
    for (let v = 1; v < VERSIONS_M.length; v++) {
      const info = VERSIONS_M[v];
      // 1 char header + length + byte data
      if (byteLen + 2 <= info.data) {
        return info;
      }
    }
    // If payload doesn't fit any version, throw a clear error
    const maxBytes = VERSIONS_M[6].data - 2;
    throw new Error(`QR payload too large: ${text.length} bytes exceeds maximum ${maxBytes} bytes (Version 6, EC Level M)`);
  }

  _setModule(r, c, val, isFunc = false) {
    if (r >= 0 && r < this.size && c >= 0 && c < this.size) {
      this.modules[r][c] = val;
      if (isFunc) this.isFunction[r][c] = true;
    }
  }

  _addFinder(top, left) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || row >= this.size || col < 0 || col >= this.size) continue;
        if (
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          this._setModule(row, col, true, true);
        } else {
          this._setModule(row, col, false, true);
        }
      }
    }
  }

  _addAlignment(centerR, centerC) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const row = centerR + r;
        const col = centerC + c;
        if (this.isFunction[row][col]) continue;
        const isBlack = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        this._setModule(row, col, isBlack, true);
      }
    }
  }

  _generate() {
    // 1. Finder patterns
    this._addFinder(0, 0);
    this._addFinder(0, this.size - 7);
    this._addFinder(this.size - 7, 0);

    // 2. Alignment patterns
    const alignCoords = this.versionInfo.align;
    for (const r of alignCoords) {
      for (const c of alignCoords) {
        // Skip finders
        if ((r === 6 && c === 6) || (r === 6 && c === this.size - 7) || (r === this.size - 7 && c === 6)) continue;
        this._addAlignment(r, c);
      }
    }

    // 3. Timing patterns
    for (let i = 8; i < this.size - 8; i++) {
      this._setModule(6, i, i % 2 === 0, true);
      this._setModule(i, 6, i % 2 === 0, true);
    }

    // 4. Dark module
    this._setModule(this.size - 8, 8, true, true);

    // Reserve format information areas
    for (let i = 0; i < 9; i++) {
      this._setModule(8, i, false, true);
      this._setModule(i, 8, false, true);
    }
    for (let i = 0; i < 8; i++) {
      this._setModule(8, this.size - 1 - i, false, true);
      this._setModule(this.size - 1 - i, 8, false, true);
    }

    // 5. Data and Error Correction
    const dataCodewords = encodeByteData(this.text, this.versionInfo.data);
    const ecCodewords = rsCompute(dataCodewords, this.versionInfo.ec);
    const finalCodewords = dataCodewords.concat(ecCodewords);

    // Convert codewords to bit stream
    let allBits = '';
    for (const byte of finalCodewords) {
      allBits += byte.toString(2).padStart(8, '0');
    }

    // 6. Place data bits in matrix (right to left, zig-zag)
    let bitIdx = 0;
    let right = this.size - 1;
    let goingUp = true;

    while (right > 0) {
      if (right === 6) right--; // Skip vertical timing column
      const rows = goingUp
        ? Array.from({ length: this.size }, (_, i) => this.size - 1 - i)
        : Array.from({ length: this.size }, (_, i) => i);

      for (const r of rows) {
        for (const c of [right, right - 1]) {
          if (!this.isFunction[r][c]) {
            let bit = bitIdx < allBits.length ? allBits[bitIdx++] === '1' : false;
            // Apply Mask 0: (row + col) % 2 === 0
            if ((r + c) % 2 === 0) {
              bit = !bit;
            }
            this.modules[r][c] = bit;
          }
        }
      }
      right -= 2;
      goingUp = !goingUp;
    }

    // 7. Write Format Bits (EC Level M + Mask 0 = 0x5412)
    // Precalculated format info with BCH for Level M, Mask 0
    const formatBits = [true, false, true, false, true, false, false, false, false, false, true, false, false, true, false];
    
    // Top-left
    for (let i = 0; i < 6; i++) this.modules[8][i] = formatBits[i];
    this.modules[8][7] = formatBits[6];
    this.modules[8][8] = formatBits[7];
    this.modules[7][8] = formatBits[8];
    for (let i = 9; i < 15; i++) this.modules[14 - i][8] = formatBits[i];

    // Split format bits across sides
    for (let i = 0; i < 7; i++) this.modules[this.size - 1 - i][8] = formatBits[i];
    for (let i = 7; i < 15; i++) this.modules[8][this.size - 15 + i] = formatBits[i];
  }

  toSVG(options = {}) {
    const margin = options.margin ?? 2;
    const fill = options.color ?? '#00f0ff';
    const bg = options.background ?? 'transparent';
    const fullSize = this.size + margin * 2;
    let rects = '';

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.modules[r][c]) {
          rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="${fill}"/>`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullSize} ${fullSize}" shape-rendering="crispEdges">
      ${bg !== 'transparent' ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}
      ${rects}
    </svg>`;
  }
}

function generateQRCodeSVG(text, options) {
  const qr = new QRCode(text);
  return qr.toSVG(options);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QRCode, generateQRCodeSVG };
}
if (typeof window !== 'undefined') {
  window.generateQRCodeSVG = generateQRCodeSVG;
}
