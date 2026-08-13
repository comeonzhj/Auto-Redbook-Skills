'use strict';
// AES-128 single-block encrypt with swappable S-box (standard MixColumns/ShiftRows/Rcon)
function mul(a, b) { let r = 0; for (let i = 0; i < 8; i++) { if (b & 1) r ^= a; const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return r; }
function keyExpand(key, sbox) {
  const Nk = 4, Nr = 10; const w = [];
  for (let i = 0; i < Nk; i++) w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
  const rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = w[i - 1].slice();
    if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map((x) => sbox[x]); t[0] ^= rcon[i / Nk - 1]; }
    w[i] = w[i - Nk].map((x, j) => x ^ t[j]);
  }
  return w;
}
function aesEncBlock(pt, key, sbox) {
  const Nr = 10; const w = keyExpand(key, sbox);
  const s = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[r * 4 + c] = pt[c * 4 + r];
  function addRK(round) { for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[r * 4 + c] ^= w[round * 4 + c][r]; }
  addRK(0);
  for (let round = 1; round <= Nr; round++) {
    for (let i = 0; i < 16; i++) s[i] = sbox[s[i]];
    const t = s.slice(); for (let r = 1; r < 4; r++) for (let c = 0; c < 4; c++) s[r * 4 + c] = t[r * 4 + ((c + r) % 4)];
    if (round < Nr) { const o = s.slice(); for (let c = 0; c < 4; c++) { const a0 = o[c], a1 = o[4 + c], a2 = o[8 + c], a3 = o[12 + c]; s[c] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3; s[4 + c] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3; s[8 + c] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3); s[12 + c] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2); } }
    addRK(round);
  }
  const out = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = s[r * 4 + c];
  return out;
}
module.exports = { aesEncBlock, mul, keyExpand };
