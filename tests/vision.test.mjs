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
  return { frame, setPhase: value => { phase = value; },
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
