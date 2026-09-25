import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { recordStartCue, assertStartCueDuration, assertPreparationTiming } from './start-cue-observation.mjs';

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

// A complete observable count-in, with Node-side reads intentionally delayed.
function countIn({ digits = [1000, 1000, 1000], round = 700, omit = null } = {}) {
  let now = 1000, cue = 'ROUND 1', phase = 'idle', nextFrame;
  const record = runInNewContext(`(${recordStartCue.toString()})()`, {
    performance: { now: () => now },
    document: { getElementById: () => ({ textContent: cue }) },
    window: {
      __littleCloud: { snapshot: () => ({ phase, event: { turn: phase === 'idle' ? 0 : 1, remaining: phase === 'idle' ? 15 : 14.99 } }) },
      testCamera: { clench: () => false },
    },
    requestAnimationFrame: callback => { nextFrame = callback; return 1; },
  });
  record.reacquiredAt = now;
  nextFrame();
  now += round; cue = '3'; nextFrame();
  const threeAt = now;
  // The old fixture reads performance.now in a separate RPC after seeing 3.
  now += 250;
  const delayedThreeAt = now;
  let transitionAt = threeAt;
  for (const [index, nextCue] of ['2', '1', 'START!'].entries()) {
    transitionAt += digits[index]; now = transitionAt; cue = nextCue;
    if (cue !== omit) nextFrame();
  }
  now += 300; cue = 'AIM'; phase = 'aim'; nextFrame();
  now += 500; // Even late reads retain preparation/first-aim boundary state.
  return { record: JSON.parse(JSON.stringify(record)), delayedThreeAt };
}

test('every count-in boundary survives a delayed digit RPC and late result read', () => {
  const { record, delayedThreeAt } = countIn();
  assertPreparationTiming(record);
  assertStartCueDuration(record);
  const lateOrigin = structuredClone(record);
  lateOrigin.cues[1].at = delayedThreeAt;
  assert.equal(lateOrigin.cues[2].at - delayedThreeAt, 750);
  assert.throws(() => assertPreparationTiming(lateOrigin), /2 follows.*750 ms/);
  for (const { state } of record.cues) {
    assert.equal(state.phase, 'idle');
    assert.equal(state.event.turn, 0);
    assert.equal(state.event.remaining, 15);
  }
  assert.equal(record.aim.state.event.remaining, 14.99);
});

for (const index of [0, 1, 2]) for (const duration of [700, 1400]) {
  test(`rejects digit ${3 - index} lasting ${duration} ms`, () => {
    const digits = [1000, 1000, 1000]; digits[index] = duration;
    assert.throws(() => assertPreparationTiming(countIn({ digits }).record), /follows its prior digit/);
  });
}
for (const round of [400, 1300]) {
  test(`retains the ROUND 1 bound at ${round} ms`, () => {
    assert.throws(() => assertPreparationTiming(countIn({ round }).record), /ROUND 1 precedes/);
  });
}
test('a skipped digit fails rather than supplying a nominal timestamp', () => {
  assert.throws(() => assertPreparationTiming(countIn({ omit: '2' }).record), /every cue in order/);
});
