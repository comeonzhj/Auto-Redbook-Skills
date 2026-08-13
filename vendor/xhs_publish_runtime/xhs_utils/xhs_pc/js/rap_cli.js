'use strict';
// CLI: node rap_cli.js <api> [dataJsonString] [appId] [fingerprintHex]
// 输出 100% 纯算 x-rap-param（ByQ...）到 stdout。
// 零 VMP 执行、零浏览器补环境、零历史 bundle 加载。
const path = require('path');
const fs = require('fs');
const { buildRapPure } = require('./rap.js');

const api = process.argv[2];
const data = process.argv[3] || '';
const appId = process.argv[4] || undefined;
const fingerprintHex = process.argv[5] || '';
if (!api) { process.stderr.write('usage: rap_cli.js <api> [data] [appId]\n'); process.exit(2); }

// Fingerprint template: 219-byte captured behavior/detection blob (session-safe reuse)
const TPL_PATH = path.join(__dirname, 'rap_fingerprint_template.json');
const tpl = JSON.parse(fs.readFileSync(TPL_PATH, 'utf8'));
const fingerprint = Buffer.from(fingerprintHex || tpl.bodyUnmaskedHex, 'hex');
if (!fingerprint.length) {
  process.stderr.write('rap gen failed: fingerprint is empty\n');
  process.exit(2);
}

try {
  const rap = buildRapPure({ api, data, fingerprint });
  process.stdout.write(rap);
} catch (e) {
  process.stderr.write('rap gen failed: ' + (e && e.message) + '\n');
  process.exit(1);
}
