/**
 * x-rap-param 纯算 —— 加密侧（crypto + 信封），零补环境。
 * 管线：payload → gzip(pure XHS) → alphabet36-random-pad → XOR(xorKey) → AES-128-ECB(自研S-box, 固定密钥) → body
 *       encR = AES-128-ECB(xorKey)
 *       信封 = header + nonce + encR + len + body + trailing(bodyLen)
 * 分组密码 = 标准 AES-128-ECB，仅 S-box 换成小红书自研表。
 * DEFLATE = deflate.js（简单贪婪LZ77 + 动态Huffman，字节对齐浏览器版本）。
 */
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const { aesEncBlock } = require('./aes_encrypt.js');
const { aesDecBlock } = require('./aes_decrypt.js');
const { encodeGzip } = require('./deflate.js');

const SBOX = [122,1,88,224,80,78,2,121,29,75,83,218,107,72,212,82,237,119,18,33,20,21,236,16,24,229,185,241,12,8,252,125,249,205,181,200,230,55,38,135,86,186,184,43,173,240,104,247,139,141,211,94,54,77,46,146,49,130,242,41,112,61,45,215,182,64,178,67,68,128,120,210,13,73,74,9,99,108,7,58,158,213,6,198,225,98,244,52,36,89,169,87,42,0,62,23,44,10,26,66,250,147,190,220,245,179,106,19,232,3,199,151,187,115,118,134,227,70,114,71,208,5,76,56,124,31,129,171,117,81,235,243,50,116,17,143,132,137,156,113,34,126,157,207,63,145,105,101,60,109,150,162,152,153,51,57,154,202,195,159,160,188,228,163,164,84,127,167,168,4,111,93,172,183,39,175,176,40,65,174,180,110,11,27,223,142,48,177,254,144,97,96,192,203,92,14,239,22,131,234,32,233,201,85,196,69,133,204,30,170,103,138,123,53,214,25,216,217,194,219,148,221,28,222,166,255,248,191,91,90,15,231,193,189,209,102,197,37,238,140,226,95,136,161,59,165,246,206,149,47,100,35,251,253,79,155];
const AES_KEY = [...Buffer.from('kqI1DTcwKX90ZtAy')];
const ALPHABET36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function aesEcbEnc(data) { const o = []; for (let i = 0; i < data.length; i += 16) o.push(...aesEncBlock([...data.slice(i, i + 16)], AES_KEY.slice(), SBOX)); return Buffer.from(o); }
function aesEcbDec(data) { const o = []; for (let i = 0; i + 16 <= data.length; i += 16) o.push(...aesDecBlock([...data.slice(i, i + 16)], AES_KEY.slice(), SBOX)); return Buffer.from(o); }

// XHS 使用 alphabet36 随机 ASCII 填充到 16 字节边界 (NOT PKCS7)
function alpha36Pad(buf) {
  const n = 16 - (buf.length % 16);
  const padActual = n === 0 ? 16 : n;
  const rand = crypto.randomBytes(padActual);
  const padBytes = Buffer.from([...rand].map(b => ALPHABET36.charCodeAt(b % 36)));
  return Buffer.concat([buf, padBytes]);
}

function pkcs7(buf) { const n = 16 - (buf.length % 16); return Buffer.concat([buf, Buffer.alloc(n, n)]); }

// 加密：payload(Buffer) + xorKey(16B) → {encR, body, gzipLen}
// mtime 可选：想字节对齐浏览器需要提供 mtime 与 xorKey，padBytes（可选）覆盖随机填充
function encryptPayload(payload, xorKey, opts = {}) {
  let gz;
  try {
    gz = encodeGzip(payload, opts.mtime || 0);
  } catch (err) {
    // 大 payload（如 Creator 发布的 452B 指纹）会让自研 Huffman 树深超过 15
    // 触发 overflow；回退 Node zlib 裸 deflate（与浏览器同族的合法编码，
    // 服务端只做 AES-ECB + XOR + gunzip 校验，不逐字节比对 deflate）。
    const deflated = zlib.deflateRawSync(payload, { level: 9 });
    const mtime = opts.mtime || 0;
    gz = Buffer.alloc(10 + deflated.length + 8);
    gz[0] = 0x1f; gz[1] = 0x8b; gz[2] = 0x08; gz[3] = 0x00;
    gz.writeUInt32LE(mtime, 4);
    gz[8] = 0x00; gz[9] = 0x03;
    deflated.copy(gz, 10);
    gz.writeUInt32LE(zlib.crc32(payload), 10 + deflated.length);
    gz.writeUInt32LE(payload.length & 0xffffffff, 14 + deflated.length);
  }
  const gzipLen = gz.length;
  const padded = opts.padBytes
    ? Buffer.concat([gz, Buffer.from(opts.padBytes)])
    : alpha36Pad(gz);
  const xored = Buffer.from(padded.map((b, i) => b ^ xorKey[i % 16]));
  const body = aesEcbEnc(xored);
  const encR = aesEcbEnc(Buffer.from(xorKey));
  return { encR, body, gzipLen };
}

// 解密（验证用）— 通过尝试不同尾部长度找出 gzip 结束位置
function decryptBody(encR, body) {
  const xorKey = aesEcbDec(encR);
  const xored = aesEcbDec(body);
  const gz = Buffer.from(xored.map((b, i) => b ^ xorKey[i % 16]));
  for (let trim = 0; trim <= 16; trim++) { try { return zlib.gunzipSync(gz.slice(0, gz.length - trim)); } catch (e) {} }
  throw new Error('gunzip failed');
}

module.exports = { encryptPayload, decryptBody, aesEcbEnc, aesEcbDec, SBOX, AES_KEY, pkcs7, alpha36Pad };
