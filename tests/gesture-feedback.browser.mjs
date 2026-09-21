// Synthetic camera states exercise presentation through the real adapter.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture, cameraDrop } from './camera-fixture.mjs';
import { checkCameraTiming } from './camera-timing-check.mjs';

const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(page);
  await page.goto(process.env.GESTURE_TEST_ORIGIN || 'http://127.0.0.1:4196/?setup=manual');
  await page.waitForFunction(() => window.__littleCloud);
  const snap = () => page.evaluate(() => window.__littleCloud.snapshot());
  const feedback = state => page.evaluate(state => { window.testCamera.feedback = state; window.testCamera.tick(); }, state);
  await page.locator('#play').click();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'AIM AT PLAY · CLENCH');
  assert.equal((await snap()).joystick.visible, false, 'setup is not acquired gameplay control');
  await page.locator('#play').click();
  await page.locator('#name').fill('Gesture check');
  await page.locator('#name').press('Enter');
  await page.waitForFunction(() => window.__littleCloud.snapshot().joystick.mode === 'tracking');
  assert.equal(await page.locator('#status').textContent(), 'Clench & hold to drop');
  await page.screenshot({ path: '.screenshots/gesture-tracking.png' });

  // A closed hand must first open to arm a new drop.
  await feedback({ kind: 'clenching', progress: 0, message: 'Open your hand first, then clench to drop.' });
  await page.waitForFunction(() => document.getElementById('status').textContent === 'OPEN HAND');
  assert.equal(await page.locator('#hint').isVisible(), false);
  assert.equal((await snap()).phase, 'aim');
  await feedback({ kind: 'clenching', progress: .5, message: 'Hold your fist to drop. Open to cancel.' });
  await page.waitForFunction(() => document.getElementById('gesture-meter').getAttribute('aria-valuenow') === '50');
  assert.equal((await snap()).joystick.progress, .5);
  const held = await snap();
  assert.ok(held.effects.fingerRadius < held.claw.radii[0] - .1);
  assert.deepEqual(held.effects.clawLean, [0, 0, 0]);
  const meterBox = await page.locator('#gesture-meter').boundingBox();
  assert.equal(meterBox.width, 1, 'remote progress remains accessible without a competing visible meter');
  assert.equal(await page.locator('#status').textContent(), 'Hold to drop');
  // The bottom DROP ring owns progress, including reduced motion.
  assert.equal(await page.locator('#deck-drop').evaluate(el => el.style.getPropertyValue('--hold')), '0.5');
  assert.equal(await page.locator('#control-deck').getAttribute('data-state'), 'holding');
  await page.screenshot({ path: '.screenshots/gesture-hold.png' });
  await feedback({ kind: 'tracking', progress: 0 });
  await page.waitForFunction(() => document.getElementById('gesture-meter').hidden);
  assert.equal((await snap()).joystick.progress, 0, 'cancelled hold clears the scene ring');
  assert.equal(await page.locator('#deck-drop').evaluate(el => el.style.getPropertyValue('--hold')), '0');

  // Silence must expire both the input and its visible control claim.
  await page.evaluate(() => clearInterval(window.testCamera.timer));
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.feedback.kind === 'delayed');
  await page.waitForFunction(() => !window.__littleCloud.snapshot().joystick.visible);
  assert.equal(await page.locator('#status').textContent(), 'TRACKING DELAYED');
  const heldRemaining = (await snap()).event.remaining;
  await page.waitForTimeout(300); assert.equal((await snap()).event.remaining, heldRemaining);
  await page.screenshot({ path: '.screenshots/gesture-lost.png' });
  await page.evaluate(() => { window.testCamera.tick(); window.testCamera.timer = setInterval(() => window.testCamera.tick(), 30); });
  await page.waitForFunction(() => window.__littleCloud.snapshot().joystick.visible);
  await page.locator('#camera-open').click();
  await page.waitForFunction(() => !window.__littleCloud.snapshot().joystick.visible);
  await page.locator('#camera-setup .panel-head button').click();

  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForFunction(() => window.__littleCloud.snapshot().joystick.visible);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.screenshots/gesture-narrow.png' });
  const aimingCamera = (await snap()).camera;
  assert.equal(await cameraDrop(page), true);
  assert.equal(await cameraDrop(page), false);
  await feedback({ kind: 'lost' });
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'result', {}, { timeout: 30000 });
  assert.equal((await snap()).event.run.turns.length, 1);
  assert.equal((await snap()).joystick.visible, false);
  assert.equal(await page.locator('#phase-label').textContent(), 'ROUND 2 OF 3');
  assert.equal(await page.locator('#status').textContent(), 'ROUND 2');
  await page.waitForTimeout(1000);
  const countdownCamera = (await snap()).camera;
  assert.ok(countdownCamera.some((value, i) => Math.abs(value - aimingCamera[i]) > 1), 'the early countdown shows the full machine');
  await page.screenshot({ path: '.screenshots/round-two-ready.png' });
  await page.locator('#operator-open').click();
  await page.waitForTimeout(2100);
  assert.equal((await snap()).phase, 'result', 'a dialog holds the next-round announcement');
  await page.locator('#pause').click();
  await page.waitForTimeout(2100);
  assert.equal((await snap()).phase, 'result', 'host pause holds the announcement');
  assert.equal(await cameraDrop(page), false);
  await page.locator('#operator-open').click(); await page.locator('#pause').click();
  for (const cue of ['3', '2', '1', 'START!']) {
    await page.waitForFunction(cue => document.getElementById('status').textContent === cue, cue);
    assert.equal(await cameraDrop(page), false, `${cue} cue rejects drops`);
    if (cue === 'START!') assert.deepEqual((await snap()).camera, aimingCamera, 'close view is ready before aiming resumes');
  }
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  assert.equal((await snap()).event.turn, 2);
  assert.equal((await snap()).event.remaining, 15, 'missing hands hold the full aiming time after the cue');
  assert.equal(await page.locator('#gesture-meter').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS visible grip, arming guidance, hold/cancel, stale input, modal suppression, narrow layout and accepted delivery after hand loss');
  await page.close();
  await checkCameraTiming(browser, process.env.GESTURE_TEST_ORIGIN || 'http://127.0.0.1:4196/?setup=manual');
} finally { await browser.close(); }
