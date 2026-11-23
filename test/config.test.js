import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFirebaseConfig,
  normalizeFirebaseConfig,
  DEFAULT_CLOUD_MODEL,
} from '../src/config.js';

const FULL = {
  apiKey: 'key',
  authDomain: 'proj.firebaseapp.com',
  projectId: 'proj',
  appId: '1:2:3',
};

test('validate accepts a complete config', () => {
  assert.deepEqual(validateFirebaseConfig(FULL), { ok: true, missing: [] });
});

test('validate lists every missing field', () => {
  const check = validateFirebaseConfig({ apiKey: 'key' });
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ['authDomain', 'projectId', 'appId']);
});

test('validate rejects a missing config', () => {
  assert.equal(validateFirebaseConfig(null).ok, false);
  assert.equal(validateFirebaseConfig(undefined).ok, false);
});

test('validate rejects blank values', () => {
  assert.equal(validateFirebaseConfig({ ...FULL, apiKey: '  ' }).ok, false);
});

test('normalize fills the default cloud model', () => {
  const config = normalizeFirebaseConfig(FULL);
  assert.equal(config.model, DEFAULT_CLOUD_MODEL);
  assert.equal(config.appCheckSiteKey, '');
  assert.equal(config.appCheckDebug, false);
});

test('normalize keeps an explicit model and App Check settings', () => {
  const config = normalizeFirebaseConfig({
    ...FULL,
    model: 'gemini-2.0-flash',
    appCheckSiteKey: 'site-key',
    appCheckDebug: true,
  });
  assert.equal(config.model, 'gemini-2.0-flash');
  assert.equal(config.appCheckSiteKey, 'site-key');
  assert.equal(config.appCheckDebug, true);
});
