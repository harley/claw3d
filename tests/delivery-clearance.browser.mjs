// Sample the actual animated mesh bounds, including the loaded toy and return.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:4196');
  await page.waitForFunction(() => window.__littleCloud);
  const report = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const { createGame, begin, drop, PHASES } = await import('/src/arcade-mechanics.js');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:960px;height:540px'; document.body.append(canvas);
    const scene = new ArcadeScene(canvas), collisions = []; let samples = 0, oldPlantHits = 0, firstTrayScale = null, fullTraySeen = false;
    // Geometry updates are unchanged; skip GPU draws for this exhaustive sweep.
    const renderFrame = scene.renderer.render.bind(scene.renderer), outletFrames = [];
    scene.renderer.render = () => {};
    const oldPlant = scene.deliveryObstacles.plant.clone().translate(new T.Vector3(-6.45, 0, 2.55));
    const moving = new T.Box3();
    for (const id of scene.toys.keys()) {
      const game = createGame(); scene.groundToys(game); begin(game);
      const toy = game.toys.find(t => t.id === id); game.position = { x: toy.x, z: toy.z }; drop(game);
      if (game.plan.prize?.id !== id) throw Error(`Uncatchable ${id}`);
      for (const phase of ['deliver', 'reveal']) {
        game.phase = phase; game.collection = phase === 'reveal' ? [id] : []; toy.claimed = phase === 'reveal';
        for (let step = 0; step <= 120; step++) {
          game.elapsed = PHASES[phase] * step / 120; scene.update(game, 1 / 60, 0, { x: 0, z: 0 }, null); samples++;
          if (id === 'butter' && phase === 'deliver' && scene.deliveryTray.visible) {
            firstTrayScale ??= scene.deliveryTray.scale.x;
            if (scene.deliveryTray.scale.x === 1) fullTraySeen = true;
          }
          if (id === 'butter' && phase === 'deliver' && [48, 51, 54, 57, 60, 63].includes(step)) {
            renderFrame(scene.scene, scene.camera); outletFrames.push(canvas.toDataURL('image/png'));
          }
          for (const [part, object] of [['toy', scene.toys.get(id)], ['tray', scene.deliveryTray], ['courier', scene.courier]]) {
            if (!object.visible) continue;
            moving.setFromObject(object, true);
            if (moving.intersectsBox(oldPlant)) oldPlantHits++;
            for (const [name, bounds] of Object.entries(scene.deliveryObstacles)) {
              // Require a small gap, not merely non-overlap.
              if (moving.intersectsBox(bounds.clone().expandByScalar(.03))) collisions.push({ id, phase, step, part, obstacle: name });
            }
          }
        }
      }
    }
    window.outletFrames = outletFrames;
    scene.observer.disconnect(); scene.renderer.dispose(); canvas.remove();
    return { samples, oldPlantHits, firstTrayScale, fullTraySeen, collisions };
  });
  assert.ok(report.oldPlantHits > 0, 'The check reproduces the original plant obstruction');
  assert.ok(report.firstTrayScale > 0 && report.firstTrayScale < .1, 'The tray eases in instead of appearing full-size in one frame');
  assert.equal(report.fullTraySeen, true, 'The tray reaches full size after clearing the outlet');
  assert.deepEqual(report.collisions, []);
  console.log(JSON.stringify(report));
  await page.evaluate(() => {
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:0;background:#080e1c;display:grid;grid-template-columns:repeat(3,1fr);gap:2px';
    for (const source of window.outletFrames) { const image = document.createElement('img'); image.src = source; image.style.width = '100%'; document.body.append(image); }
  });
  await page.screenshot({ path: '.screenshots/delivery-outlet-sequence.png', fullPage: true });
  await page.goto('http://127.0.0.1:4196/?inspect=butter&phase=deliver');
  await page.waitForFunction(() => window.__littleCloud);
  await page.screenshot({ path: '.screenshots/delivery-clearance.png' });
} finally { await browser.close(); }
