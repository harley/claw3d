import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCameraFixture, cameraInput, cameraDrop } from './camera-fixture.mjs';
import { browserOptions } from '../scripts/browser-options.mjs';

// Contract: rendered steel fingers must physically acquire each live prize,
// retain contact through lift, carry the original offset and release once.
// Existing contact replays exercise only the old upright finger geometry.
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4196/?setup=manual');
  await page.waitForFunction(() => window.__littleCloud);
  assert.ok((await page.evaluate(() => window.__littleCloud.snapshot())).claw.rotation, 'the active entry boots the new physical claw');
  const report = await page.evaluate(async () => {
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const M = await import('/src/arcade-mechanics.js');
    const { clawWorldPoint } = await import('/src/claw-suspension.js');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:100'; document.body.append(canvas);
    const scene = new ArcadeScene(canvas, { suspendedClaw: true }), render = scene.renderer.render.bind(scene.renderer);
    scene.renderer.render = () => {};
    const rows = [];
    for (const fps of [60, 30, 10]) for (const id of ['butter', 'blue-hour', 'peach', 'miso', 'bonbon', 'sprout', 'swing', 'settled-swing', 'side', 'empty', 'displaced']) {
      const game = M.createGame({ carousel: true, suspendedClaw: true }); scene.groundToys(game); M.begin(game);
      const target = game.toys.find(t => t.id === (['swing', 'settled-swing', 'displaced'].includes(id) ? 'butter' : id));
      if (id === 'sprout') { M.moveCarousel(game, M.CAROUSEL.period - M.CONTACT_DELAY); game.position = { x: .8, z: .22 }; }
      else if (id === 'side') game.position = { x: -.18, z: .72 };
      else if (id === 'empty') game.position = { x: -1.12, z: .66 };
      else game.position = { x: target.x, z: target.z };
      if (['swing', 'settled-swing'].includes(id)) {
        game.position.x -= .34; M.advanceSuspension(game, 1 / fps);
        for (let i = 0; i < Math.round(.4 * fps); i++) { game.position.x += .85 / fps; M.advanceSuspension(game, 1 / fps); }
        for (let i = 0; i < Math.round((id === 'settled-swing' ? 1.5 : .36) * fps); i++) M.advanceSuspension(game, 1 / fps);
      }
      scene.update(game, 0, 0, { x: 0, z: 0 }, null); M.drop(game);
      let lastGrip, firstLift, maxHeldError = 0, peakSwing = 0, displaced = false, releaseAnchor, maxReleaseDrift = 0, frame;
      for (frame = 0; frame < fps * 15 && game.phase !== 'result'; frame++) {
        M.advance(game, 1 / fps);
        if (id === 'displaced' && game.phase === 'grip' && !displaced) { game.suspension.x = .28; displaced = true; }
        scene.update(game, 1 / fps, frame / fps, { x: 0, z: 0 }, null);
        const pose = M.clawPose(game); peakSwing = Math.max(peakSwing, Math.abs(pose.rotation.z));
        if (game.phase === 'grip') lastGrip = scene.fingers.map(f => f.radius);
        if (game.phase === 'lift') firstLift ??= scene.fingers.map(f => f.radius);
        if (game.plan.prize && ['lift', 'transfer'].includes(game.phase)) {
          const expected = clawWorldPoint(pose, game.plan.heldLocalOffset), actual = scene.toys.get(game.plan.prize.id).position;
          maxHeldError = Math.max(maxHeldError, Math.hypot(expected.x - actual.x, expected.y - actual.y, expected.z - actual.z));
        }
        if (game.plan.prize && game.phase === 'release') {
          const actual = scene.toys.get(game.plan.prize.id).position;
          releaseAnchor ??= { x: actual.x, z: actual.z };
          maxReleaseDrift = Math.max(maxReleaseDrift, Math.hypot(actual.x - releaseAnchor.x, actual.z - releaseAnchor.z));
        }
      }
      rows.push({ fps, id, caught: game.plan.prize?.id || null, reason: game.plan.reason, collection: [...game.collection], rounds: game.rounds, phase: game.phase,
        contacts: game.plan.gripContacts, peakSwing, maxHeldError, maxReleaseDrift, releaseAnchor,
        snap: lastGrip && firstLift ? Math.max(...lastGrip.map((r, i) => Math.abs(r - firstLift[i]))) : null });
    }
    // Show a real held prize, not the empty comparison model, for visual review.
    const game = M.createGame({ carousel: true, suspendedClaw: true }); scene.groundToys(game); M.begin(game); game.position = { x: -.38, z: .72 }; M.drop(game);
    for (let i = 0; i < 240 && !(game.phase === 'lift' && game.elapsed > .8); i++) { M.advance(game, 1 / 60); scene.update(game, 1 / 60, i / 60, { x: 0, z: 0 }, null); }
    scene.camera.position.set(.35, 3.9, 6.1); scene.camera.lookAt(0, 3, 0); render(scene.scene, scene.camera);
    return rows;
  });
  await page.screenshot({ path: '.screenshots/suspended-claw-pickup.png' });
  console.log(JSON.stringify(report, null, 2));
  for (const row of report) {
    const expected = ['swing', 'side', 'empty', 'displaced'].includes(row.id) ? null : row.id === 'settled-swing' ? 'butter' : row.id;
    assert.equal(row.caught, expected, `${row.fps} FPS ${row.id}: ${row.reason}`);
    assert.equal(row.phase, 'result'); assert.equal(row.rounds, 1);
    assert.deepEqual(row.collection, expected ? [expected] : [], 'one delivery or no prize');
    if (expected) {
      assert.ok(row.contacts.every(id => id === expected), 'all three visible fingers contacted the caught toy');
      assert.ok(row.snap < 1e-8, 'resolved finger contacts carry into lift');
      assert.ok(row.maxHeldError < 1e-8, 'the toy follows the displaced/tilted claw');
      assert.ok(row.maxReleaseDrift < 1e-8, 'released toy no longer follows head swing');
      assert.ok(Math.abs(row.releaseAnchor.x + 1.08) < .12 && Math.abs(row.releaseAnchor.z - .66) < .12, 'release stays over the chute');
    }
    if (row.id === 'swing') assert.ok(row.peakSwing > .005, 'pickup replay actually exercises residual inertia');
  }
  // Contract: the active entry retains the selected claw across a real run,
  // scores exactly three accepted drops, and finishes despite hand loss.
  await installCameraFixture(page);
  await page.goto('http://127.0.0.1:4196/?setup=manual');
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#play').click();
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
  await page.locator('#play').click();
  await page.locator('#name').fill('Steel claw replay'); await page.locator('#name').press('Enter');
  for (let turn = 1; turn <= 3; turn++) {
    await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
    if (turn === 1) {
      await cameraInput(page, { x: 0, z: 0, target: { x: -.38, z: .72 } });
      await page.waitForFunction(() => {
        const p = window.__littleCloud.snapshot().position;
        return Math.hypot(p.x + .38, p.z - .72) < .005;
      });
      await cameraInput(page, { x: 0, z: 0 });
      await page.waitForTimeout(2000);
    }
    assert.equal(await cameraDrop(page), true);
    assert.equal(await cameraDrop(page), false, 'a committed drop cannot score twice');
    await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
    await page.waitForFunction(turn => {
      const e = window.__littleCloud.snapshot().event;
      return (e.run || e.complete)?.turns.length === turn;
    }, turn, { timeout: 20000 });
    const snapshot = await page.evaluate(() => window.__littleCloud.snapshot());
    assert.ok(snapshot.claw.rotation, 'fresh game retains the suspended claw');
    if (turn === 1) assert.equal(snapshot.event.run.turns[0].prizeId, 'butter');
    await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  }
  const completed = await page.evaluate(() => window.__littleCloud.snapshot().event);
  assert.equal(completed.run, null);
  assert.equal(completed.complete.turns.length, 3);
  assert.equal(completed.board.runs.length, 1);
  assert.equal(completed.complete.total, completed.complete.turns.reduce((sum, t) => sum + t.score, 0));
  assert.equal(await cameraDrop(page), false, 'a completed run cannot accept a fourth drop');
  assert.deepEqual(errors, []);
  console.log('PASS suspended steel claw: mesh pickup, inertia, misses, lift continuity and chute delivery at 60/30/10 FPS');
} finally { await browser.close(); }
