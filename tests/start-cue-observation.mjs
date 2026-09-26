import assert from 'node:assert/strict';

// Runs in the page before control reacquisition. Capture the entire count-in
// and first aim frame before Node/RPC work can shift any measured boundary.
export function recordStartCue() {
  const record = { cues: [], start: null, aim: null, frame: null,
    diagnostics: { frames: 0, maxGapMs: 0, gapsOver100ms: 0, snapshots: 0, maxSnapshotMs: 0 } };
  let previousAt;
  const sample = () => {
    // Timestamp observation before diagnostic work can move the boundary.
    const at = performance.now();
    const cue = document.getElementById('status').textContent;
    const gap = previousAt === undefined ? 0 : at - previousAt;
    previousAt = at;
    record.diagnostics.frames++;
    record.diagnostics.maxGapMs = Math.max(record.diagnostics.maxGapMs, gap);
    if (gap > 100) record.diagnostics.gapsOver100ms++;
    const changed = ['ROUND 1', '3', '2', '1', 'START!'].includes(cue) && record.cues.at(-1)?.cue !== cue;
    const aiming = record.start && document.getElementById('arcade').dataset.phase === 'aim';
    if (changed || aiming) {
      // Full snapshots sort frame history and build scene diagnostics. Only
      // cue/aim boundaries need that state, not every rendered frame.
      const beforeSnapshot = performance.now(), state = window.__littleCloud.snapshot();
      record.diagnostics.snapshots++;
      record.diagnostics.maxSnapshotMs = Math.max(record.diagnostics.maxSnapshotMs, performance.now() - beforeSnapshot);
      if (changed) record.cues.push({ cue, at, state });
      if (!record.start && cue === 'START!') record.start = { at, state, dropAccepted: window.testCamera.clench() };
      if (aiming) { record.aim = { at, state }; return; }
    }
    record.frame = requestAnimationFrame(sample);
  };
  record.frame = requestAnimationFrame(sample);
  return record;
}

function timingEvidence({ diagnostics, cues }) {
  return JSON.stringify({ ...diagnostics, cues: cues?.map(({ cue, at, state }) => ({ cue, at,
    elapsed: state.event.firstTurnPreparationElapsed, ready: state.event.firstTurnControlReady })) });
}

export function assertPreparationTiming(record) {
  const { cues, reacquiredAt } = record;
  assert.deepEqual(cues.map(({ cue }) => cue), ['ROUND 1', '3', '2', '1', 'START!'],
    'the first count-in displays every cue in order');
  const roundDuration = cues[1].at - reacquiredAt;
  assert.ok(roundDuration >= 450 && roundDuration <= 1250,
    `ROUND 1 precedes 3 for about 0.7 s (${Math.round(roundDuration)} ms); ${timingEvidence(record)}`);
  for (let index = 2; index < cues.length; index++) {
    const duration = cues[index].at - cues[index - 1].at;
    assert.ok(duration >= 800 && duration <= 1350,
      `${cues[index].cue} follows its prior digit after about one second (${Math.round(duration)} ms); ${timingEvidence(record)}`);
  }
}

export function assertStartCueDuration({ start, aim }) {
  const duration = aim.at - start.at;
  assert.ok(duration >= 180 && duration <= 800,
    `START is a short cue before aim (${Math.round(duration)} ms)`);
}
