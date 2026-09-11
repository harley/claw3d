import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ArcadeScene } from '../src/arcade-scene.js';

// The scene's effect methods run against stubbed GPU objects: behaviour is
// exercised without a WebGL context, matching render-budget.test.mjs.
function effectsFixture() {
  const scene = Object.create(ArcadeScene.prototype);
  scene.scene = { add: () => {} };
  const colors = [];
  scene.burst = { count: 0, visible: false, setColorAt: (i, c) => { colors[i] = `#${c.getHexString()}`; }, setMatrixAt: () => {}, instanceMatrix: {}, instanceColor: {} };
  scene.burstDummy = new T.Object3D(); scene.burstParticles = [];
  return { scene, colors };
}

test('a catch burst animates, fades and releases its instances', () => {
  const { scene } = effectsFixture();
  scene.spawnBurst(new T.Vector3(0, 3, 0), false);
  assert.equal(scene.burst.count, 80);
  assert.equal(scene.burst.visible, true);
  const first = scene.burstParticles[0], startY = first.position.y;
  scene.updateBurst(1 / 60);
  assert.notEqual(first.position.y, startY, 'particles move');
  for (let i = 0; i < 120; i++) scene.updateBurst(1 / 60);
  assert.equal(scene.burst.visible, false, 'burst hides once every particle expires');
  assert.equal(scene.burst.count, 0);
  assert.equal(scene.burstParticles.length, 0);
});

test('the star jackpot bursts bigger with gold in the mix', () => {
  const { scene, colors } = effectsFixture();
  scene.spawnBurst(new T.Vector3(0, 3, 0), true);
  assert.equal(scene.burst.count, 140);
  assert.ok(colors.includes('#ffd75e'), 'gold confetti marks the 200-point star');
});

function marqueeFixture() {
  const scene = Object.create(ArcadeScene.prototype);
  const bulbs = [], paints = { count: 0 };
  scene.marqueeBulbs = { setColorAt: (i, c) => { paints.count++; bulbs[i] = `#${c.getHexString()}`; }, instanceColor: {} };
  return { scene, bulbs, paints };
}

test('marquee bulbs chase during delivery, strobe on jackpot and rest between', () => {
  const { scene, bulbs, paints } = marqueeFixture();
  const distinct = () => new Set(bulbs).size;
  scene.updateMarquee('aim', null, 1, 1);
  assert.equal(distinct(), 1, 'aiming keeps a calm marquee');
  const painted = paints.count;
  scene.updateMarquee('aim', null, 1.02, 1);
  assert.equal(paints.count, painted, 'an unchanged pattern is not repainted or re-uploaded');
  scene.updateMarquee('deliver', { prize: { family: 'bunny' } }, 1, 1);
  assert.equal(distinct(), 2, 'delivery chases: lit and unlit bulbs coexist');
  const chaseA = [...bulbs];
  scene.updateMarquee('deliver', { prize: { family: 'bunny' } }, 1.15, 1);
  assert.notDeepEqual([...bulbs], chaseA, 'the chase moves over time');
  scene.updateMarquee('reveal', { prize: { family: 'star' } }, 1, 1);
  const strobeA = [...bulbs];
  scene.updateMarquee('reveal', { prize: { family: 'star' } }, 1.08, 1);
  assert.notDeepEqual([...bulbs], strobeA, 'the jackpot strobe flips');
  scene.updateMarquee('idle', null, 2, 1);
  assert.equal(distinct(), 2, 'attract mode chases slowly on the idle machine');
});

test('reduced motion keeps the marquee steady in every phase', () => {
  const { scene, bulbs } = marqueeFixture();
  for (const [phase, plan] of [['idle', null], ['deliver', { prize: { family: 'bunny' } }], ['reveal', { prize: { family: 'star' } }]]) {
    const seen = new Set();
    for (const time of [1, 1.07, 1.4, 2.2]) { scene.updateMarquee(phase, plan, time, 0); seen.add(bulbs.join()); }
    assert.equal(seen.size, 1, `${phase} must not flash under reduced motion`);
    assert.equal(new Set(bulbs).size, 1, `${phase} shows one steady colour under reduced motion`);
  }
});
