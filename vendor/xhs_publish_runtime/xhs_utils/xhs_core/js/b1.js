'use strict';

const fs = require('fs');

const B1_RC4_KEY = 'xhswebmplfbt';
const B1_BASE64_ALPHABET = 'ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5';
const MINI_FIELD_KEYS = Object.freeze([
  'x33', 'x34', 'x35', 'x36', 'x37', 'x38', 'x39',
  'x42', 'x43', 'x44', 'x45', 'x46',
  'x48', 'x49', 'x50', 'x51', 'x52', 'x82', 'x84',
]);
const DEFAULT_X37 = '0|0|0|0|0|0|0|0|0|1|0|0|1|0|0|0|0|1|1|0|0|0|0|0';
const DEFAULT_X38 = '0|0|1|0|1|0|0|0|0|0|1|0|1|0|1|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0';
const DEFAULT_X82 = '1|_BHjFmfUMEtxhI|_AUuXfEG27Xa3x|__xhsPendingNotePoint25300ReportMap|__xhsReportedNotePoint25300RecordMap|setImDebugMode|anti_hp_sign_config|__rap_app_id__|__rap_report__|__rap_last_sign_cost__|__rap_last_transform_cost__|__rap_hijack_installed__|__ed1a7dddf7c818e4bd|__hp_xhs_search_input_state__|__h';
const DEFAULT_X39 = '22';
const DEFAULT_X45 = '__SEC_CAV__1-1-1-1-1|';
const DEFAULT_X50 = '131,88,103';

function orderedMiniFields(input) {
  const out = {};
  for (const key of MINI_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input || {}, key)) out[key] = input[key];
  }
  return out;
}

function rc4BinaryString(plainText, key = B1_RC4_KEY) {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key.charCodeAt(i % key.length)) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }

  let i = 0;
  j = 0;
  let encrypted = '';
  for (let offset = 0; offset < plainText.length; offset++) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    const keyByte = state[(state[i] + state[j]) & 0xff];
    encrypted += String.fromCharCode(plainText.charCodeAt(offset) ^ keyByte);
  }
  return encrypted;
}

function customBase64(bytes, alphabet = B1_BASE64_ALPHABET) {
  let out = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset];
    const hasB = offset + 1 < bytes.length;
    const hasC = offset + 2 < bytes.length;
    const b = hasB ? bytes[offset + 1] : 0;
    const c = hasC ? bytes[offset + 2] : 0;
    out += alphabet[a >>> 2];
    out += alphabet[((a & 0x03) << 4) | (b >>> 4)];
    out += hasB ? alphabet[((b & 0x0f) << 2) | (c >>> 6)] : '=';
    out += hasC ? alphabet[c & 0x3f] : '=';
  }
  return out;
}

function customBase64Decode(text, alphabet = B1_BASE64_ALPHABET) {
  const reverse = new Map(Array.from(alphabet, (char, index) => [char, index]));
  const bytes = [];
  for (let offset = 0; offset < text.length; offset += 4) {
    const a = reverse.get(text[offset]);
    const b = reverse.get(text[offset + 1]);
    const c = text[offset + 2] === '=' ? 0 : reverse.get(text[offset + 2]);
    const d = text[offset + 3] === '=' ? 0 : reverse.get(text[offset + 3]);
    if ([a, b, c, d].some(x => x === undefined)) throw new Error('invalid b1 base64 character');
    bytes.push((a << 2) | (b >>> 4));
    if (text[offset + 2] !== '=') bytes.push(((b & 0x0f) << 4) | (c >>> 2));
    if (text[offset + 3] !== '=') bytes.push(((c & 0x03) << 6) | d);
  }
  return Uint8Array.from(bytes);
}

function encodeB1FromMini(miniFields) {
  const plainText = JSON.stringify(orderedMiniFields(miniFields));
  const encrypted = rc4BinaryString(plainText);
  return customBase64(Buffer.from(encrypted, 'utf8'));
}

function decodeB1(b1) {
  const encrypted = Buffer.from(customBase64Decode(b1)).toString('utf8');
  const plainText = rc4BinaryString(encrypted);
  return JSON.parse(plainText);
}

function formatTelemetry(options = {}) {
  const now = Number(options.now ?? Date.now());
  const timeOrigin = Number(options.timeOrigin ?? (now - Number(options.sessionAgeMs ?? 2151.1)));
  const activeProfile = options.profile === 'active' || options.profile === 'legacy-active';
  const mouse = activeProfile
    ? { me: 50, mm: 50, md: 1, mu: 1, c: 1, ...(options.mouse || {}) }
    : { ...(options.mouse || {}) };
  const page = activeProfile
    ? { ulr: 1, ps: 1, f: 3, b: 3, vc: 0, rs: 1, sc: 0, ...(options.page || {}) }
    : { ulr: 2, ps: 1, ...(options.page || {}) };
  const state = { h: 0, f: 1, kr: 0, ...(options.state || {}) };
  const featureInput = options.features || {};
  const features = activeProfile ? {
    ae: 3.3656015629507223,
    ak: 6.231183732330187,
    cdr: 0.4096814442007536,
    bf: { ar: 0.6210873146622735, fr: 7.158084478545331 },
    fi: Number(options.firstInteraction ?? 2151.1),
    ...featureInput,
  } : {
    ae: null,
    ak: null,
    cdr: null,
    bf: null,
    fi: null,
    ...featureInput,
  };
  const keyboard = options.keyboard || {};
  const mapText = value => Object.entries(value)
    .map(([key, item]) => `${key}:${item}`)
    .join(',');
  const bfText = features.bf == null
    ? 'null'
    : `{ar:${features.bf.ar},fr:${features.bf.fr}}`;
  return `{mt:{to:${timeOrigin}},m:{${mapText(mouse)}},k:{${mapText(keyboard)}},p:{${mapText(page)}},st:{${mapText(state)}},ft:{ae:${features.ae},ak:${features.ak},cdr:${features.cdr},bf:${bfText},fi:${features.fi}}}`;
}

// 默认构造“冷启动/低交互”profile。b1 是环境快照，不是稳定设备 ID：
// x36/x39/x44/x50/x82/x84 会随页面、浏览器能力和交互状态变化。
// 如需和某一条浏览器样本逐字节相等，必须把该样本解出的字段通过 overrides 传入。
function buildMiniFields(options = {}) {
  const now = Number(options.now ?? Date.now());
  const windowKeysRaw = Array.isArray(options.windowKeys)
    ? `1|${options.windowKeys.join('|')}`
    : (options.x82 ?? DEFAULT_X82);
  // 浏览器 collector 对页面全局名快照最多保留 300 个字符。
  const windowKeys = String(windowKeysRaw).slice(0, 300);
  const fields = {
    x33: '0',
    x34: '0',
    x35: '0',
    x36: String(options.frameCount ?? 2),
    x37: DEFAULT_X37,
    x38: DEFAULT_X38,
    // x39 不是 window/global 数量。当前 Chrome 150 浏览器真值为 22；其采集器
    // 在 SDK 初始化期缓存，纯算层把它作为显式环境输入。
    x39: String(options.x39 ?? DEFAULT_X39),
    x42: String(options.sdkVersion ?? '3.5.4'),
    x43: String(options.canvasFingerprint ?? 'Canvas not supported'),
    x44: String(now),
    x45: String(options.secCanvas ?? DEFAULT_X45),
    x46: String(options.webdriver ?? false),
    x48: String(options.x48 ?? ''),
    x49: String(options.x49 ?? '{list:[],type:}'),
    // x50 是初始化期缓存的三元素浏览器能力向量，不是 global 数量。
    x50: String(options.x50 ?? options.globalCount ?? DEFAULT_X50),
    x51: String(options.x51 ?? ''),
    x52: String(options.x52 ?? ''),
    x82: String(windowKeys),
    x84: String(options.x84 ?? formatTelemetry({ ...options.telemetry, now })),
  };
  return Object.assign(fields, options.overrides || {});
}

function generateB1(options = {}) {
  const mini = buildMiniFields(options);
  return { b1: encodeB1FromMini(mini), mini };
}

function main(argv = process.argv) {
  const arg = argv[2];
  if (arg === '--generate') {
    const options = argv[3] ? JSON.parse(argv[3]) : {};
    process.stdout.write(JSON.stringify(generateB1(options)) + '\n');
    return;
  }
  if (arg === '--decode') {
    process.stdout.write(JSON.stringify(decodeB1(argv[3] || ''), null, 2) + '\n');
    return;
  }
  if (!arg) {
    process.stdout.write(JSON.stringify(generateB1()) + '\n');
    return;
  }
  const input = arg.startsWith('@')
    ? JSON.parse(fs.readFileSync(arg.slice(1), 'utf8'))
    : JSON.parse(arg);
  process.stdout.write(encodeB1FromMini(input) + '\n');
}

if (require.main === module) main();

module.exports = {
  B1_RC4_KEY,
  B1_BASE64_ALPHABET,
  MINI_FIELD_KEYS,
  orderedMiniFields,
  rc4BinaryString,
  customBase64,
  customBase64Decode,
  encodeB1FromMini,
  decodeB1,
  formatTelemetry,
  buildMiniFields,
  generateB1,
  main,
};
