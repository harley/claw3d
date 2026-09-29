import test from 'node:test';
import assert from 'node:assert/strict';
import { trackingHealth, trackingSample } from '../src/tracking-health.js';
// Contract: slow delivery and missing hands are distinct. Existing governor tests
// check quality changes, not operator health wording or accepted-only rates.
test('fresh rate excludes rejected results and keeps analyzer age semantics', () => {
  const sample = trackingSample({ results: 12, rejected: { 'over age': 8 }, captureToReceiptP95Ms: 410 }, 5000);
  assert.deepEqual(sample, { freshHz: 2.4, rejectRate: .4, ageP95: 410 });
  assert.equal(trackingHealth(sample, { kind: 'tracking' }), 'Tracking slow');
  assert.equal(trackingSample(null, 5000), null);
});
test('empty but fresh detections do not imply a performance failure', () => {
  const sample = { freshHz: 12, rejectRate: 0 };
  assert.equal(trackingHealth(sample, { kind: 'ready' }), 'Waiting for hand');
  assert.equal(trackingHealth(sample, { kind: 'tracking' }), 'Tracking ready');
  assert.equal(trackingHealth(sample, { kind: 'delayed' }), 'Tracking delayed');
  assert.equal(trackingHealth(sample, { kind: 'error' }), 'Tracking unavailable');
  assert.equal(trackingHealth(sample, { kind: 'off' }), 'Tracking off');
  assert.equal(trackingHealth(null, { kind: 'tracking' }), 'Measuring tracking');
  assert.equal(trackingHealth({ freshHz: 0, rejectRate: 0 }, { kind: 'ready' }), 'Tracking slow');
});
