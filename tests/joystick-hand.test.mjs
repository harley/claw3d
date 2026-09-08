import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { JoystickHand } from '../src/joystick-hand.js';

test('glove only claims steering while aiming with current control permission', () => {
  const hand = new JoystickHand(new T.Group());
  const tracking = { kind: 'tracking', controlEnabled: true };
  hand.update('aim', 0, 1 / 60, tracking, true);
  assert.equal(hand.root.visible, true);
  assert.equal(hand.grip, 1);
  for (const [phase, feedback] of [
    ['idle', tracking], ['aim', { kind: 'calibrating', progress: .5, controlEnabled: true }], ['deliver', tracking], ['aim', { ...tracking, controlEnabled: false }],
    ['aim', { kind: 'lost', controlEnabled: true }], ['aim', { kind: 'off' }],
    ['anticipate', { kind: 'blocked' }], ['anticipate', { kind: 'off' }],
  ]) {
    hand.update(phase, 0, 1 / 60, feedback, true);
    assert.equal(hand.root.visible, false);
    assert.equal(hand.grip, 0);
  }
});

test('hold progress cancels on renewed steering and accepted feedback survives camera loss', () => {
  const hand = new JoystickHand(new T.Group());
  hand.update('aim', 0, 1 / 60, { kind: 'clenching', controlEnabled: true, progress: .5 }, true);
  assert.equal(hand.progress, .5);
  assert.ok(hand.halo.geometry.drawRange.count < hand.haloCount);
  hand.update('aim', 0, 1 / 60, { kind: 'tracking', controlEnabled: true }, true);
  assert.equal(hand.progress, 0);
  assert.equal(hand.halo.geometry.drawRange.count, hand.haloCount);
  hand.update('anticipate', .1, 1 / 60, { kind: 'lost' }, true);
  assert.equal(hand.mode, 'accepted');
  assert.equal(hand.root.visible, true);
  hand.update('descend', 0, 1 / 60, { kind: 'tracking', controlEnabled: false }, true);
  assert.equal(hand.root.visible, false);
});
