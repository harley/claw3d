import test from 'node:test';
import assert from 'node:assert/strict';
import { Steering, menuScreenPoint, MENU_BOX } from '../src/steering.js';

test('steering seeds at the first update and starts at exactly zero', () => {
  const steer = new Steering();
  assert.deepEqual(steer.update({ x: .5, y: .5 }, 1000), { x: 0, z: 0 });
  assert.deepEqual(steer.neutral, { x: .5, y: .5 });
  let last;
  for (let t = 1033; t < 1400; t += 33) last = steer.update({ x: .62, y: .5 }, t);
  assert.ok(last.x > .5 && last.z === 0, `relative deflection follows the hand (${last.x})`);
  assert.equal(last.target, undefined, 'relative mode publishes no target');
});

test('release re-seeds on the next update and an explicit seed is respected', () => {
  const steer = new Steering();
  steer.update({ x: .5, y: .5 }, 1000); steer.update({ x: .6, y: .5 }, 1033);
  steer.release(); assert.equal(steer.neutral, null);
  assert.deepEqual(steer.update({ x: .6, y: .5 }, 1066), { x: 0, z: 0 }, 'no jump after a release');
  const seeded = new Steering(); seeded.seed({ x: .3, y: .4 });
  const first = seeded.update({ x: .3, y: .4 }, 1000);
  assert.deepEqual(first, { x: 0, z: 0 }); assert.deepEqual(seeded.neutral, { x: .3, y: .4 });
});

test('absolute mode publishes a bed target with the deflection', () => {
  const steer = new Steering({ mode: 'absolute' });
  steer.update({ x: .5, y: .5 }, 1000);
  let last; for (let t = 1033; t < 1300; t += 33) last = steer.update({ x: .59, y: .5 }, t);
  assert.ok(last.target && last.target.x > .3, `target moves right (${last.target?.x})`);
  assert.ok(last.x > .3);
});

test('menus and the glove share one frame-to-page mapping', () => {
  assert.deepEqual(menuScreenPoint({ x: MENU_BOX.left, y: MENU_BOX.top }, 1000, 500), { x: 0, y: 0 });
  assert.deepEqual(menuScreenPoint({ x: MENU_BOX.left + MENU_BOX.width, y: MENU_BOX.top + MENU_BOX.height }, 1000, 500), { x: 1000, y: 500 });
  assert.deepEqual(menuScreenPoint({ x: -1, y: 2 }, 1000, 500), { x: 0, y: 500 }, 'clamped');
});
