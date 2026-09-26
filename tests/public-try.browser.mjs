// Production bundle + real disposable HTTP service. Camera events are synthetic;
// the distinct contract is notice/access wiring and registration-free local play.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
import { installCameraFixture } from './camera-fixture.mjs';

const origin = 'http://127.0.0.1:4292';
const app = await createPilotServer({ filename: ':memory:', origin, staffCode: 'try-browser-staff-secret', hostCode: 'try-host-code', secure: false,
  publicTryEnabled: true, publicDiagnosticsEnabled: true });
await new Promise(resolve => app.server.listen(4292, '127.0.0.1', resolve));
const browser = await chromium.launch(browserOptions);
let page;
try {
  await mkdir('.screenshots', { recursive: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
  await installCameraFixture(page, { built: true, cameraRequest: true });
  await page.addInitScript(() => {
    window.noticePainted = false; window.ordering = []; window.mediaCalls = 0;
    function observe() {
      const notice = document.getElementById('try-notice');
      if (notice?.open && !notice.hidden && notice.getBoundingClientRect().height > 0) window.noticePainted = true;
      requestAnimationFrame(observe);
    }
    requestAnimationFrame(observe);
    navigator.mediaDevices.getUserMedia = async () => {
      window.ordering.push({ type: 'camera', notice: window.noticePainted });
      if (++window.mediaCalls === 1) throw new DOMException('Synthetic denial', 'NotAllowedError');
      return {};
    };
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]).startsWith('/api/public/')) window.ordering.push({ type: 'diagnostics', notice: window.noticePainted });
      return originalFetch(...args);
    };
    // Practice must not depend on storage or touch an existing staff outbox.
    Storage.prototype.getItem = Storage.prototype.setItem = () => { throw Error('Storage denied'); };
  });
  await page.goto(origin);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true' && window.mediaCalls === 1);
  assert.equal(await page.locator('#try-notice').isVisible(), true);
  assert.equal(await page.locator('#registration').isVisible(), false);
  assert.equal(await page.locator('#camera-setup').isVisible(), true);
  await page.locator('#camera-toggle').click();
  await page.waitForFunction(() => window.testCamera?.running && !document.getElementById('camera-setup').open);
  await page.screenshot({ path: '.screenshots/public-try-notice.png' });
  const selectWithHand = async id => {
    const box = await page.locator(`#${id}`).boundingBox();
    await page.evaluate(({ x, y }) => window.testCamera.setFeedback({ kind: 'tracking', pointer: { x, y } }), {
      x: .18 + (box.x + box.width / 2) / 1440 * .64, y: .15 + (box.y + box.height / 2) / 900 * .70,
    });
    await page.waitForFunction(id => document.getElementById(id).classList.contains('hand-hover'), id);
    await page.evaluate(() => { window.testCamera.feedback.kind = 'clenching'; window.testCamera.feedback.progress = .7; window.testCamera.tick(); });
    // Deliver a fresh camera sample and completion in the same browser task as
    // the observed hold, rather than letting RPC/GPU delay expire its freshness.
    await page.waitForFunction(() => {
      if (Number(document.getElementById('hand-cursor').style.getPropertyValue('--hold')) <= 0) return false;
      window.testCamera.tick(); window.selectionAccepted = window.testCamera.clench(); return true;
    });
    assert.equal(await page.evaluate(() => window.selectionAccepted), true);
    await page.evaluate(() => window.testCamera.clearFeedback());
  };
  await selectWithHand('play');
  for (const attempt of [1, 2]) {
    assert.equal(await page.locator('#registration').isVisible(), false, 'Try never asks for a name');
    for (const turn of [1, 2, 3]) {
      await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn} / 3` && document.getElementById('arcade').dataset.phase === 'aim' && !document.getElementById('phase-label').textContent.includes('COMPLETE'), turn);
      assert.equal(await page.evaluate(() => { window.testCamera.tick(); return window.testCamera.clench(); }), true);
      if (turn < 3) await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn + 1} / 3`, turn);
    }
    await page.locator('#final').waitFor();
    assert.equal(await page.locator('#final-turns .catch-card').count(), 3);
    assert.match(await page.locator('#final-rank').textContent(), /PRACTICE.*NO EVENT RANKING/);
    if (attempt === 1) {
      // Collector outage on replay must never block local play.
      await page.route('**/api/public/**', route => route.abort('internetdisconnected'));
      await selectWithHand('play-again');
    }
  }
  const ordering = await page.evaluate(() => window.ordering);
  assert.ok(ordering.some(row => row.type === 'diagnostics'));
  assert.ok(ordering.every(row => row.notice), JSON.stringify(ordering));
  assert.ok(requests.every(path => path.startsWith('/api/public/')), requests.join(', '));
  for (const table of ['owners', 'runs', 'turns']) assert.equal(app.database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  const observations = app.database.db.prepare('SELECT data FROM public_playtest_events').all();
  assert.ok(observations.length > 0, 'enabled public diagnostics persisted');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '.screenshots/public-try-complete.png' });
  // Disabled/unavailable diagnostics with an otherwise working public entry.
  await page.close(); page = await browser.newPage();
  await page.route('**/api/public/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"disabled"}' }));
  await installCameraFixture(page, { built: true });
  await page.goto(`${origin}/?setup=manual`);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#play').click();
  await page.waitForFunction(() => window.testCamera?.running);
  assert.equal(await page.locator('#registration').isVisible(), false);
  console.log('Public Try: notice precedes camera/diagnostics, denial retry, 2 × 3 hand-controlled turns, offline replay, zero owners/scores, storage denied, unavailable diagnostics passed.');
} catch (error) {
  if (page) await page.screenshot({ path: '.screenshots/public-try-failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => app.server.close(resolve)); app.database.close();
}
