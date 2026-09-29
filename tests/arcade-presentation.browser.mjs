import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture } from './camera-fixture.mjs';
const browser = await chromium.launch(browserOptions);
try {
 const errors = [];
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 page.on('pageerror', error => errors.push(error.message));
 await installCameraFixture(page);
 await page.goto(process.env.PRESENTATION_TEST_ORIGIN || 'http://127.0.0.1:4196/?setup=manual'); await page.waitForFunction(() => window.__littleCloud);
 await page.locator('#play').click(); await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running && !document.getElementById('camera-setup').open);
 await page.locator('#play').click(); await page.locator('#name').press('Enter');
 await page.waitForFunction(() => document.getElementById('status').textContent === '3');
 for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const panel = await page.evaluate(() => {
   const element = document.getElementById('action-copy'), status = document.getElementById('status');
   const box = element.getBoundingClientRect(), stage = document.getElementById('scene').getBoundingClientRect();
   return { marquee: window.__littleCloud.snapshot().marquee, opacity: getComputedStyle(element).opacity, active: element.classList.contains('countdown'), background: getComputedStyle(element).backgroundColor,
    text: status.textContent, fontSize: parseFloat(getComputedStyle(status).fontSize),
    dx: box.x + box.width / 2 - stage.x - stage.width / 2, dy: box.y + box.height / 2 - stage.y - stage.height / 2,
    fits: box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && box.bottom <= stage.bottom };
  });
  assert.equal(panel.active, true, 'count-in remains available to the live region');
  assert.equal(panel.marquee.text, panel.text, 'scene and live region use the same cue on every viewport');
  assert.equal(panel.opacity, '0', 'no duplicate central countdown over the claw on phones or desktop');
  const wide = viewport.width >= 1280;
  assert.equal(await page.locator('#hand-guide-reference').isVisible(), wide);
  if (wide) {
   const reference = await page.locator('#hand-guide-reference').evaluate(el => ({ right: el.getBoundingClientRect().right, animations: el.getAnimations({ subtree: true }).length }));
   assert.ok(reference.right < viewport.width / 3, 'reference stays outside the cabinet');
   assert.equal(reference.animations, 0, 'static reference adds no animation load');
   assert.equal(await page.locator('#hand-guide-reference li').count(), 3);
  }
  await page.screenshot({ path: `.screenshots/countdown-${viewport.width}.png` });
 }
 await page.setViewportSize({ width: 1440, height: 900 });
 await page.waitForFunction(() => document.getElementById('status').textContent === 'START!');
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().marquee.text), 'START!');
 // Capture can outlast the 300ms START cue on hosted runners. Assert first.
 assert.equal(await page.locator('#action-copy').getAttribute('data-countdown'), 'play');
 await page.screenshot({ path: '.screenshots/marquee-start.png' });
 await page.waitForFunction(() => document.getElementById('status').textContent === 'Clench & hold to drop');
 assert.equal(await page.locator('#action-copy').evaluate(el => el.classList.contains('countdown')), false, 'countdown panel clears before control begins');
 assert.equal(await page.locator('#status').textContent(), 'Clench & hold to drop');
 assert.equal(await page.locator('#hint').isVisible(), false, 'first turn teaches one gesture without a subtitle');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1');
 await page.screenshot({ path: '.screenshots/quiet-first-turn.png' });
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().marquee.text), 'CLAW', 'sign rests before aiming');
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
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().marquee.text), await page.locator('#status').textContent(), 'outcome headline lives on the LED');
 const liftCamera = await page.evaluate(() => window.__littleCloud.snapshot().camera);
 assert.ok(Math.hypot(...liftCamera.map((v, i) => v - aimCamera[i])) < .12, 'the lift keeps the close viewpoint apart from a brief catch punch');
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.run.turns.length), 0);
 await page.screenshot({ path: '.screenshots/arcade-outcome.png' });
 // Screenshots may span a phase boundary on CI. The lift cue expires, while a
 // missed result deliberately keeps its outcome visible without narration.
 await page.waitForFunction(() => window.__littleCloud.snapshot().phase !== 'lift' || getComputedStyle(document.getElementById('action-copy')).opacity === '0');
 const outcome = await page.evaluate(() => ({ phase: window.__littleCloud.snapshot().phase, caught: window.__littleCloud.snapshot().caught, opacity: getComputedStyle(document.getElementById('action-copy')).opacity, hint: document.getElementById('hint').textContent }));
 if (outcome.phase === 'lift') assert.equal(outcome.opacity, '0');
 if (outcome.phase === 'result' && !outcome.caught) { assert.notEqual(outcome.hint, '', 'a miss explains itself'); assert.equal(outcome.opacity, '1'); }
 assert.equal(await page.locator('#action-copy').getAttribute('role'), 'status');
 assert.equal(await page.locator('#celebration').count(), 0);
 await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim' && window.__littleCloud.snapshot().event.turn === 2 && getComputedStyle(document.getElementById('action-copy')).opacity === '0');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '0', 'later turns leave tracked aiming clear');
 await page.screenshot({ path: '.screenshots/quiet-second-turn.png' });
 await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
 await page.waitForFunction(() => document.getElementById('status').textContent === 'SHOW ONE HAND');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'quiet aiming never hides recovery');
 for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const framing = await page.evaluate(() => ({ sign: window.__littleCloud.snapshot().marquee, scene: document.getElementById('scene').getBoundingClientRect().toJSON() }));
  assert.ok(framing.sign.cloudTop.y >= framing.scene.top + Math.max(12, framing.scene.height * .02), `cloud has headroom at ${viewport.width}: ${JSON.stringify(framing)}`);
  assert.ok(framing.sign.top.y >= framing.scene.top && framing.sign.bottom.y <= framing.scene.bottom, 'whole LED panel stays within the scene');
  const wide = viewport.width >= 1280;
  assert.equal(await page.locator('#hand-guide-reference').isVisible(), wide);
  if (wide) {
   const reference = await page.locator('#hand-guide-reference').evaluate(el => ({ right: el.getBoundingClientRect().right, animations: el.getAnimations({ subtree: true }).length }));
   assert.ok(reference.right < viewport.width / 3, 'reference stays outside the cabinet');
   assert.equal(reference.animations, 0, 'static reference adds no animation load');
   assert.equal(await page.locator('#hand-guide-reference li').count(), 3);
  }
  await page.screenshot({ path: `.screenshots/marquee-layout-${viewport.width}.png` });
 }
 await page.setViewportSize({ width: 1440, height: 900 });

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
  if (width > 650) assert.ok(await page.evaluate(() => document.querySelector('.player-hud').getBoundingClientRect().bottom <= document.getElementById('scene').getBoundingClientRect().top), 'compact HUD stays above the scene');
 }
 // Existing controller tests cover timing; this covers scene/DOM wiring under interruption.
 await page.setViewportSize({ width: 1440, height: 900 });
 await page.locator('#operator-open').click(); await page.locator('#reset').click();
 await page.locator('#play').click(); await page.locator('#name').press('Enter');
 await page.waitForFunction(() => window.__littleCloud.snapshot().marquee.text === '3');
 await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
 await page.waitForFunction(() => !window.__littleCloud.snapshot().event.firstTurnControlReady);
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().marquee.text), 'CLAW', 'lost readiness clears the scene digit');
 await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
 await page.waitForFunction(() => window.__littleCloud.snapshot().marquee.text === 'ROUND 1');
 await page.locator('#operator-open').click();
 await page.waitForFunction(() => window.__littleCloud.snapshot().marquee.text === 'CLAW');
 await page.locator('#pause').click();
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.paused), true);
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().marquee.text), 'CLAW', 'pause never leaves a stale digit');
 const version = await page.evaluate(() => window.__littleCloud.snapshot().marquee.textureVersion);
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().marquee.textureVersion), version, 'static sign does not upload a texture per frame');
 await page.locator('#operator-open').click(); await page.locator('#reset').click();
 await page.setViewportSize({ width: 390, height: 620 });
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await page.reload(); await page.waitForFunction(() => window.__littleCloud);
 await page.locator('#operator-open').click(); await page.locator('#reset').click();
 await page.locator('#play').click(); await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running && !document.getElementById('camera-setup').open);
 await page.locator('#play').click(); await page.locator('#name').press('Enter');
 await page.waitForFunction(() => document.getElementById('status').textContent === '3');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).animationName), 'none', 'reduced motion removes the countdown pulse');
 await page.screenshot({ path: '.screenshots/countdown-reduced.png' });
 await page.waitForFunction(() => document.getElementById('status').textContent === 'Clench & hold to drop');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'a new run teaches the gesture again');
 await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
 await page.waitForTimeout(1800);
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'recovery guidance never expires');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).animationName), 'none');
 await page.screenshot({ path: '.screenshots/arcade-reduced-narrow.png', fullPage: true });
 const preview = await page.locator('#camera-preview').boundingBox();
 assert.ok(preview && preview.height > 0, 'hand guidance anchor is measurable');
 assert.ok(preview.y >= (await page.locator('#scene').boundingBox()).y + (await page.locator('#scene').boundingBox()).height, 'short-screen guidance stays below the scene');
 assert.equal(await page.locator('#control-deck').isVisible(),false);
 assert.ok(preview.y + preview.height < 710, 'recognition fits above the short-screen footer');
 await page.evaluate(() => window.testCamera.stop());
 await page.waitForFunction(() => document.getElementById('button-text').textContent === 'Restart camera');
 const bounds = await page.evaluate(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }; return { arcade: r('arcade'), button: r('play') }; });
 assert.ok(bounds.button.bottom < bounds.arcade.bottom - 30, 'restart is above footer on short screens');
 await page.locator('#play').click();
 await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
 console.log('PASS immediate, timed, single-surface outcomes; persistent recovery; narrow layout and reduced motion');
 assert.deepEqual(errors, []);
} finally { await browser.close(); }
