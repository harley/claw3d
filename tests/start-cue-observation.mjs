import assert from 'node:assert/strict';

// Runs in the page before control reacquisition. Capture both observable frame
// boundaries and their state without allowing intervening Node/RPC work to
// shorten the cue or consume the first aim frame's clock.
export function recordStartCue() {
  const record = { start: null, aim: null, frame: null };
  const sample = () => {
    const state = window.__littleCloud.snapshot();
    const at = performance.now();
    if (!record.start && document.getElementById('status').textContent === 'START!') {
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

export function assertStartCueDuration({ start, aim }) {
  const duration = aim.at - start.at;
  assert.ok(duration >= 180 && duration <= 800,
    `START is a short cue before aim (${Math.round(duration)} ms)`);
}
