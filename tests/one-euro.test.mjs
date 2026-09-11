import test from 'node:test';
import assert from 'node:assert/strict';
import { OneEuroPoint } from '../src/one-euro.js';

test('a still hand with sensor jitter settles far below the raw noise', () => {
  const filter = new OneEuroPoint();
  let worst = 0, time = 1000;
  for (let i = 0; i < 60; i++) {
    const raw = .5 + (i % 2 ? .02 : -.02);
    const { x } = filter.filter({ x: raw, y: .5 }, time);
    if (i > 10) worst = Math.max(worst, Math.abs(x - .5));
    time += 33;
  }
  assert.ok(worst < .01, `jitter amplitude .02 leaked ${worst}`);
});

test('a fast deliberate move is tracked closely instead of lagging', () => {
  const filter = new OneEuroPoint();
  let time = 1000, value = 0;
  filter.filter({ x: .5, y: .5 }, time);
  for (let i = 1; i <= 6; i++) { time += 33; ({ x: value } = filter.filter({ x: .5 + i * .03, y: .5 }, time)); }
  assert.ok(Math.abs(value - .68) < .04, `lagged at ${value} while the hand reached .68`);
});

test('a long frame gap snaps to the new position instead of sweeping across', () => {
  const filter = new OneEuroPoint();
  filter.filter({ x: .2, y: .2 }, 1000);
  filter.filter({ x: .2, y: .2 }, 1033);
  const { x, y } = filter.filter({ x: .8, y: .7 }, 1500);
  assert.equal(x, .8); assert.equal(y, .7);
});
