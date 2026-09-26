// Production wiring contract: ticket -> explicit activation -> existing camera
// loop -> pending versus server result -> reload -> public capability handoff.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
import { installCameraFixture } from './camera-fixture.mjs';
const origin = 'http://127.0.0.1:4295', staffCode = 'official-ui-staff-secret', hostCode = 'official-ui-host-secret';
const app = await createPilotServer({ filename: ':memory:', origin, staffCode, hostCode, secure: false,
  publicTryEnabled: true, officialEventsEnabled: true, officialAdmissionsEnabled: true });
await new Promise(resolve => app.server.listen(4295, '127.0.0.1', resolve));
const browser = await chromium.launch(browserOptions);
try {
  const host = await browser.newContext(), player = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const post = async (context, path, data) => {
    const response = await context.request.post(origin + path, { headers: { origin }, data });
    assert.ok(response.ok(), `${path}: ${response.status()}`); return response.json();
  };
  await post(host, '/api/login', { code: staffCode }); await post(host, '/api/host/login', { code: hostCode });
  const event = await post(host, '/api/host/events', { name: 'Synthetic official UI', requestKey: randomUUID() });
  await post(host, `/api/host/events/${event.eventId}/state`, { state: 'open', requestKey: randomUUID() });
  const person = await post(host, `/api/host/events/${event.eventId}/participants`, { name: 'Synthetic player', requestKey: randomUUID() });
  const ticket = await post(host, `/api/host/events/${event.eventId}/tickets`, { participantId: person.participantId, requestKey: randomUUID() });
  const page = await player.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
  await installCameraFixture(page, { built: true });
  await page.goto(`${origin}/official?setup=manual`);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  const built = JSON.parse(await readFile('dist/build-info.json', 'utf8'));
  assert.ok((await page.locator('#build-info').textContent()).includes(`BUILD ${built.commit}`));
  await mkdir('.screenshots', { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const entryBox = await page.locator('#shared-access').boundingBox(), playBox = await page.locator('#play').boundingBox();
  assert.ok(entryBox.y + entryBox.height <= playBox.y, 'mobile ticket controls do not cover PLAY');
  await page.screenshot({ path: '.screenshots/official-entry-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#official-status-open').click();
  await page.locator('#official-code').fill(ticket.code);
  await page.locator('#official-redeem').click();
  await page.waitForFunction(() => !document.getElementById('official-ticket').open);
  const run = app.database.db.prepare('SELECT id,state FROM official_runs').get();
  assert.equal(run.state, 'accepted', 'redemption does not activate physics');
  assert.equal(await page.locator('#official-code').inputValue(), '', 'secret input is cleared');
  assert.equal(await page.locator('#mode-two').isVisible(), false, 'immutable one-hand event rules');
  await page.locator('#play').click();
  await page.waitForFunction(() => window.testCamera?.running && !document.getElementById('camera-setup').open);
  await page.locator('#play').click();
  await page.locator('#registration').waitFor();
  assert.equal(await page.locator('#name').inputValue(), 'Synthetic player');
  assert.equal(await page.locator('#name').evaluate(el => el.readOnly), true);
  await page.locator('#register-play').click();
  let holdThird = true, thirdCommitted;
  const committed = new Promise(resolve => { thirdCommitted = resolve; });
  await page.route('**/api/official/public/runs/*/turns', async route => {
    const response = await route.fetch();
    if (route.request().postDataJSON().turn === 3 && holdThird) {
      thirdCommitted(); await route.abort('internetdisconnected');
    } else await route.fulfill({ response });
  });
  // Hide reads after the third commit too: the result remains unknown until
  // reconnect. No timing sleep or fabricated total is used as the assertion.
  await page.route('**/api/official/public/runs/*', async route => {
    if (holdThird && app.database.db.prepare('SELECT state FROM official_runs WHERE id=?').get(run.id).state === 'complete') return route.abort('internetdisconnected');
    return route.continue();
  });
  for (const turn of [1, 2, 3]) {
    await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn} / 3` && document.getElementById('arcade').dataset.phase === 'aim' && !document.getElementById('phase-label').textContent.includes('COMPLETE'), turn);
    assert.equal(await page.evaluate(() => { window.testCamera.tick(); return window.testCamera.clench(); }), true);
    // Accepted drops must finish despite loss of tracking; no host pause is set.
    await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
    if (turn < 3) {
      await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn + 1} / 3`, turn);
      await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
    }
  }
  await committed; await page.locator('#final').waitFor();
  assert.equal(await page.locator('#final-score').textContent(), '—', 'unacknowledged local total is not an official result');
  assert.equal(await page.locator('#play-again').isVisible(), false);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 3);
  holdThird = false;
  // Real reload drains the acknowledged outbox and only shows a result.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('final-kicker').textContent === 'SERVER-CONFIRMED RESULT');
  assert.match(await page.locator('#final-rank').textContent(), /YOUR EVENT BEST .* RANK #1/);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
  assert.equal(await page.locator('#turn').textContent(), '— / 3', 'reload does not start another turn');
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
  assert.ok(requests.every(path => path.startsWith('/api/official/')), 'official flow never uses legacy scoring/board or telemetry');
  await mkdir('.screenshots', { recursive: true });
  await page.screenshot({ path: '.screenshots/official-result.png' });
  await Promise.all([page.waitForURL(`${origin}/official`), page.locator('#next-player').click()]);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  assert.equal(await page.locator('#operator-open').isVisible(), false);
  assert.equal(await page.locator('#official-try').isVisible(), true);
  assert.equal((await player.request.get(`${origin}/api/official/session`)).status(), 401);
  assert.equal((await player.request.get(`${origin}/api/session`)).status(), 401);
  // A host can void a failed run; the same anonymous station explicitly
  // clears only that terminal attempt, then admits its replacement.
  const second = await post(host, `/api/host/events/${event.eventId}/tickets`, { participantId: person.participantId, requestKey: randomUUID() });
  await page.locator('#official-status-open').click();
  await page.locator('#official-code').fill(second.code); await page.locator('#official-redeem').click();
  await page.waitForFunction(() => !document.getElementById('official-ticket').open);
  const unfinished = app.database.db.prepare("SELECT id FROM official_runs WHERE state='accepted'").get();
  const replacement = await post(host, `/api/host/event-runs/${unfinished.id}/recover`, { reason: 'camera_failure', requestKey: randomUUID() });
  await page.locator('#official-signout').waitFor();
  await page.screenshot({ path: '.screenshots/official-void.png' });
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), page.locator('#official-signout').click()]);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#official-status-open').click();
  await page.locator('#official-code').fill(replacement.code); await page.locator('#official-redeem').click();
  await page.waitForFunction(() => !document.getElementById('official-ticket').open);
  assert.equal(app.database.db.prepare("SELECT COUNT(*) AS n FROM official_runs WHERE state='accepted'").get().n, 1);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 3);
  assert.deepEqual(errors, []);
  console.log('Official production UI: explicit admission/activation, three turns, hand loss, pending/result reload, separate board, anonymous handoff and host-void replacement passed.');
} finally { await browser.close(); await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
