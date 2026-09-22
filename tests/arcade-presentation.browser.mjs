import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture } from './camera-fixture.mjs';
const browser = await chromium.launch(browserOptions);
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 await installCameraFixture(page);
 await page.goto(process.env.PRESENTATION_TEST_ORIGIN || 'http://127.0.0.1:4196/?setup=manual'); await page.waitForFunction(() => window.__littleCloud);
 await page.locator('#play').click(); await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running && !document.getElementById('camera-setup').open);
 await page.locator('#play').click(); await page.locator('#name').press('Enter');
 await page.waitForFunction(() => document.getElementById('status').textContent === 'Clench & hold to drop');
 assert.equal(await page.locator('#status').textContent(), 'Clench & hold to drop');
 assert.equal(await page.locator('#hint').isVisible(), false, 'first turn teaches one gesture without a subtitle');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1');
 await page.screenshot({ path: '.screenshots/quiet-first-turn.png' });
 const aimCamera = await page.evaluate(() => window.__littleCloud.snapshot().camera);
 const layout = await page.evaluate(() => {
   const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
   return { scene: rect('scene'), drop: rect('machine-drop') };
 });
 assert.ok(layout.drop.top >= layout.scene.top && layout.drop.bottom <= layout.scene.bottom, 'DROP stays on the cabinet');
 assert.equal(await page.locator('#control-deck').isVisible(),false,'no duplicate control panel');
 assert.equal(await page.locator('#control-deck button, #control-deck input').count(), 0, 'deck does not add another input system');
 await page.evaluate(() => { window.testCamera.input = {x:.5,z:0}; window.testCamera.tick(); });
 await page.waitForFunction(() => document.getElementById('deck-stick').style.transform.includes('7.5px'));
 await page.evaluate(() => { window.testCamera.input = {x:0,z:0}; window.testCamera.tick(); });

 await page.evaluate(() => window.testCamera.clench());
 assert.equal(await page.locator('#status').textContent(), 'DROP!');
 await page.screenshot({ path: '.screenshots/arcade-drop.png' });
 await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'lift');
 assert.match(await page.locator('#status').textContent(), /^(GOT IT!|MISSED)$/);
 assert.deepEqual(await page.evaluate(() => window.__littleCloud.snapshot().camera), aimCamera, 'camera stays fixed through lift');
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.run.turns.length), 0);
 await page.screenshot({ path: '.screenshots/arcade-outcome.png' });
 // Screenshots may span a phase boundary on CI. The lift cue expires, while a
 // missed result deliberately keeps its outcome visible without narration.
 await page.waitForFunction(() => window.__littleCloud.snapshot().phase !== 'lift' || getComputedStyle(document.getElementById('action-copy')).opacity === '0');
 const outcome = await page.evaluate(() => ({ phase: window.__littleCloud.snapshot().phase, caught: window.__littleCloud.snapshot().caught, opacity: getComputedStyle(document.getElementById('action-copy')).opacity, hint: document.getElementById('hint').textContent }));
 if (outcome.phase === 'lift') assert.equal(outcome.opacity, '0');
 if (outcome.phase === 'result' && !outcome.caught) { assert.equal(outcome.hint, ''); assert.equal(outcome.opacity, '1'); }
 assert.equal(await page.locator('#action-copy').getAttribute('role'), 'status');
 assert.equal(await page.locator('#celebration').count(), 0);
 await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim' && window.__littleCloud.snapshot().event.turn === 2 && getComputedStyle(document.getElementById('action-copy')).opacity === '0');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '0', 'later turns leave tracked aiming clear');
 await page.screenshot({ path: '.screenshots/quiet-second-turn.png' });
 await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
 await page.waitForFunction(() => document.getElementById('status').textContent === 'SHOW ONE HAND');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'quiet aiming never hides recovery');
 await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
 await page.waitForFunction(() => getComputedStyle(document.getElementById('action-copy')).opacity === '0');
 await page.evaluate(() => { window.testCamera.feedback = { kind: 'clenching', progress: .5 }; window.testCamera.tick(); });
 await page.waitForFunction(() => document.getElementById('status').textContent === 'Hold to drop');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'hold confirmation returns after teaching is complete');
 assert.equal(await page.locator('#hint').isVisible(), false);
 await page.evaluate(() => { window.testCamera.feedback = {}; window.testCamera.tick(); });
 for (const width of [1440, 1050, 1000, 820, 390, 360]) {
  await page.setViewportSize({ width, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (width > 650) assert.ok(await page.evaluate(() => document.querySelector('.player-hud').getBoundingClientRect().right <= document.getElementById('scene').getBoundingClientRect().left), 'side HUD stays outside the scene');
 }
 await page.setViewportSize({ width: 390, height: 620 });
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await page.reload(); await page.waitForFunction(() => window.__littleCloud);
 await page.locator('#operator-open').click(); await page.locator('#reset').click();
 await page.locator('#play').click(); await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running && !document.getElementById('camera-setup').open);
 await page.locator('#play').click(); await page.locator('#name').press('Enter');
 await page.waitForFunction(() => document.getElementById('status').textContent === 'Clench & hold to drop');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'a new run teaches the gesture again');
 await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
 await page.waitForTimeout(1800);
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'recovery guidance never expires');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).animationName), 'none');
 await page.screenshot({ path: '.screenshots/arcade-reduced-narrow.png', fullPage: true });
 const preview = await page.locator('#camera-preview').boundingBox();
 assert.ok(preview && preview.height > 0, 'camera preview is visible before measuring');
 assert.ok(preview.y >= (await page.locator('#scene').boundingBox()).y + (await page.locator('#scene').boundingBox()).height, 'short-screen preview stays below the scene');
 assert.equal(await page.locator('#control-deck').isVisible(),false);
 assert.ok(preview.y + preview.height < 710, 'uncropped preview and recognition fit above the short-screen footer');
 await page.evaluate(() => window.testCamera.stop());
 await page.waitForFunction(() => document.getElementById('button-text').textContent === 'Restart camera');
 const bounds = await page.evaluate(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }; return { arcade: r('arcade'), button: r('play') }; });
 assert.ok(bounds.button.bottom < bounds.arcade.bottom - 30, 'restart is above footer on short screens');
 await page.locator('#play').click();
 await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
 console.log('PASS immediate, timed, single-surface outcomes; persistent recovery; narrow layout and reduced motion');
} finally { await browser.close(); }
