'use strict';
// Full DEFLATE encoder matching browser: simple greedy LZ77 + dynamic Huffman
// Verify byte-exact against browser samples

const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CLC_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

function lenToCode(l) {
  for (let i = 0; i < LEN_BASE.length; i++) {
    if (l >= LEN_BASE[i] && (i === LEN_BASE.length - 1 || l < LEN_BASE[i + 1])) {
      return { code: 257 + i, extra: LEN_EXTRA[i], extraBits: l - LEN_BASE[i] };
    }
  }
  throw new Error('bad len ' + l);
}

function distToCode(d) {
  for (let i = 0; i < DIST_BASE.length; i++) {
    if (d >= DIST_BASE[i] && (i === DIST_BASE.length - 1 || d < DIST_BASE[i + 1])) {
      return { code: i, extra: DIST_EXTRA[i], extraBits: d - DIST_BASE[i] };
    }
  }
  throw new Error('bad dist ' + d);
}

function lz77Tokenize(input, maxMatchLen = 5, minMatchLen = 3, windowSize = 128) {
  const tokens = [];
  let pos = 0;
  while (pos < input.length) {
    let bestLen = 0, bestDist = 0;
    const searchStart = Math.max(0, pos - windowSize);
    for (let back = pos - 1; back >= searchStart; back--) {
      const dist = pos - back;
      let len = 0;
      const maxLen = Math.min(maxMatchLen, input.length - pos);
      while (len < maxLen && input[back + len] === input[pos + len]) len++;
      if (len >= minMatchLen && len > bestLen) {
        bestLen = len; bestDist = dist;
        if (len === maxMatchLen) break;
      }
    }
    if (bestLen >= minMatchLen) {
      tokens.push({ t: 'M', len: bestLen, dist: bestDist });
      pos += bestLen;
    } else {
      tokens.push({ t: 'L', v: input[pos] });
      pos++;
    }
  }
  tokens.push({ t: 'END' });
  return tokens;
}

// Standard Huffman with length limit — package-merge would be more accurate, but zlib uses a specific heap-based algorithm
function buildHuffmanLengths(freqs, maxBits = 15) {
  // Build heap of (freq, sym) leaves; construct Huffman tree
  const n = freqs.length;
  const nodes = [];
  for (let i = 0; i < n; i++) if (freqs[i] > 0) nodes.push({ freq: freqs[i], sym: i, left: null, right: null });
  if (nodes.length === 0) return new Array(n).fill(0);
  if (nodes.length === 1) {
    const lens = new Array(n).fill(0);
    lens[nodes[0].sym] = 1;
    return lens;
  }
  // Build tree
  const heap = nodes.slice();
  const cmp = (a, b) => a.freq - b.freq;
  heap.sort(cmp);
  while (heap.length > 1) {
    const a = heap.shift();
    const b = heap.shift();
    const parent = { freq: a.freq + b.freq, sym: -1, left: a, right: b };
    let idx = 0;
    while (idx < heap.length && heap[idx].freq <= parent.freq) idx++;
    heap.splice(idx, 0, parent);
  }
  const lens = new Array(n).fill(0);
  const depths = new Array(n).fill(0);
  function walk(node, depth) {
    if (node.sym >= 0) { lens[node.sym] = depth || 1; depths[node.sym] = depth || 1; return; }
    walk(node.left, depth + 1);
    walk(node.right, depth + 1);
  }
  walk(heap[0], 0);

  // Enforce max bits limit（pako/zlib gen_bitlen 溢出修正，2026-07-25 移植）
  let overflow = 0;
  for (let i = 0; i < n; i++) if (lens[i] > maxBits) overflow++;
  if (overflow === 0) return lens;

  const bl_count = new Array(maxBits + 1).fill(0);
  for (let i = 0; i < n; i++) {
    if (lens[i]) bl_count[Math.min(lens[i], maxBits)]++;
  }
  do {
    let bits = maxBits - 1;
    while (bl_count[bits] === 0) bits--;
    bl_count[bits]--;
    bl_count[bits + 1] += 2;
    bl_count[maxBits]--;
    overflow -= 2;
  } while (overflow > 0);

  // 按 pako 的 smaller() 顺序（freq 升序、depth 升序、sym 升序）把叶子排好；
  // pako 的 heap 尾删序使最长码从最低频叶子开始分配（heap[--h] 从最小端扫）。
  const leaves = nodes
    .map(node => ({ sym: node.sym, freq: node.freq, depth: depths[node.sym] }))
    .sort((a, b) => (a.freq - b.freq) || (a.depth - b.depth) || (a.sym - b.sym));
  const out = new Array(n).fill(0);
  let h = 0;
  for (let bits = maxBits; bits !== 0; bits--) {
    let cnt = bl_count[bits];
    while (cnt !== 0) {
      const leaf = leaves[h++];
      out[leaf.sym] = bits;
      cnt--;
    }
  }
  return out;
}

// Canonical Huffman codes from lengths
function buildCanonical(lens) {
  const maxLen = Math.max(...lens, 0);
  const bl_count = new Array(maxLen + 1).fill(0);
  for (const l of lens) if (l) bl_count[l]++;
  const next_code = new Array(maxLen + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxLen; bits++) {
    code = (code + bl_count[bits - 1]) << 1;
    next_code[bits] = code;
  }
  const codes = new Array(lens.length).fill(0);
  for (let n = 0; n < lens.length; n++) {
    if (lens[n]) {
      codes[n] = next_code[lens[n]];
      next_code[lens[n]]++;
    }
  }
  return codes;
}

class BitWriter {
  constructor() { this.chunks = []; this.buf = 0; this.nbits = 0; }
  writeBits(val, n) {
    this.buf |= (val << this.nbits) >>> 0;
    this.nbits += n;
    while (this.nbits >= 8) {
      this.chunks.push(this.buf & 0xff);
      this.buf >>>= 8;
      this.nbits -= 8;
    }
  }
  writeCode(code, len) {
    // DEFLATE Huffman codes emitted MSB-first
    let rev = 0;
    for (let i = 0; i < len; i++) {
      rev |= (((code >> (len - 1 - i)) & 1) << i);
    }
    this.writeBits(rev, len);
  }
  flush() {
    if (this.nbits > 0) {
      this.chunks.push(this.buf & 0xff);
      this.buf = 0; this.nbits = 0;
    }
    return Buffer.from(this.chunks);
  }
}

// Encode code-length sequence with RLE for the code-length alphabet
function rleCodeLens(lens) {
  const rle = [];
  let i = 0;
  while (i < lens.length) {
    const cur = lens[i];
    let run = 1;
    while (i + run < lens.length && lens[i + run] === cur) run++;
    if (cur === 0) {
      // Encode run of zeros
      while (run >= 11) {
        const r = Math.min(run, 138);
        rle.push({ sym: 18, extra: r - 11, extraBits: 7 });
        run -= r;
      }
      while (run >= 3) {
        const r = Math.min(run, 10);
        rle.push({ sym: 17, extra: r - 3, extraBits: 3 });
        run -= r;
      }
      while (run > 0) { rle.push({ sym: 0 }); run--; }
    } else {
      // Emit first, then use 16 (repeat prev) for subsequent
      rle.push({ sym: cur });
      run--;
      while (run >= 3) {
        const r = Math.min(run, 6);
        rle.push({ sym: 16, extra: r - 3, extraBits: 2 });
        run -= r;
      }
      while (run > 0) { rle.push({ sym: cur }); run--; }
    }
    i += (run === 0 ? (i + run + 1 === i ? 1 : 0) : 0);  // this loop advance
    // Actually: re-set i to start of next different value
    let jmp = 1;
    while (i + jmp < lens.length && lens[i + jmp] === cur) jmp++;
    i += jmp;
  }
  return rle;
}

function encodeDeflate(input) {
  const tokens = lz77Tokenize(input);

  // Count frequencies
  const litFreq = new Array(286).fill(0);
  const distFreq = new Array(30).fill(0);
  litFreq[256] = 1; // END
  for (const t of tokens) {
    if (t.t === 'L') litFreq[t.v]++;
    else if (t.t === 'M') {
      const lc = lenToCode(t.len);
      litFreq[lc.code]++;
      const dc = distToCode(t.dist);
      distFreq[dc.code]++;
    }
  }

  // Build Huffman code lengths
  const litLens = buildHuffmanLengths(litFreq, 15);
  const distLens = buildHuffmanLengths(distFreq, 15);

  // Find HLIT, HDIST
  let hlitMax = 256;
  for (let i = 285; i > 256; i--) if (litLens[i]) { hlitMax = i; break; }
  const HLIT = hlitMax - 256;  // HLIT + 257 = alphabet size
  let hdistMax = 0;
  for (let i = 29; i > 0; i--) if (distLens[i]) { hdistMax = i; break; }
  const HDIST = hdistMax;  // HDIST + 1 = alphabet size

  // Trim to actual size
  const litLensTrim = litLens.slice(0, HLIT + 257);
  const distLensTrim = distLens.slice(0, HDIST + 1);

  // RLE encode the lengths
  const combined = litLensTrim.concat(distLensTrim);
  const rle = rleCodeLens(combined);

  // Build code-length alphabet Huffman
  const clenFreq = new Array(19).fill(0);
  for (const r of rle) clenFreq[r.sym]++;
  const clenLens = buildHuffmanLengths(clenFreq, 7);

  // Find HCLEN (minimum needed by CLC_ORDER)
  let HCLEN = 0;
  for (let i = 18; i >= 4; i--) if (clenLens[CLC_ORDER[i]]) { HCLEN = i - 3; break; }

  // Build canonical codes for all three Huffman tables
  const litCodes = buildCanonical(litLensTrim);
  const distCodes = buildCanonical(distLensTrim);
  const clenCodes = buildCanonical(clenLens);

  // Write DEFLATE stream
  const bw = new BitWriter();
  bw.writeBits(1, 1);       // BFINAL
  bw.writeBits(2, 2);       // BTYPE=10 (dynamic)
  bw.writeBits(HLIT, 5);
  bw.writeBits(HDIST, 5);
  bw.writeBits(HCLEN, 4);
  for (let i = 0; i < HCLEN + 4; i++) bw.writeBits(clenLens[CLC_ORDER[i]], 3);

  // Write encoded code lengths using clen Huffman
  for (const r of rle) {
    bw.writeCode(clenCodes[r.sym], clenLens[r.sym]);
    if (r.sym === 16) bw.writeBits(r.extra, 2);
    else if (r.sym === 17) bw.writeBits(r.extra, 3);
    else if (r.sym === 18) bw.writeBits(r.extra, 7);
  }

  // Write actual data
  for (const t of tokens) {
    if (t.t === 'L') {
      bw.writeCode(litCodes[t.v], litLensTrim[t.v]);
    } else if (t.t === 'M') {
      const lc = lenToCode(t.len);
      bw.writeCode(litCodes[lc.code], litLensTrim[lc.code]);
      if (lc.extra) bw.writeBits(lc.extraBits, lc.extra);
      const dc = distToCode(t.dist);
      bw.writeCode(distCodes[dc.code], distLensTrim[dc.code]);
      if (dc.extra) bw.writeBits(dc.extraBits, dc.extra);
    } else if (t.t === 'END') {
      bw.writeCode(litCodes[256], litLensTrim[256]);
    }
  }

  return bw.flush();
}

// Wrap in gzip format
function encodeGzip(input, mtime = 0) {
  const deflate = encodeDeflate(input);
  const gzip = Buffer.alloc(10 + deflate.length + 8);
  gzip[0] = 0x1f; gzip[1] = 0x8b;
  gzip[2] = 0x08;    // CM = DEFLATE
  gzip[3] = 0x00;    // FLG = 0
  gzip.writeUInt32LE(mtime, 4);  // MTIME
  gzip[8] = 0x00;    // XFL
  gzip[9] = 0x03;    // OS = Unix
  deflate.copy(gzip, 10);
  const crc = require('zlib').crc32(input);
  gzip.writeUInt32LE(crc, 10 + deflate.length);
  gzip.writeUInt32LE(input.length & 0xffffffff, 14 + deflate.length);
  return gzip;
}

module.exports = { encodeDeflate, encodeGzip, lz77Tokenize };
