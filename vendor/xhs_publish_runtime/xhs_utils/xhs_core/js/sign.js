/**
 * XHS Web 共用签名算法入口：mns.js + xs_common.js。
 * Creator 0101 可显式传入服务端 DS 程序，在隔离 VM 中调用其 _dsf；
 * 其余签名路径不依赖浏览器宿主。
 * seccore_signv2 兼容版：内部对 (url + JSON.stringify(data)) 求 md5 作为 u 与 md5(url) 作为 p，
 * 与浏览器 window.mnsv2 完全一致（逐字节对齐）。
 *
 * CLI: node sign.js @input.json    ({api,data,cookie,version?,now?,seq?,tier?})
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { signTier, hexToBytes } = require('./mns.js');
const { xsCommon } = require('./xs_common.js');

const ALPHABET_XS = 'ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5';
function encodeUtf8(e) {
  const r = encodeURIComponent(e), a = [];
  for (let i = 0; i < r.length; i++) { const c = r.charAt(i); if (c === '%') { a.push(parseInt(r.charAt(i + 1) + r.charAt(i + 2), 16)); i += 2; } else a.push(c.charCodeAt(0)); }
  return a;
}
function b64XS(e) {
  const a = e.length, c = a % 3, d = []; let u = 0; const l = a - c, s = 16383;
  for (u = 0; u < l; u += s) { const end = u + s > l ? l : u + s; for (let k = u; k < end; k += 3) { const t = (e[k] << 16) + ((k + 1 < end ? e[k + 1] : 0) << 8) + (k + 2 < end ? e[k + 2] : 0); d.push(ALPHABET_XS[(t >> 18) & 63], ALPHABET_XS[(t >> 12) & 63], ALPHABET_XS[(t >> 6) & 63], ALPHABET_XS[t & 63]); } }
  if (c === 1) { const t = e[a - 1]; d.push(ALPHABET_XS[t >> 2] + ALPHABET_XS[(t << 4) & 63] + '=='); }
  else if (c === 2) { const t = (e[a - 2] << 8) + e[a - 1]; d.push(ALPHABET_XS[t >> 10] + ALPHABET_XS[(t >> 4) & 63] + ALPHABET_XS[(t << 2) & 63] + '='); }
  return d.join('');
}
function encodeXs(x3, x4Value, options = {}) {
  // Browser's seccore_signv2 always sets x4 = (data ? typeof data : '')
  // For empty data (GET), x4 = ''; for object data, x4 = 'object'; for string data, x4 = 'string'
  const signObj = {
    x0: String(options.signVersion || '4.3.7'),
    x1: String(options.appId || 'xhs-pc-web'),
    x2: String(options.platform || 'Windows'),
    x3,
    x4: x4Value,
  };
  return 'XYS_' + b64XS(encodeUtf8(JSON.stringify(signObj)));
}

function runDsfProgram(program, inputBytes, timeoutMs = 10000) {
  const source = String(program || '');
  if (!source || (!source.includes('__$c') && !source.includes('_dsf'))) {
    throw new Error('Creator DS program is missing or invalid');
  }
  const sandbox = {};
  sandbox.global = sandbox;
  vm.runInNewContext(source, sandbox, { timeout: Number(timeoutMs) });
  if (typeof sandbox._dsf !== 'function') {
    throw new Error('Creator DS program did not export _dsf');
  }
  const output = Array.from(sandbox._dsf(null, Array.from(inputBytes || [])) || []);
  if (
    output.length !== 16
    || output.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error('Creator _dsf output must be 16 bytes');
  }
  return output;
}

function signFull(input) {
  input = input || {};
  // 生产模式：cookie 必须从 CLI 传入；不再读磁盘兜底
  if (!input.cookie) throw new Error('cookie required (must be passed via CLI JSON)');
  const cookie = input.cookie;
  const cookieMap = Object.fromEntries(cookie.split(/;\s*/).map((part) => {
    const offset = part.indexOf('=');
    return offset < 0 ? [part, ''] : [part.slice(0, offset), part.slice(offset + 1)];
  }));
  const a1 = (cookie.match(/a1=([^;]*)/) || [])[1] || '';
  if (!a1) throw new Error('cookie a1 required');
  const now = input.now != null ? Number(input.now) : Date.now();
  const version = input.version != null ? (input.version >>> 0) : (Math.floor(Math.random() * 0x100000000) >>> 0);
  const loadts = input.loadts != null ? Number(input.loadts) : Number(cookieMap.loadts);
  if (!Number.isFinite(loadts)) throw new Error('loadts required (input.loadts or cookie loadts)');
  if (input.seq == null) throw new Error('seq required from PcDeviceProfile session state');
  if (input.envConst == null) throw new Error('envConst required from PcDeviceProfile stage state');
  if (!Array.isArray(input.envFpTail) || input.envFpTail.length !== 14) {
    throw new Error('envFpTail required from PcDeviceProfile stage state (14 bytes)');
  }
  // seccore_signv2 receives `data` as JS object or string (not stringified for u calc)
  // c = url + JSON.stringify(data) for objects, or url + data for strings
  const dataIn = input.data;
  const dataStr = dataIn == null ? '' : (typeof dataIn === 'object' ? JSON.stringify(dataIn) : String(dataIn));
  const c = String(input.api) + dataStr;
  // x4 label per browser: object data → 'object', string data (non-empty) → 'string', else ''
  const x4Label = dataIn == null || dataIn === '' ? '' : (typeof dataIn === 'object' ? 'object' : 'string');
  const md5Full = hexToBytes(crypto.createHash('md5').update(c).digest('hex'));
  const md5Url = hexToBytes(crypto.createHash('md5').update(String(input.api)).digest('hex'));
  const fullLen = Buffer.byteLength(c, 'utf8');
  const tier = input.tier || '0301';
  const deviceTag = String(input.deviceTag || input.dsn || 'a3');
  let dsSigBytes = input.dsSigBytes;
  if (deviceTag !== 'nop' && !dsSigBytes && input.dsfProgram) {
    const dsfInput = [];
    let timestamp = BigInt(now);
    for (let index = 0; index < 8; index++) {
      dsfInput.push(Number(timestamp & 255n));
      timestamp >>= 8n;
    }
    dsfInput.push(...md5Url);
    dsSigBytes = runDsfProgram(input.dsfProgram, dsfInput, input.dsfTimeoutMs);
  }
  const x3 = signTier({
    api: input.api,
    data: dataStr,
    a1,
    appId: String(input.appId || 'xhs-pc-web'),
    deviceTag,
    dsSigBytes,
    version,
    ts: now,
    loadts,
    seq: input.seq,
    envConst: input.envConst,
    envFpTail: input.envFpTail,
    md5FullBytes: md5Full,
    md5UrlBytes: md5Url,
    fullLen,
  }, tier);
  const xs = encodeXs(x3, x4Label, input);
  // Browser builds MNS first, then samples Date.now() again for X-t.
  const xt = input.xt != null ? String(input.xt) : String(Date.now());
  const out = { x3, xs, xt, len: x3.length, prefix: x3.slice(0, 12), tier, pure: true };
  // X-S-Common 纯算（需 b1 + dslPair）
  const b1 = input.b1 == null ? '' : String(input.b1);
  const dslPairRaw = input.dslPair == null ? input.dsl_pair : input.dslPair;
  const dslPair = dslPairRaw == null ? '' : String(dslPairRaw);
  if (dslPair) {
    const webBuild = String(input.webBuild || cookieMap.webBuild || '');
    if (!webBuild) throw new Error('webBuild required (input.webBuild or cookie webBuild)');
    out.xs_common = xsCommon(a1, xt, xs, dslPair, b1, {
      b1b1: input.b1b1,
      signVersion: input.signVersion,
      platform: input.platform,
      appId: input.appId,
      webBuild,
      signCount: input.signCount,
    });
  }
  return out;
}

function main() {
  const arg = process.argv[2];
  const raw = arg && arg.startsWith('@') ? fs.readFileSync(arg.slice(1), 'utf8') : arg;
  const input = JSON.parse(raw);
  process.stdout.write(JSON.stringify(signFull(input)) + '\n');
}

if (require.main === module) main();

module.exports = { signFull, encodeXs, encodeUtf8, b64XS, runDsfProgram, main };
