'use strict';
// AES-128 decrypt with custom S-box (standard InvMixColumns/InvShiftRows)
const { keyExpand } = require('./aes_encrypt.js');
function mul(a, b) { let r = 0; for (let i = 0; i < 8; i++) { if (b & 1) r ^= a; const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return r; }
function invSboxOf(sbox) { const inv = new Array(256); for (let i = 0; i < 256; i++) inv[sbox[i]] = i; return inv; }
function aesDecBlock(ct, key, sbox) {
  const inv = invSboxOf(sbox); const Nr = 10; const w = keyExpand(key, sbox);
  const s = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[r * 4 + c] = ct[c * 4 + r];
  function addRK(round) { for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[r * 4 + c] ^= w[round * 4 + c][r]; }
  addRK(Nr);
  for (let round = Nr - 1; round >= 0; round--) {
    // InvShiftRows
    const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) s[r * 4 + c] = t[r * 4 + ((c - r + 4) % 4)];
    for (let i = 0; i < 16; i++) s[i] = inv[s[i]];
    addRK(round);
    if (round > 0) { const o = s.slice(); for (let c = 0; c < 4; c++) { const a0 = o[c], a1 = o[4 + c], a2 = o[8 + c], a3 = o[12 + c]; s[c] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); s[4 + c] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); s[8 + c] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); s[12 + c] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); } }
  }
  const out = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = s[r * 4 + c];
  return out;
}
module.exports = { aesDecBlock, invSboxOf };
