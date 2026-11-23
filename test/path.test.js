import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectScreenPath,
  selectExplainPath,
  nextScreenFallback,
  nextExplainFallback,
  HYBRID,
  DIRECT,
  LOCAL,
  CLOUD,
} from '../src/path.js';

test('screen path prefers hybrid when Firebase is configured', () => {
  assert.equal(selectScreenPath({ firebaseConfigured: true, onDevice: 'unavailable' }), HYBRID);
});

test('screen path uses direct on-device without Firebase when the model is ready', () => {
  assert.equal(selectScreenPath({ firebaseConfigured: false, onDevice: 'available' }), DIRECT);
  assert.equal(selectScreenPath({ firebaseConfigured: false, onDevice: 'downloading' }), DIRECT);
});

test('screen path falls to local without Firebase and without a model', () => {
  assert.equal(selectScreenPath({ firebaseConfigured: false, onDevice: 'unavailable' }), LOCAL);
  assert.equal(selectScreenPath({ firebaseConfigured: false, onDevice: 'unknown' }), LOCAL);
  assert.equal(selectScreenPath({ firebaseConfigured: false, onDevice: 'downloadable' }), LOCAL);
});

test('screen fallback order is hybrid, direct, local', () => {
  assert.equal(nextScreenFallback(HYBRID), DIRECT);
  assert.equal(nextScreenFallback(DIRECT), LOCAL);
  assert.equal(nextScreenFallback(LOCAL), null);
});

test('explain path is cloud with Firebase, local without', () => {
  assert.equal(selectExplainPath({ firebaseConfigured: true }), CLOUD);
  assert.equal(selectExplainPath({ firebaseConfigured: false }), LOCAL);
});

test('explain fallback order is cloud, local', () => {
  assert.equal(nextExplainFallback(CLOUD), LOCAL);
  assert.equal(nextExplainFallback(LOCAL), null);
});
