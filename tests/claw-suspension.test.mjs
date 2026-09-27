import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuspension, stepSuspension, suspendedPose, rotateClaw, clawWorldPoint, steelFingerPoint, CLAW_FINGER_ANGLES } from '../src/claw-suspension.js';
import { createGame, begin, drop, advance, clawPose, FIELD, HIGH } from '../src/arcade-mechanics.js';
import { resolvePlayMode } from '../src/play-mode.js';

// Contract: a stopped carriage leaves a moving head which settles, and a pause
// cannot consume that motion. Legacy lean tests intentionally require an instant stop.
test('the suspended mass trails, overshoots and settles without moving the carriage', () => {
  const state = createSuspension(), carriage = { x: 0, y: 3.5, z: 0 };
  stepSuspension(state, carriage, 1 / 60);
  for (let i = 0; i < 30; i++) { carriage.x += .85 / 60; stepSuspension(state, carriage, 1 / 60); }
  assert.ok(suspendedPose(carriage, state).x < carriage.x - .015);
  const before = structuredClone(state); stepSuspension(state, carriage, 0); assert.deepEqual(state, before);
  let ahead = false;
  for (let i = 0; i < 300; i++) { stepSuspension(state, carriage, 1 / 60); ahead ||= suspendedPose(carriage, state).x > carriage.x + .01; }
  assert.ok(ahead, 'inertia carries the head past the stopped carriage');
  assert.ok(Math.abs(state.x) < .001 && Math.abs(state.vx) < .002, 'swing decays instead of oscillating forever');
});

// Contract: the rendered fingers cannot swing through the chamber at a travel
// limit. Existing clearance tests cover only the old straight, upright fingers.
test('suspension stops keep the full open curve inside the chamber', () => {
  for (const y of [HIGH, 3.5, 2.8]) for (const x of [FIELD.minX, FIELD.maxX]) for (const z of [FIELD.minZ, FIELD.maxZ]) {
    const state = createSuspension(), carriage = { x, y, z };
    state.x = Math.sign(x) * .28; state.z = Math.sign(z) * .28;
    stepSuspension(state, carriage, 1 / 60);
    const pose = suspendedPose(carriage, state);
    for (const angle of CLAW_FINGER_ANGLES) for (let i = 0; i <= 32; i++) {
      const p = steelFingerPoint(.41, i / 32), w = clawWorldPoint(pose, { x: Math.cos(angle) * p.x, y: p.y, z: Math.sin(angle) * p.x });
      assert.ok(w.x >= -1.64 && w.x <= 1.64 && w.z >= -1.13 && w.z <= 1.17, JSON.stringify({ carriage, w }));
    }
  }
});

test('carried offsets round-trip through the same tilted coordinate frame', () => {
  const rotation = { x: -.17, z: .23 }, point = { x: .12, y: -.88, z: -.07 };
  const result = rotateClaw(rotateClaw(point, rotation), rotation, true);
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(point[axis] - result[axis]) < 1e-12);
});

test('a carriage prediction cannot award a suspended catch without mesh contact', () => {
  const game = createGame({ suspendedClaw: true }); begin(game); game.position = { x: -.38, z: .72 }; drop(game);
  assert.equal(game.plan.prize, null);
  while (game.phase !== 'result') advance(game, .1);
  assert.equal(game.plan.prize, null); assert.equal(game.rounds, 1); assert.deepEqual(game.collection, []);
  assert.ok(Number.isFinite(clawPose(game).y));
});

test('the approved claw is default, shared play cannot override it, and pushing remains isolated', () => {
  for (const controls of ['', '&controls=dual', '&controls=grab']) {
    const mode = resolvePlayMode(`?claw=suspended${controls}`), base = resolvePlayMode(`?${controls}`);
    assert.equal(mode.suspendedClaw, true); assert.equal(mode.storageKey, base.storageKey);
    const shared = resolvePlayMode(`?claw=suspended${controls}`, true);
    assert.equal(shared.suspendedClaw, true); assert.equal(shared.storageKey, resolvePlayMode(`?${controls}`, true).storageKey);
  }
  assert.equal(resolvePlayMode('').suspendedClaw, true);
  assert.equal(resolvePlayMode('?claw=rigid').suspendedClaw, false);
  assert.equal(resolvePlayMode('?claw=rigid&contact=push', true).suspendedClaw, true);
  assert.equal(resolvePlayMode('?contact=push').suspendedClaw, false);
  assert.equal(resolvePlayMode('?claw=suspended&contact=push').pushContact, false);
  assert.equal(createGame({ suspendedClaw: true, pushContact: true }).pushContact, false);
});

// A velocity step should transfer the same momentum independent of render rate.
// A per-frame acceleration cap previously made slow frames kick much harder.
test('start and stop momentum stays comparable at 60, 30 and 10 FPS', () => {
  const outcomes = [60, 30, 10].map(fps => {
    const state = createSuspension(), carriage = { x: 0, y: 3.5, z: 0 };
    stepSuspension(state, carriage, 1 / fps);
    for (let i = 0; i < .4 * fps; i++) { carriage.x += .85 / fps; stepSuspension(state, carriage, 1 / fps); }
    for (let i = 0; i < .4 * fps; i++) stepSuspension(state, carriage, 1 / fps);
    return state;
  });
  for (const state of outcomes.slice(1)) {
    assert.ok(Math.abs(state.x - outcomes[0].x) < .015);
    assert.ok(Math.abs(state.vx - outcomes[0].vx) < .025);
  }
});

test('a missed turn preserves the carriage position without adding the swing offset twice', () => {
  const game = createGame({ suspendedClaw: true }); begin(game);
  game.position = { x: .2, z: .1 }; drop(game);
  while (game.phase !== 'result') advance(game, .1);
  game.suspension.x = .08;
  const before = clawPose(game); begin(game);
  const after = clawPose(game);
  assert.deepEqual(game.position, { x: .2, z: .1 });
  assert.ok(Math.abs(before.x - after.x) < 1e-12);
});
