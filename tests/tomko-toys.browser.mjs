import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';

// Native entry wiring and real mesh/contact replay: a rule-table test cannot
// prove the replacement bodies are drawn or can be lifted by all three fingers.
const origin = process.env.CLAW_TEST_ORIGIN || 'http://127.0.0.1:4196';
const browser = await chromium.launch(browserOptions);
try {
  await mkdir('.screenshots', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.TomkoNative = { postMessage() {} }; });
  await page.goto(`${origin}/?setup=manual`);
  await page.waitForFunction(() => window.__littleCloud);
  const toys = await page.evaluate(() => window.__littleCloud.snapshot().toys);
  assert.equal(toys.find(t => t.id === 'blue-hour').family, 'bear');
  assert.equal(toys.find(t => t.id === 'peach').family, 'panda');
  assert.doesNotMatch(await page.locator('#mode-label').textContent(), /COLLECTION|LOCAL PREVIEW/);
  assert.equal(await page.locator('#register-other').isVisible(), false);
  await page.screenshot({ path: '.screenshots/tomko-refreshed-toys.png' });
  const report = await page.evaluate(async () => {
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const M = await import('/src/arcade-mechanics.js');
    const { clawWorldPoint } = await import('/src/claw-suspension.js');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const scene = new ArcadeScene(canvas, { suspendedClaw: true, assortment: M.BOOTH_TOYS });
    scene.renderer.render = () => {};
    const rows = [];
    for (const fps of [60, 30, 15, 10]) for (const toy of M.BOOTH_TOYS) {
      const game = M.createGame({ carousel: true, suspendedClaw: true, boothToys: true });
      scene.groundToys(game); M.begin(game);
      const target = game.toys.find(t => t.id === toy.id);
      if (toy.id === 'sprout') { M.moveCarousel(game, M.CAROUSEL.period - M.CONTACT_DELAY); game.position = { x: .8, z: .22 }; }
      else game.position = { x: target.x, z: target.z };
      scene.update(game, 0, 0, { x: 0, z: 0 }, null); M.drop(game);
      let lastGrip, firstLift, maxHeldError = 0;
      for (let frame = 0; frame < fps * 15 && game.phase !== 'result'; frame++) {
        M.advance(game, 1 / fps); scene.update(game, 1 / fps, frame / fps, { x: 0, z: 0 }, null);
        if (game.phase === 'grip') lastGrip = scene.fingers.map(f => f.radius);
        if (game.phase === 'lift') firstLift ??= scene.fingers.map(f => f.radius);
        if (game.plan.prize && ['lift', 'transfer'].includes(game.phase)) {
          const expected = clawWorldPoint(M.clawPose(game), game.plan.heldLocalOffset), actual = scene.toys.get(game.plan.prize.id).position;
          maxHeldError = Math.max(maxHeldError, Math.hypot(expected.x - actual.x, expected.y - actual.y, expected.z - actual.z));
        }
      }
      rows.push({ id: toy.id, fps, caught: game.plan.prize?.id, contacts: game.plan.gripContacts, phase: game.phase, rounds: game.rounds, collection: game.collection, maxHeldError,
        snap: lastGrip && firstLift ? Math.max(...lastGrip.map((r, i) => Math.abs(r - firstLift[i]))) : null });
    }
    // Peach used to mount the carousel after Sprout. Its replacement must still
    // make that transition and remain catchable without becoming a 200-point ID.
    const promoted = M.createGame({ carousel: true, suspendedClaw: true, boothToys: true });
    scene.groundToys(promoted);
    for (const id of ['sprout', 'peach']) {
      M.begin(promoted);
      M.moveCarousel(promoted, 2 * M.CAROUSEL.period - M.CONTACT_DELAY - promoted.carouselTime % M.CAROUSEL.period);
      promoted.position = { x: .8, z: .22 };
      scene.update(promoted, 0, 0, { x: 0, z: 0 }, null); M.drop(promoted);
      for (let frame = 0; frame < 900 && promoted.phase !== 'result'; frame++) {
        M.advance(promoted, 1 / 60); scene.update(promoted, 1 / 60, frame / 60, { x: 0, z: 0 }, null);
      }
      if (promoted.plan.prize?.id !== id) throw new Error(`Carousel replacement failed to catch ${id}`);
      if (promoted.plan.gripContacts.length !== 3 || promoted.plan.gripContacts.some(contact => contact !== id)) throw new Error(`Carousel contact mismatch for ${id}`);
    }
    if (promoted.rounds !== 2 || promoted.collection.join(',') !== 'sprout,peach' || promoted.rider !== null) throw new Error('Carousel replacement must deliver each rider once');
    scene.renderer.dispose(); canvas.remove();
    return rows;
  });
  for (const row of report) {
    assert.equal(row.caught, row.id, JSON.stringify(row));
    assert.equal(row.phase, 'result'); assert.equal(row.rounds, 1);
    assert.deepEqual(row.collection, [row.id]);
    assert.equal(row.contacts.length, 3); assert.ok(row.contacts.every(id => id === row.id));
    assert.ok(row.snap < 1e-8); assert.ok(row.maxHeldError < 1e-8);
  }
  assert.deepEqual(errors, []);
  console.log('PASS native toy wiring; six pickups, held finger continuity and single delivery at 60/30/15/10 FPS; panda carousel succession.');
} finally { await browser.close(); }
