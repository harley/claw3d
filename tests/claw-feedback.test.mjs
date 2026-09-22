import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ArcadeScene } from '../src/arcade-scene.js';

const tracking = { kind: 'tracking', controlEnabled: true };
const pose = { x: 0, y: 4, z: 0, radii: [.41, .41, .41] };
function fixture() {
  const scene = Object.create(ArcadeScene.prototype);
  scene.claw = new T.Group();
  scene.applyClawPose = value => { scene.renderedPose = value; };
  return scene;
}
test('visual travel is bounded and returns immediately to neutral without changing the mechanical pose', () => {
  const scene = fixture();
  const update = (p, f = tracking, phase = 'aim', hold = 0) => scene.updateClawFeedback(p, phase, .02, f, hold);
  update(pose);
  assert.equal(Math.abs(scene.claw.rotation.z), 0);
  const moved = { ...pose, x: .02, z: -.02 };
  update(moved);
  assert.equal(scene.claw.rotation.z, -.035);
  assert.equal(scene.claw.rotation.x, -.035);
  assert.equal(scene.renderedPose, moved);
  update(moved); // Rest or a travel limit.
  assert.equal(Math.abs(scene.claw.rotation.z), 0);
  update({ ...pose, x: .0201, z: -.02 });
  assert.equal(Math.abs(scene.claw.rotation.z), 0, 'tiny travel does not amplify jitter');
  for (const f of [{kind:'lost'}, {kind:'paused'}, {...tracking, controlEnabled:false}]) {
    update(pose, f);
    assert.equal(Math.abs(scene.claw.rotation.z), 0);
    assert.equal(scene.previousAim, null);
  }
  update(pose);
  scene.reducedMotion = true;
  update(moved);
  assert.equal(Math.abs(scene.claw.rotation.z), 0);
  update(moved, tracking, 'descend');
  assert.equal(scene.previousAim, null);
});
test('hold tension is readable, deterministic and cancels without mutating collision radii', () => {
  const scene = fixture();
  const original = structuredClone(pose);
  scene.reducedMotion = true;
  scene.updateClawFeedback(pose, 'aim', .02, {kind:'clenching',controlEnabled:true}, 1);
  assert.ok(scene.renderedPose.radii.every(r => Math.abs(r - .19) < 1e-12));
  assert.deepEqual(pose, original);
  assert.equal(scene.renderedPose.x, pose.x);
  assert.equal(scene.renderedPose.z, pose.z);
  scene.updateClawFeedback(pose, 'aim', .02, tracking, 0);
  assert.deepEqual(scene.renderedPose.radii, original.radii);
  assert.equal(Math.abs(scene.claw.rotation.z), 0);
});
