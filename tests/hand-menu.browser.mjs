import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture } from './camera-fixture.mjs';
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(page);
  await page.goto('http://127.0.0.1:4196/');
  await page.waitForFunction(() => window.__littleCloud?.snapshot().event.handCamera.running);
  assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
  const point = async id => {
    const box = await page.locator(`#${id}`).boundingBox();
    await page.evaluate(({ x, y }) => { window.testCamera.feedback = { kind: 'tracking', pointer: { x, y } }; window.testCamera.tick(); }, { x: .18 + (box.x + box.width / 2) / 1440 * .64, y: .15 + (box.y + box.height / 2) / 900 * .70 });
    await page.waitForFunction(id => document.getElementById(id).classList.contains('hand-hover'), id);
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
  await page.evaluate(() => { window.testCamera.feedback.kind = 'lost'; window.testCamera.tick(); });
  await page.waitForTimeout(80); assert.equal(await fire(), false, 'lost hand cancels selection');
  await point('register-play'); await hold();
  await page.screenshot({ path: '.screenshots/hand-menu-start.png' });
  assert.equal(await fire(), true);
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
    HandController.prototype.draw = function() {};
    window.menuSample = (x, y, closed) => {
      window.sampleTime = (window.sampleTime || performance.now()) + 100;
      const lm = Array.from({length:21}, () => ({x:1-x,y,z:0}));
      lm[0].y += .06; lm[9].y -= .06; lm[5].x -= .06; lm[17].x += .06;
      menuController.handle({landmarks:[lm],handedness:[[{categoryName:'Left'}]],gestures:[[{categoryName:closed?'Closed_Fist':'Open_Palm',score:.99}]]}, sampleTime);
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
  await real.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  await samples(startPosition, true, 10);
  assert.equal(await real.evaluate(() => window.__littleCloud.snapshot().phase), 'aim', 'real recognizer requires open hand after START; no carried drop');
  await real.locator('#operator-open').click();await real.locator('#pause').click();
  await real.waitForFunction(()=>document.getElementById('status').textContent==='PAUSED');
  const resumePosition=await select('play');
  await real.waitForFunction(()=>!window.__littleCloud.snapshot().event.paused);
  await samples(resumePosition,true,10);
  assert.equal(await real.evaluate(()=>window.__littleCloud.snapshot().phase),'aim','held RESUME gesture cannot drop');
  await real.close();
  console.log('PASS automatic camera/audio preference, generated name, hand menu selection, lost-hand cancellation and gameplay/host isolation');
} finally { await browser.close(); }
