import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { recordStartCue, assertStartCueDuration } from './start-cue-observation.mjs';

// Drive the actual page recorder with deterministic rendered frames. Existing
// game journeys cover wiring; this regression isolates delayed test-side reads.
function scenario(duration) {
  let now = 0, cue = '1', phase = 'idle', nextFrame, drops = 0;
  const record = runInNewContext(`(${recordStartCue.toString()})()`, {
    performance: { now: () => now },
    document: { getElementById: () => ({ textContent: cue }) },
    window: {
      __littleCloud: { snapshot: () => ({ phase, event: { remaining: phase === 'idle' ? 15 : 14.99 } }) },
      testCamera: { clench: () => { drops++; return false; } },
    },
    requestAnimationFrame: callback => { nextFrame = callback; return 1; },
  });
  nextFrame();
  now = 1000; cue = 'START!'; nextFrame();
  // The old fixture took its origin only after these awaited browser calls.
  now += Math.min(160, duration - 1);
  const legacyStartAt = now;
  now = 1000 + duration; cue = 'AIM'; phase = 'aim'; nextFrame();
  // Reading the result late must not change captured timestamps or state.
  now += 500;
  return { record, legacyDuration: record.aim.at - legacyStartAt, drops };
}

test('valid START survives intervening RPC delay that failed the old measurement', () => {
  const { record, legacyDuration, drops } = scenario(300);
  assert.equal(legacyDuration, 140);
  assert.throws(() => assertStartCueDuration({ start: { at: 0 }, aim: { at: legacyDuration } }), /short cue/);
  assertStartCueDuration(record);
  assert.equal(record.aim.at - record.start.at, 300);
  assert.equal(record.start.state.phase, 'idle');
  assert.equal(record.start.state.event.remaining, 15);
  assert.equal(record.start.dropAccepted, false);
  assert.equal(record.aim.state.phase, 'aim');
  assert.equal(record.aim.state.event.remaining, 14.99);
  assert.equal(drops, 1);
});

for (const duration of [100, 900]) {
  test(`rejects an observable ${duration} ms START despite delayed reads`, () => {
    assert.throws(() => assertStartCueDuration(scenario(duration).record), /short cue/);
  });
}
