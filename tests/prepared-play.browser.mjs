// Production arcade and service worker with only synthetic camera input replaced.
// This proves browser integration, not physical recognition or power-loss durability.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { waitForAsync } from './browser-poll.mjs';
import { cameraFixtureModule } from './camera-fixture.mjs';
import { offlinePack } from '../scripts/offline-pack.mjs';
import { createPilotServer } from '../server/index.js';
const directory = await mkdtemp(join(tmpdir(), 'prepared-play-'));
let browser, app;
const deadline = setTimeout(() => browser?.close(), 600000);
try {
  await cp('dist', directory, { recursive: true });
  const visionCandidates = (await readdir(join(directory, 'assets'))).filter(file => /^vision-[\w-]+\.js$/.test(file));
  const visionEntries = [];
  for (const file of visionCandidates) {
    if (/ as HandController/.test(await readFile(join(directory, 'assets', file), 'utf8'))) visionEntries.push(file);
  }
  assert.equal(visionEntries.length, 1, 'exactly one production camera entry exports HandController');
  const [vision] = visionEntries;
  await writeFile(join(directory, 'assets', vision), cameraFixtureModule());
  // Setup imports the same journal module before loading the production arcade.
  for (const file of ['public-run-journal.js', 'event-session.js']) await cp(`src/${file}`, join(directory, 'assets', file));
  const pack = offlinePack(); pack.configResolved({ root: directory, build: { outDir: '.' } }); await pack.closeBundle();
  const origin = 'http://127.0.0.1:4299';
  app = await createPilotServer({ filename: ':memory:', dist: directory, origin, staffCode: 'prepared-browser-staff', hostCode: 'prepared-browser-host', secure: false,
    publicTryEnabled: true, publicPermitPolicy: { maxSlots: 20, maxRetentionMs: 86400000 } });
  let lost = false, liveCalls = 0, dropReceipt = false;
  app.server.prependListener('request', (request, response) => {
    if (request.url === '/api/play/permits/live') liveCalls++;
    if (!dropReceipt || lost || request.url !== '/api/play/permits/reconcile') return;
    const end = response.end;
    response.end = function(...args) {
      // The real handler has committed before ending its successful response.
      if (!lost && this.statusCode === 200) { lost = true; this.destroy(); return this; }
      return end.apply(this, args);
    };
  });
  await new Promise(resolve => app.server.listen(4299, '127.0.0.1', resolve));
  const url = origin;
  browser = await chromium.launch(browserOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const setup = await context.newPage(); await setup.goto(url + '/privacy');
  const prepared = await setup.evaluate(async () => {
    const post = async (path, data) => { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) throw Error(await r.text()); return r.json(); };
    await post('/api/play/session', {}); await post('/api/host/sign-in', { code: 'prepared-browser-host' }); await post('/api/host/station', {});
    const pool = await post('/api/host/station/permits', { protocol: 1, requestKey: crypto.randomUUID(), count: 20, reconcileBy: Date.now() + 3600000 });
    const assets = await (await import('/prepared/client.js')).prepareAssets();
    const journal = await (await import('/assets/public-run-journal.js')).openPublicRunJournal();
    await journal.installPool(pool, assets.prepared.id); journal.close(); return assets;
  });
  assert.equal(prepared.prepared.complete, true); console.log('Verified synthetic-camera pack and 20 permits installed'); await setup.close();
  // No host credentials accompany play or reconciliation.
  await context.request.post(url + '/api/logout', { headers: { origin: url }, data: {} });
  assert.equal((await context.request.get(url + '/api/host/station')).status(), 401);
  const page = await context.newPage(); let liveRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/play/permits/live')) liveRequests++; });
  await context.setOffline(true);
  const local = [];
  for (let player = 0; player < 20; player++) {
    // Navigation/reload between players must retain all prior outcomes and capacity.
    await page.goto(url + `/prepared/index.html?hands=manual${player % 2 ? '&controls=dual' : ''}`);
    await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true' && window.testCamera?.running);
    await page.locator('#play').click(); await page.locator('#registration').waitFor();
    assert.ok((await page.locator('#name').inputValue()).trim());
    console.log(`Prepared player ${player + 1}: offline shell, camera and registration ready`);
    await page.locator('#name').fill(`Offline ${player}`); await page.locator('#register-play').click();
    for (const turn of [1, 2, 3]) {
      await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn} / 3` && document.getElementById('arcade').dataset.phase === 'aim' && !document.getElementById('phase-label').textContent.includes('COMPLETE'), turn);
      assert.equal(await page.evaluate(() => { window.testCamera.tick(); return window.testCamera.clench(); }), true);
      if (turn === 1) await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
      if (turn < 3) {
        await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn + 1} / 3`, turn);
        await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
      }
    }
    await page.locator('#final').waitFor();
    // Production deliberately omits development snapshots. Read the durable
    // journal and compare its completed result with the visible UI and server.
    const run = await page.evaluate(async name => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('cloud-claw:public-journal:v1', 2);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        const entries = await new Promise((resolve, reject) => {
          const request = db.transaction('intents', 'readonly').objectStore('intents').getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const entry = entries.find(value => value.name === name && value.physical === 'complete');
        if (!entry) throw Error('Completed run missing from durable journal');
        return { ...entry.run, turns: entry.turns, total: entry.turns.reduce((sum, turn) => sum + turn.score, 0) };
      } finally { db.close(); }
    }, `Offline ${player}`); local.push(run);
    assert.equal(run.turns.length, 3); assert.equal(run.rules.controlMode, player % 2 ? 'two-hand' : 'one-hand');
    assert.equal(Number(await page.locator('#final-score').textContent()), run.total);
    assert.equal(await page.locator('#final-turns .catch-card').count(), 3);
    assert.match(await page.locator('#final-rank').textContent(), /Saved on this computer · sync pending/);
    assert.doesNotMatch(await page.locator('#final-rank').textContent(), /RANK|HANOI/);
    assert.equal(await page.locator('#final-name-input').isDisabled(), true);
    await page.locator('#next-player').click(); await page.locator('#registration').waitFor();
    console.log(`Prepared offline player ${player + 1}/20 completed three turns`);
  }
  assert.equal(liveRequests, 0); assert.equal(liveCalls, 0); assert.equal(app.database.db.prepare('SELECT COUNT(*) n FROM runs').get().n, 0);
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#play').click(); await page.locator('#register-play').click();
  await page.locator('#shared-start').waitFor(); assert.match(await page.locator('#shared-start-message').textContent(), /No usable prepared starts/);
  // Close the error through reload; reconciliation must never reopen an old result.
  await page.reload();
  // Drop a real server response after reconnect. Browser route interception can
  // bypass offline mode or miss requests passing through a service worker.
  dropReceipt = true;
  await context.setOffline(false);
  await page.waitForFunction(() => !document.getElementById('sync-message').textContent, null, { timeout: 90000 });
  await waitForAsync(page, async () => {
    const journal = await new Promise((resolve, reject) => { const r = indexedDB.open('cloud-claw:public-journal:v1', 2); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    try { return await new Promise(resolve => { const r = journal.transaction('intents').objectStore('intents').getAll(); r.onsuccess = () => resolve(r.result.length === 20 && r.result.every(entry => entry.settled)); }); }
    finally { journal.close(); }
  }, null, { timeout: 90000 });
  assert.equal(lost, true); assert.equal(await page.locator('#final').isVisible(), false);
  assert.equal(app.database.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='complete'").get().n, 20);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) n FROM turns').get().n, 60);
  for (const run of local) {
    const response = await context.request.get(url + `/api/play/runs/${run.id}`); assert.equal(response.status(), 200);
    const receipt = await response.json(); assert.equal(receipt.total, run.total); assert.deepEqual(receipt.turns, run.turns); assert.deepEqual(receipt.rules, run.rules); assert.equal(receipt.event, undefined);
  }
  assert.equal(liveRequests, 0); assert.equal(liveCalls, 0);
  console.log('Prepared rendered 20-run/60-turn workload, exhaustion, reload, response loss and score parity pass');
} finally {
  clearTimeout(deadline); await browser?.close();
  if (app) { await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
  await rm(directory, { recursive: true, force: true });
}
