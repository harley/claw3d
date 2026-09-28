// Real IndexedDB/Web Locks and owner-scoped HTTP receipts, without a renderer.
// Existing gameplay journeys do not cover browser restart/transaction ownership.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
const directory = await mkdtemp(join(tmpdir(), 'public-journal-'));
let browser, app;
try {
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<head></head><title>Public journal contract</title>');
  for (const file of ['session-api.js', 'public-run-journal.js', 'event-session.js']) await cp(`src/${file}`, join(directory, 'assets', file));
  const origin = 'http://127.0.0.1:4298';
  app = await createPilotServer({ filename: ':memory:', origin, dist: directory, staffCode: 'journal-browser-staff', hostCode: 'journal-host-code', publicTryEnabled: true, secure: false });
  await new Promise(resolve => app.server.listen(4298, '127.0.0.1', resolve));
  let context = await chromium.launchPersistentContext(join(directory, 'profile'), browserOptions);
  browser = context;
  let page = await context.newPage();
  const initialize = async page => {
    await page.goto(origin);
    await page.evaluate(async () => {
      const { createSessionApi } = await import('/assets/session-api.js');
      window.api = createSessionApi({ publicPlay: true, onWork: () => {} });
      await api.initialize(); await api.flush();
    });
  };
  await initialize(page);
  const second = await context.newPage(); await second.goto(origin);
  assert.match(await second.evaluate(async () => {
    try { await (await import('/assets/public-run-journal.js')).openPublicRunJournal(); return 'unexpected owner'; }
    catch (error) { return error.message; }
  }), /Another tab/);
  await second.close();
  let creations = 0;
  await page.route('**/api/play/runs', async route => { creations++; await route.fetch(); await route.abort('failed'); });
  const lostKey = crypto.randomUUID();
  assert.match(await page.evaluate(async key => { try { await api.start('Lost response', key); return 'unexpected success'; } catch (error) { return error.message; } }, lostKey), /fetch/i);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1);
  await page.close(); // No sessionStorage pointer survives a new tab.
  page = await context.newPage(); await initialize(page);
  assert.equal(app.database.db.prepare('SELECT status FROM runs').get().status, 'abandoned', JSON.stringify(await page.evaluate(() => api.state())));
  assert.equal(creations, 1); assert.equal(await page.evaluate(() => api.state().pending), 0);
  for (const count of [1, 2, 3]) {
    await page.evaluate(async count => {
      const run = await api.start(`Player ${count}`, crypto.randomUUID());
      run.turns = Array.from({ length: count }, (_, index) => ({ turn: index + 1, prizeId: null, remainingMs: 0, score: 0 }));
      await api.queue(run); // Commit without draining, then close the tab.
    }, count);
    await page.close(); page = await context.newPage(); await initialize(page);
    const last = app.database.db.prepare('SELECT status FROM runs ORDER BY rowid DESC LIMIT 1').get();
    assert.equal(last.status, count === 3 ? 'complete' : 'abandoned');
  }
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM turns').get().n, 6);
  assert.equal(app.database.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='complete'").get().n, 1);
  // Data and receipts survive another connection. Recovery never invents turn 3.
  await context.close();
  context = await chromium.launchPersistentContext(join(directory, 'profile'), browserOptions); browser = context;
  page = await context.newPage(); await initialize(page);
  assert.equal(await page.evaluate(() => api.state().pending), 0);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 4);
  console.log('PASS real IndexedDB commit/restart, exclusive Web Lock, lost-start read-only lookup, interrupted turns and complete receipt recovery');
} finally {
  await browser?.close();
  if (app) { await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
  await rm(directory, { recursive: true, force: true });
}
