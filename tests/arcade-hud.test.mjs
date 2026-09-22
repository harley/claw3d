import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTurnSeconds, nextTurnCue } from '../src/arcade-hud.js';

test('after a catch the next round keeps every cue and returns control in 2.5 s', () => {
  assert.equal(nextTurnSeconds(true), 2.5);
  for (const [elapsed, cue] of [[0, 'ROUND 2'], [.699, 'ROUND 2'], [.7, '3'], [1.199, '3'], [1.2, '2'], [1.7, '1'], [2.2, 'START!'], [2.499, 'START!']]) {
    assert.equal(nextTurnCue(elapsed, 2, true), cue);
  }
});

test('after a miss the next round names the outcome and starts within 1.2 s', () => {
  assert.equal(nextTurnSeconds(false), 1.2);
  for (const [elapsed, cue] of [[0, 'MISSED'], [.599, 'MISSED'], [.6, 'START!'], [1.199, 'START!']]) {
    assert.equal(nextTurnCue(elapsed, 3, false), cue);
  }
});
