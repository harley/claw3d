// Built frontend, real shared API and isolated cookies. Synthetic camera events only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPilotServer } from '../server/index.js';
import { backup } from '../server/backup.js';
import { openDatabase } from '../server/database.js';

const origin = 'http://127.0.0.1:4208', staffCode = 'browser-test-staff-secret', hostCode = 'browser-test-host-secret';
const dir = await mkdtemp(join(tmpdir(), 'cloud-claw-browser-'));
await mkdir('.screenshots', { recursive: true });
const app = await createPilotServer({ filename: join(dir, 'pilot.sqlite'), origin, staffCode, hostCode, secure: false });
await new Promise(resolve => app.server.listen(4208, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = []; let activePage;
async function open(context) {
  const page = await context.newPage(); activePage = page; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/vision-*.js', async route => {
    // Preserve the bundler's exported symbol, replacing only recognition with deterministic events.
    const original = await (await route.fetch()).text();
    const alias = original.includes(' as HandController') ? 'HandController' : null;
    assert.ok(alias, 'production vision export found');
    await route.fulfill({ contentType: 'text/javascript', body: `
      class HandController {
        constructor(options) { Object.assign(this, options); this.running=false; this.visible=true; this.input={x:0,z:0}; window.testCamera=this; }
        resetOwner() { this.input={x:0,z:0}; this.onInput(this.input); }
        async start() { this.running=true; this.tick(); this.timer=setInterval(()=>this.tick(),30); }
        tick() { this.onInput(this.visible ? this.input : {x:0,z:0}); this.onState({kind:this.visible ? 'tracking' : 'lost',message:'Camera fixture'}); }
        stop() { clearInterval(this.timer); this.running=false; }
        clench() { return this.onDrop(); }
      } export { HandController as ${alias} };` });
  });
  await page.goto(origin);
  if (await page.locator('#code').count()) {
    await page.locator('#code').fill(staffCode); await page.locator('#login button').click();
  }
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  assert.equal(await page.evaluate(() => window.__littleCloud), undefined, 'production omits diagnostics');
  return page;
}
async function register(page, name) {
  await page.locator('#play').click(); await page.waitForFunction(() => window.testCamera?.running);
  await page.locator('#play').click(); await page.locator('#name').fill(name); await page.locator('#name').press('Enter');
  const count = () => app.database.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE name=?').get(name).n;
  assert.equal(count(), 0);
  assert.equal(await page.evaluate(() => window.testCamera.clench()), true);
  assert.equal(await page.evaluate(() => window.testCamera.clench()), false);
  await page.waitForFunction(() => document.getElementById('status').textContent === 'Here we go…');
  assert.equal(count(), 0, 'practice must not create a server run');
  assert.equal(await page.locator('#rehearsal-exit').isEnabled(), false);
  await page.evaluate(() => { window.testCamera.visible=false; window.testCamera.tick(); document.getElementById('rehearsal-exit').click(); });
  await page.waitForFunction(() => document.getElementById('status').textContent === 'You’ve got it', {}, { timeout: 30000 });
  assert.equal(count(), 0, 'full unscored animation finishes before server start');
  assert.equal(await page.locator('#turn').textContent(), '— / 3');
  if (name === 'Browser A') {
    await page.locator('#shared-start').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('#turn').textContent(), '— / 3');
    const issued = app.database.db.prepare('SELECT id FROM runs WHERE name=?').get(name);
    assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM turns WHERE run_id=?').get(issued.id).n, 0);
    await page.locator('#shared-retry').click();
  }
  await page.waitForFunction(() => document.getElementById('turn').textContent === '1 / 3');
  assert.equal(count(), 1);
  const issued = app.database.db.prepare('SELECT id FROM runs WHERE name=?').get(name);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM turns WHERE run_id=?').get(issued.id).n, 0);
  await page.evaluate(() => { window.testCamera.visible=true; window.testCamera.tick(); });
}
async function finish(page) {
  for (const turn of [1, 2, 3]) {
    await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn} / 3` && !document.getElementById('phase-label').textContent.includes('COMPLETE'), turn);
    await page.evaluate(() => window.testCamera.clench());
    if (turn < 3) await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn + 1} / 3`, turn, { timeout: 30000 });
  }
  await page.locator('#final').waitFor({ timeout: 30000 });
}
try {
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const b = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  let page = await open(a);
  await page.locator('#operator-open').click(); assert.equal(await page.locator('#host-access').isVisible(), true);
  await page.locator('#host-access [aria-label="Close host access"]').click();
  app.database.db.prepare('UPDATE sessions SET expires=0').run();
  await page.locator('#shared-reauth').waitFor({ timeout: 10000 });
  await page.waitForTimeout(2200); assert.equal(await page.locator('#shared-reauth').isVisible(), true);
  await page.locator('#shared-reauth').click(); await page.locator('#staff-code').fill(staffCode); await page.locator('#staff-form button').click();
  await page.locator('#staff-access').waitFor({ state: 'hidden' });
  const startKeys = [];
  await page.route('**/api/runs', async route => {
    startKeys.push(route.request().postDataJSON().requestKey);
    const response = await route.fetch();
    if (startKeys.length === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated lost start acknowledgement' }) });
    else await route.fulfill({ response });
  });
  await register(page, 'Browser A');
  assert.equal(startKeys.length, 2); assert.equal(startKeys[0], startKeys[1]);
  let hold = true, lost = false;
  await page.route('**/api/runs/*/turns', async route => {
    if (hold) {
      if (!lost) { lost = true; await route.fetch(); } // server commits, browser loses acknowledgement
      await route.abort('internetdisconnected');
    } else await route.continue();
  });
  await finish(page);
  assert.equal(await page.locator('#final-rank').textContent(), 'Score waiting to sync');
  const cookies = await a.cookies();
  assert.ok(cookies.find(cookie => cookie.name === 'cc_owner').httpOnly);
  await page.screenshot({ path: '.screenshots/shared-pending.png' });
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  assert.equal(await page.locator('#player-name').textContent(), 'Your turn?');
  hold = false;
  await page.waitForFunction(() => document.querySelector('#leaders')?.textContent.includes('Browser A'), {}, { timeout: 15000 });
  assert.equal(app.database.board().runs.length, 1); assert.equal(app.database.board().runs[0].turns.length, 3);
  await page.close(); // Browser suites stay sequential: no simultaneous WebGL timing load.
  page = await open(b); await register(page, 'Browser B'); await finish(page);
  await page.waitForFunction(() => document.getElementById('final-rank').textContent.includes('SAVED'));
  assert.equal(await page.locator('#leaders li').count(), 2);
  assert.match(await page.locator('#final-rank').textContent(), /RANK #1/);
  await page.screenshot({ path: '.screenshots/shared-saved.png' });
  await page.close();
  page = await open(a); assert.equal(await page.locator('#leaders li').count(), 2);
  await page.locator('#operator-open').click(); await page.locator('#host-code').fill(hostCode); await page.locator('#host-form button').click();
  await page.locator('#operator').waitFor();
  assert.match(await page.locator('#storage-status').textContent(), /SHARED/);
  await page.screenshot({ path: '.screenshots/shared-host.png' });
  backup(join(dir, 'pilot.sqlite'), join(dir, 'restored.sqlite'));
  const restored = openDatabase(join(dir, 'restored.sqlite'));
  assert.equal(restored.board().runs.length, 2); restored.close();
  // Hold a stale poll across rotation; repeated activation must create only one board.
  let releasePoll, pollStarted;
  const oldPoll = new Promise(resolve => { pollStarted = resolve; });
  await page.route('**/api/board', async route => {
    const response = await route.fetch(); pollStarted();
    await new Promise(resolve => { releasePoll = resolve; });
    await route.fulfill({ response });
  }, { times: 1 });
  await oldPoll;
  const boardsBefore = app.database.db.prepare('SELECT COUNT(*) AS n FROM boards').get().n;
  await page.locator('#session-name').fill('Rotation regression');
  await page.evaluate(() => { document.getElementById('new-board').click(); document.getElementById('new-board').click(); });
  await page.waitForFunction(() => document.getElementById('board-name').textContent === 'Rotation regression');
  releasePoll(); await page.waitForTimeout(1000);
  assert.equal(await page.locator('#board-name').textContent(), 'Rotation regression');
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM boards').get().n, boardsBefore + 1);
  const download = page.waitForEvent('download'); await page.locator('#export').click();
  assert.match((await download).suggestedFilename(), /cloud-claw-sessions/);
  await page.close();
  page = await open(b); await register(page, 'Interrupted');
  const interrupted = app.database.db.prepare("SELECT id FROM runs WHERE name='Interrupted'").get();
  await page.evaluate(() => window.testCamera.clench());
  await page.waitForFunction(() => document.getElementById('turn').textContent === '2 / 3', {}, { timeout: 30000 });
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.waitForTimeout(2500);
  assert.equal(app.database.db.prepare('SELECT status FROM runs WHERE id=?').get(interrupted.id).status, 'abandoned');
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM turns WHERE run_id=?').get(interrupted.id).n, 1);
  assert.equal(app.database.board().runs.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS built protected frontend; two isolated named three-turn runs; lost-response/reload retry exactly once; shared tied ranks; host gate; backup restoration. Synthetic camera only.');
} catch (error) {
  console.error('UI at failure:', await activePage.locator('body').innerText());
  console.error('Page errors:', errors);
  await activePage.screenshot({ path: '.screenshots/shared-failure.png' });
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => app.server.close(resolve)); app.database.close();
  await rm(dir, { recursive: true, force: true });
}
