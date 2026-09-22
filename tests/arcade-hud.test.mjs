import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTurnSeconds, nextTurnCue, missCopy, finaleHeadline } from '../src/arcade-hud.js';

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

test('miss copy names what the claw met', () => {
  const toys = [{ id: 'butter', name: 'Butter' }, { id: 'miso', name: 'Miso' }];
  assert.equal(missCopy({ reason: 'near' }, toys), 'SO CLOSE');
  assert.equal(missCopy({ reason: 'slipped', touched: { id: 'butter' } }, toys), 'SLIPPED OFF BUTTER');
  assert.equal(missCopy({ reason: 'crowded', touched: { id: 'butter' }, blocker: 'miso' }, toys), 'BUTTER STUCK BESIDE MISO');
  assert.equal(missCopy({ reason: 'blocked', blocker: 'miso' }, toys), 'BLOCKED BY MISO');
  assert.equal(missCopy({ reason: 'bumped', touched: { id: 'miso' } }, toys), 'BUMPED MISO');
  assert.equal(missCopy({ reason: 'platform' }, toys), 'STAR MOVED ON');
  assert.equal(missCopy({ reason: 'empty' }, toys), 'NOTHING THERE');
  assert.equal(missCopy(null, toys), 'NOTHING THERE');
});

test('the finale headline reads the run', () => {
  const points = { butter: 100, sprout: 200 };
  const miss = { prizeId: null, score: 0 }, butter = { prizeId: 'butter', score: 120 }, star = { prizeId: 'sprout', score: 230 };
  assert.equal(finaleHeadline([miss, miss, miss], 4, points), 'THE CLAW WINS THIS ONE');
  assert.equal(finaleHeadline([butter, miss, miss], 3, points), 'RUN COMPLETE');
  assert.equal(finaleHeadline([butter, star, miss], 2, points), 'JACKPOT RUN!');
  assert.equal(finaleHeadline([butter, butter, butter], 2, points), 'CLEAN SWEEP!');
  assert.equal(finaleHeadline([butter, miss, miss], 1, points), 'TOP OF THE BOARD!');
  assert.equal(finaleHeadline([miss, miss, miss], undefined, points), 'THE CLAW WINS THIS ONE', 'shared mode before the rank arrives');
});
