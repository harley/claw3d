import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController } from '../src/vision.js';

function hand(x, side = 'Left') {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 1 - x, y: .5, z: 0 }));
  landmarks[0].y = .56; landmarks[9].y = .44;
  landmarks[5].x -= .06; landmarks[17].x += .06;
  return { landmarks, side };
}

function fixture() {
  let phase = 'blocked', starts = 0, drops = 0, state, input, active;
  // Exercise the real recognition handler without opening a physical camera.
  const controller = Object.create(HandController.prototype);
  Object.assign(controller, {
    video: { videoWidth: 640, videoHeight: 640 },
    getProfile: () => 'clasp', getPhase: () => phase,
    onStart: () => starts++, onDrop: () => drops++,
    onState: value => { state = value; }, onInput: value => { input = { ...value }; },
    draw: (_hands, value) => { active = value; },
  });
  controller.resetOwner();
  let time = 1000;
  const frame = (hands, count = 1) => {
    for (let i = 0; i < count; i++) {
      controller.handle({ landmarks: hands.map(h => h.landmarks),
        handedness: hands.map(h => [{ categoryName: h.side }]),
        gestures: hands.map(() => [{ categoryName: 'Open_Palm', score: .99 }]),
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

test('setup clasp cannot drop; aiming requires a new apart and hold sequence', () => {
  const f = fixture(), apart = [hand(.4), hand(.7, 'Right')], together = [hand(.46), hand(.55, 'Right')];
  f.frame([hand(.4)], 10);
  f.frame(apart, 6); f.frame(together, 15);
  assert.equal(f.read().drops, 0);
  f.setPhase('aim'); f.frame(together, 15);
  assert.equal(f.read().drops, 0);
  f.frame(apart, 6); f.frame(together, 15);
  assert.equal(f.read().drops, 1);
  f.frame(together, 15);
  assert.equal(f.read().drops, 1);
});

test('blocking input cancels a partly held drop while keeping recognition visible', () => {
  const f = fixture(), apart = [hand(.4), hand(.7, 'Right')], together = [hand(.46), hand(.55, 'Right')];
  f.setPhase('aim'); f.frame([hand(.4)], 10);
  f.frame(apart, 6); f.frame(together, 4);
  assert.ok(f.read().state.progress > 0);
  f.setPhase('blocked'); f.frame(together, 15);
  assert.equal(f.read().state.handCount, 2);
  assert.deepEqual(f.read().input, { x: 0, z: 0 });
  f.setPhase('aim'); f.frame(together, 15);
  assert.equal(f.read().drops, 0);
  f.frame([hand(.46)], 7); f.frame([hand(.52)], 3);
  assert.ok(f.read().input.x > 0);
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

test('a rejected clasp never reports an accepted drop and requires a fresh gesture', () => {
  const f = fixture(); f.setPhase('aim');
  let attempts = 0; f.controller.onDrop = () => { attempts++; return false; };
  f.frame([hand(.4)], 10); f.frame([hand(.4), hand(.7, 'Right')], 6);
  f.frame([hand(.46), hand(.55, 'Right')], 11);
  assert.equal(attempts, 1);
  assert.notEqual(f.read().state.kind, 'accepted');
  assert.ok(!f.read().state.message.includes('confirmed'));
  f.frame([hand(.46), hand(.55, 'Right')], 20); assert.equal(attempts, 1);
});

test('continuously late results do not masquerade as a stopped camera or control the game', async () => {
  const f=fixture(), c=f.controller, originalDocument=globalThis.document;
  globalThis.document={hidden:false};
  Object.assign(c,{running:true,busy:true,generation:1,lastCapture:1000,lastResult:1000,lastActivity:1000});
  let handled=0,failed=0;c.handle=()=>handled++;c.fail=()=>failed++;
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
    await c.frame(lastActivity+7001);assert.equal(failed,1,'a genuinely silent worker still stops');
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
