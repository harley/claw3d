// Real service and production bundle: editable identity, saved ranks, default
// handoff, privacy navigation, and booth enrollment. Camera input is synthetic.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
import { installCameraFixture } from './camera-fixture.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:4293';
const directory = await mkdtemp(join(tmpdir(), 'claw-public-recovery-'));
const options = { filename: join(directory, 'scores.sqlite'), origin, staffCode: 'public-browser-staff-secret', hostCode: 'public-host-code', secure: false,
  publicTryEnabled: true, publicDiagnosticsEnabled: true, now: () => Date.parse('2026-09-29T10:00:00+07:00') };
let app = await createPilotServer(options);
await new Promise(resolve => app.server.listen(4293, '127.0.0.1', resolve));
const browser = await chromium.launch(browserOptions);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page;
try {
  // Enroll through the actual operator UI, then use the same browser publicly.
  page = await context.newPage();
  await installCameraFixture(page, { built: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // A tab opened before login must still lock the later shared host cookie.
  const stale = await context.newPage();
  await stale.goto(`${origin}/staff`);
  await stale.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: 'Public game handoff' }));
  let statusAttempts = 0;
  await page.route('**/api/host/station', route => {
    if (route.request().method() === 'GET' && ++statusAttempts === 1) return route.fulfill({ status: 503, json: { error: 'Setup status is temporarily unavailable.' } });
    return route.continue();
  });
  await page.goto(`${origin}/staff`);
  assert.equal(await page.locator('#open-game').getAttribute('href'), '/');
  assert.equal(await page.locator('#scene, #camera-video, #operator-open').count(), 0, 'host setup has no game or camera');
  await page.locator('#code').fill('public-browser-staff-secret');
  await page.locator('#login button').click();
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('host code was not accepted'));
  assert.equal(await page.locator('#login button').isEnabled(), true, 'wrong code permits retry');
  await page.locator('#code').fill('public-host-code');
  await page.locator('#login button').click();
  await page.locator('#status-retry').waitFor();
  assert.equal(await page.locator('#station-enroll').isEnabled(), false, 'unknown status cannot enroll');
  await page.locator('#status-retry').click();
  await page.waitForFunction(() => !document.getElementById('station-enroll').disabled);
  await stale.locator('#open-game').click();
  await stale.waitForURL(`${origin}/`);
  assert.equal((await context.request.get(`${origin}/api/host/station`)).status(), 401, 'stale anonymous tab locks current host access');
  await stale.close();
  // Clicking Open game during sign-in waits for the new cookie, then locks it.
  const overlap = await context.newPage();
  await overlap.goto(`${origin}/staff`);
  await overlap.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: 'Public game handoff' }));
  let releaseLogin, loginRequested;
  const loginGate = new Promise(resolve => { releaseLogin = resolve; });
  const pendingLogin = new Promise(resolve => { loginRequested = resolve; });
  await overlap.route('**/api/host/sign-in', async route => { loginRequested(); await loginGate; await route.continue(); });
  await overlap.locator('#code').fill('public-host-code');
  await overlap.locator('#login button').click();
  await pendingLogin;
  await overlap.locator('#open-game').click();
  releaseLogin();
  await overlap.waitForURL(`${origin}/`);
  assert.equal((await context.request.get(`${origin}/api/host/station`)).status(), 401, 'pending sign-in cannot unlock the public handoff');
  await overlap.close();
  await page.reload();
  await page.locator('#code').fill('public-host-code');
  await page.locator('#login button').click();
  await page.locator('#station-enroll').click();
  await page.waitForFunction(() => document.getElementById('station-status').textContent.includes('Ready'));
  assert.equal(await page.locator('#station-enroll').isVisible(), false);
  await page.screenshot({ path: '.screenshots/host-setup-ready.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: '.screenshots/host-setup-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  let sessionAttempts = 0;
  await page.route('**/api/play/session', route => {
    if (++sessionAttempts === 1) return route.fulfill({ status: 503, json: { error: 'Synthetic initial outage' } });
    return route.continue();
  });
  await page.locator('#open-game').click();
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true' && window.testCamera?.running);
  await page.waitForResponse(r => r.url().endsWith('/api/play/board') && r.ok());
  assert.ok(sessionAttempts >= 2, 'public initialization retries without a reload');
  assert.equal((await context.request.get(`${origin}/api/host/station`)).status(), 401, 'opening the game locks host access');
  const publicSession = await context.request.post(`${origin}/api/play/session`, { headers: { origin }, data: {} });
  assert.equal((await publicSession.json()).station.active, true, 'event enrollment survives host sign-out');
  assert.equal(await page.locator('#official-entry').isVisible(), false);
  assert.equal(await page.locator('#operator-open').isVisible(), false);
  const privacyTab = context.waitForEvent('page'); await page.locator('#privacy-link').click();
  const privacy = await privacyTab; await privacy.waitForLoadState();
  assert.equal(new URL(privacy.url()).pathname, '/privacy');
  assert.match(await privacy.locator('body').textContent(), /does not record or upload/); await privacy.close();
  await page.locator('#play').click();
  await page.locator('#registration').waitFor();
  assert.ok((await page.locator('#name').inputValue()).trim());
  await page.screenshot({ path: '.screenshots/public-ranked-name.png' });
  let boardReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/play/board') boardReads++; });
  const name = 'Min <3';
  for (const attempt of [1, 2]) {
    if (attempt === 2) await page.route('**/api/play/runs/*/turns', route => route.fulfill({ status: 503, json: { error: 'Synthetic score outage' } }));
    await page.locator('#name').fill(name);
    await page.locator('#register-play').click();
    let readsAtAim;
    for (const turn of [1, 2, 3]) {
      await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn} / 3` && document.getElementById('arcade').dataset.phase === 'aim' && !document.getElementById('phase-label').textContent.includes('COMPLETE'), turn);
      if (turn === 1) readsAtAim = boardReads;
      else assert.equal(boardReads, readsAtAim, 'the real arcade suppresses board polling throughout active play');
      if (attempt === 1 && turn === 1) await page.evaluate(() => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, ...args) {
          if (this.name === 'intents' && value.turns?.length && !window.allowScoreWrite) throw new DOMException('Synthetic quota refusal', 'QuotaExceededError');
          return original.call(this, value, ...args);
        };
      });
      assert.equal(await page.evaluate(() => { window.testCamera.tick(); return window.testCamera.clench(); }), true);
      if (attempt === 1 && turn === 1) {
        await page.locator('#score-storage').waitFor();
        assert.equal(await page.locator('#turn').textContent(), '1 / 3', 'storage refusal holds the physical turn boundary');
        await page.evaluate(() => { window.allowScoreWrite = true; });
        await page.locator('#score-storage-retry').click();
        await page.locator('#score-storage').waitFor({ state: 'hidden' });
      }
      if (turn < 3) await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn + 1} / 3`, turn);
    }
    await page.locator('#final').waitFor();
    if (attempt === 2) {
      assert.match(await page.locator('#final-rank').textContent(), /waiting to sync/);
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
      await page.unroute('**/api/play/runs/*/turns');
      await page.locator('#final').waitFor();
    }
    await page.waitForFunction(() => document.getElementById('final-rank').textContent.includes('SAVED'));
    assert.match(await page.locator('#final-rank').textContent(), /RANK #\d+ · HANOI #\d+/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'next-player');
    assert.equal(await page.locator('#next-player').getAttribute('class'), 'play-button');
    assert.equal(await page.locator('#final-turns .catch-card').count(), 3);
    await page.screenshot({ path: `.screenshots/public-ranked-result-${attempt}.png` });
    if (attempt === 1) {
      const receipt = app.database.db.prepare("SELECT * FROM runs WHERE status='complete'").get();
      await page.route('**/api/play/runs/*/name', route => route.fulfill({ status: 503, json: { error: 'Temporary outage.' } }));
      await page.locator('#final-name-input').fill('Winner Linh');
      await page.locator('#final-name-input').press('Enter');
      await page.waitForFunction(() => document.getElementById('final-name-status').textContent.includes('Retry Save'));
      assert.equal(await page.locator('#final-name-input').inputValue(), 'Winner Linh', 'failed save retains draft');
      assert.equal(app.database.db.prepare('SELECT name FROM runs WHERE id=?').get(receipt.id).name, name);
      await page.unroute('**/api/play/runs/*/name');
      await page.waitForTimeout(2500); // Explicit retries also respect the jittered two-second cooldown.
      await page.locator('#final-name-save').click();
      await page.waitForFunction(() => document.getElementById('final-name-status').textContent === 'Name saved');
      assert.deepEqual({ ...app.database.db.prepare('SELECT * FROM runs WHERE id=?').get(receipt.id) }, { ...receipt, name: 'Winner Linh' });
      await page.waitForTimeout(2200);
      assert.equal(await page.locator('#final-name-input').inputValue(), 'Winner Linh', 'background refresh retains saved name');
      assert.equal(await page.locator('#next-player').textContent(), 'Next Play');
      assert.equal(await page.locator('#play-again').isVisible(), false);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#booth-invite summary').click();
      await page.locator('#booth-invite').screenshot({ path: '.screenshots/booth-invite-refined-mobile.png' });
      await page.locator('#invite-name').fill('Private Linh');
      await page.locator('#invite-contact').fill('linh@example.com');
      await page.waitForTimeout(2200);
      assert.equal(await page.locator('#invite-contact').inputValue(), 'linh@example.com', 'rank refresh preserves private draft');
      let releaseContact;
      const contactGate = new Promise(resolve => { releaseContact = resolve; });
      await page.route('**/api/play/runs/*/contact', async route => {
        await contactGate; await route.fulfill({ status: 503, json: { error: 'Temporary outage.' } });
      });
      await page.locator('#invite-submit').click();
      await page.waitForFunction(() => document.getElementById('invite-status').textContent === 'Saving request…');
      await page.locator('#next-player').click();
      assert.equal(await page.locator('#registration').isVisible(), false, 'replay cannot race contact submission');
      assert.equal(await page.locator('#final').isVisible(), true);
      releaseContact();
      await page.waitForFunction(() => document.getElementById('invite-status').textContent.includes('Please retry'));
      assert.equal(await page.locator('#invite-contact').inputValue(), 'linh@example.com', 'retry retains private draft');
      assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('linh@example.com'))), false);
      await page.screenshot({ path: '.screenshots/booth-invite-mobile.png' });
      await page.unroute('**/api/play/runs/*/contact');
      await page.locator('#invite-submit').click();
      await page.waitForFunction(() => document.getElementById('invite-status').textContent.startsWith('Request saved'));
      assert.equal(app.database.db.prepare('SELECT contact FROM public_contacts').get().contact, 'linh@example.com');
      await page.waitForTimeout(2200);
      assert.equal(await page.locator('#invite-form').isVisible(), false, 'rank refresh does not reopen a submitted form');
      assert.equal(app.database.db.prepare('SELECT name FROM runs WHERE id=?').get(receipt.id).name, 'Winner Linh');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('#next-player').click();
      await page.locator('#registration').waitFor();
      assert.notEqual(await page.locator('#name').inputValue(), 'Winner Linh', 'Next Play generates a fresh nickname');
      await page.locator('#name').fill('Winner Linh'); // Names remain explicitly editable.
    }
  }
  await page.locator('#final-leaderboard').click();
  await page.locator('#scores-dialog[open]').waitFor();
  await page.locator('#result-open').click();
  await page.locator('#final[open]').waitFor();
  assert.equal(await page.locator('#scores-dialog').isVisible(), false, 'Your result replaces the scores dialog');
  await page.locator('#final-leaderboard').click();
  await page.locator('#scores-dialog[open] #leaders').waitFor();
  await page.locator('#board-scope').selectOption('event');
  await page.waitForFunction(() => document.getElementById('board-name').textContent.includes('Hanoi'));
  assert.equal(await page.locator('#leaders li').count(), 2);
  const rows = app.database.db.prepare("SELECT name,status FROM runs WHERE status='complete'").all();
  assert.equal(rows.length, 2); assert.deepEqual(rows.map(row => row.name).sort(), [name, 'Winner Linh'].sort());
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM turns').get().n, 6);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM public_run_events').get().n, 2);
  // A retained completed journal must drain after a service restart that pauses
  // ranked starts. HTTP-only tests cannot verify the practice page's recovery wiring.
  const queuedResponse = await context.request.post(`${origin}/api/play/runs`, { headers: { origin }, data: { name: 'Recovered after pause', requestKey: randomUUID() } });
  assert.equal(queuedResponse.status(), 201);
  const queued = await queuedResponse.json();
  const blockedId = randomUUID();
  await page.evaluate(blockedId => {
    const prefix = `cloud-claw:public:pending:v1:${blockedId}:`;
    localStorage.setItem(`${prefix}run`, JSON.stringify({ id: blockedId }));
    localStorage.setItem(`${prefix}turn:1`, JSON.stringify({ turn: 1, prizeId: null }));
  }, blockedId);
  await page.evaluate(queued => {
    const prefix = `cloud-claw:public:pending:v1:${queued.id}:`;
    localStorage.setItem(`${prefix}run`, JSON.stringify(queued));
    for (const turn of [1, 2, 3]) localStorage.setItem(`${prefix}turn:${turn}`, JSON.stringify({ turn, prizeId: null, remainingMs: 0 }));
  }, queued);
  await page.goto('about:blank');
  const closed = new Promise(resolve => app.server.close(resolve));
  app.server.closeAllConnections(); await closed; app.database.close();
  app = await createPilotServer({ ...options, publicRankedEnabled: false });
  await new Promise(resolve => app.server.listen(4293, '127.0.0.1', resolve));
  let rejectedAttempts = 0, recoveryThrottle = true;
  const recoveryCalls = [];
  await page.route('**/api/play/**', async route => {
    const request = route.request(); recoveryCalls.push(new URL(request.url()).pathname);
    if (recoveryThrottle) { recoveryThrottle = false; return route.fulfill({ status: 429, headers: { 'Retry-After': '2' }, json: { error: 'Synthetic recovery throttle' } }); }
    if (request.url().includes(blockedId)) rejectedAttempts++;
    return route.continue();
  });
  await page.goto(`${origin}/?setup=manual`);
  await page.locator('#final').waitFor();
  assert.equal(await page.locator('#final-name').textContent(), queued.name.toUpperCase());
  assert.match(await page.locator('#final-rank').textContent(), /SAVED · RANK #/);
  assert.equal(app.database.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='complete'").get().n, 3);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM turns').get().n, 9);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('cloud-claw:public:pending:v1:')).length), 2, 'inaccessible record is retained while valid scores drain');
  assert.equal(rejectedAttempts, 1);
  assert.ok(recoveryCalls.every(path => path.endsWith('/turns')), 'paused recovery never bootstraps ownership, starts a run or reads the board');
  const pausedStart = await context.request.post(`${origin}/api/play/runs`, { headers: { origin }, data: { name: 'Must not start', requestKey: randomUUID() } });
  assert.equal(pausedStart.status(), 503);
  assert.deepEqual(errors, []);
  console.log('Public ranked play: editable names, 2 × 3 turns, independent saved ranks, next-player focus, event enrollment/filter and privacy link passed.');
} catch (error) { await page?.screenshot({ path: '.screenshots/public-ranked-failure.png' }).catch(() => {}); throw error; }
finally { await browser.close(); const closed = new Promise(resolve => app.server.close(resolve)); app.server.closeAllConnections(); await closed; app.database.close(); await rm(directory, { recursive: true, force: true }); }
