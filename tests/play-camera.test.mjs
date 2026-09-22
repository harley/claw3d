import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ArcadeScene } from '../src/arcade-scene.js';
function fixture() {
  return Object.assign(Object.create(ArcadeScene.prototype), {
    camera: new T.PerspectiveCamera(35, 1.5, .1, 70),
    playCamera: new T.Vector3(.45, 4.8, 6.4), playLook: new T.Vector3(0, 2.95, 0),
    home: new T.Vector3(7.25, 6.15, 11.6), look: new T.Vector3(-.4, 2.25, 0),
    currentLook: new T.Vector3(), surroundings: { visible: true }, punch: null, attractBlend: 0,
  });
}
test('aim, accepted drop, contact and full lift retain exactly the same close viewpoint', () => {
  const scene = fixture();
  for (const phase of ['aim', 'anticipate', 'descend', 'grip', 'lift']) {
    for (const elapsed of [0, .2, .85, 1.45]) {
      scene.updateCamera({ phase, elapsed });
      assert.deepEqual(scene.camera.position, scene.playCamera);
      assert.deepEqual(scene.currentLook, scene.playLook);
      assert.equal(scene.surroundings.visible, false);
    }
  }
});
test('pullback starts only after lift, and next-turn preparation completes before aiming', () => {
  const scene = fixture();
  scene.updateCamera({phase:'transfer', elapsed:.325});
  assert.ok(scene.camera.position.distanceTo(scene.playCamera) > 0);
  assert.ok(scene.camera.position.distanceTo(scene.home) > 0);
  scene.updateCamera({phase:'transfer', elapsed:.65});
  assert.deepEqual(scene.camera.position, scene.home);
  for (const phase of ['release','deliver','reveal','result','idle']) {
    scene.updateCamera({phase, elapsed:0});
    assert.deepEqual(scene.camera.position, scene.home);
  }
  const caught = { phase: 'result', plan: { prize: {} } };
  scene.updateCamera(caught, {preparing:true,nextTurnElapsed:1.9});
  assert.ok(scene.camera.position.distanceTo(scene.playCamera) > 0);
  assert.ok(scene.camera.position.distanceTo(scene.home) > 0);
  scene.updateCamera(caught, {preparing:true,nextTurnElapsed:2.2});
  assert.deepEqual(scene.camera.position, scene.playCamera, 'close view is back before START! at 2.2 s');
  scene.updateCamera({phase:'aim',elapsed:0});
  assert.deepEqual(scene.camera.position, scene.playCamera);
});
test('a miss never leaves the close view while the next turn is prepared', () => {
  const scene = fixture();
  const missed = { phase: 'result', plan: { prize: null } };
  for (const nextTurnElapsed of [0, .6, 1.2]) {
    scene.updateCamera(missed, {preparing:true,nextTurnElapsed});
    assert.deepEqual(scene.camera.position, scene.playCamera);
    assert.equal(scene.surroundings.visible, false);
  }
  scene.updateCamera(missed, {preparing:false});
  assert.deepEqual(scene.camera.position, scene.home, 'a finished run shows the whole machine behind the results');
});
test('reduced motion uses stable cuts with no zoom interpolation', () => {
  const scene = fixture(); scene.reducedMotion = true;
  scene.updateCamera({phase:'lift',elapsed:1});
  assert.deepEqual(scene.camera.position, scene.playCamera);
  scene.updateCamera({phase:'transfer',elapsed:0});
  assert.deepEqual(scene.camera.position, scene.home);
  const caught = { phase: 'result', plan: { prize: {} } };
  scene.updateCamera(caught, {preparing:true,nextTurnElapsed:2.1});
  assert.deepEqual(scene.camera.position, scene.home);
  scene.updateCamera(caught, {preparing:true,nextTurnElapsed:2.2});
  assert.deepEqual(scene.camera.position, scene.playCamera);
});

test('a camera punch is a short decaying kick that reduced motion never applies', () => {
  const scene = fixture();
  scene.kick(.05, 10);
  scene.updateCamera({ phase: 'grip', elapsed: .1 }, {}, 10.02);
  const kicked = scene.camera.position.distanceTo(scene.playCamera);
  assert.ok(kicked > .01 && kicked < .06, `offset shortly after the kick (${kicked.toFixed(3)})`);
  scene.updateCamera({ phase: 'grip', elapsed: .3 }, {}, 10.3);
  assert.ok(scene.camera.position.distanceTo(scene.playCamera) < kicked, 'the kick decays');
  scene.updateCamera({ phase: 'grip', elapsed: .7 }, {}, 10.7);
  assert.deepEqual(scene.camera.position, scene.playCamera, 'and ends exactly on the play viewpoint');
  assert.equal(scene.punch, null);
  const still = fixture(); still.reducedMotion = true; still.kick(.05, 10);
  still.updateCamera({ phase: 'grip', elapsed: .1 }, {}, 10.02);
  assert.deepEqual(still.camera.position, still.playCamera, 'reduced motion ignores kicks');
});

test('attract drifts a close view while unattended and hands back the idle framing the moment a hand appears', () => {
  const scene = fixture();
  scene.updateCamera({ phase: 'idle' }, { attract: true, dt: 1 }, 3);
  assert.equal(scene.attractBlend, 1, 'a long step is fully attracted');
  const a = scene.camera.position.clone();
  assert.ok(a.distanceTo(scene.playCamera) < 1.3 && a.distanceTo(scene.home) > 3, 'close framing, not the wide home view');
  scene.updateCamera({ phase: 'idle' }, { attract: true, dt: 1 / 60 }, 5);
  assert.ok(scene.camera.position.distanceTo(a) > .05, 'the view drifts over time');
  scene.updateCamera({ phase: 'idle' }, { attract: false, dt: 1 }, 6);
  assert.equal(scene.attractBlend, 0);
  assert.deepEqual(scene.camera.position, scene.home, 'a hand restores the idle framing exactly');
  const cut = fixture(); cut.updateCamera({ phase: 'idle' }, { attract: true, dt: 1 }, 1);
  cut.updateCamera({ phase: 'aim', elapsed: 0 }, { attract: false, dt: 1 / 60 }, 1.02);
  assert.equal(cut.attractBlend, 0); assert.deepEqual(cut.camera.position, cut.playCamera, 'aiming starts on the exact play viewpoint even mid-ease');
  const blend = fixture(); blend.updateCamera({ phase: 'idle' }, { attract: true, dt: 1 / 60 }, 1);
  assert.ok(blend.attractBlend > 0 && blend.attractBlend < 1, 'transitions ease rather than cut');
  const still = fixture(); still.reducedMotion = true;
  still.updateCamera({ phase: 'idle' }, { attract: true, dt: 1 / 60 }, 3);
  assert.equal(still.attractBlend, 1, 'reduced motion cuts');
  const s1 = still.camera.position.clone();
  still.updateCamera({ phase: 'idle' }, { attract: true, dt: 1 / 60 }, 9);
  assert.deepEqual(still.camera.position, s1, 'and never drifts');
});
