// Contract: desktop keeps one guidance surface and an unobstructed full-width
// scene; phone rotation chooses a future run's mode without replacing a live run.
// Regression: a portrait camera used to grow over PLAY and the cabinet.
// Existing suites exercise gameplay, but not phone rotation or portrait capture.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture } from './camera-fixture.mjs';
const browser = await chromium.launch(browserOptions);
const origin = 'http://127.0.0.1:4196';
const errors = [];
async function waitingRun(page) {
  await page.locator('#play').click();
  await page.waitForFunction(() => window.testCamera?.running);
  await assertHiddenCapture(page);
  await page.locator('#play').click();
  await page.locator('#name').fill('Pebble');
  await page.evaluate(() => { testCamera.visible = false; testCamera.tick(); });
  await page.locator('#name').press('Enter');
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.run);
}
async function assertHiddenCapture(page) {
  // Model the portrait dimensions from a phone camera, absent from the ordinary
  // landmark fixture. This used to expand the visible video over the controls.
  await page.evaluate(() => {
    const video = document.getElementById('camera-video');
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 480 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 640 });
    document.getElementById('camera-preview').style.setProperty('--camera-aspect', '480 / 640');
    testCamera.tick();
  });
  const capture = await page.evaluate(() => {
    const image = document.querySelector('.camera-image'), style = getComputedStyle(image);
    const rect = image.getBoundingClientRect();
    const play = document.getElementById('play'), box = play.getBoundingClientRect();
    return { width: rect.width, height: rect.height, opacity: style.opacity,
      pointerEvents: getComputedStyle(document.getElementById('camera-preview')).pointerEvents,
      playReachable: play.hidden || box.width === 0 || play.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
  });
  assert.deepEqual(capture, { width: 1, height: 1, opacity: '0', pointerEvents: 'none', playReachable: true }, 'capture cannot paint over or intercept player controls');
}
async function layout(page) {
  return page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    const state = window.__littleCloud.snapshot();
    return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth,
      scene: rect('#scene'), camera: rect('#camera-preview'), hud: rect('.player-hud'), brand: rect('.brand'), actions: rect('.header-actions'),
      drop: state.machineControls.drop, stick: state.machineControls.stick,
      mode: state.event.controlProfile, id: state.event.run?.id,
      quiet: getComputedStyle(document.getElementById('action-copy')).opacity,
      board: getComputedStyle(document.querySelector('.leaderboard')).display };
  });
}
try {
  const desktop = await browser.newPage({ viewport: { width: 1382, height: 1138 }, reducedMotion: 'reduce' });
  desktop.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(desktop);
  await desktop.goto(`${origin}/?setup=manual&controls=dual`);
  await desktop.waitForFunction(() => window.__littleCloud);
  await waitingRun(desktop);
  await desktop.locator('#dual-hand-guide').waitFor({ state: 'visible' });
  let state = await layout(desktop);
  assert.equal(state.scene.width, state.width, 'no permanent side columns');
  assert.ok(state.hud.bottom <= state.scene.top, 'HUD does not cover the machine');
  assert.ok(state.brand.right < state.hud.left && state.hud.right < state.actions.left, 'header groups do not overlap');
  assert.equal(state.board, 'none');
  assert.equal(state.quiet, '0', 'camera guide replaces the repeated central instruction during acquisition');
  assert.equal(await desktop.locator('#camera-preview .camera-feedback').isVisible(), false);
  await desktop.screenshot({ path: '.screenshots/centre-stage-desktop.png' });
  for (const viewport of [{ width: 2080, height: 1714 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    await desktop.setViewportSize(viewport);
    state = await layout(desktop);
    assert.equal(state.scroll, state.width);
    assert.ok(state.camera.right < state.stick.x - state.stick.radius, 'camera leaves joystick clear');
    assert.ok(state.drop.x + state.drop.radius < state.width && state.drop.y + state.drop.radius < state.height, 'DROP remains on-screen');
    await desktop.screenshot({ path: `.screenshots/centre-stage-${viewport.width}.png` });
  }
  await desktop.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  phone.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(phone);
  await phone.goto(`${origin}/?setup=manual`);
  await phone.waitForFunction(() => window.__littleCloud?.snapshot().event.controlProfile === 'hold-drop');
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.waitForURL(/controls=dual/);
  await phone.waitForFunction(() => window.__littleCloud?.snapshot().event.controlProfile === 'dual');
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.waitForURL(url => !url.searchParams.has('controls'));
  await phone.waitForFunction(() => window.__littleCloud?.snapshot().event.controlProfile === 'hold-drop');
  await waitingRun(phone);
  await assertHiddenCapture(phone);
  state = await layout(phone);
  assert.equal(state.mode, 'hold-drop');
  const runId = state.id;
  assert.ok(state.camera.top >= state.scene.bottom && state.camera.bottom <= state.height, 'portrait guidance sits below the scene without scrolling');
  assert.equal(state.scroll, state.width);
  await phone.screenshot({ path: '.screenshots/centre-stage-phone-portrait.png' });
  await phone.evaluate(() => { document.getElementById('try-notice').hidden = false; });
  const noticeLayout = await phone.evaluate(() => ({
    notice: document.getElementById('try-notice').getBoundingClientRect().toJSON(),
    guidance: document.getElementById('action-copy').getBoundingClientRect().toJSON(),
  }));
  assert.ok(noticeLayout.guidance.bottom < noticeLayout.notice.top, 'public privacy notice cannot cover recovery guidance');
  await phone.screenshot({ path: '.screenshots/camera-hidden-phone-public-notice.png' });

  await phone.setViewportSize({ width: 844, height: 390 });
  await assertHiddenCapture(phone);
  state = await layout(phone);
  assert.equal(state.mode, 'hold-drop');
  assert.equal(state.id, runId, 'rotation preserves the active attempt');
  await phone.reload();
  await phone.waitForFunction(() => window.__littleCloud?.snapshot().event.run);
  assert.equal((await layout(phone)).id, runId, 'reload in another orientation still reaches the saved attempt');
  assert.equal((await layout(phone)).mode, 'hold-drop');
  await phone.close();

  const landscape = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await installCameraFixture(landscape);
  await landscape.goto(`${origin}/?setup=manual`);
  await landscape.waitForFunction(() => window.__littleCloud?.snapshot().event.controlProfile === 'dual');
  await waitingRun(landscape);
  await landscape.locator('#dual-hand-guide').waitFor({ state: 'visible' });
  state = await layout(landscape);
  assert.ok(state.camera.right < state.stick.x - state.stick.radius, 'landscape preview does not cover the joystick');
  assert.equal(state.scroll, state.width);
  await landscape.screenshot({ path: '.screenshots/centre-stage-phone-landscape.png' });
  await landscape.close();
  assert.deepEqual(errors, []);
  console.log('PASS full-width arcade, one acquisition cue, portrait/landscape defaults and run/reload mode lock');
} finally { await browser.close(); }
