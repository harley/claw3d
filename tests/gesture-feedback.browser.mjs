// Synthetic camera states exercise presentation through the real adapter.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCameraFixture, cameraDrop } from './camera-fixture.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(page);
  await page.goto(process.env.GESTURE_TEST_ORIGIN || 'http://127.0.0.1:4196');
  await page.waitForFunction(() => window.__littleCloud);
  const snap = () => page.evaluate(() => window.__littleCloud.snapshot());
  const feedback = state => page.evaluate(state => { window.testCamera.feedback = state; window.testCamera.tick(); }, state);
  await page.locator('#play').click();
  await page.waitForFunction(() => document.getElementById('status').textContent === 'You’re ready');
  assert.equal(await page.evaluate(() => window.testCamera.getProfile()), 'fist');
  assert.equal((await snap()).joystick.visible, false, 'setup is not acquired gameplay control');
  await page.locator('#play').click();
  await page.locator('#name').fill('Gesture check');
  await page.locator('#name').press('Enter');
  await page.waitForFunction(() => window.__littleCloud.snapshot().joystick.mode === 'tracking');
  assert.equal(await page.locator('#status').textContent(), 'Move your hand');
  await page.screenshot({ path: '.screenshots/gesture-tracking.png' });

  // A closed hand must first open to arm a new drop.
  await feedback({ kind: 'clenching', progress: 0, message: 'Open your hand first, then clench to drop.' });
  await page.waitForFunction(() => document.getElementById('hint').textContent.includes('Open your hand first'));
  assert.equal((await snap()).phase, 'aim');
  await feedback({ kind: 'clenching', progress: .5, message: 'Hold your fist to drop. Open to cancel.' });
  await page.waitForFunction(() => document.getElementById('gesture-meter').getAttribute('aria-valuenow') === '50');
  assert.equal((await snap()).joystick.progress, .5);
  assert.equal(await page.locator('#status').textContent(), 'Hold to drop');
  await page.screenshot({ path: '.screenshots/gesture-hold.png' });
  await feedback({ kind: 'tracking', progress: 0 });
  await page.waitForFunction(() => document.getElementById('gesture-meter').hidden);
  assert.equal((await snap()).joystick.progress, 0, 'cancelled hold clears the scene ring');

  // Silence must expire both the input and its visible control claim.
  await page.evaluate(() => clearInterval(window.testCamera.timer));
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.feedback.kind === 'delayed');
  await page.waitForFunction(() => !window.__littleCloud.snapshot().joystick.visible);
  assert.equal(await page.locator('#status').textContent(), 'Hold steady');
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
  assert.equal(await cameraDrop(page), true);
  assert.equal(await cameraDrop(page), false);
  await feedback({ kind: 'lost' });
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'result', {}, { timeout: 30000 });
  assert.equal((await snap()).event.run.turns.length, 1);
  assert.equal((await snap()).joystick.visible, false);
  assert.match(await page.locator('#phase-label').textContent(), /TURN 1 COMPLETE/);
  assert.equal(await page.locator('#gesture-meter').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS visible grip, arming guidance, hold/cancel, stale input, modal suppression, narrow layout and accepted delivery after hand loss');
} finally { await browser.close(); }
