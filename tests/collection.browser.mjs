import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture, cameraInput, cameraDrop } from './camera-fixture.mjs';

// Contract: six authored meshes remain catchable with the real suspended claw,
// quality survives the scene/contact boundary, and the active entry persists
// exactly three precision-scored turns. Existing suites use the old assortment.
const browser = await chromium.launch(browserOptions);
try {
  await mkdir('.screenshots', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4196/?setup=manual&toys=collection');
  await page.waitForFunction(() => window.__littleCloud);
  assert.match(await page.locator('#mode-label').textContent(), /COLLECTION/);
  const report = await page.evaluate(async () => {
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const M = await import('/src/arcade-mechanics.js');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:100'; document.body.append(canvas);
    const scene = new ArcadeScene(canvas, { suspendedClaw: true, assortment: M.COLLECTION_TOYS });
    const render = scene.renderer.render.bind(scene.renderer); scene.renderer.render = () => {};
    const rows = [];
    const idle = M.createGame({ carousel: true, suspendedClaw: true, collection: true }); scene.groundToys(idle);
    for (const time of [0, .1, .5, 1.3, 4]) {
      scene.update(idle, 0, time, { x: 0, z: 0 }, null);
      for (const object of scene.toys.values()) {
        const scale = object.userData.blink?.scale.y;
        if (scale != null && (scale < .14 || scale > 1.01)) throw new Error(`Invalid blink scale ${scale} for ${object.userData.data.id}`);
      }
    }
    for (const fps of [60, 30, 10]) for (const id of [...M.COLLECTION_TOYS.map(t => t.id), 'edge', 'miss']) {
      const game = M.createGame({ carousel: true, suspendedClaw: true, collection: true }); scene.groundToys(game); M.begin(game);
      const toy = game.toys.find(t => t.id === (['edge', 'miss'].includes(id) ? 'butter' : id));
      if (id === 'sprout') { M.moveCarousel(game, M.CAROUSEL.period - M.CONTACT_DELAY); game.position = { x: .8, z: .22 }; }
      else game.position = { x: toy.x + (id === 'edge' ? .075 : id === 'miss' ? .33 : 0), z: toy.z };
      scene.update(game, 0, 0, { x: 0, z: 0 }, null); M.drop(game);
      let lastGrip, firstLift;
      for (let i = 0; i < fps * 15 && game.phase !== 'result'; i++) {
        M.advance(game, 1 / fps); scene.update(game, 1 / fps, i / fps, { x: 0, z: 0 }, null);
        if (game.phase === 'grip') lastGrip = scene.fingers.map(f => f.radius);
        if (game.phase === 'lift') firstLift ??= scene.fingers.map(f => f.radius);
      }
      rows.push({ id, fps, prize: game.plan.prize?.id ?? null, quality: M.catchQuality(game.plan), precision: game.plan.precision, reason: game.plan.reason, rounds: game.rounds, collection: game.collection, phase: game.phase,
        snap: lastGrip && firstLift ? Math.max(...lastGrip.map((v, i) => Math.abs(v - firstLift[i]))) : null });
    }
    const preview = M.createGame({ carousel: true, suspendedClaw: true, collection: true }); scene.groundToys(preview); M.begin(preview); scene.update(preview, 0, 0, { x: 0, z: 0 }, null);
    scene.camera.position.set(.1, 5.4, 6.2); scene.camera.lookAt(0, 2.5, 0); render(scene.scene, scene.camera);
    return rows;
  });
  await page.screenshot({ path: '.screenshots/collection-toys.png' });
  console.log(JSON.stringify(report));
  for (const row of report) {
    assert.equal(row.phase, 'result'); assert.equal(row.rounds, 1);
    assert.equal(row.prize, row.id === 'miss' ? null : row.id === 'edge' ? 'butter' : row.id, JSON.stringify(row));
    assert.equal(row.quality, row.id === 'miss' ? 'miss' : row.id === 'edge' ? 'ordinary' : 'perfect', JSON.stringify(row));
    assert.equal(row.collection.length, row.id === 'miss' ? 0 : 1);
    if (row.prize) assert.ok(row.snap < .001, 'fingers retain their grip radius into lift');
  }
  await installCameraFixture(page);
  await page.goto('http://127.0.0.1:4196/?setup=manual&toys=collection');
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#play').click();
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
  await page.locator('#play').click(); await page.locator('#name').fill('Collection replay'); await page.locator('#name').press('Enter');
  for (let turn = 1; turn <= 3; turn++) {
    await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
    const target = turn === 1 ? { x: -.38, z: .72 } : turn === 2 ? { x: -.835, z: -.61 } : { x: -1.15, z: .70 };
    await cameraInput(page, { x: 0, z: 0, target });
    await page.waitForFunction(target => { const p = window.__littleCloud.snapshot().position; return Math.hypot(p.x-target.x,p.z-target.z) < .004; }, target);
    await cameraInput(page, { x: 0, z: 0 }); await page.waitForTimeout(1800);
    assert.equal(await cameraDrop(page), true); assert.equal(await cameraDrop(page), false);
    await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
    await page.waitForFunction(turn => { const e=window.__littleCloud.snapshot().event; return (e.run||e.complete)?.turns.length === turn; }, turn, { timeout: 20000 });
    await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  }
  const done = await page.evaluate(() => window.__littleCloud.snapshot().event);
  assert.deepEqual(done.complete.turns.map(t => t.quality), ['perfect', 'ordinary', 'miss']);
  assert.deepEqual(done.complete.turns.map(t => t.score), [200, 150, 0]);
  assert.equal(done.complete.total, 350); assert.equal(done.board.runs.length, 1);
  assert.match(await page.locator('#final-turns').textContent(), /50 PERFECT/);
  assert.doesNotMatch(await page.locator('#final-turns').textContent(), /SPEED/);
  await page.screenshot({ path: '.screenshots/collection-results.png' });
  await page.reload(); await page.waitForFunction(() => window.__littleCloud);
  assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.board.runs[0].total), 350);
  await page.goto('http://127.0.0.1:4196/?setup=manual'); await page.waitForFunction(() => window.__littleCloud);
  assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.board.runs.length), 0);
  assert.deepEqual(errors, []);
  console.log('PASS collection: six mesh pickups and quality at 60/30/10 FPS; three turns, hand loss, receipt recovery and default isolation');
} finally { await browser.close(); }
