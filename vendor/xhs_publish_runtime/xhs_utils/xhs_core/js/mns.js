/**
 * mnsv2 → mns0101_/0201_/0301_ 100% 纯算法
 * ============================================================
 *
 *   sign = "mns0301_" + base64_custom( XOR( pack(fields), KEYSTREAM ) )
 *
 * 全部子过程均已还原为可读算法（无 VM / 无 __$c / 无补环境）：
 *   - pack        : 见 packPlaintext（TLV 字段布局）
 *   - ds 环境指纹 : envFp()  = [1, ver0^115, <14 固定环境常量>]
 *   - ds 设备签名 : dsSig()  = dsf(le64(ts)++md5(api+data)) 逐字节 XOR ver0
 *   - _dsf        : 自定义 4-lane ARX 哈希（见 dsf()）
 *   - encrypt     : XOR 固定密钥流（stream cipher）
 *   - base64      : 自定义字母表
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALPHABET = 'MfgqrsbcyzPQRStuvC7mn501HIJBo2DEFTKdeNOwxWXYZap89+/A4UVLhijkl63G';
const MNS0101_ALPHABET = 'NOPQRStuvwxWXYZabcyz012DEFTKLMdefghijkl4563GHIJBC7mnop89+/';

const KEYSTREAM = (() => {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'mns_keystreams.json'), 'utf8'));
  return [...Buffer.from(j.b64, 'base64')];
})();

const MNS0101_KEYSTREAM = (() => {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'mns_0101_keystream.json'), 'utf8'));
  return [...Buffer.from(j.b64, 'base64')];
})();

// envConst/envFpTail/loadts/seq/appId/deviceTag 属于页面、平台与会话状态，
// 不是算法常量。PC 与 Creator 共用本文件，平台层必须显式传入这些材料。

function md5Bytes(s) {
  return [...crypto.createHash('md5').update(String(s), 'utf8').digest()];
}
function le32(n) {
  n >>>= 0;
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}
function le64(n) {
  const out = [];
  let b = BigInt(n);
  for (let i = 0; i < 8; i++) { out.push(Number(b & 255n)); b >>= 8n; }
  return out;
}
function strBytes(s) {
  return [...Buffer.from(String(s), 'utf8')];
}
function base64Custom(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
    if (b1 === undefined) { out += '=='; break; }
    out += ALPHABET[((b1 & 15) << 2) | ((b2 || 0) >> 6)];
    if (b2 === undefined) { out += '='; break; }
    out += ALPHABET[b2 & 63];
  }
  return out;
}

// mns0101 使用自定义 Base58，而不是 0201/0301 的自定义 Base64。
// 前导零使用该字母表中的 `1` 表示。
function base58Custom(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let body = '';
  while (value > 0n) {
    body = MNS0101_ALPHABET[Number(value % 58n)] + body;
    value /= 58n;
  }
  let zeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    zeros++;
  }
  return '1'.repeat(zeros) + body;
}

function base58CustomDecode(text) {
  const reverse = new Map(Array.from(MNS0101_ALPHABET, (char, index) => [char, BigInt(index)]));
  let value = 0n;
  let offset = 0;
  while (offset < text.length && text[offset] === '1') offset++;
  for (let i = offset; i < text.length; i++) {
    const digit = reverse.get(text[i]);
    if (digit === undefined) throw new Error(`invalid mns0101 base58 character at ${i}`);
    value = value * 58n + digit;
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 255n));
    value >>= 8n;
  }
  return new Array(offset).fill(0).concat(bytes);
}

// --- ds 设备签名 _dsf：自定义 4-lane ARX 哈希 ---
function rotl(x, r) {
  return (((x << r) | 0) + (x >>> (32 - r))) | 0;
}
function dsf(data) {
  const len = data.length;
  const rd = (o) => (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) | 0;
  let h1 = (0x6d2b79f5 ^ len) | 0;
  let h2 = (0x1b873593 ^ (len << 8)) | 0;
  let h3 = (0x85ebca6b ^ (len << 16)) | 0;
  let h4 = (0xc2b2ae35 ^ (len << 24)) | 0;
  for (let i = 0; i + 8 <= len; i += 8) {
    const w0 = rd(i), w1 = rd(i + 4);
    h1 = rotl((((h1 + w0) | 0) ^ h3) | 0, 7);
    h2 = rotl((((h2 ^ w0) | 0) + h4) | 0, 11);
    h3 = rotl((((h3 + w1) | 0) ^ h1) | 0, 13);
    h4 = rotl((((h4 ^ w1) | 0) + h2) | 0, 17);
  }
  h1 = (h1 ^ len) | 0;
  h2 = (h2 ^ h1) | 0;
  h3 = (h3 + h2) | 0;
  h4 = (h4 ^ h3) | 0;
  h1 = rotl(h1, 9); h2 = rotl(h2, 13); h3 = rotl(h3, 17); h4 = rotl(h4, 19);
  h1 = (h1 + h3) | 0;
  h2 = (h2 ^ h4) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 ^ h2) | 0;
  const out = [];
  for (const h of [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]) {
    out.push(h & 255, (h >>> 8) & 255, (h >>> 16) & 255, (h >>> 24) & 255);
  }
  return out;
}

function envFp(versionKey, tail) {
  if (!Array.isArray(tail) || tail.length !== 14) {
    throw new Error('envFpTail required (14 bytes)');
  }
  return [1, versionKey ^ 115].concat(tail);
}

function packPlaintext(p) {
  if (p.loadts == null) throw new Error('mns loadts required');
  if (p.seq == null) throw new Error('mns seq required');
  if (p.envConst == null) throw new Error('mns envConst required');
  if (!Array.isArray(p.envFpTail) || p.envFpTail.length !== 14) {
    throw new Error('mns envFpTail required (14 bytes)');
  }
  const version = p.version >>> 0;
  const vKey = version & 255;
  const ts = p.ts;
  const loadts = p.loadts;
  const appId = String(p.appId || 'xhs-pc-web');
  const deviceTag = String(p.deviceTag || p.dsn || 'a3');
  const full = String(p.api) + (p.data || '');
  // md5FullBytes / md5UrlBytes are the u and p params from seccore_signv2 (already-computed md5s).
  // If not supplied, compute from api+data / api locally.
  const md5full = p.md5FullBytes ? [...p.md5FullBytes] : md5Bytes(full);
  const md5api = p.md5UrlBytes ? [...p.md5UrlBytes] : md5Bytes(p.api);
  // DS 脚本尚未就绪时浏览器的 window._dsn = "nop"，此阶段尾部直接放
  // MD5(url) XOR versionLowByte；DS 就绪后 PC/Creator 分别使用 a3/a1，
  // 尾部改为 _dsf(null, timestamp || MD5(url)) XOR versionLowByte。
  // Creator 的 _dsf 来自当前服务端 DS 程序，通过 dsSigBytes 显式传入；
  // 本地 dsf() 仅保留给已经完成静态提纯的平台路径。
  let rawDsSig;
  if (deviceTag === 'nop') {
    rawDsSig = md5api;
  } else if (Array.isArray(p.dsSigBytes) || ArrayBuffer.isView(p.dsSigBytes)) {
    rawDsSig = Array.from(p.dsSigBytes);
    if (rawDsSig.length !== 16) throw new Error('mns dsSigBytes must be 16 bytes');
  } else {
    rawDsSig = dsf(le64(ts).concat(md5api));
  }
  const dsSig = rawDsSig.map((b) => b ^ vKey);

  const out = [];
  const push = (a) => { for (const b of a) out.push(b); };
  push([121, 104, 96, 41]);
  push(le32(version));
  push(le64(ts));
  push(le64(loadts));
  push(le32(p.seq >>> 0)); // 请求序列号（会话自增计数器）
  push(le32(p.envConst >>> 0));
  push(le32(p.fullLen != null ? p.fullLen >>> 0 : Buffer.byteLength(full, 'utf8')));
  push(md5full.slice(0, 8).map((b) => b ^ vKey));
  push([p.a1.length]);
  push(strBytes(p.a1));
  const appBytes = strBytes(appId);
  if (appBytes.length > 255) throw new Error('mns appId too long');
  push([appBytes.length]);
  push(appBytes);
  push(envFp(vKey, p.envFpTail));
  const tagBytes = strBytes(deviceTag);
  if (tagBytes.length > 255) throw new Error('mns deviceTag too long');
  push([tagBytes.length]);
  push(tagBytes);
  push([16]);
  push(dsSig);
  return out;
}

// Helper: hex string → bytes array
function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// seccore_signv2 wrapper: matches browser's exact call convention.
// c = url + JSON.stringify(data) or url + data(string), u = md5(c) hex, p = md5(url) hex.
function seccoreSignV2({
  url, data, a1, ts, loadts, seq, version, envConst, envFpTail,
  appId = 'xhs-pc-web', deviceTag = 'a3',
}) {
  const c = String(url) + (data == null ? '' : (typeof data === 'object' ? JSON.stringify(data) : String(data)));
  const uHex = crypto.createHash('md5').update(c).digest('hex');
  const pHex = crypto.createHash('md5').update(String(url)).digest('hex');
  const md5FullBytes = hexToBytes(uHex);
  const md5UrlBytes = hexToBytes(pHex);
  return sign({
    api: url, data, a1, ts, loadts, seq, version, envConst, envFpTail,
    appId, deviceTag,
    md5FullBytes, md5UrlBytes,
    fullLen: Buffer.byteLength(c, 'utf8'),
  });
}

function sign(p) {
  const plain = packPlaintext(p);
  const cipher = plain.map((b, i) => b ^ KEYSTREAM[i]);
  return 'mns0301_' + base64Custom(cipher);
}

// mns0101：同一 144B pack → 固定密钥流 XOR → 自定义 Base58。
// 浏览器冷启动内容请求夹具已从显式 pack 输入 6/6 byte-exact。
function sign0101(p) {
  const plain = packPlaintext(p);
  if (plain.length > MNS0101_KEYSTREAM.length) {
    throw new Error(`mns0101 keystream too short: ${MNS0101_KEYSTREAM.length} < ${plain.length}`);
  }
  const cipher = plain.map((byte, index) => byte ^ MNS0101_KEYSTREAM[index]);
  return 'mns0101_' + base58Custom(cipher);
}

// ============================================================
// mns0201 档位：XXTEA(自定义 DELTA) + 同一自定义 base64 字母表
// ------------------------------------------------------------
// 从 vendor-dynamic VM 字节码静态还原（f_13448_141 管线）：
//   pack(144B) --toWordsLE(includeLength=true)--> 37 words
//   --XXTEA_encrypt(key, DELTA=1013904243)--> 37 words
//   --fromWordsLE(includeLength=false)--> 148 bytes
//   --base64_custom--> payload ；结果 = "mns0201_" + payload
// 真实密钥 = utf8("e6483ca2a1eed5e3")（VM 内 "e6"+"483c"+"a2a1eed5e3" 拼接）。
// 注意："99754106633f94d350db34d548d6091a" 是字节码里的诱饵（其派生值随即被覆盖）。
const MNS0201_DELTA = 1013904243; // 0x3C6EF373（非标准 golden-ratio）
const MNS0201_KEY_STR = 'e6483ca2a1eed5e3';

function mnsKeyWords() {
  let kb = [...Buffer.from(MNS0201_KEY_STR, 'utf8')];
  if (kb.length < 16) kb = kb.concat(new Array(16 - kb.length).fill(0));
  return toWordsLE(kb, false);
}
function toWordsLE(bytes, includeLength) {
  const e = bytes.length;
  let a = e >> 2;
  if (e & 3) a++;
  const t = includeLength ? new Array(a + 1).fill(0) : new Array(a).fill(0);
  if (includeLength) t[a] = e;
  for (let o = 0; o < e; o++) t[o >> 2] |= bytes[o] << ((o & 3) << 3);
  return t;
}
function fromWordsLE(r, includeLength) {
  let t = r.length, a = t << 2;
  if (includeLength) { const e = r[t - 1]; a -= 4; if (e < a - 3 || e > a) return null; a = e; }
  const f = new Array(a);
  for (let i = 0; i < a; i++) f[i] = (r[i >> 2] >>> ((i & 3) << 3)) & 0xff;
  return f;
}
function xxteaMx(sum, y, z, p, e, k) {
  return ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ (((sum ^ y) + (k[(p & 3) ^ e] ^ z)))) | 0;
}
function xxteaEncrypt(v, k) {
  const n = v.length;
  if (n < 2) return v;
  const nn = n - 1;
  let rounds = Math.floor(6 + 52 / n);
  let sum = 0, y, z = v[nn], e, p;
  while (rounds-- > 0) {
    sum = (sum + MNS0201_DELTA) | 0;
    e = (sum >>> 2) & 3;
    for (p = 0; p < nn; p++) { y = v[p + 1]; z = v[p] = (v[p] + xxteaMx(sum, y, z, p, e, k)) | 0; }
    y = v[0]; z = v[nn] = (v[nn] + xxteaMx(sum, y, z, nn, e, k)) | 0;
  }
  return v;
}
function xxteaDecrypt(v, k) {
  const n = v.length;
  if (n < 2) return v;
  const nn = n - 1;
  let rounds = Math.floor(6 + 52 / n);
  let sum = (rounds * MNS0201_DELTA) | 0, y = v[0], z, e, p;
  while (sum !== 0) {
    e = (sum >>> 2) & 3;
    for (p = nn; p > 0; p--) { z = v[p - 1]; y = v[p] = (v[p] - xxteaMx(sum, y, z, p, e, k)) | 0; }
    z = v[nn]; y = v[0] = (v[0] - xxteaMx(sum, y, z, 0, e, k)) | 0;
    sum = (sum - MNS0201_DELTA) | 0;
  }
  return v;
}

function encrypt0201(pack) {
  const kw = mnsKeyWords();
  const dataWords = toWordsLE(pack, true);
  const cipherWords = xxteaEncrypt(dataWords.slice(), kw);
  return fromWordsLE(cipherWords, false);
}
function sign0201(p) {
  const plain = packPlaintext(p);
  return 'mns0201_' + base64Custom(encrypt0201(plain));
}

// 统一入口：按档位分发（0301 默认；0201 = XXTEA）
function signTier(p, tier) {
  switch (tier || '0301') {
    case '0101': return sign0101(p);
    case '0201': return sign0201(p);
    case '0301': return sign(p);
    default: throw new Error(`unsupported mns tier: ${tier}`);
  }
}

module.exports = {
  sign, sign0101, sign0201, signTier, packPlaintext, dsf, envFp,
  base58Custom, base58CustomDecode, base64Custom,
  KEYSTREAM, MNS0101_KEYSTREAM, ALPHABET, MNS0101_ALPHABET,
  encrypt0201, xxteaEncrypt, xxteaDecrypt, toWordsLE, fromWordsLE, mnsKeyWords,
  MNS0201_DELTA, MNS0201_KEY_STR, seccoreSignV2, hexToBytes, le64
};
