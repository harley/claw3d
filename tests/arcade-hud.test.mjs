import test from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_TURN_SECONDS, nextTurnCue } from '../src/arcade-hud.js';

test('next turns announce the round and a one-second 3, 2, 1 countdown before START', () => {
  assert.equal(NEXT_TURN_SECONDS, 4.7);
  for (const [elapsed, cue] of [[0, 'ROUND 2'], [.999, 'ROUND 2'], [1, '3'], [1.999, '3'], [2, '2'], [3, '1'], [4, 'START!'], [4.699, 'START!']]) {
    assert.equal(nextTurnCue(elapsed, 2), cue);
  }
});
