'use strict';

const env = require('./websectiga_env');
const _process = process;
const _Buffer = Buffer;
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const inputText = fs.readFileSync(0, 'utf8');
const input = JSON.parse(inputText || '{}');
const sourceCode = String(input.code || '');
if (sourceCode.length < 1000 || !/\w+\(\)\(window,\{/.test(sourceCode)) {
  throw new Error('invalid scripting JSVMP code');
}
const UA = String(input.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36');
const PLATFORM = String(input.platform || 'Win32');
const PAGE_URL = String(input.pageUrl || 'https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend');

function nativeInstance(name) {
  const [Ctor, instance] = env.getNativeProto(name, {});
  // Browser host objects expose their brand through the prototype, while
  // Object.getOwnPropertyNames(instance) is empty for Navigator/Document.
  delete instance.toString;
  delete instance[Symbol.toStringTag];
  Object.defineProperty(Ctor.prototype, Symbol.toStringTag, {
    value: name,
    configurable: true,
  });
  return [Ctor, instance];
}

function defineReadonly(proto, values) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(proto, key, {
      get: env.setFuncNative(function get() { return value; }, `get ${key}`, 0),
      enumerable: true,
      configurable: true,
    });
  }
}

const [Window, fakeWindow] = nativeInstance('Window');
const [Navigator, fakeNavigator] = nativeInstance('Navigator');
defineReadonly(Navigator.prototype, {
  appCodeName: 'Mozilla',
  appName: 'Netscape',
  appVersion: UA.slice(8),
  cookieEnabled: true,
  hardwareConcurrency: 8,
  language: 'zh-CN',
  languages: Object.freeze(['zh-CN', 'zh', 'en']),
  maxTouchPoints: 0,
  platform: PLATFORM,
  product: 'Gecko',
  productSub: '20030107',
  userAgent: UA,
  vendor: 'Google Inc.',
  webdriver: false,
});

const [Location, fakeLocation] = nativeInstance('Location');
const parsedUrl = new URL(PAGE_URL);
defineReadonly(Location.prototype, {
  href: PAGE_URL,
  protocol: parsedUrl.protocol,
  host: parsedUrl.host,
  hostname: parsedUrl.hostname,
  port: parsedUrl.port,
  pathname: parsedUrl.pathname,
  search: parsedUrl.search,
  hash: parsedUrl.hash,
  origin: parsedUrl.origin,
});
Location.prototype.toString = env.setFuncNative(function toString() { return PAGE_URL; }, 'toString', 0);

const [HTMLDivElement] = nativeInstance('HTMLDivElement');
let appendCalls = 0;
let appendSelfCalls = 0;
HTMLDivElement.prototype.getAttribute = env.setFuncNative(function getAttribute() { return null; }, 'getAttribute', 1);
HTMLDivElement.prototype.setAttribute = env.setFuncNative(function setAttribute() {}, 'setAttribute', 2);
HTMLDivElement.prototype.appendChild = env.setFuncNative(function appendChild(child) {
  appendCalls += 1;
  if (child === this) appendSelfCalls += 1;
  throw new TypeError('Illegal invocation');
}, 'appendChild', 1);
Object.defineProperty(HTMLDivElement.prototype, 'style', {
  get: env.setFuncNative(function get() { return {}; }, 'get style', 0),
  configurable: true,
});

const [HTMLHtmlElement, fakeDocumentElement] = nativeInstance('HTMLHtmlElement');
HTMLHtmlElement.prototype.getAttribute = env.setFuncNative(function getAttribute() { return null; }, 'getAttribute', 1);

const [HTMLBodyElement, fakeBody] = nativeInstance('HTMLBodyElement');
HTMLBodyElement.prototype.appendChild = env.setFuncNative(function appendChild(child) { return child; }, 'appendChild', 1);

const [HTMLDocument, fakeDocument] = nativeInstance('HTMLDocument');
HTMLDocument.prototype.createElement = env.setFuncNative(function createElement(tag) {
  if (String(tag).toLowerCase() === 'div') return Object.create(HTMLDivElement.prototype);
  return Object.create(HTMLDivElement.prototype);
}, 'createElement', 1);
HTMLDocument.prototype.addEventListener = env.setFuncNative(function addEventListener() {}, 'addEventListener', 2);
HTMLDocument.prototype.removeEventListener = env.setFuncNative(function removeEventListener() {}, 'removeEventListener', 2);
defineReadonly(HTMLDocument.prototype, {
  body: fakeBody,
  documentElement: fakeDocumentElement,
  domain: 'xiaohongshu.com',
  hidden: false,
  referrer: '',
  title: '',
  URL: PAGE_URL,
  visibilityState: 'visible',
});

const [External, fakeExternal] = nativeInstance('External');
External.prototype.toString = env.setFuncNative(function toString() { return '[object External]'; }, 'toString', 0);

const [HTMLImageElement] = nativeInstance('HTMLImageElement');
for (const key of [
  'alt', 'src', 'srcset', 'sizes', 'crossOrigin', 'useMap', 'isMap',
  'width', 'height', 'naturalWidth', 'naturalHeight', 'complete',
  'currentSrc', 'referrerPolicy',
]) {
  Object.defineProperty(HTMLImageElement.prototype, key, {
    get: env.setFuncNative(function get() { return ''; }, `get ${key}`, 0),
    set: env.setFuncNative(function set() {}, `set ${key}`, 1),
    configurable: true,
    enumerable: true,
  });
}
const Image = env.setFuncNative(function Image() {
  return Object.create(HTMLImageElement.prototype);
}, 'Image', 0);
Image.prototype = HTMLImageElement.prototype;

const [Screen, fakeScreen] = nativeInstance('Screen');
defineReadonly(Screen.prototype, {
  width: 1920,
  height: 1080,
  availWidth: 1920,
  availHeight: 1040,
  colorDepth: 24,
  pixelDepth: 24,
});

const [History, fakeHistory] = nativeInstance('History');
defineReadonly(History.prototype, { length: 1, state: null });

const nativeAtob = env.setFuncNative(function atob(value) {
  return _Buffer.from(String(value), 'base64').toString('binary');
}, 'atob', 1);
const nativeBtoa = env.setFuncNative(function btoa(value) {
  return _Buffer.from(String(value), 'binary').toString('base64');
}, 'btoa', 1);

Object.assign(fakeWindow, {
  Array,
  Boolean,
  Date,
  Function,
  Image,
  JSON,
  Location,
  Math,
  Navigator,
  Number,
  Object,
  RegExp,
  String,
  Window,
  atob: nativeAtob,
  btoa: nativeBtoa,
  console,
  document: fakeDocument,
  escape,
  external: fakeExternal,
  frames: null,
  history: fakeHistory,
  location: fakeLocation,
  navigator: fakeNavigator,
  screen: fakeScreen,
  encodeURIComponent,
  setTimeout,
  clearTimeout,
});
fakeWindow.window = fakeWindow;
fakeWindow.self = fakeWindow;
fakeWindow.top = fakeWindow;
fakeWindow.parent = fakeWindow;
fakeWindow.frames = [fakeWindow];

let result = '';
fakeWindow.seccallback = env.setFuncNative(function seccallback(value) {
  result = String(value || '');
}, 'seccallback', 1);

env.init({
  window: fakeWindow,
  document: fakeDocument,
  navigator: fakeNavigator,
  location: fakeLocation,
});

vm.runInThisContext(sourceCode, {
  filename: 'xhs-scripting-response.js',
  timeout: Number(input.timeoutMs || 10000),
});

const summary = {
  websectiga: result,
  length: result.length,
  hex: /^[0-9a-f]{64}$/i.test(result),
  sha256Prefix: crypto.createHash('sha256').update(result).digest('hex').slice(0, 16),
};

_process.stdout.write(JSON.stringify(summary) + '\n');
// env_core keeps an exit-time diagnostic reporter for reverse work. The pure
// CLI has already emitted its machine-readable result, so suppress that noise.
console.log = function log() {};
