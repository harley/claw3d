import assert from 'node:assert/strict';

// Runs in the page before control reacquisition. Capture the entire count-in
// and first aim frame before Node/RPC work can shift any measured boundary.
export function recordStartCue() {
  const record = { cues: [], start: null, aim: null, frame: null };
  const sample = () => {
    const state = window.__littleCloud.snapshot();
    const at = performance.now();
    const cue = document.getElementById('status').textContent;
    if (['ROUND 1', '3', '2', '1', 'START!'].includes(cue) && record.cues.at(-1)?.cue !== cue) {
      record.cues.push({ cue, at, state });
    }
    if (!record.start && cue === 'START!') {
      record.start = { at, state, dropAccepted: window.testCamera.clench() };
    }
    if (record.start && state.phase === 'aim') {
      record.aim = { at, state };
      return;
    }
    record.frame = requestAnimationFrame(sample);
  };
  record.frame = requestAnimationFrame(sample);
  return record;
}

export function assertPreparationTiming({ cues, reacquiredAt }) {
  assert.deepEqual(cues.map(({ cue }) => cue), ['ROUND 1', '3', '2', '1', 'START!'],
    'the first count-in displays every cue in order');
  const roundDuration = cues[1].at - reacquiredAt;
  assert.ok(roundDuration >= 450 && roundDuration <= 1250,
    `ROUND 1 precedes 3 for about 0.7 s (${Math.round(roundDuration)} ms)`);
  for (let index = 2; index < cues.length; index++) {
    const duration = cues[index].at - cues[index - 1].at;
    assert.ok(duration >= 800 && duration <= 1350,
      `${cues[index].cue} follows its prior digit after about one second (${Math.round(duration)} ms)`);
  }
}

export function assertStartCueDuration({ start, aim }) {
  const duration = aim.at - start.at;
  assert.ok(duration >= 180 && duration <= 800,
    `START is a short cue before aim (${Math.round(duration)} ms)`);
}
