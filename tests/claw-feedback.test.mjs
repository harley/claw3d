import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ArcadeScene } from '../src/arcade-scene.js';
import { createGame, begin, drop, clawPose, PHASES, OPEN_RADIUS } from '../src/arcade-mechanics.js';

const tracking = { kind: 'tracking', controlEnabled: true };
const pose = { x: 0, y: 4, z: 0, radii: [.41, .41, .41] };
function fixture() {
  const scene = Object.create(ArcadeScene.prototype);
  scene.claw = new T.Group();
  scene.bridge = new T.Group(); scene.carriage = new T.Group(); scene.cable = new T.Group();
  scene.fingers = Array.from({ length: 3 }, () => ({
    shoulder: [.11, -.145, 0], upper: new T.Group(), lower: new T.Group(),
    tendon: new T.Group(), elbow: new T.Group(), pad: new T.Group(),
  }));
  scene.applyClawPose = value => {
    ArcadeScene.prototype.applyClawPose.call(scene, value);
    scene.renderedPose = value;
  };
  return scene;
}
test('visual travel is bounded and returns immediately to neutral without changing the mechanical pose', () => {
  const scene = fixture();
  const update = (p, f = tracking, phase = 'aim') => scene.updateClawFeedback(p, phase, .02, f);
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
// Exercise actual finger transforms: mechanics-only checks miss a visual override.
for (const reducedMotion of [false, true]) {
  test(`confirmation stays open and only grip closes the visible fingers (reduced motion: ${reducedMotion})`, () => {
    const scene = fixture(); scene.reducedMotion = reducedMotion;
    const game = createGame(); begin(game); game.position = { x: -.38, z: .72 };
    const render = feedback => {
      const mechanicalPose = clawPose(game), original = structuredClone(mechanicalPose);
      scene.updateClawFeedback(mechanicalPose, game.phase, .02, feedback);
      assert.deepEqual(mechanicalPose, original, 'rendering never mutates the mechanical pose');
      const radii = scene.fingers.map(finger => finger.pad.position.x + .017);
      for (const [i, radius] of radii.entries()) assert.ok(Math.abs(radius - mechanicalPose.radii[i]) < 1e-12);
      return radii;
    };
    const assertOpen = feedback => assert.ok(render(feedback).every(r => Math.abs(r - OPEN_RADIUS) < 1e-12));
    for (const progress of [.25, .5, .99, 1]) {
      render({ kind: 'clenching', controlEnabled: true, progress });
    }
    assertOpen(tracking); // Opening cancels confirmation.
    assertOpen({ kind: 'lost', controlEnabled: false });
    assert.equal(game.phase, 'aim');
    assert.ok(drop(game));
    for (const phase of ['anticipate', 'descend']) {
      game.phase = phase;
      for (const progress of [0, .5, 1]) {
        game.elapsed = PHASES[phase] * progress;
        assertOpen({ kind: 'lost', controlEnabled: false });
      }
    }
    game.phase = 'grip'; game.elapsed = 0;
    assertOpen({ kind: 'lost' });
    game.elapsed = PHASES.grip;
    assert.ok(render({ kind: 'lost' }).every(r => r < OPEN_RADIUS - .05), 'grip still closes at the toy');
  });
}
