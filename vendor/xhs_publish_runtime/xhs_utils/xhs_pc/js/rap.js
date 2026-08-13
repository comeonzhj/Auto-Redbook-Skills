/**
 * x-rap-param algorithm — zero VMP execution.
 *
 * Reversed 2026-07-15 from captured Sanji/Garp VMP browser evidence.
 *
 * Discoveries:
 *   - Xorkeyverifyvalue = xxHash32([mask_byte], seed=0)
 *   - RequestHash       = xxHash32(url_pathAndBeyond + jsonBody, seed=0)
 *   - Payload wire format: header(16B raw) + body(N B XOR-masked with 1B mask)
 *       header: [0:2]=0x03e8 op, [2:10]=8B ts BE, [10:12]=0x03e9 op, [12:16]=4B xorKeyVerify
 *       body: TLV opcodes 0x3ea..0x484, each XOR'd with mask
 *   - Random ASCII generation: bytes → alphabet36[b % 36]
 *   - AES key: "kqI1DTcwKX90ZtAy" (fixed)
 *   - Envelope: rap_crypto.js
 *
 * Fingerprint (~200B of behavior/detection data) is captured once per session
 * and reused (same approach as mns envConst/envFpTail).
 */
'use strict';
const crypto = require('crypto');
const { encryptPayload } = require('./rap_crypto.js');

const ALPHABET36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** xxHash32 (32-bit variant of xxHash). Byte-exact vs reference. */
function xxHash32(buf, seed = 0) {
  const P1 = 0x9E3779B1 >>> 0, P2 = 0x85EBCA77 >>> 0, P3 = 0xC2B2AE3D >>> 0;
  const P4 = 0x27D4EB2F >>> 0, P5 = 0x165667B1 >>> 0;
  const M = Math.imul;
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
  let h, p = 0; const len = buf.length;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) >>> 0, v2 = (seed + P2) >>> 0, v3 = seed >>> 0, v4 = (seed - P1) >>> 0;
    while (p + 16 <= len) {
      const l1 = (buf[p] | buf[p+1]<<8 | buf[p+2]<<16 | buf[p+3]<<24) >>> 0;
      const l2 = (buf[p+4] | buf[p+5]<<8 | buf[p+6]<<16 | buf[p+7]<<24) >>> 0;
      const l3 = (buf[p+8] | buf[p+9]<<8 | buf[p+10]<<16 | buf[p+11]<<24) >>> 0;
      const l4 = (buf[p+12] | buf[p+13]<<8 | buf[p+14]<<16 | buf[p+15]<<24) >>> 0;
      v1 = M(rotl((v1 + M(l1, P2)) >>> 0, 13), P1) >>> 0;
      v2 = M(rotl((v2 + M(l2, P2)) >>> 0, 13), P1) >>> 0;
      v3 = M(rotl((v3 + M(l3, P2)) >>> 0, 13), P1) >>> 0;
      v4 = M(rotl((v4 + M(l4, P2)) >>> 0, 13), P1) >>> 0;
      p += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else h = (seed + P5) >>> 0;
  h = (h + len) >>> 0;
  while (p + 4 <= len) {
    const l = (buf[p] | buf[p+1]<<8 | buf[p+2]<<16 | buf[p+3]<<24) >>> 0;
    h = M(rotl((h + M(l, P3)) >>> 0, 17), P4) >>> 0; p += 4;
  }
  while (p < len) { h = M(rotl((h + M(buf[p], P5)) >>> 0, 11), P1) >>> 0; p++; }
  h ^= h >>> 15; h = M(h, P2) >>> 0; h ^= h >>> 13; h = M(h, P3) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}

/** Map N raw random bytes to ASCII: alphabet36[b % 36] for each byte. */
function randomAscii(n) {
  const buf = crypto.randomBytes(n);
  let out = '';
  for (const b of buf) out += ALPHABET36[b % 36];
  return out;
}

/** Build a fresh 235B payload (no Uuid; the minimal common form).
 *  Returns Uint8Array of the plaintext payload (before gzip).
 *  fingerprint is a 201-byte Buffer captured from browser (or all-zeros for a bare minimum). */
function buildPayload({ ts, url, body, fingerprint, mask }) {
  // Layout for 235B payload (Uuid absent):
  //   [0:16]  header (raw)
  //   [16:38] Uuid section — for 235B we still need SOMETHING at [16:] starting with 0x03ea
  //   ... 219B body ...
  // Simpler: use the exact template we captured and only overwrite dynamic bytes.
  // Header: 03e8 <8B ts BE> 03e9 <4B xorKeyVerify>
  const p = new Uint8Array(fingerprint.length + 16);
  // Header
  p[0] = 0x03; p[1] = 0xe8;
  // 8B ts BE
  const tsHi = Math.floor(ts / 0x100000000);
  const tsLo = ts >>> 0;
  p[2] = (tsHi >>> 24) & 0xff; p[3] = (tsHi >>> 16) & 0xff; p[4] = (tsHi >>> 8) & 0xff; p[5] = tsHi & 0xff;
  p[6] = (tsLo >>> 24) & 0xff; p[7] = (tsLo >>> 16) & 0xff; p[8] = (tsLo >>> 8) & 0xff; p[9] = tsLo & 0xff;
  p[10] = 0x03; p[11] = 0xe9;
  // xorKeyVerify = xxHash32([mask])
  const verify = xxHash32(Buffer.from([mask]));
  p[12] = (verify >>> 24) & 0xff; p[13] = (verify >>> 16) & 0xff; p[14] = (verify >>> 8) & 0xff; p[15] = verify & 0xff;
  // Body: copy fingerprint template + write dynamic fields, then XOR with mask
  const bodyUnmasked = Buffer.from(fingerprint);
  // Fingerprint template must already have 0x03ea at [0] (Uuid) or 0x03eb at [0] (RequestHash).
  // Locate RequestHash slot (opcode 0x03eb) and write current URL+body hash.
  // Search for 03eb marker in template.
  let reqHashOff = -1;
  for (let i = 0; i < bodyUnmasked.length - 5; i++) {
    if (bodyUnmasked[i] === 0x03 && bodyUnmasked[i+1] === 0xeb) { reqHashOff = i + 2; break; }
  }
  if (reqHashOff >= 0) {
    const reqHash = xxHash32(Buffer.from(url + body));
    bodyUnmasked[reqHashOff]   = (reqHash >>> 24) & 0xff;
    bodyUnmasked[reqHashOff+1] = (reqHash >>> 16) & 0xff;
    bodyUnmasked[reqHashOff+2] = (reqHash >>> 8)  & 0xff;
    bodyUnmasked[reqHashOff+3] = reqHash & 0xff;
  }
  // XOR-mask the body
  for (let i = 0; i < bodyUnmasked.length; i++) p[16 + i] = bodyUnmasked[i] ^ mask;
  return p;
}

/** Full rap generator.
 *  Optional inputs for byte-exact reproduction: mtime, padBytes, bodyEncryTime.
 */
function buildRapPure({ api, data, fingerprint, mask, xorKey, ts, nonce, mtime, padBytes, bodyEncryTime, returnLayers }) {
  api = api || '/api/sns/web/v1/homefeed';
  data = typeof data === 'string' ? data : JSON.stringify(data || {});
  ts = ts || Date.now();
  // URL form used by the browser rap for RequestHash.
  // 2026-07-25 实证（Creator post_note 模板 03eb 槽反解）：
  // 浏览器对发布接口用**完整 https URL** 求 xxHash32(url+body)；
  // 传完整 URL 时按原样使用，传路径时退回协议相对形式（兼容 PC 旧调用）。
  let url;
  if (/^https?:\/\//.test(api)) url = api;
  else if (api.startsWith('//')) url = api;
  else url = '//edith.xiaohongshu.com' + api;

  // mask: a random byte mapped to alphabet36 ASCII (like '0'..'9','a'..'z')
  if (mask == null) mask = ALPHABET36.charCodeAt(crypto.randomBytes(1)[0] % 36);

  // xorKey: 16 ASCII chars from alphabet36
  if (!xorKey) xorKey = Buffer.from(randomAscii(16));
  else if (typeof xorKey === 'string') xorKey = Buffer.from(xorKey);

  // Envelope nonce: 4-6 ASCII chars — magic byte determines length. Accept override.
  let nonceLen;
  if (nonce != null) {
    if (typeof nonce === 'string') nonce = Buffer.from(nonce, 'ascii');
    nonceLen = nonce.length;
  } else {
    nonceLen = 4 + Math.floor(crypto.randomBytes(1)[0] / 86); // 4/5/6 roughly balanced
    nonce = Buffer.from(randomAscii(nonceLen), 'ascii');
  }

  // Build the plaintext payload (single canonical build; RequestHash uses url + data)
  const p2 = buildPayload({ ts, url, body: data, fingerprint, mask });

  // Encrypt via rap_crypto (DEFLATE + alphabet36 pad)
  const encryptStart = Date.now();
  const { encR, body: bodyEnc, gzipLen } = encryptPayload(Buffer.from(p2), Array.from(xorKey), { mtime: mtime || 0, padBytes });
  const encryptTimeMs = bodyEncryTime != null ? bodyEncryTime : Math.max(1, Date.now() - encryptStart);

  const B = bodyEnc.length;
  const env = Buffer.alloc(60 + nonceLen + B);
  env[0] = 0x07; env[1] = 0x24; env[2] = 0x01; env[3] = nonceLen;
  env.writeUInt32BE(1, 4);                              // ver (protocolCryptVersion)
  env.writeUInt32BE(20, 8);                             // keyLength (encR + encRlen)
  env.writeUInt32BE(B + 4, 12);                         // payloadLen (bodyLen + 4)
  // env[16:20] = chk16 (bodyhash) — computed below after body written
  env.writeUInt32BE(0x0000283d, 20);                    // Version (0x283d = fingerprint version)
  env.writeUInt32BE(encryptTimeMs, 24);                 // bodyEncryTime (elapsed ms)
  // env[28:36] = 0 (already zero from Buffer.alloc) — note: header prototype writes 512 at [28:32] but final envelope has 0
  nonce.copy(env, 36);
  Buffer.from(encR).copy(env, 36 + nonceLen);
  env.writeUInt32BE(16, 52 + nonceLen);
  Buffer.from(bodyEnc).copy(env, 56 + nonceLen);
  env.writeUInt32BE(gzipLen, 56 + nonceLen + B);  // trailing = actual gzip length (NOT encrypted body length)
  // Now compute chk16 = xxHash32(env[36:], seed=0) — hash of everything after the 36B header
  const chk16 = xxHash32(env.slice(36), 0);
  env.writeUInt32BE(chk16, 16);

  const rap = env.toString('base64');
  if (returnLayers) return { rap, plaintext: Buffer.from(p2), encR: Buffer.from(encR), body: Buffer.from(bodyEnc), envelope: env, mask, xorKey, nonce };
  return rap;
}

module.exports = { buildRapPure, xxHash32, randomAscii, ALPHABET36 };
