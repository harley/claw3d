import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController } from '../src/vision.js';

// Contract: camera FPS follows quality without requiring 60 FPS, replacing the
// stream, or letting late constraint changes affect a replacement camera.
// Existing vision tests cover frame dropping; these cover track lifecycle and
// negotiation using API fakes, without assuming a browser's chosen resolution.
function fixture(t, { actualFps = 30, apply = true, settings = true } = {}) {
  const saved = new Map(['navigator', 'document', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let constraints = { width: { ideal: 960 }, height: { ideal: 540 }, deviceId: { exact: 'chosen' } };
  let negotiated = { frameRate: actualFps, width: 960, height: 540, deviceId: 'chosen' };
  const requests = [], changes = [], diagnostics = [];
  let stopped = 0;
  const track = {
    addEventListener() {}, stop() { stopped++; },
    getConstraints: () => constraints,
    ...(settings ? { getSettings: () => negotiated } : {}),
    ...(apply ? { async applyConstraints(next) {
      changes.push(next); constraints = next;
      negotiated = { ...negotiated, frameRate: Math.min(actualFps, next.frameRate.max) };
    } } : {}),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const mediaDevices = { addEventListener() {}, async getUserMedia(request) { requests.push(request); return stream; } };
  for (const [key, value] of Object.entries({ navigator: { mediaDevices }, document: { addEventListener() {}, hidden: false }, location: { search: '', origin: 'http://camera.test' } })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const c = new HandController({
    video: { async play() {}, srcObject: null }, overlay: { getContext: () => ({ clearRect() {} }) },
    select: { value: 'chosen', addEventListener() {} }, onState() {}, onInput() {},
    onDiagnostic: next => diagnostics.push(next),
  });
  c.initializeWorker = async () => { c.worker = { terminate() {} }; c.delegate = 'CPU'; };
  c.listCameras = async () => {};
  t.after(() => {
    c.stop(false);
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { c, track, stream, mediaDevices, requests, changes, diagnostics, stopped: () => stopped,
    diagnostic: () => Object.assign({}, ...diagnostics) };
}

for (const [mode, fps] of [['full', 60], ['simple', 30]]) {
  test(`${mode} startup requests up to ${fps} FPS and reports an actual 30 FPS webcam`, async t => {
    const f = fixture(t);
    f.c.setPerformanceMode(mode);
    await f.c.start();
    assert.deepEqual(f.requests[0].video, { width: { ideal: 960 }, height: { ideal: 540 },
      frameRate: { ideal: fps, max: fps }, deviceId: { exact: 'chosen' } });
    assert.equal(f.c.running, true);
    assert.deepEqual(f.diagnostic(), { requestedFps: fps, cameraFps: 30, cameraWidth: 960, cameraHeight: 540,
      fpsConstraintStatus: 'initial', delegate: 'CPU', driver: 'timer', captureWidth: mode === 'simple' ? 320 : 640 });
    assert.equal(f.changes.length, 0, 'no redundant applyConstraints during ordinary startup');
  });
}

test('live quality changes retain the stream and its other constraints; repeated mode is a no-op', async t => {
  const f = fixture(t, { actualFps: 60 });
  await f.c.start();
  for (const [mode, fps] of [['simple', 30], ['full', 60]]) {
    f.c.setPerformanceMode(mode); await f.c.fpsUpdate;
    assert.deepEqual(f.changes.at(-1), { width: { ideal: 960 }, height: { ideal: 540 },
      deviceId: { exact: 'chosen' }, frameRate: { ideal: fps, max: fps } });
    assert.equal(f.diagnostic().cameraFps, fps);
    assert.equal(f.diagnostic().requestedFps, fps);
    assert.equal(f.diagnostic().fpsConstraintStatus, 'applied');
    assert.equal(f.c.video.srcObject, f.stream);
    assert.equal(f.c.setPerformanceMode(mode), false);
  }
  assert.equal(f.requests.length, 1); assert.equal(f.changes.length, 2); assert.equal(f.stopped(), 0);
});

for (const outcome of ['rejected', 'throw', 'unsupported', 'missing settings']) {
  test(`${outcome} FPS support cannot stop a live camera`, async t => {
    const f = fixture(t, { apply: outcome !== 'unsupported', settings: outcome !== 'missing settings' });
    if (outcome === 'rejected') f.track.applyConstraints = () => Promise.reject(new Error('OverconstrainedError'));
    if (outcome === 'throw') f.track.applyConstraints = () => { throw new Error('Not supported'); };
    await f.c.start();
    f.c.setPerformanceMode('simple'); await f.c.fpsUpdate;
    assert.equal(f.c.running, true); assert.equal(f.c.video.srcObject, f.stream); assert.equal(f.stopped(), 0);
    assert.equal(f.diagnostic().fpsConstraintStatus, outcome === 'unsupported' ? 'unsupported' : outcome === 'missing settings' ? 'applied' : 'failed');
    assert.equal(f.diagnostic().cameraFps, outcome === 'missing settings' ? null : 30);
    if (outcome === 'missing settings') {
      assert.equal(f.diagnostic().cameraWidth, null); assert.equal(f.diagnostic().cameraHeight, null);
    }
  });
}

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('a mode selected while camera permission is pending applies to the acquired track', async t => {
  const f = fixture(t, { actualFps: 60 }), permission = deferred();
  f.mediaDevices.getUserMedia = () => permission.promise;
  const startup = f.c.start();
  f.c.setPerformanceMode('simple'); permission.resolve(f.stream);
  await startup; await f.c.fpsUpdate;
  assert.equal(f.diagnostic().cameraFps, 30); assert.equal(f.c.captureWidth, 320);
});

test('rapid mode changes serialize and converge on the latest target', async t => {
  const f = fixture(t, { actualFps: 60 }), pending = deferred();
  await f.c.start();
  const apply = f.track.applyConstraints;
  let calls = 0;
  f.track.applyConstraints = async next => { if (++calls === 1) await pending.promise; await apply(next); };
  f.c.setPerformanceMode('simple'); await Promise.resolve();
  f.c.setPerformanceMode('full'); f.c.setPerformanceMode('simple'); f.c.setPerformanceMode('full');
  assert.equal(calls, 1, 'never overlap constraint operations');
  pending.resolve(); await f.c.fpsUpdate;
  assert.deepEqual(f.changes.map(change => change.frameRate.max), [30, 60]);
  assert.equal(f.diagnostic().cameraFps, 60);
});

test('a late FPS operation cannot change diagnostics or constrain the next camera', async t => {
  const f = fixture(t), pending = deferred();
  await f.c.start();
  f.track.applyConstraints = () => pending.promise;
  f.c.setPerformanceMode('simple'); const oldUpdate = f.c.fpsUpdate; await Promise.resolve();
  await f.c.start();
  const count = f.diagnostics.length;
  pending.resolve(); await oldUpdate;
  assert.equal(f.diagnostics.length, count);
  assert.equal(f.diagnostic().fpsConstraintStatus, 'initial');
  assert.equal(f.c.fpsUpdate, null); assert.equal(f.c.running, true);
});
