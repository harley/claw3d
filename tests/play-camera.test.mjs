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
  scene.updateCamera({phase:'result'}, {preparing:true,nextTurnElapsed:2.7});
  assert.ok(scene.camera.position.distanceTo(scene.playCamera) > 0);
  scene.updateCamera({phase:'result'}, {preparing:true,nextTurnElapsed:3});
  assert.deepEqual(scene.camera.position, scene.playCamera);
  scene.updateCamera({phase:'aim',elapsed:0});
  assert.deepEqual(scene.camera.position, scene.playCamera);
});
test('reduced motion uses stable cuts with no zoom interpolation', () => {
  const scene = fixture(); scene.reducedMotion = true;
  scene.updateCamera({phase:'lift',elapsed:1});
  assert.deepEqual(scene.camera.position, scene.playCamera);
  scene.updateCamera({phase:'transfer',elapsed:0});
  assert.deepEqual(scene.camera.position, scene.home);
  scene.updateCamera({phase:'result'}, {preparing:true,nextTurnElapsed:2.9});
  assert.deepEqual(scene.camera.position, scene.home);
  scene.updateCamera({phase:'result'}, {preparing:true,nextTurnElapsed:3});
  assert.deepEqual(scene.camera.position, scene.playCamera);
});
