// Uses Chromium's synthetic video device, never a physical webcam.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser = await chromium.launch({ ...browserOptions, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.mediaCalls = 0; const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = options => { window.mediaCalls++; return original(options); }; });
  await page.goto('http://127.0.0.1:4196/?setup=manual'); await page.waitForFunction(() => window.__littleCloud);
  await page.evaluate(async () => {
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const draw = ArcadeScene.prototype.draw;
    ArcadeScene.prototype.draw = function (time, cameraActive) {
      window.cameraRenderBudget = cameraActive;
      return draw.call(this, time, cameraActive);
    };
  });
  const snap = () => page.evaluate(() => window.__littleCloud.snapshot());
  assert.equal(await page.evaluate(() => window.mediaCalls), 0);
  await page.locator('#camera-open').click(); assert.equal(await page.evaluate(() => window.mediaCalls), 0);
  await page.locator('#camera-setup .panel-head button').click();
  await page.locator('#play').click();
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running, { }, { timeout: 35000 });
  assert.equal((await snap()).event.run, null); assert.equal((await snap()).phase, 'idle');
  assert.equal(await page.locator('#registration').isVisible(), false);
  assert.equal(await page.locator('#camera-preview').isVisible(), true);
  assert.equal(await page.evaluate(() => document.getElementById('camera-video').videoWidth > 0), true);
  await page.waitForFunction(() => document.getElementById('status').textContent === 'SHOW ONE HAND');
  assert.equal(await page.locator('#hint').isVisible(), false, 'camera recovery uses one clear status line');
  assert.equal(await page.locator('#camera-recognition').textContent(), 'Camera view');
  // The draw cap follows quality, not camera state (unit-tested in render-budget.test.mjs).
  // The operator toggle itself is not exercised here: on the CI runner's virtual GPU a
  // quality change starves the camera worker for over 7 s (issue #75).
  await page.waitForFunction(() => typeof window.cameraRenderBudget === 'boolean');
  assert.equal(await page.evaluate(() => window.cameraRenderBudget), await page.evaluate(() => window.__littleCloud.snapshot().lowQuality), 'capped exactly when quality is simple');
  const geometry = await page.evaluate(() => {
    const video = document.getElementById('camera-video'), overlay = document.getElementById('camera-overlay');
    const v = video.getBoundingClientRect(), o = overlay.getBoundingClientRect();
    return { ratio: v.width / v.height, cameraRatio: video.videoWidth / video.videoHeight,
      aligned: v.x === o.x && v.y === o.y && v.width === o.width && v.height === o.height };
  });
  assert.ok(Math.abs(geometry.ratio - geometry.cameraRatio) < .01);
  assert.equal(geometry.aligned, true);
  for (const height of [480, 360]) {
    await page.evaluate(height => document.getElementById('camera-video').srcObject.getVideoTracks()[0].applyConstraints({ width: 640, height }), height);
    await page.waitForFunction(height => { const video = document.getElementById('camera-video'); return video.videoWidth === 640 && video.videoHeight === height; }, height);
    await page.waitForFunction(() => { const video = document.getElementById('camera-video'), rect = video.getBoundingClientRect(); return Math.abs(rect.width / rect.height - video.videoWidth / video.videoHeight) < .01; });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('camera-video')).transform.startsWith('matrix(-1')), true);
  }
  await page.screenshot({ path: '.screenshots/camera-ready-wide.png' });
  await page.setViewportSize({ width: 820, height: 900 });
  assert.equal(await page.locator('#hint').isVisible(), false, 'camera recovery uses one clear status line');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.screenshots/camera-ready-narrow.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#play').click(); await page.locator('#name').fill('   '); await page.locator('#name').press('Enter');
  assert.equal(await page.locator('#registration').isVisible(), false);
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  assert.match((await snap()).event.run.name, /^(?:🦀|🦊|🐻|🐱|🐰|🦦|🐧|🐉) [A-Z][a-z]+$/u); assert.equal((await snap()).event.turn, 1);
  await page.waitForTimeout(300); const before = (await snap()).event.remaining;
  await page.waitForTimeout(700); assert.equal((await snap()).event.remaining, before); assert.equal((await snap()).event.handCamera.waiting, true);
  const position = (await snap()).position;
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(350); await page.keyboard.up('ArrowRight');
  await page.keyboard.press('Space'); assert.deepEqual((await snap()).position, position); assert.equal((await snap()).phase, 'aim');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); assert.equal((await snap()).event.paused, false);
  await page.locator('#camera-open').click(); assert.equal(await page.locator('#operator').isVisible(), false);
  await page.locator('#camera-toggle').click(); assert.equal((await snap()).event.handCamera.running, false);
  await page.waitForFunction(() => window.cameraRenderBudget === false);
  assert.equal(await page.evaluate(() => document.getElementById('camera-video').srcObject), null);
  await page.locator('#camera-setup .panel-head button').click();
  await page.screenshot({ path: '.screenshots/camera-only.png' });
  assert.deepEqual(errors, []);
  console.log('PASS opt-in real worker/model with synthetic camera; camera-only input; hand-loss timer hold; blur does not latch pause; separate camera setup; shutdown');
  await context.close();
  const denied = await browser.newContext(); const dp = await denied.newPage();
  await dp.addInitScript(() => { const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let first = true; navigator.mediaDevices.getUserMedia = async options => { if (first) { first = false; throw new DOMException('Denied', 'NotAllowedError'); } return original(options); }; });
  await dp.goto('http://127.0.0.1:4196/?setup=manual'); await dp.waitForFunction(() => window.__littleCloud); await dp.locator('#camera-open').click(); await dp.locator('#camera-toggle').click();
  await dp.waitForFunction(() => document.getElementById('camera-status').textContent.includes('permission'));
  assert.equal(await dp.evaluate(() => window.__littleCloud.snapshot().event.handCamera.running), false);
  assert.equal(await dp.locator('#camera-setup').isVisible(), true);
  assert.equal(await dp.locator('#operator').isVisible(), false);
  await dp.locator('#camera-toggle').click(); await dp.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
  assert.equal(await dp.locator('#camera-setup').isVisible(), false); assert.equal(await dp.evaluate(() => window.__littleCloud.snapshot().event.run), null);
  console.log('PASS denied camera permission retries successfully without spending a turn'); await denied.close();

  // Affected WebKit versions can fail worker-side MediaPipe canvas setup with
  // `document is not defined`, even when a capability exists by name. Reproduce
  // that initialization result while retaining the real model and synthetic
  // camera for the compatible page-runtime path.
  const fallback = await browser.newContext({ permissions: ['camera'] }); const fp = await fallback.newPage();
  await fp.addInitScript(() => {
    window.Worker = class {
      postMessage(message) { if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'error', message: 'document is not defined' } })); }
      terminate() {}
    };
  });
  await fp.goto('http://127.0.0.1:4196/?setup=manual'); await fp.waitForFunction(() => window.__littleCloud);
  await fp.locator('#play').click();
  await fp.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running, {}, { timeout: 35000 });
  const fallbackCamera = (await fp.evaluate(() => window.__littleCloud.snapshot())).event.handCamera;
  assert.ok(['GPU', 'CPU'].includes(fallbackCamera.diagnostic.delegate));
  assert.equal(fallbackCamera.diagnostic.driver, 'timer');
  assert.equal(await fp.locator('#camera-preview').isVisible(), true);
  console.log(`PASS worker-canvas fallback starts the real model on ${fallbackCamera.diagnostic.delegate} with timer-paced video input`);
  await fallback.close();
} finally { await browser.close(); }
