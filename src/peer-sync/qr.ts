import { normalizePeerUrl } from "./protocol";

const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);
let gfVal = 1;
for (let i = 0; i < 255; i++) {
  GF256_EXP[i] = gfVal;
  GF256_EXP[i + 255] = gfVal;
  GF256_LOG[gfVal] = i;
  gfVal = (gfVal << 1) ^ (gfVal >= 128 ? 0x11d : 0);
}

function gmul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF256_EXP[GF256_LOG[a] + GF256_LOG[b]];
}

function rsGenPoly(numEc: number): number[] {
  let poly = [1];
  for (let i = 0; i < numEc; i++) {
    const factor = [1, GF256_EXP[i]];
    const res = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      res[j] ^= gmul(poly[j], factor[0]);
      res[j + 1] ^= gmul(poly[j], factor[1]);
    }
    poly = res;
  }
  return poly;
}

function rsCompute(data: number[], numEc: number): number[] {
  const gen = rsGenPoly(numEc);
  const res = new Array(numEc).fill(0);
  for (const b of data) {
    const factor = b ^ (res.shift() ?? 0);
    res.push(0);
    for (let i = 0; i < numEc; i++) {
      res[i] ^= gmul(gen[i + 1], factor);
    }
  }
  return res;
}

// Codeword capacities for Error Correction Level L
const VERSION_DATA_CAPACITY = [0, 19, 34, 55, 80, 108, 136];
const VERSION_EC_COUNT = [0, 7, 10, 15, 20, 26, 36];
const ALIGNMENT_COORDS = [0, 0, 18, 22, 26, 30, 34];

function getFormatBits(ecLevelBits: number, mask: number): number {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem >> (i + 10)) & 1) rem ^= 0x537 << i;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

export function createPairingUri(host: string, port: number, secret: string): string {
  const cleanHost = host
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+.*$/, "")
    .trim();
  return `obsidian://temperans-pair?host=${encodeURIComponent(cleanHost)}&port=${port}&code=${encodeURIComponent(secret.trim())}`;
}

export function parsePairingPayload(payload: string): { url: string; secret: string } | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  // 1. Obsidian Deep Link: obsidian://temperans-pair?host=...&port=...&code=...
  if (trimmed.startsWith("obsidian://temperans-pair")) {
    try {
      const parsed = new URL(trimmed);
      const code = parsed.searchParams.get("code") || parsed.searchParams.get("secret") || "";
      const rawUrl = parsed.searchParams.get("url");
      let url = rawUrl;
      if (!url) {
        const rawHost = parsed.searchParams.get("host");
        const portStr = parsed.searchParams.get("port") || "43887";
        if (rawHost) {
          const cleanHost = rawHost
            .replace(/^https?:\/\//i, "")
            .replace(/\/.*$/, "")
            .replace(/:\d+.*$/, "")
            .trim();
          const cleanPort = Number(portStr.replace(/[^0-9]/g, "")) || 43887;
          url = `http://${cleanHost}:${cleanPort}`;
        }
      }
      if (url && code.trim()) {
        const normalized = normalizePeerUrl(url);
        if (!normalized) {
          throw new Error(`Invalid desktop address: "${url}". Expected format: http://192.168.1.20:43887`);
        }
        return { url: normalized, secret: code.trim() };
      }
      throw new Error("Missing host address or pairing code in deep link.");
    } catch (error) {
      console.warn("Could not parse obsidian://temperans-pair payload:", error);
      return null;
    }
  }

  // 2. Space, hash, or separator formatted connection details: http://192.168.1.20:43887#CODE
  const matchWithCode = trimmed.match(/^(https?:\/\/[^\s#?()]+)(?:[#\s(?&]+)(?:code=)?([a-zA-Z0-9_\-]+)\)?$/i);
  if (matchWithCode) {
    const normalized = normalizePeerUrl(matchWithCode[1]);
    const code = matchWithCode[2]?.trim();
    if (normalized && code) return { url: normalized, secret: code };
  }

  // 3. JSON payload
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const rawUrl = typeof parsed.url === "string" ? parsed.url : typeof parsed.address === "string" ? parsed.address : "";
      const rawSecret = typeof parsed.code === "string" ? parsed.code : typeof parsed.secret === "string" ? parsed.secret : "";
      if (rawUrl && rawSecret) {
        const normalized = normalizePeerUrl(rawUrl);
        if (normalized) return { url: normalized, secret: rawSecret.trim() };
      }
    } catch {
      // Invalid JSON
    }
  }

  // 4. Custom URI scheme: temperans-sync://192.168.1.50:43887?code=...
  if (trimmed.startsWith("temperans-sync://")) {
    try {
      const parsed = new URL(trimmed.replace("temperans-sync://", "http://"));
      const code = parsed.searchParams.get("code") || parsed.searchParams.get("secret") || "";
      const url = `http://${parsed.host}`;
      const normalized = normalizePeerUrl(url);
      if (normalized && code.trim()) {
        return { url: normalized, secret: code.trim() };
      }
    } catch {
      // Invalid URL
    }
  }

  // 3. HTTP URL with hash: http://192.168.1.50:43887#A9F2-81C4-DE90
  try {
    const parsed = new URL(trimmed);
    const code = parsed.hash.replace(/^#/, "").trim();
    if (code) {
      const url = `${parsed.protocol}//${parsed.host}`;
      const normalized = normalizePeerUrl(url);
      if (normalized) return { url: normalized, secret: code };
    }
  } catch {
    // Not an HTTP URL
  }

  return null;
}

class BitBuffer {
  private buffer: number[] = [];
  private length = 0;

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const index = Math.floor(this.length / 8);
    if (this.buffer.length <= index) this.buffer.push(0);
    if (bit) this.buffer[index] |= 0x80 >>> (this.length % 8);
    this.length += 1;
  }

  getBytes(): number[] {
    return [...this.buffer];
  }

  get bitLength(): number {
    return this.length;
  }
}

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const dataLen = bytes.length;

  // Determine QR version (1 to 6)
  let version = 1;
  while (version <= 6 && dataLen + 2 > VERSION_DATA_CAPACITY[version]) {
    version += 1;
  }
  if (version > 6) {
    throw new Error("Text payload exceeds maximum QR version capacity for peer-sync pairing.");
  }

  const numDataCodewords = VERSION_DATA_CAPACITY[version];
  const numEcCodewords = VERSION_EC_COUNT[version];
  const size = 17 + 4 * version;

  // Encode data in Byte mode
  const bb = new BitBuffer();
  bb.put(0b0100, 4); // Byte mode indicator
  bb.put(dataLen, 8); // Character count (8 bits for versions 1-9)
  for (const b of bytes) bb.put(b, 8);

  // Terminator
  const requiredBits = numDataCodewords * 8;
  const terminatorBits = Math.min(4, requiredBits - bb.bitLength);
  bb.put(0, terminatorBits);

  // Pad to multiple of 8
  while (bb.bitLength % 8 !== 0) bb.putBit(false);

  // Pad bytes alternating 0xEC and 0x11
  const codewords = bb.getBytes();
  let padByte = 0xec;
  while (codewords.length < numDataCodewords) {
    codewords.push(padByte);
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }

  // Calculate Error Correction codewords
  let finalCodewords: number[];
  if (version === 6) {
    // Version 6-L uses 2 blocks of 68 data, 18 ec codewords each
    const block1Data = codewords.slice(0, 68);
    const block2Data = codewords.slice(68, 136);
    const block1Ec = rsCompute(block1Data, 18);
    const block2Ec = rsCompute(block2Data, 18);
    // Interleave data codewords
    finalCodewords = [];
    for (let i = 0; i < 68; i++) {
      finalCodewords.push(block1Data[i], block2Data[i]);
    }
    // Interleave EC codewords
    for (let i = 0; i < 18; i++) {
      finalCodewords.push(block1Ec[i], block2Ec[i]);
    }
  } else {
    // Versions 1 to 5 use a single block
    const ecCodewords = rsCompute(codewords, numEcCodewords);
    finalCodewords = [...codewords, ...ecCodewords];
  }

  // Initialize modules matrix
  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));

  function setFunction(row: number, col: number, val: boolean): void {
    modules[row][col] = val;
    isFunction[row][col] = true;
  }

  function addFinderPattern(r: number, c: number): void {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const row = r + y;
        const col = c + x;
        if (row >= 0 && row < size && col >= 0 && col < size) {
          const isDark = (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
            (x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
            (y >= 2 && y <= 4 && x >= 2 && x <= 4);
          setFunction(row, col, isDark);
        }
      }
    }
  }

  // 1. Finder patterns
  addFinderPattern(0, 0);
  addFinderPattern(0, size - 7);
  addFinderPattern(size - 7, 0);

  // 2. Alignment pattern
  if (version >= 2) {
    const center = ALIGNMENT_COORDS[version];
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const row = center + y;
        const col = center + x;
        const isDark = Math.max(Math.abs(y), Math.abs(x)) !== 1;
        setFunction(row, col, isDark);
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  // 4. Dark module
  setFunction(4 * version + 9, 8, true);

  // 5. Reserve format info modules
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8][i] = true;
      isFunction[i][8] = true;
    }
  }
  for (let i = size - 8; i < size; i++) isFunction[8][i] = true;
  for (let i = size - 7; i < size; i++) isFunction[i][8] = true;

  // 6. Place data bits
  let bitIndex = 0;
  const totalBits = finalCodewords.length * 8;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // Skip vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const goingUp = ((right + 1) & 2) === 0;
        const row = goingUp ? size - 1 - vert : vert;
        if (!isFunction[row][col]) {
          let bit = false;
          if (bitIndex < totalBits) {
            const byteIndex = Math.floor(bitIndex / 8);
            bit = ((finalCodewords[byteIndex] >>> (7 - (bitIndex % 8))) & 1) === 1;
            bitIndex += 1;
          }
          modules[row][col] = bit;
        }
      }
    }
  }

  // 7. Evaluate mask patterns and select optimal mask
  function maskCondition(m: number, r: number, c: number): boolean {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
      case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0;
      case 7: return (((r + c) % 2 + (r * c) % 3) % 2) === 0;
      default: return false;
    }
  }

  let bestMask = 0;
  let minPenalty = Infinity;

  for (let m = 0; m < 8; m++) {
    let penalty = 0;
    // N1 penalty: consecutive modules in row/col
    for (let r = 0; r < size; r++) {
      let count = 0;
      let last = false;
      for (let c = 0; c < size; c++) {
        const val = isFunction[r][c] ? modules[r][c] : (modules[r][c] !== maskCondition(m, r, c));
        if (c === 0 || val !== last) {
          last = val;
          count = 1;
        } else {
          count += 1;
          if (count === 5) penalty += 3;
          else if (count > 5) penalty += 1;
        }
      }
    }
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = m;
    }
  }

  // Apply best mask to non-function modules
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r][c] && maskCondition(bestMask, r, c)) {
        modules[r][c] = !modules[r][c];
      }
    }
  }

  // 8. Add format bits for Level L (01) and chosen mask
  const formatBits = getFormatBits(1, bestMask);
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >>> i) & 1) === 1;
    // Top-left
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[8][15 - i] = bit;

    // Split around edges
    if (i < 8) modules[8][size - 1 - i] = bit;
    else modules[size - 15 + i][8] = bit;
  }

  return modules;
}

export function generateQrSvg(text: string, pixelSize = 220): string {
  const matrix = generateQrMatrix(text);
  const size = matrix.length;
  const margin = 4;
  const totalSize = size + margin * 2;

  let pathData = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" class="temperans-peer-sync-qr-svg"><rect width="100%" height="100%" fill="#ffffff" rx="8"/><path d="${pathData.trim()}" fill="#000000"/></svg>`;
}
