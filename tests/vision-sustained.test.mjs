import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController, CAPTURE_MAX_AGE } from '../src/vision.js';

// Contract: ordered but continuously late replies cannot leave a live camera
// unusable forever. Existing silence tests only cover unanswered requests;
// these exercise compact capture, bounded replacement and stale-input safety.
function fixture(t, { local = false, delegate = 'GPU' } = {}) {
  const saved = new Map(['Worker', 'location', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, value] of saved) {
    if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];
  } });
  const workers = [], states = [], diagnostics = [], constraints = [];
  class Worker {
    constructor() { this.messages = []; this.terminated = 0; workers.push(this); }
    postMessage(data) { this.messages.push(data); }
    terminate() { this.terminated++; }
    reply(data) { this.onmessage({ data }); }
  }
  Object.assign(globalThis, { Worker, location: { origin: 'http://camera.test' }, document: { hidden: false } });
  let stopped = 0, handled = 0, cancelled = 0;
  const track = { stop: () => stopped++, getSettings: () => ({ frameRate: 30, width: 960, height: 540 }),
    getConstraints: () => ({ width: { ideal: 960 }, height: { ideal: 540 } }),
    applyConstraints: async next => { constraints.push(next); } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const c = Object.create(HandController.prototype);
  Object.assign(c, { running: true, starting: false, generation: 2, delegate, busy: false,
    performanceMode: 'full', captureWidth: 0, captureDriver: 'stream', workerRecoveryUsed: false,
    lastResult: 1000, lastCapture: 1000, lastResponseCapture: 1000, lastActivity: 1000,
    video: { srcObject: stream, readyState: 2, currentTime: 1, videoWidth: 960, videoHeight: 540 }, stream,
    overlay: { getContext: () => ({ clearRect() {} }) },
    onInput: () => {}, onState: next => states.push(next), onDiagnostic: next => diagnostics.push(next),
    handle: () => handled++, frameReader: { cancel: async () => { cancelled++; } },
  });
  c.resetOwner(); c.worker = new Worker(); c.worker.local = local; c.bindWorker(c.generation);
  t.after(() => c.stop(false));
  let captured = 1000;
  const late = (count = 4) => { for (let i = 0; i < count; i++) {
    captured += 600;
    assert.equal(c.acceptResult({}, captured, c.generation, captured + 600), false);
  } };
  const fresh = () => { captured += 65; return c.acceptResult({}, captured, c.generation, captured + 20); };
  return { c, workers, states, diagnostics, constraints, stream, late, fresh,
    read: () => ({ stopped, handled, cancelled }) };
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('sustained late replies compact the capture path and FPS without accepting stale steering', async t => {
  const f = fixture(t), { c } = f;
  c.fist.armed = true; c.fist.held = 400;
  f.late(); await settle();
  assert.equal(CAPTURE_MAX_AGE, 300);
  assert.equal(c.fist.held, 0);
  assert.equal(c.latencyLimited, true);
  assert.equal(c.captureWidth, 320);
  assert.equal(c.captureDriver, 'timer');
  assert.equal(f.read().cancelled, 1, 'old stream reader is retired');
  assert.equal(c.requestedFps, 30);
  assert.equal(f.constraints.at(-1).frameRate.max, 30);
  assert.equal(f.read().handled, 0);
  assert.equal(f.read().stopped, 0);
  assert.equal(f.workers.length, 1);
  assert.equal(c.video.srcObject, f.stream);
  assert.equal(f.diagnostics.filter(d => d.latencyRecovery === 'compact_capture').length, 1);
  assert.equal(f.fresh(), true, 'fresh detections may regain control');
  c.setPerformanceMode('full'); await settle();
  assert.equal(c.captureWidth, 320, 'the measured slow session retains its smaller capture');
  assert.equal(c.requestedFps, 30);
  assert.equal(c.lateSamples, 0);
});

test('a slow GPU gets one CPU replacement on the same camera; persistently late CPU input becomes actionable error', async t => {
  const f = fixture(t), { c, workers } = f;
  f.late(); f.late();
  assert.equal(c.recovering, true);
  assert.equal(workers.length, 2);
  assert.equal(workers[0].terminated, 1);
  assert.equal(workers[1].messages[0].delegate, 'CPU');
  assert.equal(f.read().stopped, 0);
  workers[1].reply({ type: 'ready', delegate: 'CPU' }); await settle();
  assert.equal(c.recovering, false);
  assert.equal(c.workerRecoveryUsed, true);
  assert.equal(c.video.srcObject, f.stream);
  f.late();
  assert.equal(c.running, false);
  assert.equal(f.states.at(-1).code, 'tracking_too_slow');
  assert.equal(workers.length, 2, 'no repeated replacement loop');
  assert.equal(f.read().stopped, 1);
  assert.equal(f.read().handled, 0, 'no late result controlled the game');
});

test('WebKit replacement explicitly requests CPU and ignores the retired local runtime', async t => {
  const f = fixture(t, { local: true }), { c } = f;
  let requested;
  const cpu = { local: true, delegate: 'CPU', postMessage() {}, terminate() {} };
  c.createMainThreadVision = async (_base, delegate) => { requested = delegate; return cpu; };
  const old = c.worker;
  f.late(); f.late(); await settle();
  assert.equal(requested, 'CPU');
  assert.equal(c.worker, cpu);
  assert.equal(c.delegate, 'CPU');
  assert.equal(old.terminated, 1);
  old.reply({ type: 'result', result: {}, now: performance.now() });
  assert.equal(f.read().handled, 0);
  assert.equal(f.read().stopped, 0);
  assert.equal(f.fresh(), true);
});

for (const outcome of ['timeout', 'stop', 'switch']) test(`pending local CPU recovery is bounded on ${outcome} and disposes its late runtime`, async t => {
  const f = fixture(t, { local: true }), { c } = f;
  const originalTimeout = globalThis.setTimeout;
  t.after(() => { globalThis.setTimeout = originalTimeout; });
  let deadline, resolveCpu, disposed = 0;
  globalThis.setTimeout = (callback, ms) => { assert.equal(ms, 25000); deadline = callback; return 0; };
  c.createMainThreadVision = () => new Promise(resolve => { resolveCpu = resolve; });
  const recovery = c.recoverWorker();
  assert.equal(c.recovering, true);
  assert.equal(f.read().stopped, 0);
  if (outcome === 'timeout') deadline(); else c.stop(false);
  if (outcome === 'switch') { c.worker = new f.workers[0].constructor(); c.generation++; }
  await recovery;
  const newerWorker = c.worker;
  resolveCpu({ delegate: 'CPU', terminate: () => disposed++ }); await settle();
  assert.equal(disposed, 1);
  assert.equal(c.worker, newerWorker);
  assert.equal(c.running, false);
  if (outcome === 'timeout') assert.equal(f.states.at(-1).code, 'worker_timeout');
  else assert.equal(f.states.some(state => state.kind === 'error'), false);
});

test('sporadic late frames, hidden/out-of-order samples and camera stop do not trigger recovery', async t => {
  const f = fixture(t), { c } = f;
  for (let i = 0; i < 60; i++) { f.late(1); assert.equal(f.fresh(), true); }
  assert.equal(c.latencyLimited, undefined);
  assert.equal(f.workers.length, 1);
  c.acceptResult({}, 1000, c.generation, 60000);
  assert.equal(c.lateSamples, 0);
  c.stop(false);
  assert.equal(c.acceptResult({}, 70000, c.generation, 70600), false);
  assert.equal(f.workers.length, 1);
});
