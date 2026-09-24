import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController } from '../src/vision.js';
import { firstTurnControlReady, resolvePlayMode } from '../src/play-mode.js';
import { firstTurnWaitingMessage } from '../src/arcade-hud.js';

function hand(x, side = 'Left', gesture = 'Open_Palm') {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 1 - x, y: .5, z: 0 }));
  landmarks[0].y = .56; landmarks[9].y = .44;
  landmarks[5].x -= .06; landmarks[17].x += .06;
  return { landmarks, side, gesture };
}

function ambiguousHand(x, side = 'Left') {
  const value = hand(x, side, 'None'), landmarks = value.landmarks;
  landmarks[9] = { ...landmarks[0] };
  landmarks[17] = { ...landmarks[5] };
  return value;
}

function fixture() {
  let phase = 'blocked', starts = 0, drops = 0, state, input, active;
  // Exercise the real recognition handler without opening a physical camera.
  const controller = Object.create(HandController.prototype);
  Object.assign(controller, {
    video: { videoWidth: 640, videoHeight: 640 },
    getPhase: () => phase,
    onStart: () => starts++, onDrop: () => drops++,
    onState: value => { state = value; }, onInput: value => { input = { ...value }; },
    draw: (_hands, value) => { active = value; },
  });
  controller.resetOwner();
  let time = 1000;
  const frame = (hands, count = 1) => {
    for (let i = 0; i < count; i++) {
      controller.handle({ landmarks: hands.map(h => h.landmarks),
        handedness: hands.map(h => [{ categoryName: h.side, score: h.score ?? .99 }]),
        gestures: hands.map(h => [{ categoryName: h.gesture, score: .99 }]),
      }, time);
      time += 65;
    }
  };
  return { frame, controller, setPhase: value => { phase = value; },
    read: () => ({ starts, drops, state, input, active }) };
}

test('setup recognises and highlights a hand without starting or steering the game', () => {
  const f = fixture();
  f.frame([hand(.4)], 10);
  assert.equal(f.read().state.kind, 'tracking');
  assert.equal(f.read().state.controlEnabled, false);
  assert.equal(f.read().state.handCount, 1);
  assert.ok(f.read().active);
  f.frame([hand(.48)], 5);
  assert.deepEqual(f.read().input, { x: 0, z: 0 });
  assert.equal(f.read().starts, 0);
  assert.equal(f.read().drops, 0);
  f.frame([]);
  assert.equal(f.read().state.kind, 'lost');
  assert.equal(f.read().active, null);
});

test('recognition-only prep acquires a hand without steering or carrying input into aim', () => {
  const f = fixture(); f.setPhase('recognizing');
  f.frame([hand(.4)], 10);
  const owner = f.controller.owner;
  assert.ok(owner);
  assert.equal(f.read().state.kind, 'tracking');
  assert.equal(f.read().state.controlEnabled, false);
  assert.deepEqual(f.read().input, { x: 0, z: 0 });
  assert.equal(f.read().starts, 0);
  assert.equal(f.read().drops, 0);

  f.setPhase('aim'); f.frame([hand(.42)], 1);
  assert.equal(f.controller.owner, owner, 'the recognized hand survives the START boundary');
  assert.deepEqual(f.read().input, { x: 0, z: 0 }, 'aim begins from a neutral steering sample');
  assert.equal(f.read().starts, 0);
  assert.equal(f.read().drops, 0);
});

test('a closed hand stays unready and asks to open during first-turn recognition', () => {
  const f = fixture(); f.setPhase('recognizing');
  f.frame([hand(.4)], 10);
  assert.equal(f.read().state.kind, 'tracking');
  assert.equal(f.read().state.closed, false);

  f.frame([hand(.4, 'Left', 'Closed_Fist')]);
  assert.equal(f.read().state.kind, 'clenching');
  assert.equal(f.read().state.closed, true);
  assert.equal(f.read().state.controlEnabled, false);
  assert.equal(f.read().state.message, 'Open your hand to begin.');
  assert.deepEqual(f.read().input, { x: 0, z: 0 });
  assert.equal(f.read().drops, 0);
});

test('a closed fist before acquisition reports actionable readiness guidance', () => {
  const f = fixture(); f.setPhase('recognizing');
  f.frame([hand(.4, 'Left', 'Closed_Fist')], 1);
  const feedback = f.read().state;
  assert.equal(feedback.kind, 'ready');
  assert.equal(feedback.handCount, 1);
  assert.equal(feedback.open, false);
  assert.equal(feedback.closed, true);
  assert.equal(firstTurnControlReady(resolvePlayMode('', false), feedback), false);
  assert.equal(firstTurnWaitingMessage(feedback), 'OPEN HAND TO READY');
});

test('an ambiguous tracked pose does not count as open-hand readiness', () => {
  const f = fixture(); f.setPhase('recognizing');
  f.frame([hand(.4)], 10);
  f.frame([ambiguousHand(.4)]);
  const feedback = f.read().state;
  assert.equal(feedback.kind, 'tracking');
  assert.equal(feedback.closed, false);
  assert.equal(feedback.open, false);
  assert.equal(firstTurnControlReady(resolvePlayMode('', false), feedback), false);
});



test('prolonged owner loss requires stable single-hand acquisition', () => {
  const f = fixture(); f.setPhase('aim'); f.frame([hand(.4)], 10);
  f.frame([hand(.85, 'Right')], 15);
  assert.equal(f.controller.owner, null);
  f.frame([hand(.7, 'Right')], 2);
  assert.equal(f.read().state.kind, 'calibrating');
  assert.deepEqual(f.read().input, { x: 0, z: 0 });
  f.frame([hand(.7, 'Right')], 10);
  assert.equal(f.read().state.kind, 'tracking');
});

test('capture gate rejects delayed, reordered and previous-camera results without refreshing input', () => {
  const f = fixture(), c = f.controller;
  Object.assign(c, { running: true, generation: 3, lastCapture: 1000, lastResult: 1000 });
  let handled = 0; c.handle = () => handled++;
  assert.equal(c.acceptResult({}, 1100, 3, 1500), false);
  assert.equal(c.lastResult, 1000);
  assert.equal(c.acceptResult({}, 900, 3, 1100), false);
  assert.equal(c.acceptResult({}, 1100, 2, 1200), false);
  c.visibilityCutoff = 1150;
  assert.equal(c.acceptResult({}, 1100, 3, 1200), false);
  assert.equal(handled, 0);
  assert.equal(c.acceptResult({}, 1200, 3, 1400), true);
  assert.equal(c.lastResult, 1200);
  assert.equal(handled, 1);
});

test('a moving acquisition candidate cannot claim control until held still', () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) for (const x of [.3, .38, .46, .54, .62, .54, .46, .38]) f.frame([hand(x)]);
  assert.equal(f.controller.owner, null);
  f.frame([hand(.4)], 12);
  assert.ok(f.controller.owner);
});

test('returning after a long hidden interval allows fresh frames without trusting old input', async () => {
  const f = fixture(), c = f.controller, originalDocument = globalThis.document;
  globalThis.document = { hidden: false };
  try {
    Object.assign(c, { running: true, busy: true, lastResult: performance.now() - 8000, lastActivity: performance.now() });
    let failed = false; c.fail = () => { failed = true; };
    await c.frame();
    assert.equal(failed, false); assert.equal(c.running, true);
    assert.deepEqual(f.read().input, { x: 0, z: 0 });
  } finally { globalThis.document = originalDocument; }
});

test('obsolete camera enumeration cannot update camera choices', async () => {
  const f = fixture(), c = f.controller;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let resolve, updates = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { enumerateDevices: () => new Promise(r => { resolve = r; }) } } });
  c.generation = 1; c.select = { replaceChildren: () => updates++ };
  try {
    const pending = c.listCameras(); c.generation++;
    resolve([{ kind: 'videoinput', deviceId: 'old' }]); await pending;
    assert.equal(updates, 0);
  } finally { if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator; }
});

test('stopping while main-thread vision initializes disposes the late runtime', async () => {
  const controller = Object.create(HandController.prototype);
  let resolve, terminated = 0;
  Object.assign(controller, { generation: 3, worker: null,
    createMainThreadVision: () => new Promise(done => { resolve = done; }) });
  const pending = controller.useMainThreadVision(3, '/base');
  controller.generation = 4;
  resolve({ delegate: 'CPU', terminate: () => terminated++ });
  assert.equal(await pending, false);
  assert.equal(terminated, 1);
  assert.equal(controller.worker, null);
});


test('continuously late results do not masquerade as a stopped camera or control the game', async () => {
  const f=fixture(), c=f.controller, originalDocument=globalThis.document;
  globalThis.document={hidden:false};
  Object.assign(c,{running:true,busy:true,generation:1,lastCapture:1000,lastResult:1000,lastActivity:1000});
  let handled=0,failed=0,failureCode;c.handle=()=>handled++;c.fail=(_error,code)=>{failed++;failureCode=code;};
  try {
    for(let captured=1400;captured<=11000;captured+=400){
      assert.equal(c.acceptResult({},captured,1,captured+350),false);
      await c.frame(captured+390);
      assert.equal(f.read().state.kind,'delayed');
      assert.deepEqual(f.read().input,{x:0,z:0});
    }
    assert.equal(handled,0);assert.equal(failed,0);assert.equal(c.running,true);
    const lastActivity=c.lastActivity;
    assert.equal(c.acceptResult({},1000,1,12000),false);
    assert.equal(c.lastActivity,lastActivity,'replayed results cannot keep the worker alive');
    for(let t=lastActivity+65;t<=lastActivity+7100&&!failed;t+=65)await c.frame(t);assert.equal(failed,1,'a genuinely silent worker still stops');assert.equal(failureCode,'worker_timeout');
  } finally {globalThis.document=originalDocument;}
});

test('a late result cancels confirmation and fresh tracking can resume without restarting',()=>{
  const f=fixture(),c=f.controller;
  Object.assign(c,{running:true,generation:1,lastCapture:1000,lastResult:1000,lastActivity:1000});
  c.fist.armed=true;c.fist.held=400;
  assert.equal(c.acceptResult({},1400,1,1750),false);
  assert.equal(c.fist.armed,false);assert.equal(c.fist.held,0);
  let handled=0;c.handle=()=>handled++;
  assert.equal(c.acceptResult({},1800,1,1900),true);
  assert.equal(handled,1);assert.equal(c.lastFreshReceipt,1900);
});

test('steering filters hand jitter while staying responsive to real moves', () => {
  const f = fixture(); f.setPhase('aim');
  f.frame([hand(.5)], 12);
  assert.ok(f.controller.owner);
  for (let i = 0; i < 30; i++) f.frame([hand(.5 + (i % 2 ? .02 : -.02))]);
  assert.ok(Math.abs(f.read().input.x) < .1, `jitter leaked into steering: ${f.read().input.x}`);
  f.frame([hand(.62)], 4);
  assert.ok(f.read().input.x > .3, `filtered steering too sluggish: ${f.read().input.x}`);
});

test('vision gates forward hold cancellations with their cause', () => {
  const f = fixture(), c = f.controller;
  const gestures = []; c.onGesture = (name, cause) => gestures.push(cause ? `${name}:${cause}` : name);
  Object.assign(c, { running: true, generation: 1, lastCapture: 1000, lastResult: 1000, lastActivity: 1000 });
  c.fist.armed = true; c.fist.held = 400;
  assert.equal(c.acceptResult({}, 1400, 1, 1750), false);
  assert.deepEqual(gestures, ['hold_cancelled:stale']);
  gestures.length = 0;
  f.setPhase('aim'); f.frame([hand(.5)], 12);
  c.fist.armed = true; c.fist.held = 300; c.fist.last = 0;
  f.frame([]);
  assert.deepEqual(gestures, ['hold_cancelled:hand_lost']);
});

test('re-acquiring a hand that moved during a brief loss re-centres steering at zero', () => {
  const f = fixture(); f.setPhase('aim');
  f.frame([hand(.5)], 12);
  assert.ok(f.controller.owner);
  f.frame([hand(.5)], 4);
  f.frame([], 2);
  f.frame([hand(.68)], 6);
  assert.equal(f.read().state.kind, 'tracking');
  // The filter's convergence residue must not become a phantom deflection.
  assert.deepEqual(f.read().input, { x: 0, z: 0 });
});

test('a mid-session CPU fallback stops the zero-copy stream and reports the flip', () => {
  const f = fixture(), c = f.controller;
  const diagnostics = []; c.onDiagnostic = d => diagnostics.push(d);
  let cancelled = 0;
  Object.assign(c, { running: true, generation: 4, captureDriver: 'stream', delegate: 'GPU',
    frameReader: { cancel: () => { cancelled++; return Promise.resolve(); } }, video: {} });
  c.demoteCapture(4, 'CPU');
  assert.equal(c.delegate, 'CPU');
  assert.equal(cancelled, 1);
  assert.equal(c.frameReader, null);
  assert.equal(c.captureDriver, 'timer');
  assert.ok(diagnostics.some(d => d.delegate === 'CPU'));
  assert.ok(diagnostics.some(d => d.driver === 'timer'));
});

test('simple performance mode keeps zero-copy streaming and only resizes bitmap fallbacks', () => {
  const f = fixture(), c = f.controller, originalProcessor = globalThis.MediaStreamTrackProcessor;
  let cancelled = 0, readers = 0;
  globalThis.MediaStreamTrackProcessor = class { constructor() { this.readable = { getReader: () => ({ read: () => new Promise(() => {}), cancel: () => { cancelled++; return Promise.resolve(); } }) }; } };
  Object.assign(c, { running: true, generation: 4, captureDriver: 'stream', captureWidth: 0, delegate: 'GPU', worker: {},
    stream: { getVideoTracks: () => [{}] }, frameReader: { cancel: () => { cancelled++; return Promise.resolve(); } },
    video: { requestVideoFrameCallback: () => {} }, readFrames: () => { readers++; } });
  try {
    assert.equal(c.setPerformanceMode('simple'), true);
    assert.equal(c.captureWidth, 320); assert.equal(c.captureDriver, 'stream'); assert.equal(cancelled, 0, 'the stream is never interrupted for a width change');
    assert.equal(c.setPerformanceMode('full'), true);
    assert.equal(c.captureWidth, 0); assert.equal(c.captureDriver, 'stream'); assert.equal(readers, 0);
    // Without streaming, the width governs the paced bitmap path and reconfiguration applies it.
    globalThis.MediaStreamTrackProcessor = undefined;
    c.captureDriver = 'rvfc';
    assert.equal(c.setPerformanceMode('simple'), true);
    assert.equal(c.captureWidth, 320); assert.equal(c.captureDriver, 'rvfc');
  } finally { globalThis.MediaStreamTrackProcessor = originalProcessor; }
});

test('an explicit capture-width diagnostic override is never replaced automatically', () => {
  const f = fixture(), c = f.controller;
  Object.assign(c, { captureLocked: true, captureWidth: 480 });
  assert.equal(c.setPerformanceMode('simple'), false);
  assert.equal(c.captureWidth, 480);
});

test('reconfiguring an rvfc capture path retires the previous pacing loop', () => {
  const f = fixture(), c = f.controller, callbacks = [];
  let frames = 0;
  Object.assign(c, { running: true, generation: 4, captureWidth: 640, delegate: 'GPU', worker: {},
    stream: { getVideoTracks: () => [{}] }, video: { requestVideoFrameCallback: callback => callbacks.push(callback) },
    frame: () => { frames++; } });
  c.configureCapture();
  c.captureWidth = 320; c.configureCapture();
  assert.equal(callbacks.length, 2);
  callbacks[0]();
  assert.equal(frames, 0);
  assert.equal(callbacks.length, 2, 'the retired loop must not schedule another callback');
  callbacks[1]();
  assert.equal(frames, 1);
  assert.equal(callbacks.length, 3);
});

test('a dedicated capture driver keeps the watchdog timer from double-capturing', async () => {
  const f = fixture(), c = f.controller, originalDocument = globalThis.document;
  globalThis.document = { hidden: false };
  try {
    const now = performance.now();
    Object.assign(c, { running: true, busy: false, captureDriver: 'stream', lastResult: now, lastActivity: now,
      video: { readyState: 4, currentTime: 9, videoWidth: 640, videoHeight: 360 } });
    // Reaching capture would throw: createImageBitmap does not exist in node.
    await c.frame();
    assert.equal(c.busy, false);
    c.captureDriver = 'rvfc';
    await c.frame();
    assert.equal(c.busy, false);
  } finally { globalThis.document = originalDocument; }
});

test('stream capture transfers only the freshest frame and closes the rest', async () => {
  const f = fixture(), c = f.controller, originalDocument = globalThis.document;
  globalThis.document = { hidden: false };
  const closed = [], posted = [];
  const makeFrame = id => ({ id, close: () => closed.push(id) });
  const queue = [makeFrame(1), makeFrame(2), makeFrame(3)];
  try {
    Object.assign(c, { running: true, generation: 5, busy: true });
    c.worker = { postMessage: message => posted.push(message.frame.id) };
    c.frameReader = { read: async () => {
      const value = queue.shift();
      if (value?.id === 2) c.busy = false;
      return value ? { value } : { done: true, value: undefined };
    } };
    await c.readFrames(5);
    assert.deepEqual(closed, [1, 3], 'busy frames must be closed, not queued');
    assert.deepEqual(posted, [2]);
    assert.equal(c.busy, true);
  } finally { globalThis.document = originalDocument; }
});

test('stream capture closes frames and exits after a camera switch', async () => {
  const f = fixture(), c = f.controller, originalDocument = globalThis.document;
  globalThis.document = { hidden: false };
  const closed = [], posted = [];
  try {
    Object.assign(c, { running: true, generation: 5, busy: false });
    c.worker = { postMessage: message => posted.push(message.frame.id) };
    c.frameReader = { read: async () => { c.generation = 6; return { value: { id: 1, close: () => closed.push(1) } }; } };
    await c.readFrames(5);
    assert.deepEqual(closed, [1]);
    assert.deepEqual(posted, []);
  } finally { globalThis.document = originalDocument; }
});

test('camera failure exposes a bounded reason and clears steering before reporting', () => {
  const f = fixture(), c = f.controller;
  c.stop = () => { c.running = false; c.resetOwner(); };
  for (const [name, supplied, expected] of [
    ['Error', 'worker_timeout', 'worker_timeout'],
    ['Error', 'worker_error', 'worker_error'],
    ['Error', 'camera_disconnected', 'camera_disconnected'],
    ['Error', 'capture_error', 'capture_error'],
    ['Error', 'tracking_init_error', 'tracking_init_error'],
    ['NotAllowedError', undefined, 'permission_denied'],
    ['NotFoundError', undefined, 'no_camera'],
    ['NotReadableError', undefined, 'camera_busy'],
  ]) {
    c.running = true; c.fist.held = 400;
    c.fail(Object.assign(new Error('diagnostic detail'), { name }), supplied);
    assert.equal(f.read().state.code, expected);
    assert.equal(f.read().state.kind, 'error');
    assert.equal(c.running, false); assert.equal(c.fist.held, 0);
    assert.deepEqual(f.read().input, { x: 0, z: 0 });
  }
});

test('absolute steering maps the predicted hand offset onto the bed and carries a target with the input', () => {
  const f = fixture(), c = f.controller;
  c.steering = 'absolute';
  f.setPhase('aim');
  f.frame([hand(.5)], 10);
  assert.deepEqual([f.read().input.x, f.read().input.z], [0, 0], 'the acquired pose is the neutral centre');
  assert.ok(f.read().input.target, 'absolute mode publishes a target');
  f.frame([hand(.59)], 6);
  const { input } = f.read();
  assert.ok(input.x > .4 && input.x <= 1, `deck deflection follows the offset (${input.x})`);
  assert.ok(input.target.x > .4, `target moves toward the right of the bed (${input.target.x})`);
  assert.ok(Math.abs(input.target.z - .0275) < .05, 'no vertical offset keeps the target on the centre row');
  const relative = fixture();
  relative.setPhase('aim'); relative.frame([hand(.5)], 10); relative.frame([hand(.59)], 6);
  assert.equal(relative.read().input.target, undefined, 'the default profile never publishes a target');
});

test('a stalled main thread never counts against the worker; a frame left unanswered for 7 s still does', () => {
  const originalDocument = globalThis.document; globalThis.document = { hidden: false };
  const f = fixture(), c = f.controller; let failed = 0;
  Object.assign(c, { running: true, busy: true, generation: 1, lastResult: 1000, lastActivity: 1000, lastSent: 1000, fail: () => { failed++; c.running = false; } });
  c.supervise(1065);
  // The tab froze for six seconds (material recompile): nothing was sent, so nothing is owed.
  c.supervise(7100); assert.equal(failed, 0, 'a tick gap resets liveness');
  for (let t = 7165; t < 14000; t += 65) c.supervise(t);
  assert.equal(failed, 0, 'seven seconds since the stall is not yet a timeout');
  for (let t = 14000; t < 14300; t += 65) c.supervise(t);
  assert.equal(failed, 1, 'a frame in flight with no answer for 7 s of live ticks stops the camera');
  const idle = fixture(), d = idle.controller; let idleFailed = 0;
  Object.assign(d, { running: true, busy: false, generation: 1, lastResult: 1000, lastActivity: 1000, lastSent: 1000, fail: () => { idleFailed++; } });
  for (let t = 1000; t < 20000; t += 65) d.supervise(t);
  assert.equal(idleFailed, 0, 'with nothing in flight the worker owes nothing');
  globalThis.document = originalDocument;
});


test('two-hand menus select with the left hand while the right remains visible', () => {
  const f = fixture(); f.controller.getControlProfile = () => 'menu-left'; f.setPhase('aim');
  const left = hand(.35), right = hand(.7, 'Right');
  f.frame([right, left], 14);
  assert.equal(f.read().state.kind, 'tracking');
  assert.equal(f.read().state.handCount, 2);
  assert.deepEqual(f.read().state.pointer, { x: .35, y: .5 });
  f.frame([hand(.7, 'Right', 'Closed_Fist'), left], 12);
  assert.equal(f.read().drops, 0, 'the right fist cannot select');
  f.frame([right, hand(.35, 'Left', 'Closed_Fist')], 12);
  assert.equal(f.read().drops, 1, 'the left fist selects once with both hands visible');
});

test('two-hand menu loss and ambiguous labels cancel a pending selection', () => {
  for (const interruption of [[hand(.35, 'Right', 'Closed_Fist')], [hand(.35), hand(.38, 'Right')],
    [hand(.35), hand(.7)], [{ ...hand(.35), score: .5 }, hand(.7, 'Right')]]) {
    const f = fixture(); f.controller.getControlProfile = () => 'menu-left'; f.setPhase('aim');
    f.frame([hand(.35), hand(.7, 'Right')], 14);
    f.frame([hand(.35, 'Left', 'Closed_Fist'), hand(.7, 'Right')], 3);
    f.frame(interruption, 3);
    assert.equal(f.read().state.pointer, null);
    f.frame([hand(.35, 'Left', 'Closed_Fist'), hand(.7, 'Right')], 12);
    assert.equal(f.read().drops, 0, 'lost selection cannot resume a held fist');
  }
});

test('menu-to-dual transition discards a held selection and waits for both open hands', () => {
  const f = fixture(); let profile = 'menu-left';
  f.controller.getControlProfile = () => profile;
  f.controller.getControlTarget = () => ({ overTarget: true });
  f.setPhase('aim'); f.frame([hand(.35), hand(.7, 'Right')], 14);
  f.frame([hand(.35, 'Left', 'Closed_Fist'), hand(.7, 'Right')], 12);
  const selections = f.read().drops;
  profile = 'dual'; f.setPhase('recognizing');
  f.frame([hand(.35, 'Left', 'Closed_Fist'), hand(.7, 'Right')], 12);
  assert.equal(firstTurnControlReady(resolvePlayMode('?controls=dual'), f.read().state), false);
  assert.equal(firstTurnWaitingMessage(f.read().state, true), 'OPEN LEFT HAND');
  f.frame([hand(.35)], 12);
  assert.equal(firstTurnWaitingMessage(f.read().state, true), 'SHOW RIGHT HAND OPEN');
  f.frame([hand(.35), hand(.7, 'Right')], 12);
  assert.equal(firstTurnControlReady(resolvePlayMode('?controls=dual'), f.read().state), true);
  assert.equal(f.read().state.preparing, true);
  assert.deepEqual(f.read().input, { x: 0, z: 0 });
  assert.equal(f.read().drops, selections, 'recognition does not select again or drop');
});

test('a menu label swap cannot transfer left-hand confirmation to the physical right fist', () => {
  const f = fixture(); f.controller.getControlProfile = () => 'menu-left'; f.setPhase('aim');
  f.frame([hand(.35), hand(.5, 'Right', 'Closed_Fist')], 14);
  f.frame([hand(.35, 'Left', 'Closed_Fist'), hand(.5, 'Right', 'Closed_Fist')], 3);
  // Physical left opens at its previous position, but both confident labels flip.
  f.frame([hand(.35, 'Right'), hand(.5, 'Left', 'Closed_Fist')], 8);
  assert.equal(f.read().drops, 0, 'the right fist cannot inherit the left menu hold');
  assert.equal(f.read().state.pointer, null);
});
