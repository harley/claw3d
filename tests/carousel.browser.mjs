import { installCameraFixture, cameraInput, cameraDrop, assertScoredStart } from './camera-fixture.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { writeFile } from 'node:fs/promises';
import { checkStarCue } from './star-cue-check.mjs';
const browser = await chromium.launch(browserOptions);
try {
  const errors = [];
  if (!process.argv.includes('--clearance-only')) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', recordVideo: { dir: '.screenshots/', size: { width: 1440, height: 900 } } });
  await installCameraFixture(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4196/?setup=manual'); await page.waitForFunction(() => window.__littleCloud);
  await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    window.checkStarTag = state => {
      const toy = state.toys.find(toy => toy.id === 'sprout');
      const position = toy.position;
      const viewport = document.querySelector('#scene').getBoundingClientRect();
      const camera = new T.PerspectiveCamera(35, viewport.width / viewport.height, .1, 70);
      camera.position.fromArray(state.camera); camera.lookAt(...state.cameraLook); camera.updateMatrixWorld();
      const point = new T.Vector3(position[0], toy.bounds.max[1] + .28, position[2]).project(camera);
      const tag = document.querySelector('.prize-tag[data-points="200"]'), rect = tag.getBoundingClientRect();
      return { visible: !tag.hidden, distance: Math.hypot(rect.x + rect.width / 2 - (viewport.x + (point.x + 1) / 2 * viewport.width), rect.y + rect.height / 2 - (viewport.y + (1 - point.y) / 2 * viewport.height)) };
    };
  });
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
  await page.locator('#play').click(); await page.locator('#name').fill('Star Pilot'); await page.locator('#name').press('Enter'); await assertScoredStart(page); await aim();
  // Dispatch in the observed timing window; screenshots/IPC must not delay DROP.
  await page.waitForFunction(() => {
    const state = window.__littleCloud.snapshot();
    if (!window.starHoldStarted) {
      if (!state.event.cue.now) return false;
      window.starCueText = document.getElementById('jackpot-cue').textContent;
      window.starHoldStarted = state.event.carouselTime;
      return false;
    }
    if (state.event.carouselTime - window.starHoldStarted < .55) return false;
    window.starTagCheck = window.checkStarTag(window.__littleCloud.snapshot(true));
    window.starBeforeDrop = state.toys.find(toy => toy.id === 'sprout').position;
    window.testCamera.clench(); return true;
  });
  assert.match(await page.evaluate(() => window.starCueText), /CLENCH.*FIST.*HOLD/);
  const before = await page.evaluate(() => window.starBeforeDrop);
  const tag = await page.evaluate(() => window.starTagCheck);
  assert.equal(tag.visible, true); assert.ok(tag.distance < 2, `Star label must follow visible toy, offset ${tag.distance}px`);
  await phase('descend'); assert.equal((await snap()).caught, null);
  await page.waitForTimeout(250); const during = (await snap()).toys.find(t => t.id === 'sprout').position;
  assert.ok(Math.hypot(before[0] - during[0], before[2] - during[2]) > .03);
  await phase('grip'); assert.equal((await snap()).caught, 'sprout'); await page.screenshot({ path: '.screenshots/carousel-grip.png' });
  await phase('result'); const starScore = (await snap()).event.run.turns[0].score; assert.ok(starScore > 200 && starScore <= 250);
  console.log('PASS camera cue + simulated 550ms hold + moving descent + actual star catch with speed bonus');
  await phase('aim'); await aim();
  await page.waitForFunction(() => { const t = window.__littleCloud.snapshot().event.carouselTime % 5.6; return t >= 3.5 && t < 3.7; });
  await cameraDrop(page); await phase('result'); assert.equal((await snap()).event.run.turns[1].score, 0);
  console.log('PASS early drop misses');
  await phase('aim'); await aim();
  await page.waitForFunction(() => { const t = window.__littleCloud.snapshot().event.carouselTime % 5.6; return t >= 5.4 && t < 5.55; });
  await cameraDrop(page); await phase('result'); assert.equal((await snap()).event.complete.total, starScore);
  assert.equal((await snap()).event.complete.turns[2].score, 0); assert.deepEqual(errors, []);
  await page.screenshot({ path: '.screenshots/carousel-result.png' });
  console.log('PASS late drop misses, correct speed-score total, no browser errors');
  const video = page.video(); await page.close(); await video.saveAs('.screenshots/carousel-gameplay.webm'); await video.delete();
  await checkStarCue(browser);
  }
  // Sweep actual rendered star geometry against all stationary toys. No GPU
  // draws are needed to exercise the exact transforms and bounding geometry.
  const sweep = await browser.newPage(); await sweep.goto('http://127.0.0.1:4196/?setup=manual'); await sweep.waitForFunction(() => window.__littleCloud);
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
  await writeFile(process.argv.includes('--clearance-only') ? '.screenshots/carousel-clearance.json' : '.screenshots/carousel-verification.json', JSON.stringify({ keyboard: process.argv.includes('--clearance-only') ? [] : ['timed star catch with speed bonus', 'early miss', 'late miss', 'movement during descent', 'correct final total'], clearance, errors }, null, 2));
} finally { await browser.close(); }
