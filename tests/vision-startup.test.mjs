import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController } from '../src/vision.js';

// The observable contract is one bounded replacement of an unanswered
// GPU frame (including a previously responsive worker), retaining the camera.
// Existing vision tests cover late results and terminal silence, but cannot
// exercise worker replacement/cancellation races.
function fixture(t) {
  const saved = new Map(['Worker', 'location', 'document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const workers = [], states = [], diagnostics = [];
  class Worker {
    constructor() { this.messages = []; this.terminated = 0; workers.push(this); }
    postMessage(data) { this.messages.push(data); }
    terminate() { this.terminated++; }
    reply(data) { this.onmessage({ data }); }
  }
  Object.assign(globalThis, { Worker, location: { origin: 'http://camera.test' }, document: { hidden: false },
    createImageBitmap: async () => ({ close() {} }) });
  let stopped = 0, handled = 0, configured = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const c = Object.create(HandController.prototype);
  Object.assign(c, { running: true, starting: false, generation: 2, delegate: 'GPU', busy: true,
    lastResult: 1000, lastActivity: 1000, lastSent: 1000, lastSupervise: 1000,
    video: { srcObject: stream, readyState: 2, currentTime: 1, videoWidth: 640, videoHeight: 480 }, stream,
    overlay: { getContext: () => ({ clearRect() {} }) },
    onInput: () => {}, onState: state => states.push(state), onDiagnostic: data => diagnostics.push(data),
    configureCapture() { configured++; this.captureDriver = 'timer'; }, handle: () => handled++,
  });
  c.resetOwner(); c.worker = new Worker(); c.bindWorker?.(c.generation);
  t.after(() => c.stop(false));
  const silence = (from, to) => { for (let now = from; now <= to && c.running; now += 65) c.supervise(now); };
  return { c, workers, states, diagnostics, stream, silence, read: () => ({ stopped, handled, configured }) };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

for (const outcome of ['resolved', 'rejected']) {
  test(`a ${outcome} capture belonging to the retired worker cannot affect its replacement`, async t => {
    const f = fixture(t), { c } = f;
    let resolve, reject, closed = 0;
    globalThis.createImageBitmap = () => new Promise((yes, no) => { resolve = yes; reject = no; });
    c.busy = false;
    const capture = c.frame(1065);
    f.silence(1130, 8150);
    assert.equal(f.workers.length, 2);
    if (outcome === 'resolved') resolve({ close: () => closed++ }); else reject(new Error('retired capture'));
    await capture;
    assert.equal(closed, outcome === 'resolved' ? 1 : 0);
    assert.equal(f.workers[1].messages.length, 1, 'only init, no old image sent');
    assert.equal(c.running, true);
    assert.equal(c.recovering, true);
  });
}

for (const proven of [false, true]) test(`${proven ? 'Previously responsive' : 'First-frame'} GPU silence replaces the worker once, retains the camera and accepts only a fresh CPU result`, async t => {
  const f = fixture(t), { c, workers, stream } = f;
  const old = c.worker;
  if (proven) {
    old.reply({ type: 'result', result: {}, now: performance.now() });
    assert.equal(c.receivedResult, true);
    c.busy = true; // The next frame is sent but never receives a reply.
  }
  c.fist.armed = true; c.fist.held = 400;
  f.silence(1065, 7955);
  assert.equal(workers.length, 1, 'original seven-second deadline is preserved');
  c.supervise(8065);
  assert.equal(workers.length, 2);
  assert.equal(old.terminated, 1);
  assert.equal(c.recovering, true);
  assert.equal(c.video.srcObject, stream);
  assert.equal(f.read().stopped, 0);
  assert.equal(c.fist.held, 0);
  assert.deepEqual(workers[1].messages, [{ type: 'init', base: 'http://camera.test', maxHands: undefined, delegate: 'CPU' }]);
  old.reply({ type: 'result', result: {}, now: 8065 });
  assert.equal(c.busy, true, 'old queued reply must not release the replacement latch');
  assert.equal(f.read().handled, proven ? 1 : 0);
  old.onerror(); assert.equal(c.running, true);
  f.silence(8130, 20000);
  assert.equal(workers.length, 2, 'no replacement loop during initialization');
  workers[1].reply({ type: 'ready', delegate: 'CPU' }); await settle();
  assert.equal(c.recovering, false);
  assert.equal(c.busy, false);
  assert.equal(f.read().configured, 1);
  await c.frame(performance.now());
  const capture = workers[1].messages.at(-1);
  assert.equal(capture.type, 'frame');
  assert.ok(capture.bitmap, 'replacement captures a new image, never replays the stale transferred frame');
  workers[1].reply({ type: 'result', result: {}, now: capture.now });
  assert.equal(f.read().handled, proven ? 2 : 1);
  assert.equal(c.receivedResult, true);
  assert.equal(c.video.srcObject, stream);
  Object.assign(c, { busy: true, lastSent: 30000, lastSupervise: 30000 });
  f.silence(30065, 37150);
  assert.equal(c.running, false, 'CPU silence remains terminal');
  assert.equal(workers.length, 2);
  assert.equal(f.states.at(-1).code, 'worker_timeout');
});

test('replacement initialization has a finite deadline even if it sends progress', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  f.silence(1065, 8085);
  assert.equal(f.workers.length, 2);
  f.workers[1].reply({ type: 'progress' });
  t.mock.timers.tick(25000);
  return settle().then(() => {
    assert.equal(f.c.running, false);
    assert.equal(f.c.video.srcObject, null);
    assert.equal(f.states.at(-1).code, 'worker_timeout');
    assert.equal(f.workers[1].terminated, 1);
  });
});

test('stopping during replacement cancels initialization and ignores its late ready', async t => {
  const f = fixture(t);
  f.silence(1065, 8085);
  const replacement = f.workers[1];
  f.c.stop(false);
  replacement.reply({ type: 'ready', delegate: 'CPU' }); await settle();
  assert.equal(f.c.worker, null);
  assert.equal(f.c.video.srcObject, null);
  assert.equal(f.read().configured, 0);
  assert.equal(f.states.some(state => state.kind === 'error'), false, 'intentional stop is not a failure');
  assert.equal(replacement.terminated, 1);
});

for (const reason of ['CPU', 'already recovered GPU', 'main thread']) {
  test(`${reason} silence is terminal without another replacement`, t => {
    const f = fixture(t);
    if (reason === 'CPU') f.c.delegate = 'CPU';
    if (reason === 'already recovered GPU') f.c.workerRecoveryUsed = true;
    if (reason === 'main thread') f.c.worker.local = true;
    f.silence(1065, 8085);
    assert.equal(f.c.running, false);
    assert.equal(f.workers.length, 1);
    assert.equal(f.states.at(-1).code, 'worker_timeout');
  });
}

for (const type of ['error', 'main_thread_required']) {
  test(`replacement ${type} is terminal, never another GPU or main-thread attempt`, async t => {
    const f = fixture(t);
    f.silence(1065, 8085);
    f.workers[1].reply({ type }); await settle();
    assert.equal(f.c.running, false);
    assert.equal(f.workers.length, 2);
    assert.equal(f.states.at(-1).code, 'worker_timeout');
  });
}
