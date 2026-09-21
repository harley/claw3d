import test from 'node:test';
import assert from 'node:assert/strict';
import { handCameraGuide } from '../src/hand-camera-guide.js';

const feedback = { kind: 'tracking', controlEnabled: true, dropEnabled: true, hands: {
  left: { ready: true, grab: { stage: 'gripped', armed: true } },
  right: { ready: true, grab: { stage: 'seeking', armed: true } },
} };

test('missing roles invite open hands without claiming active control', () => {
  for (const role of ['left', 'right']) {
    const guide = handCameraGuide(role, { kind: 'lost', controlEnabled: true, hands: {} });
    assert.equal(guide.state, 'open'); assert.equal(guide.icon, 'palm');
  }
});
test('right readiness requires both acquired right and held left evidence', () => {
  assert.equal(handCameraGuide('right', feedback).label, 'RAISE');
  assert.equal(handCameraGuide('right', { ...feedback, dropEnabled: false }).state, 'inactive');
  assert.equal(handCameraGuide('right', { ...feedback, hands: {} }).state, 'open');
  assert.equal(handCameraGuide('right', { ...feedback, hands: { right: { ready: true, grab: { armed: false } } } }).icon, 'palm');
});
test('stale, blocked and reset evidence cannot leave ready windows lit', () => {
  for (const state of [null, { ...feedback, controlEnabled: false }, ...['delayed', 'blocked', 'off', 'error'].map(kind => ({ ...feedback, kind }))]) {
    for (const role of ['left', 'right']) assert.equal(handCameraGuide(role, state).state, 'inactive');
  }
});
test('guide bounds match sticky left travel and right local movement limits', () => {
  assert.deepEqual(handCameraGuide('left', feedback, { x: .25, y: .48 }).zone, { minX: .02, maxX: .48, minY: .02, maxY: .98 });
  const guide = handCameraGuide('right', feedback, { x: .75, y: .48 });
  for (const [key, value] of Object.entries({ minX: .57, maxX: .92, minY: .28, maxY: .68 })) assert.ok(Math.abs(guide.zone[key] - value) < 1e-9);
  const outside = handCameraGuide('right', { ...feedback, hands: { right: { outside: true } } }, { x: .75, y: .48 });
  assert.equal(outside.state, 'return'); assert.equal(outside.icon, 'palm'); assert.deepEqual(outside.zone, guide.zone);
});
