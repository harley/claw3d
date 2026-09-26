import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { assertMenuGuidance } from './menu-guidance.mjs';
import { installCameraFixture } from './camera-fixture.mjs';
const browser = await chromium.launch(browserOptions);
try {
  await assertMenuGuidance(browser);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(page);
  await page.goto('http://127.0.0.1:4196/');
  await page.waitForFunction(() => window.__littleCloud?.snapshot().event.handCamera.running);
  await page.waitForFunction(() => !document.getElementById('menu-guide').hidden);
  assert.equal(await page.locator('#menu-guide strong').textContent(), 'Raise your hand');
  await page.screenshot({ path: '.screenshots/clp81-after-idle.png' });
  assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
  const point = async id => {
    const box = await page.locator(`#${id}`).boundingBox();
    await page.evaluate(({ x, y }) => { window.testCamera.feedback = { kind: 'tracking', pointer: { x, y } }; window.testCamera.tick(); }, { x: .18 + (box.x + box.width / 2) / 1440 * .64, y: .15 + (box.y + box.height / 2) / 900 * .70 });
    await page.waitForFunction(id => document.getElementById(id).classList.contains('hand-hover'), id);
    assert.equal(await page.locator('#menu-guide').isVisible(), false);
    assert.equal(await page.locator('#hand-cursor.demonstrating').count(), 1);
  };
  const hold = async () => { await page.evaluate(() => { window.testCamera.feedback.kind = 'clenching'; window.testCamera.feedback.progress = .7; window.testCamera.tick(); }); await page.waitForFunction(() => Number(document.getElementById('hand-cursor').style.getPropertyValue('--hold')) > 0); };
  const fire = () => page.evaluate(() => window.testCamera.clench());
  await point('play');
  assert.equal(await fire(), false, 'pointing without a hold cannot select');
  await point('play'); await hold(); assert.equal(await fire(), true);
  await page.locator('#registration').waitFor();
  assert.match(await page.locator('#name').inputValue(), /^(?:🦀|🦊|🐻|🐱|🐰|🦦|🐧|🐉) [A-Z][a-z]+$/u);
  // Wait for ownership reset; cursor belongs to the modal top layer.
  await page.waitForTimeout(80); await point('register-play');
  assert.equal(await page.locator('#registration #hand-cursor').count(), 1);
  await hold();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('#hand-cursor').isVisible(), false, 'hidden page clears without waiting for animation frames');
  assert.equal(await fire(), false);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await point('register-play'); await hold();
  await page.evaluate(() => { window.testCamera.feedback.kind = 'lost'; window.testCamera.tick(); });
  await page.waitForTimeout(80); assert.equal(await fire(), false, 'lost hand cancels selection');
  await point('register-play'); await hold();
  await page.screenshot({ path: '.screenshots/hand-menu-start.png' });
  assert.equal(await fire(), true);
  await page.evaluate(() => window.testCamera.clearFeedback());
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.firstTurnControlReady);
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => window.__littleCloud.snapshot())).event.run.turns.length, 0);
  assert.equal(await page.locator('#hand-cursor').isVisible(), false);
  // No gesture operation is available inside host controls.
  await page.locator('#operator-open').click();
  assert.equal(await fire(), false);
  assert.equal((await page.evaluate(() => window.__littleCloud.snapshot())).phase, 'aim');
  assert.deepEqual(errors, []);

  await page.close();
  const real = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const source = await readFile(new URL('../src/vision.js', import.meta.url), 'utf8');
  await real.route('**/src/vision.js*', route => route.fulfill({ contentType: 'application/javascript', body: source + `
    HandController.prototype.start = async function() { this.running = true; window.menuController = this; this.onState({kind:'ready'}); };
    const drawHands = HandController.prototype.draw;
    HandController.prototype.draw = function(...args) { if (window.menuDual) drawHands.apply(this, args); };
    window.menuSample = (x, y, closed) => {
      window.sampleTime = (window.sampleTime || performance.now()) + 100;
      const lm = Array.from({length:21}, () => ({x:1-x,y,z:0}));
      lm[0].y += .06; lm[9].y -= .06; lm[5].x -= .06; lm[17].x += .06;
      const result = {landmarks:[lm],handedness:[[{categoryName:'Left',score:.99}]],gestures:[[{categoryName:closed?'Closed_Fist':'Open_Palm',score:.99}]]};
      if (window.menuDual && window.menuRightVisible !== false) {
        const right = lm.map(point => ({...point, x: point.x + x - .75}));
        result.landmarks.push(right); result.handedness.push([{categoryName:'Right',score:.99}]);
        result.gestures.push([{categoryName:'Open_Palm',score:.99}]);
      }
      menuController.handle(result, sampleTime);
    };
  ` }));
  await real.goto('http://127.0.0.1:4196/');
  await real.waitForFunction(() => window.menuController?.running);
  const samples = async (position, closed, count) => {
    for (let i = 0; i < count; i++) await real.evaluate(async ({position, closed}) => {
      menuSample(position.x, position.y, closed);
      await new Promise(requestAnimationFrame);
    }, {position, closed});
  };
  const select = async id => {
    const box = await real.locator(`#${id}`).boundingBox();
    const position = { x: .18 + (box.x + box.width / 2) / 1440 * .64, y: .15 + (box.y + box.height / 2) / 900 * .70 };
    await samples(position, false, 16);
    await real.waitForFunction(id => document.getElementById(id).classList.contains('hand-hover'), id);
    await samples(position, true, 8);
    return position;
  };
  const playPosition = await select('play');
  await real.locator('#registration').waitFor();
  await samples(playPosition, true, 10);
  assert.equal(await real.evaluate(() => window.__littleCloud.snapshot().event.run), null, 'held menu fist does not start another action');
  const startPosition = await select('register-play');
  await samples(startPosition, false, 16);
  await real.waitForFunction(() => window.__littleCloud.snapshot().event.firstTurnControlReady);
  await real.evaluate(position => { window.prepSamples = setInterval(() => menuSample(position.x, position.y, false), 130); }, startPosition);
  await real.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  await real.evaluate(() => clearInterval(window.prepSamples));
  await samples(startPosition, true, 10);
  assert.equal(await real.evaluate(() => window.__littleCloud.snapshot().phase), 'aim', 'real recognizer requires open hand after START; no carried drop');
  await real.locator('#operator-open').click();await real.locator('#pause').click();
  await real.waitForFunction(()=>document.getElementById('status').textContent==='PAUSED');
  assert.equal(await real.locator('#menu-guide').isVisible(), false, 'pause keeps its specific help');
  const resumePosition=await select('play');
  await real.waitForFunction(()=>!window.__littleCloud.snapshot().event.paused);
  await samples(resumePosition,true,10);
  assert.equal(await real.evaluate(()=>window.__littleCloud.snapshot().phase),'aim','held RESUME gesture cannot drop');
  // Use the real recognition/menu path with both hands visible from entry.
  await real.goto('http://127.0.0.1:4196/?controls=dual');
  await real.waitForFunction(() => window.menuController?.running);
  await real.evaluate(() => { window.menuDual = true; });
  await select('play');
  await real.locator('#registration').waitFor();
  await select('register-play');
  const resting = { x: .3, y: .5 };
  await samples(resting, true, 12);
  await real.waitForFunction(() => document.getElementById('status').textContent === 'OPEN LEFT HAND');
  assert.equal(await real.evaluate(() => window.__littleCloud.snapshot().event.turn), 0);
  await real.evaluate(() => { window.menuRightVisible = false; });
  await samples(resting, false, 12);
  await real.waitForFunction(() => document.getElementById('status').textContent === 'SHOW RIGHT HAND OPEN');
  assert.equal(await real.locator('#camera-overlay').getAttribute('data-left'), 'active');
  assert.equal(await real.locator('#camera-overlay').getAttribute('data-right'), 'open');
  assert.equal(await real.evaluate(() => window.__littleCloud.snapshot().event.firstTurnPreparationElapsed), 0);
  await real.screenshot({ path: '.screenshots/issue-103-right-hand-readiness.png' });
  await real.evaluate(() => { window.menuRightVisible = true; });
  await samples(resting, false, 12);
  await real.waitForFunction(() => window.__littleCloud.snapshot().event.firstTurnControlReady);
  await real.evaluate(position => { window.prepSamples = setInterval(() => menuSample(position.x, position.y, false), 130); }, resting);
  await real.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  await real.evaluate(() => clearInterval(window.prepSamples));
  assert.equal(await real.evaluate(() => window.__littleCloud.snapshot().event.turn), 1);
  assert.equal(await real.evaluate(() => window.__littleCloud.snapshot().event.run.turns.length), 0);
  await real.close();
  console.log('PASS automatic camera/audio preference, generated name, hand menu selection, lost-hand cancellation and gameplay/host isolation');
} finally { await browser.close(); }
