import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Step the rendered game's frame loop and real recognition handler together.
// Only camera startup and the initial aim/orbit position are synthetic fixtures.
export async function checkStarCue(browser) {
  const vision = await readFile(new URL('../src/vision.js', import.meta.url), 'utf8');
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = async () => { throw new Error('No physical camera in cue check'); };
      });
      await page.route('**/src/arcade.js*', async route => {
        const response = await route.fetch(), source = await response.text();
        assert.ok(source.includes('window.__littleCloud = { snapshot };'));
        await route.fulfill({ response, body: source
          .replaceAll('requestAnimationFrame(frame);', 'window.cueFrame = frame;')
          .replace('window.__littleCloud = { snapshot };', `window.__littleCloud = { snapshot };
            Object.defineProperty(window, 'cueGame', { get: () => game }); window.cueScene = scene;`) });
      });
      await page.route('**/src/vision.js*', route => route.fulfill({ contentType: 'application/javascript', body: vision + `
        HandController.prototype.start = async function() {
          this.running = true; this.generation++; window.cueController = this;
          this.lastCapture = -Infinity; this.lastResponseCapture = -Infinity;
          this.onState({ kind: 'ready' });
        };
        window.cueSample = (closed = false) => {
          window.cueTime = (window.cueTime || 1000) + 10;
          const lm = Array.from({ length: 21 }, () => ({ x: .5, y: .5, z: 0 }));
          lm[0].y = .56; lm[9].y = .44; lm[5].x -= .06; lm[17].x += .06;
          const phase = cueGame.phase;
          cueController.acceptResult({ landmarks: [lm], handedness: [[{ categoryName: 'Left' }]],
            gestures: [[{ categoryName: closed ? 'Closed_Fist' : 'Open_Palm', score: .99 }]] },
            cueTime, cueController.generation, cueTime + 20);
          if (phase === 'aim' && cueGame.phase === 'anticipate') window.cueAccepted = {
            held: cueController.fist.held, orbit: cueGame.carouselTime };
          cueFrame(cueTime);
        };
      ` }));
      await page.goto('http://127.0.0.1:4196');
      await page.waitForFunction(() => window.cueFrame);
      await page.locator('#play').click();
      await page.waitForFunction(() => window.cueController);
      await page.evaluate(() => { for (let i = 0; i < 100; i++) cueSample(); });
      await page.locator('#play').click();
      await page.locator('#name').fill('Synthetic star cue check');
      await page.locator('#name').press('Enter');
      await page.waitForFunction(() => window.__littleCloud.snapshot().event.run);
      await page.evaluate(() => {
        for (let i = 0; i < 100; i++) cueSample();
        cueGame.position = { x: .8, z: .22 }; cueGame.carouselTime = 2.4;
        window.readCue = () => {
          const state = __littleCloud.snapshot(), signal = document.getElementById('jackpot-signal');
          const tag = document.querySelector('.prize-tag[data-points="200"]'), rect = tag.getBoundingClientRect();
          const toy = state.toys.find(toy => toy.id === 'sprout');
          const point = cueScene.screenPoint(toy.position[0], toy.position[1] + .08, toy.position[2]);
          return { orbit: state.event.carouselTime, phase: state.phase, held: cueController.fist.held,
            title: document.getElementById('status').textContent, text: document.getElementById('jackpot-cue').textContent,
            visible: !signal.hidden, go: signal.classList.contains('go'), caught: state.caught,
            target: cueScene.target.position.toArray(), star: toy.position,
            tagVisible: !tag.hidden, tagOffset: tag.hidden ? null : Math.hypot(rect.x + rect.width / 2 - point.x, rect.y + rect.height / 2 - point.y) };
        };
      });
      const timeline = [];
      for (const target of [3.4, 3.9, 4.35, 4.54, 5.6]) {
        const state = await page.evaluate(target => {
          for (let guard = 0; guard < 1000 && cueGame.carouselTime < target - 1e-6 && cueGame.phase !== 'grip'; guard++)
            cueSample(cueGame.carouselTime >= 4 - 1e-6);
          return readCue();
        }, target);
        assert.ok(Math.abs(state.orbit - target) < .011, 'fixture advances the active game, not an obsolete run');
        timeline.push(state);
        if (target === 3.4) assert.equal(state.text, '2');
        if (target === 3.9) { assert.equal(state.go, true); assert.equal(state.text, 'CLENCH FIST & HOLD'); }
        if (target === 4.35 || target === 4.54) {
          assert.equal(state.visible, true);
          assert.equal(state.title, 'Hold to drop');
          assert.equal(state.text, 'KEEP HOLDING', 'the expired start cue must not tell an active hold to wait');
          assert.equal(state.tagVisible, true); assert.ok(state.tagOffset < 1);
        }
        if (target === 5.6) { assert.equal(state.phase, 'grip'); assert.equal(state.caught, 'sprout'); }
        if (target === 3.9 || target === 4.35) await page.screenshot({ path: `.screenshots/star-cue-${width}-${target}.png` });
      }
      const accepted = await page.evaluate(() => cueAccepted);
      assert.equal(accepted.held, 550);
      assert.ok(Math.abs(timeline.at(-1).orbit - accepted.orbit - 1.05) < .011);
      assert.deepEqual(timeline.at(-1).target.filter((_, i) => i !== 1), [.8, .22]);
      assert.ok(Math.hypot(timeline.at(-1).star[0] - .8, timeline.at(-1).star[2] - .22) < 1e-6);

      // Cancellation changes the display even while the underlying cue bucket
      // stays unchanged. Use a fresh scored turn, then repeat the same hold.
      await page.evaluate(() => {
        for (let i = 0; i < 2000 && cueGame.phase !== 'aim'; i++) cueSample();
        for (let i = 0; i < 100; i++) cueSample();
        cueGame.position = { x: .8, z: .22 }; cueGame.carouselTime = 4;
        for (let i = 0; i < 36; i++) cueSample(true);
      });
      assert.equal(await page.locator('#jackpot-cue').textContent(), 'KEEP HOLDING');
      const cancelled = await page.evaluate(() => { cueSample(false); return readCue(); });
      assert.equal(cancelled.held, 0); assert.equal(cancelled.text, 'WAIT FOR THE LIGHTS');
      assert.equal(cancelled.phase, 'aim');
      assert.deepEqual(errors, []);
      console.log('PASS rendered star cue and real fist path', JSON.stringify({ width, accepted, timeline, cancelled }));
    } finally { await page.close(); }
  }
}
