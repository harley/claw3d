import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ArcadeScene } from '../src/arcade-scene.js';
function fixture() {
  return Object.assign(Object.create(ArcadeScene.prototype), {
    camera: new T.PerspectiveCamera(35, 1.5, .1, 70),
    playCamera: new T.Vector3(.45, 4.8, 6.4), playLook: new T.Vector3(0, 2.95, 0),
    home: new T.Vector3(7.25, 6.15, 11.6), look: new T.Vector3(-.4, 2.25, 0),
    currentLook: new T.Vector3(), surroundings: { visible: true },
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
