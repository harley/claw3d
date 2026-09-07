import { installCameraFixture, cameraInput, cameraDrop } from './camera-fixture.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const errors = [];
  if (!process.argv.includes('--clearance-only')) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', recordVideo: { dir: '.screenshots/', size: { width: 1440, height: 900 } } });
  await installCameraFixture(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4196'); await page.waitForFunction(() => window.__littleCloud);
  const snap = () => page.evaluate(() => window.__littleCloud.snapshot());
  const phase = state => page.waitForFunction(state => window.__littleCloud.snapshot().phase === state, state, { timeout: 30000 });
  async function aim() {
    for (const axis of ['x', 'z']) for (let i = 0; i < 8; i++) {
      const delta = ({ x: .80, z: .22 })[axis] - (await snap()).position[axis]; if (Math.abs(delta) < .012) break;
      const speed = Math.abs(delta) < .15 ? .25 : 1;
      await cameraInput(page, {x:0,z:0,[axis]:Math.sign(delta)*speed}); await page.waitForTimeout(Math.abs(delta) / (.85*speed) * 1000); await cameraInput(page,{x:0,z:0});
    }
  }
  await page.locator('#play').click(); await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
  await page.locator('#play').click(); await page.locator('#name').fill('Star Pilot'); await page.locator('#name').press('Enter'); await aim();
  // Dispatch in the observed timing window; screenshots/IPC must not delay DROP.
  await page.waitForFunction(() => {
    const state = window.__littleCloud.snapshot(), t = state.event.carouselTime % 5.6;
    if (t < 4.5 || t > 4.6) return false;
    window.starBeforeDrop = state.toys.find(toy => toy.id === 'sprout').position;
    window.testCamera.clasp(); return true;
  });
  const before = await page.evaluate(() => window.starBeforeDrop);
  await phase('descend'); assert.equal((await snap()).caught, null);
  await page.waitForTimeout(250); const during = (await snap()).toys.find(t => t.id === 'sprout').position;
  assert.ok(Math.hypot(before[0] - during[0], before[2] - during[2]) > .03);
  await phase('grip'); assert.equal((await snap()).caught, 'sprout'); await page.screenshot({ path: '.screenshots/carousel-grip.png' });
  await phase('result'); assert.equal((await snap()).event.run.turns[0].score, 200);
  console.log('PASS green cue + moving descent + actual star catch: 200');
  await phase('aim'); await aim();
  await page.waitForFunction(() => { const t = window.__littleCloud.snapshot().event.carouselTime % 5.6; return t >= 3.5 && t < 3.7; });
  await cameraDrop(page); await phase('result'); assert.equal((await snap()).event.run.turns[1].score, 0);
  console.log('PASS early drop misses');
  await phase('aim'); await aim();
  await page.waitForFunction(() => { const t = window.__littleCloud.snapshot().event.carouselTime % 5.6; return t >= 5.4 && t < 5.55; });
  await cameraDrop(page); await phase('result'); assert.equal((await snap()).event.complete.total, 200);
  assert.equal((await snap()).event.complete.turns[2].score, 0); assert.deepEqual(errors, []);
  await page.screenshot({ path: '.screenshots/carousel-result.png' });
  console.log('PASS late drop misses, final total 200, no browser errors');
  const video = page.video(); await page.close(); await video.saveAs('.screenshots/carousel-gameplay.webm'); await video.delete();
  }
  // Sweep actual rendered star geometry against all stationary toys. No GPU
  // draws are needed to exercise the exact transforms and bounding geometry.
  const sweep = await browser.newPage(); await sweep.goto('http://127.0.0.1:4196'); await sweep.waitForFunction(() => window.__littleCloud);
  const clearance = await sweep.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const { createGame, begin, moveCarousel, CAROUSEL, BED } = await import('/src/arcade-mechanics.js');
    const canvas = document.createElement('canvas'); document.body.append(canvas); const scene = new ArcadeScene(canvas); scene.renderer.render = () => {};
    const game = createGame({ carousel: true }); scene.groundToys(game); begin(game); const collisions = [], starBounds = new T.Box3(), otherBounds = new T.Box3(); let minGap = Infinity;
    for (let i = 0; i < 360; i++) {
      moveCarousel(game, CAROUSEL.period / 360); scene.update(game, 1 / 60, 0, { x: 0, z: 0 }, null);
      starBounds.setFromObject(scene.toys.get('sprout'), true); minGap = Math.min(minGap, starBounds.min.y - (BED + CAROUSEL.height));
      for (const toy of game.toys.filter(t => t.id !== 'sprout')) if (starBounds.intersectsBox(otherBounds.setFromObject(scene.toys.get(toy.id), true))) collisions.push({ step: i, toy: toy.id });
    }
    scene.observer.disconnect(); scene.renderer.dispose(); canvas.remove(); return { samples: 360, collisions, minGap };
  });
  assert.deepEqual(clearance.collisions, []); assert.ok(clearance.minGap > -.015);
  console.log('PASS full orbit mesh clearance', JSON.stringify(clearance));
  await writeFile(process.argv.includes('--clearance-only') ? '.screenshots/carousel-clearance.json' : '.screenshots/carousel-verification.json', JSON.stringify({ keyboard: process.argv.includes('--clearance-only') ? [] : ['timed 200-point catch', 'early miss', 'late miss', 'movement during descent', 'correct final total'], clearance, errors }, null, 2));
} finally { await browser.close(); }
