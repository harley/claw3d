import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcadeScene } from '../src/arcade-scene.js';

test('camera rendering stays at 30 FPS on high refresh displays', () => {
  for (const refresh of [60, 120, 144]) {
    const scene = Object.create(ArcadeScene.prototype);
    let draws = 0;
    scene.renderer = { render: () => draws++ };
    for (let frame = 0; frame < refresh * 3; frame++) scene.draw(frame / refresh, true);
    assert.ok(draws >= 89 && draws <= 91, `${refresh} Hz submitted ${draws} draws`);
  }
});

test('camera shutdown restores display cadence; a stall does not cause catch-up draws', () => {
  const scene = Object.create(ArcadeScene.prototype);
  let draws = 0;
  scene.renderer = { render: () => draws++ };
  scene.draw(0, true);
  scene.draw(.008, true);
  assert.equal(draws, 1);
  scene.draw(.016, false);
  scene.draw(.024, false);
  assert.equal(draws, 3);
  scene.draw(20, true);
  scene.draw(20.008, true);
  assert.equal(draws, 4);
});
