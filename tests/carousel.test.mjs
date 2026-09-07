import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, begin, drop, advance, moveCarousel, aimTarget, carouselPose, carouselCue, CAROUSEL, CONTACT_DELAY, PHASES, BODY, BED, clawPose } from '../src/arcade-mechanics.js';
const pickup = { x: CAROUSEL.x, z: CAROUSEL.z + CAROUSEL.radius };
function shot(time, dt = 1 / 60, position = pickup) {
  const game = createGame({ carousel: true }); begin(game); moveCarousel(game, time); game.position = { ...position }; drop(game);
  while (['anticipate', 'descend'].includes(game.phase)) advance(game, dt);
  return game;
}
test('green cue predicts contact; the star moves during descent and catch resolves at contact', () => {
  const game = createGame({ carousel: true }); begin(game); moveCarousel(game, CAROUSEL.period - CONTACT_DELAY); game.position = { ...pickup };
  const star = game.toys.find(t => t.id === CAROUSEL.id), start = { x: star.x, z: star.z };
  assert.equal(carouselCue(game.carouselTime, 0).now, true); assert.equal(aimTarget(game).id, CAROUSEL.id);
  drop(game); assert.equal(game.plan.prize, null); advance(game, CONTACT_DELAY / 2);
  assert.ok(Math.hypot(star.x - start.x, star.z - start.z) > .10); assert.equal(game.plan.prize, null);
  advance(game, CONTACT_DELAY / 2); assert.equal(game.phase, 'grip'); assert.equal(game.plan.prize.id, CAROUSEL.id);
  assert.ok(Math.hypot(star.x - pickup.x, star.z - pickup.z) < 1e-8);
  const contact = clawPose(game); advance(game, PHASES.grip); assert.ok(Math.abs(clawPose(game).y - contact.y) < 1e-8);
  assert.ok(Math.abs(clawPose(game).y - game.plan.offset.y - BED - CAROUSEL.height) < 1e-8);
});
test('early and late drops miss; signal window is achievable; timing is frame-rate independent', () => {
  const cue = CAROUSEL.period - CONTACT_DELAY;
  for (const offset of [-.18, 0, .18]) assert.equal(shot(cue + offset).plan.prize?.id, CAROUSEL.id);
  for (const offset of [-1, 1]) assert.equal(shot(cue + offset).plan.prize, null);
  for (const fps of [20, 30, 60, 120]) assert.equal(shot(cue, 1 / fps).plan.prize?.id, CAROUSEL.id);
  assert.equal(shot(cue, CONTACT_DELAY).plan.prize?.id, CAROUSEL.id);
});
test('stationary catches work at every carousel phase; wrong aim never earns a jackpot', () => {
  for (const time of [0, 1, 2, 3, 4, 5]) {
    const game = shot(time, 1 / 60, { x: -.38, z: .72 }); assert.equal(game.plan.prize?.id, 'butter');
    assert.equal(shot(time, 1 / 60, { x: -1.12, z: .66 }).plan.prize, null);
  }
});
test('carousel motion has a repeatable orbit clear of the stationary support envelopes', () => {
  const game = createGame({ carousel: true }), star = game.toys.find(t => t.id === CAROUSEL.id);
  for (let i = 0; i <= 360; i++) {
    const pose = carouselPose(i / 360 * CAROUSEL.period);
    for (const other of game.toys.filter(t => t !== star)) assert.ok(Math.hypot(pose.x - other.x, pose.z - other.z) > BODY.star.rx * star.scale + BODY[other.family].rx * other.scale + .025);
  }
  const first = carouselPose(0), last = carouselPose(CAROUSEL.period);
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < 1e-8);
  assert.equal(carouselCue(CAROUSEL.period - CONTACT_DELAY - .65 - 1).lights, 1);
  assert.equal(carouselCue(CAROUSEL.period - CONTACT_DELAY - .65 - .6).lights, 2);
  assert.equal(carouselCue(CAROUSEL.period - CONTACT_DELAY - .65 - .3).lights, 3);
});

test('camera cue includes the hold delay across repeated orbits', () => {
  for (let cycle = 1; cycle <= 5; cycle++) {
    const time = cycle * CAROUSEL.period - CONTACT_DELAY - .65;
    assert.equal(carouselCue(time).now, true);
    assert.equal(carouselCue(time).text, 'BRING HANDS TOGETHER');
    assert.equal(shot(time + .65).plan.prize?.id, CAROUSEL.id);
  }
});
