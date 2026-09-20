import test from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_TURN_SECONDS, nextTurnCue } from '../src/arcade-hud.js';

test('next turns keep every cue while returning control in under four seconds', () => {
  assert.equal(NEXT_TURN_SECONDS, 3.7);
  for (const [elapsed, cue] of [[0, 'ROUND 2'], [.899, 'ROUND 2'], [.9, '3'], [1.599, '3'], [1.6, '2'], [2.3, '1'], [3, 'START!'], [3.699, 'START!']]) {
    assert.equal(nextTurnCue(elapsed, 2), cue);
  }
});
