// Real host auth + production UI: catches wiring, request-key loss and stale
// state presentation that domain tests cannot. No camera/gameplay duplication.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
const origin = 'http://127.0.0.1:4294', staffCode = 'host-ui-staff-test-secret', hostCode = 'host-ui-test-secret';
const app = await createPilotServer({ filename: ':memory:', origin, staffCode, hostCode, secure: false, publicTryEnabled: true, officialEventsEnabled: true, officialAdmissionsEnabled: true });
await new Promise(resolve => app.server.listen(4294, '127.0.0.1', resolve));
const browser = await chromium.launch(browserOptions);
try {
  await mkdir('.screenshots', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/?setup=manual`);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  assert.equal(await page.locator('#operator-open').isVisible(), false);
  assert.equal(await page.locator('#event-create').count(), 0, 'no public host controls mounted');
  const denied = await page.evaluate(async () => (await fetch('/api/host/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Denied', requestKey: crypto.randomUUID() }) })).status);
  assert.equal(denied, 401);
  await page.goto(`${origin}/staff?setup=manual`);
  await page.locator('#code').fill(staffCode);
  // Login awaits fetch before location.replace('/staff'). Clicking alone can
  // finish first; let that navigation load before starting the manual view.
  await Promise.all([page.waitForURL(`${origin}/staff`), page.locator('#login button').click()]);
  await page.goto(`${origin}/staff?setup=manual`);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#operator-open').click();
  assert.equal(await page.locator('#host-access').isVisible(), true);
  assert.equal(await page.locator('#host-events').isVisible(), false);
  await page.locator('#host-code').fill('wrong'); await page.locator('#host-form button').click();
  await page.waitForFunction(() => document.getElementById('host-message').textContent.length > 0);
  assert.equal(await page.locator('#operator').isVisible(), false);
  await page.locator('#host-code').fill(hostCode); await page.locator('#host-form button').click();
  await page.locator('#event-name').waitFor();

  const bodies = [];
  await page.route('**/api/host/events', async route => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    if (bodies.length === 1) {
      assert.equal(await page.locator('#event-create-button').isDisabled(), true);
      await route.abort('failed'); // server committed, client did not receive it
    } else await route.fulfill({ response });
  });
  await page.locator('#event-name').fill('Host UI test');
  await page.locator('#event-create-button').click();
  await page.waitForFunction(() => document.getElementById('event-message').textContent.includes('retry'));
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM official_events').get().n, 1);
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/session')), page.reload()]);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#operator-open').click();
  await page.locator('#event-retry').click();
  await page.waitForFunction(() => document.getElementById('event-state').textContent.includes('DRAFT'));
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM official_events').get().n, 1);
  const stateBodies = [];
  await page.route('**/api/host/events/*/state', async route => {
    stateBodies.push(route.request().postDataJSON()); const response = await route.fetch();
    if (stateBodies.length === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await page.locator('#event-open').click();
  await page.waitForFunction(() => document.getElementById('event-message').textContent.includes('retry'));
  await page.locator('#event-retry').click();
  await page.waitForFunction(() => document.getElementById('event-state').textContent.includes('OPEN'));
  assert.deepEqual(stateBodies[1], stateBodies[0]);

  // Distinct host wiring: duplicate display labels remain selectable by ID.
  await page.locator('#participant-name').fill('Same display name'); await page.locator('#participant-create-button').click();
  await page.waitForFunction(() => document.getElementById('participant-identity').textContent.startsWith('Selected ID:'));
  const firstParticipant = await page.locator('#participant-select').inputValue();
  await page.locator('#participant-create-button').click();
  await page.waitForFunction(first => document.getElementById('participant-select').value !== first, firstParticipant);
  await page.locator('#participant-select').selectOption(firstParticipant);
  const ticketBodies = [];
  await page.route('**/api/host/events/*/tickets', async route => {
    ticketBodies.push(route.request().postDataJSON()); const response = await route.fetch();
    if (ticketBodies.length === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await page.locator('#ticket-issue').click();
  await page.waitForFunction(() => document.getElementById('ticket-message').textContent.includes('Could not confirm'));
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/session')), page.reload()]);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#operator-open').click(); await page.locator('#ticket-retry').click();
  await page.waitForFunction(() => document.getElementById('ticket-message').textContent.includes('not returned again'));
  assert.deepEqual(ticketBodies[0], ticketBodies[1]);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 1);
  assert.equal(await page.locator('#ticket-secret').isVisible(), false);
  await page.locator('#ticket-reissue-confirm').check(); await page.locator('#ticket-reissue').click();
  await page.locator('#ticket-secret').waitFor();
  const issuedCode = await page.locator('#host-ticket-code').inputValue();
  assert.match(issuedCode, /^T-[A-Fa-f0-9]{32}$/);
  assert.equal(await page.locator('#participant-select').inputValue(), firstParticipant);
  assert.equal(app.database.db.prepare("SELECT COUNT(*) AS n FROM official_tickets WHERE state='revoked'").get().n, 1);
  assert.equal(await page.evaluate(code => JSON.stringify(sessionStorage).includes(code), issuedCode), false);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#ticket-copy').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), issuedCode);
  // Recovery wiring uses a real admitted attempt; no synthetic gameplay loop.
  const nonce = crypto.randomUUID();
  const admitted = await page.request.post(`${origin}/api/official/redeem`, { headers: { origin }, data: { code: issuedCode, nonce, requestKey: crypto.randomUUID() } });
  assert.equal(admitted.status(), 200); const attempt = await admitted.json();
  await page.locator('#event-refresh').click();
  await page.locator('#recovery-attempt').selectOption(attempt.id);
  await page.waitForFunction(id => document.getElementById('recovery-summary').textContent.includes(id), firstParticipant);
  assert.equal(await page.locator('#recovery-submit').isDisabled(), true);
  await page.locator('#recovery-reason').selectOption('camera_failure');
  await page.locator('#recovery-confirm').check();
  const recoveryBodies = [];
  await page.route('**/api/host/event-runs/*/recover', async route => {
    recoveryBodies.push(route.request().postDataJSON()); const response = await route.fetch();
    if (recoveryBodies.length === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await page.locator('#recovery-submit').click();
  await page.waitForFunction(() => document.getElementById('recovery-message').textContent.includes('Could not confirm'));
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/session')), page.reload()]);
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#operator-open').click(); await page.locator('#recovery-retry').click();
  await page.waitForFunction(() => document.getElementById('recovery-message').textContent.includes('receipt recovered'));
  assert.deepEqual(recoveryBodies[0], recoveryBodies[1]);
  assert.equal(app.database.db.prepare("SELECT COUNT(*) AS n FROM official_actions WHERE kind='recover'").get().n, 1);
  assert.equal(await page.locator('#recovery-secret').isVisible(), false);
  assert.match(await page.locator('#recovery-summary').textContent(), /VOID/);
  assert.equal((await page.request.post(`${origin}/api/official/runs/${attempt.id}/activate`, { headers: { origin }, data: { nonce } })).status(), 409);
  await page.locator('#recovery-reissue-confirm').check(); await page.locator('#recovery-reissue').click();
  await page.locator('#recovery-secret').waitFor();
  const replacementCode = await page.locator('#recovery-code').inputValue();
  assert.match(replacementCode, /^T-[A-Fa-f0-9]{32}$/);
  assert.equal(await page.evaluate(code => JSON.stringify(sessionStorage).includes(code), replacementCode), false);
  await page.locator('#recovery-copy').click(); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), replacementCode);
  // Never include the secret in screenshots. Refresh clears the memory-only code.
  await page.locator('#event-refresh').click();
  await page.waitForFunction(() => document.getElementById('ticket-secret').hidden && document.getElementById('recovery-secret').hidden);
  assert.equal(await page.locator('#event-close').isDisabled(), true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#host-events').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.screenshots/host-events-${width}.png` });
  }
  await page.locator('#event-close-check').check(); await page.locator('#event-close').click();
  await page.waitForFunction(() => document.getElementById('event-state').textContent.includes('CLOSED'));
  assert.equal(await page.locator('#event-open').isVisible(), false);
  assert.equal(await page.locator('#ticket-issue').isDisabled(), true);
  assert.equal(await page.locator('#recovery-submit').isDisabled(), true);
  assert.equal(await page.locator('#recovery-reissue').isDisabled(), true);
  const closedAt = app.database.db.prepare('SELECT closed_at FROM official_events').get().closed_at;
  await page.locator('#event-refresh').click();
  assert.equal(app.database.db.prepare('SELECT closed_at FROM official_events').get().closed_at, closedAt);
  app.database.db.prepare('UPDATE official_events SET retain_until=0').run();
  await page.locator('#event-refresh').click();
  await page.waitForFunction(() => document.getElementById('event-message').textContent.includes('expired'));
  assert.equal(await page.locator('#event-open').isVisible(), false);
  assert.equal(await page.locator('#event-close').isVisible(), false);
  app.database.db.prepare("UPDATE sessions SET role='staff'").run();
  await page.locator('#event-refresh').click();
  await page.locator('#host-access').waitFor();
  assert.equal(await page.locator('#host-events').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('Host UI: protected login, one event after lost response/reload, open/confirmed close, participant IDs, lost ticket/reload/reissue/copy, confirmed recovery/reload/replacement reissue/late activation rejection, expiry/auth errors; no gameplay or score mutations.');
} finally { await browser.close(); await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
