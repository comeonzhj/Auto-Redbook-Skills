/**
 * XHS Web 共用 X-S-Common 纯算（还原自 launcher XsCommon）：
 *   customB64( utf8( JSON.stringify({s0..x12}) ) )
 *   x9 = 变体 CRC32(b1)（多项式 0xedb88320，末值 ~c ^ 0xedb88320）
 * 无 VM / 无静态混淆 JS。
 */
'use strict';

const XS_ALPHABET = 'ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5';

const _crcTable = (() => {
  const a = 0xedb88320;
  const s = new Array(256);
  for (let d = 0; d < 256; d++) {
    let r = d;
    for (let c = 8; c > 0; c--) r = 1 & r ? (r >>> 1) ^ a : r >>> 1;
    s[d] = r >>> 0;
  }
  return s;
})();

function gens9(str) {
  const a = 0xedb88320;
  let c = -1;
  for (let r = 0; r < str.length; r++) {
    c = _crcTable[(255 & c) ^ str.charCodeAt(r)] ^ (c >>> 8);
  }
  return (-1 ^ c ^ a) | 0; // signed int32，与 JS 一致
}

function encodeUtf8(e) {
  const r = encodeURIComponent(e), a = [];
  for (let i = 0; i < r.length; i++) { const ch = r.charAt(i); if (ch === '%') { a.push(parseInt(r.charAt(i + 1) + r.charAt(i + 2), 16)); i += 2; } else a.push(ch.charCodeAt(0)); }
  return a;
}
function b64Custom(e) {
  const A = XS_ALPHABET, a = e.length, c = a % 3, d = []; const s = 16383; let u = 0; const l = a - c;
  for (u = 0; u < l; u += s) { const end = u + s > l ? l : u + s; for (let k = u; k < end; k += 3) { const t = (e[k] << 16) + ((k + 1 < end ? e[k + 1] : 0) << 8) + (k + 2 < end ? e[k + 2] : 0); d.push(A[(t >> 18) & 63], A[(t >> 12) & 63], A[(t >> 6) & 63], A[t & 63]); } }
  if (c === 1) { const t = e[a - 1]; d.push(A[t >> 2] + A[(t << 4) & 63] + '=='); }
  else if (c === 2) { const t = (e[a - 2] << 8) + e[a - 1]; d.push(A[t >> 10] + A[(t >> 4) & 63] + A[(t << 2) & 63] + '='); }
  return d.join('');
}

function xsCommon(a1, xt, xs, dslPair, b1, options = {}) {
  // Login/security cold paths still send X-S-Common before the b1 collector
  // has produced a snapshot.  In that phase x8 is the empty string and x9 is
  // its normal CRC variant; an empty b1 is therefore a real browser state,
  // not a missing-value fallback.
  if (b1 == null) throw new Error('xsCommon: b1 必须显式传入（允许空字符串）');
  if (!dslPair) throw new Error('xsCommon: dslPair 必传');
  const b1Value = String(b1);
  const config = typeof options === 'string' ? { webBuild: options } : options;
  const webBuild = String(config.webBuild || '6.32.2');
  // 2026-07-25 浏览器实证（zones/seccallback X-S-Common 解码）：
  // b1 未采集阶段浏览器发 x8: null（JSON null）且 x9 = gens9('null')，
  // 不是空字符串。服务端两种都容忍，字节级对齐以浏览器为准。
  const coldB1 = b1Value === '';
  const d = {
    s0: 5,
    s1: '',
    x0: String(config.b1b1 || '1'),
    x1: String(config.signVersion || '4.3.7'),
    x2: String(config.platform || 'Windows'),
    x3: String(config.appId || 'xhs-pc-web'),
    x4: webBuild,
    x5: a1,
    x6: '',
    x7: '',
    x8: coldB1 ? null : b1Value,
    x9: gens9(coldB1 ? 'null' : b1Value),
    x10: Number(config.signCount || 0),
    x11: 'normal',
    x12: dslPair,
  };
  return b64Custom(encodeUtf8(JSON.stringify(d)));
}

module.exports = { xsCommon, gens9 };
