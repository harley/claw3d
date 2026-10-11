// Real phone scene + score service; deterministic input never establishes physical recognition.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
import { installCameraFixture, cameraInput, cameraDrop } from './camera-fixture.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const origin = 'http://127.0.0.1:4304';
const directory = await mkdtemp(join(tmpdir(), 'claw-phone-play-'));
const app = await createPilotServer({ filename: join(directory, 'scores.sqlite'), origin,
  staffCode: 'phone-fixture-staff-secret', hostCode: 'phone-fixture-host-code', secure: false, publicTryEnabled: true });
await new Promise(resolve => app.server.listen(4292, '127.0.0.1', resolve));
// Use the existing development snapshot to inspect actual physics, not a
// debug escape hatch in the production game. Built onboarding is covered by public-ranked.
const preview = await createServer({ server: { host: '127.0.0.1', port: 4304, strictPort: true,
  proxy: { '/api': 'http://127.0.0.1:4292' } }, plugins: [{ name: 'phone-test-public-entry',
  transformIndexHtml: html => html.replace('<head>', '<head><script>window.__PUBLIC_TRY__=true;window.__PUBLIC_PLAY__=true;</script>') }] });
await preview.listen();
const browser = await chromium.launch(browserOptions);
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(page);
  const snapshot = () => page.evaluate(() => window.__littleCloud.snapshot());
  const aim = () => page.waitForFunction(() => window.__littleCloud?.snapshot().phase === 'aim');
  await page.goto(`${origin}/?setup=manual`);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true' && !document.getElementById('play').disabled);
  assert.equal((await snapshot()).event.controlProfile, 'hold-drop', 'phone defaults to one hand');
  await page.locator('#play').click();
  assert.equal(await page.evaluate(() => Boolean(window.testCamera)), false, 'setup precedes camera creation');
  await page.locator('#register-play').click(); await aim();
  const originalName = (await snapshot()).event.run.name;
  assert.match(originalName, /^(?:🦀|🦊|🐻|🐱|🐰|🦦|🐧|🐉) [A-Z][a-z]+$/u);
  // Pause is explicit and resumes publicly without host access.
  await page.locator('#mobile-menu-open').click(); await page.locator('#mobile-pause').click();
  assert.equal(await page.locator('#button-text').textContent(), 'Resume');
  const paused = (await snapshot()).event.remaining;
  await page.waitForTimeout(200);
  assert.equal((await snapshot()).event.remaining, paused);
  await page.locator('#play').click(); assert.equal((await snapshot()).event.paused, false);
  for (const axis of ['x', 'z']) for (let i = 0; i < 12; i++) {
    const delta = { x: -.38, z: .72 }[axis] - (await snapshot()).position[axis];
    if (Math.abs(delta) < .0025) break;
    const speed = Math.abs(delta) < .04 ? .08 : Math.abs(delta) < .14 ? .25 : 1;
    await cameraInput(page, { x: 0, z: 0, [axis]: Math.sign(delta) * speed });
    await page.waitForTimeout(Math.abs(delta) / (.85 * speed) * 1000);
    await cameraInput(page, { x: 0, z: 0 });
  }
  await page.waitForTimeout(2000);
  assert.equal(await cameraDrop(page), true);
  assert.equal(await cameraDrop(page), false, 'repeated input cannot duplicate an accepted drop');
  await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.run?.turns.length === 1, null, { timeout: 15000 });
  assert.equal((await snapshot()).event.paused, false, 'hand loss does not latch pause');
  assert.equal((await snapshot()).event.run.turns[0].prizeId, 'butter');
  await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  for (let turn = 2; turn <= 3; turn++) { await aim(); assert.equal(await cameraDrop(page), true); await page.waitForFunction(turn => {
    const event = window.__littleCloud.snapshot().event;
    return (event.complete || event.run)?.turns.length === turn;
  }, turn, { timeout: 15000 }); }
  await page.locator('#final[open]').waitFor();
  assert.equal((await snapshot()).event.complete.turns.length, 3);
  assert.equal(await page.locator('#final-turns .catch-card').count(), 3);
  assert.equal(await page.locator('#menu-guide').isVisible(), false, 'hand targeting does not cover phone results');
  // A portrait must contain the caught model, including when its source mesh is hidden after delivery.
  const portrait = await page.locator('#final-turns img').evaluate(async image => {
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 128, 128).data.filter((value, i) => i % 4 === 3 && value > 0).length;
  });
  assert.ok(portrait > 1000, 'actual toy portrait is not blank');
  await page.locator('#final-name-input').fill('Phone QA'); await page.locator('#final-name-input').press('Enter');
  await page.waitForFunction(() => document.getElementById('final-name-status').textContent === 'Name saved');
  await page.setViewportSize({ width: 320, height: 568 });
  assert.ok(await page.locator('#final').evaluate(el => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path: '.screenshots/phone-run-result-320.png' });
  await page.locator('#next-player').click();
  assert.equal(await page.locator('#name').isVisible(), false);
  assert.equal(await page.locator('#register-play').textContent(), 'Play');
  assert.notEqual(await page.locator('#name').inputValue(), 'Phone QA', 'replay receives a fresh alias');
  await page.locator('#input-two').click(); await page.locator('#register-play').click(); await aim();
  assert.equal((await snapshot()).event.run.rules.controlMode, 'two-hand', 'selected mode reaches scoring');
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal((await snapshot()).event.controlProfile, 'dual', 'rotation does not change an active profile');
  assert.deepEqual(errors, []);
  console.log('PASS phone setup, generated alias, public pause/resume, accepted catch through hand loss, exactly three turns, real prize portrait, optional rename and two-hand replay');
} finally {
  await browser.close();
  await preview.close();
  const closed = new Promise(resolve => app.server.close(resolve)); app.server.closeAllConnections(); await closed;
  app.database.close(); await rm(directory, { recursive: true, force: true });
}
