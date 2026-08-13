'use strict';

const CryptoJS = require('crypto-js');
const reference = require('./reference_profile.json');

const DES_KEY = CryptoJS.enc.Utf8.parse('zbp30y86');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mapText(value) {
  return Object.entries(value || {}).map(([key, item]) => `${key}:${item}`).join(',');
}

function buildTelemetry(options = {}) {
  if (options.telemetry != null) return String(options.telemetry);
  const timestampMs = Number(options.timestampMs ?? Date.now());
  const timeOrigin = Number(options.timeOrigin ?? (timestampMs - 613.5));
  const mouse = options.mouse || {};
  const keyboard = options.keyboard || {};
  const page = { ulr: 1, ps: 1, ...(options.page || {}) };
  const state = { h: 0, f: 1, kr: 0, ...(options.state || {}) };
  const features = {
    ae: null,
    ak: null,
    cdr: null,
    bf: null,
    fi: null,
    ...(options.features || {}),
  };
  const bfText = features.bf == null
    ? 'null'
    : `{ar:${features.bf.ar},fr:${features.bf.fr}}`;
  return `{mt:{to:${timeOrigin}},m:{${mapText(mouse)}},k:{${mapText(keyboard)}},`
    + `p:{${mapText(page)}},st:{${mapText(state)}},`
    + `ft:{ae:${features.ae},ak:${features.ak},cdr:${features.cdr},bf:${bfText},fi:${features.fi}}}`;
}

function buildProfileFields(options = {}) {
  const profileReference = reference.webProfile;
  const fields = clone(profileReference.fields);
  const timestampMs = Number(options.timestampMs ?? Date.now());
  if (!Number.isSafeInteger(timestampMs) || timestampMs <= 0) {
    throw new TypeError('timestampMs must be a positive safe integer');
  }
  if (options.documentCookie == null) {
    throw new TypeError('documentCookie is required for Creator profileData');
  }

  fields.x44 = String(timestampMs);
  fields.x57 = String(options.documentCookie);
  fields.x84 = buildTelemetry({ ...options, timestampMs });
  if (options.location || options.referer) {
    fields.x66 = {
      ...fields.x66,
      location: String(options.location || fields.x66.location || ''),
      referer: String(options.referer || fields.x66.referer || ''),
    };
  }

  for (const [key, value] of Object.entries(options.fields || {})) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      throw new TypeError(`unsupported Creator webProfile field: ${key}`);
    }
    fields[key] = value;
  }
  return fields;
}

function encodeProfileData(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('profile fields must be an object');
  }
  const serialized = JSON.stringify(fields);
  const base64 = Buffer.from(serialized, 'utf8').toString('base64');
  const encrypted = CryptoJS.DES.encrypt(
    CryptoJS.enc.Latin1.parse(base64),
    DES_KEY,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.ZeroPadding },
  );
  return encrypted.ciphertext.toString(CryptoJS.enc.Hex);
}

function generateProfileData(options = {}) {
  return encodeProfileData(buildProfileFields(options));
}

function main() {
  const options = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  const profileData = generateProfileData(options);
  process.stdout.write(`${JSON.stringify({
    profileData,
    length: profileData.length,
    sdkVersion: reference.release.webProfileSdkVersion,
    algorithm: reference.webProfile.algorithm,
  })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildTelemetry,
  buildProfileFields,
  encodeProfileData,
  generateProfileData,
  main,
};
