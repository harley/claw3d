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
        async start() { if(this.failNextStart) { this.failNextStart=false; this.fail('camera_busy'); return; } this.running=true; this.tick(); this.timer=setInterval(()=>this.tick(),30); }
        tick() { this.onInput(this.visible ? this.input : {x:0,z:0}); this.onState({kind:this.visible ? 'tracking' : 'lost',message:'Camera fixture'}); }
        stop() { clearInterval(this.timer); this.running=false; }
        fail(code='worker_timeout') { this.stop(); this.onState({kind:'error',code,message:'Synthetic camera failure. Restart camera.'}); }
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
async function openOperator(page) {
  await page.locator('#operator-open').click();
  if (await page.locator('#host-access').isVisible()) {
    await page.locator('#host-code').fill(hostCode); await page.locator('#host-form button').click();
  }
  await page.locator('#operator').waitFor();
}
async function openRegistration(page) {
  if (!await page.evaluate(() => window.testCamera?.running)) {
    await page.locator('#play').click(); await page.waitForFunction(() => window.testCamera?.running);
  }
  await page.locator('#play').click(); await page.locator('#registration').waitFor();
}
async function register(page, name) {
  await openRegistration(page);
  assert.equal(await page.locator('#name').getAttribute('required'), null);
  const count = () => app.database.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE name=?').get(name).n;
  await page.locator('#name').fill(name);
  await page.evaluate(() => { document.getElementById('player-form').requestSubmit(); document.getElementById('player-form').requestSubmit(); });
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
async function finish(page, firstTurn = 1, stopCameraOnLastDrop = false) {
  for (const turn of [1, 2, 3].filter(turn => turn >= firstTurn)) {
    await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn} / 3` && !document.getElementById('phase-label').textContent.includes('COMPLETE'), turn);
    await page.evaluate(() => window.testCamera.clench());
    if (turn === 3 && stopCameraOnLastDrop) await page.evaluate(() => window.testCamera.fail('camera_disconnected'));
    if (turn < 3) await page.waitForFunction(turn => document.getElementById('turn').textContent === `${turn + 1} / 3`, turn, { timeout: 30000 });
  }
  await page.locator('#final').waitFor({ timeout: 30000 });
}
async function scoredAndFeedback() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  app.database.db.prepare('INSERT INTO owners VALUES (?)').run('rank-owner');
  for (let i = 0; i < 6; i++) {
    const run = app.database.createRun('rank-owner', { requestKey: crypto.randomUUID(), name: 'Same nickname' });
    for (let turn = 1; turn <= 3; turn++) app.database.record(run.id, 'rank-owner', { turn, prizeId: 'butter' });
  }
  const page = await open(context), boardBefore = app.database.board();
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') starts++; });
  assert.equal(await page.locator('#practice, #shared-practice, #rehearsal-exit').count(), 0);
  await openRegistration(page);
  assert.equal(await page.locator('#name').getAttribute('required'), null);
  await page.locator('#name').press('Enter');
  await page.waitForFunction(() => document.getElementById('turn').textContent === '1 / 3');
  assert.equal(await page.locator('#player-name').textContent(), 'Player');
  assert.equal(await page.evaluate(() => window.testCamera.clench()), true);
  assert.equal(await page.evaluate(() => window.testCamera.clench()), false);
  await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
  await page.locator('#feedback-open').click();
  await page.waitForFunction(() => document.getElementById('phase-label').textContent === 'TURN 1 COMPLETE', {}, { timeout: 30000 });
  assert.equal(await page.locator('#turn').textContent(), '1 / 3');
  await page.locator('#feedback-dialog [aria-label="Close feedback"]').click();
  await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  await page.waitForFunction(() => document.getElementById('turn').textContent === '2 / 3');

  // A runtime failure must preserve the current run, score and remaining time.
  await page.waitForFunction(() => Number(document.getElementById('timer').textContent) <= 13);
  await page.evaluate(() => window.testCamera.fail());
  await page.getByRole('button', { name: 'Restart camera', exact: true }).waitFor();
  const beforeRecovery = await page.locator('#timer').textContent();
  await page.waitForTimeout(1800);
  assert.equal(await page.locator('#timer').textContent(), beforeRecovery);
  const cameraFailures = () => app.database.db.prepare("SELECT * FROM playtest_events WHERE type='camera_error'").all();
  assert.equal(cameraFailures().length, 1, 'runtime error is persisted once');
  assert.equal(JSON.parse(cameraFailures()[0].data).code, 'worker_timeout');
  assert.equal(app.playtest.read().summary.cameraFailureSessions, 1);
  await page.screenshot({ path: '.screenshots/camera-recovery.png' });
  await page.evaluate(() => { window.testCamera.failNextStart = true; });
  await page.getByRole('button', { name: 'Restart camera', exact: true }).click();
  await page.locator('#camera-setup').waitFor();
  await page.waitForTimeout(1800);
  assert.equal(cameraFailures().length, 2, 'failed restart is counted once despite startup fallback');
  assert.equal(JSON.parse(cameraFailures()[1].data).code, 'camera_busy');
  await page.locator('#camera-toggle').click();
  await page.waitForFunction(() => window.testCamera.running);
  assert.equal(await page.locator('#timer').textContent(), beforeRecovery, 'restart must not reset the aiming budget');
  assert.equal(starts, 1, 'camera restart does not create a new scored run');
  assert.equal(await page.locator('#turn').textContent(), '2 / 3');

  const attempts = [];
  let feedbackAvailable = false;
  await page.route('**/api/playtest', async route => {
    const batch = route.request().postDataJSON(), feedback = batch.events.filter(event => event.type === 'feedback');
    if (!feedback.length) { await route.continue(); return; }
    attempts.push(...feedback);
    if (!feedbackAvailable) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Feedback temporarily unavailable' }) });
    else await route.continue();
  });
  await page.locator('#feedback-open').click();
  const remaining = await page.locator('#timer').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#timer').textContent(), remaining, 'feedback pauses active aiming');
  assert.equal(await page.evaluate(() => window.testCamera.clench()), false, 'feedback cannot accept a new drop');
  const comment = 'The fist hold needed a clearer cue.';
  await page.locator('#feedback-category').selectOption('controls');
  await page.locator('#feedback-comment').fill(comment);
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/playtest' && response.status() === 503);
  await page.locator('#feedback-send').click(); await failed;
  await page.waitForFunction(() => !document.getElementById('feedback-send').disabled && document.getElementById('feedback-status').textContent.length > 0);
  assert.equal(await page.locator('#feedback-comment').inputValue(), comment, 'failure preserves draft');
  assert.equal(await page.locator('#feedback-category').inputValue(), 'controls');
  assert.notEqual(await page.locator('#feedback-status').textContent(), 'Thanks. Your feedback is saved.');
  feedbackAvailable = true;
  await page.locator('#feedback-send').click();
  await page.waitForFunction(() => document.getElementById('feedback-status').textContent === 'Thanks. Your feedback is saved.');
  assert.ok(attempts.length >= 2);
  assert.ok(attempts.every(event => event.id === attempts[0].id && event.data.comment === comment), 'retry retains one feedback event and draft');
  const feedbackRows = () => app.database.db.prepare("SELECT * FROM playtest_events WHERE type='feedback' ORDER BY received_at").all();
  assert.equal(feedbackRows().length, 1, 'acknowledgement corresponds to one persisted feedback');
  assert.equal(JSON.parse(feedbackRows()[0].data).comment, comment);
  assert.equal(feedbackRows()[0].mode, 'event');
  await page.screenshot({ path: '.screenshots/scored-feedback-saved.png' });
  await page.locator('#feedback-dialog [aria-label="Close feedback"]').click();
  await page.locator('#feedback-dialog').waitFor({ state: 'hidden' });
  await finish(page, 2, true);
  await page.waitForFunction(() => document.getElementById('final-rank').textContent.includes('SAVED'));
  await page.screenshot({ path: '.screenshots/scored-result.png' });
  assert.equal(await page.locator('#final-turns .turn-chip').count(), 3);
  assert.match(await page.locator('#final-rank').textContent(), /RANK #7/);
  assert.equal(await page.locator('#leaders li').count(), 5);
  assert.equal(starts, 1, 'blank nickname creates exactly one server run');
  assert.equal(app.database.board().runs.length, boardBefore.runs.length + 1);
  assert.equal(app.database.board().runs[0].turns.length, 3);

  await page.locator('#final-feedback').click();
  await page.locator('#feedback-dialog').waitFor();
  await page.locator('#feedback-category').selectOption('controls');
  await page.locator('#feedback-comment').fill('Finished all three turns without help.');
  await page.locator('#feedback-send').click();
  await page.waitForFunction(() => document.getElementById('feedback-status').textContent === 'Thanks. Your feedback is saved.');
  assert.equal(feedbackRows().length, 2);
  assert.deepEqual(feedbackRows().map(row => JSON.parse(row.data).comment).sort(), [comment, 'Finished all three turns without help.'].sort());
  const forbidden = new Set(['name', 'playerName', 'frame', 'cameraFrames', 'landmarks', 'rawError']);
  const checkPrivateKeys = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, `Telemetry must omit ${key}`); if (key === 'frames') assert.equal(typeof child, 'number', 'frame metric is a count, never images'); checkPrivateKeys(child); }
  };
  for (const row of app.database.db.prepare('SELECT data FROM playtest_events').all()) checkPrivateKeys(JSON.parse(row.data));
  await page.locator('#feedback-dialog [aria-label="Close feedback"]').click();
  await page.locator('#feedback-dialog').waitFor({ state: 'hidden' });
  await page.locator('#final-leaderboard').click();
  await page.locator('#result-open').click();
  assert.match(await page.locator('#final-rank').textContent(), /RANK #7/);
  assert.equal(await page.evaluate(() => window.testCamera.running), false);
  await page.locator('#play-again').click();
  await page.locator('#registration').waitFor();
  assert.equal(await page.evaluate(() => window.testCamera.running), true);
  assert.equal(await page.locator('#name').inputValue(), 'Player');
  assert.equal(await page.locator('#name').evaluate(el => el.selectionEnd - el.selectionStart), 6);
  assert.equal(starts, 1, 'opening replay does not create a run');
  let releaseReplay, replayRequest;
  const replayStarted = new Promise(resolve => { replayRequest = resolve; });
  await page.route('**/api/runs', async route => {
    replayRequest(); await new Promise(resolve => { releaseReplay = resolve; }); await route.continue();
  }, { times: 1 });
  await page.locator('#name').press('Enter'); await replayStarted;
  assert.equal(await page.locator('#result-open').isVisible(), false);
  await page.evaluate(() => { document.getElementById('result-open').click(); document.getElementById('play-again').click(); });
  assert.equal(await page.locator('#final').isVisible(), false);
  assert.equal(await page.evaluate(() => window.testCamera.clench()), false);
  releaseReplay();
  await page.waitForFunction(() => document.getElementById('turn').textContent === '1 / 3');
  assert.equal(starts, 2, 'submitted replay creates a new attempt');
  const replays = app.database.db.prepare("SELECT request_key FROM runs WHERE name='Player'").all();
  assert.equal(replays.length, 2); assert.notEqual(replays[0].request_key, replays[1].request_key);
  await page.evaluate(() => document.getElementById('scene').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await page.locator('#error').waitFor();
  await page.locator('#error-feedback').click();
  await page.locator('#feedback-dialog').waitFor();
  await page.locator('#feedback-category').selectOption('stuck');
  await page.locator('#feedback-comment').fill('Synthetic renderer failure report.');
  await page.locator('#feedback-send').click();
  await page.waitForFunction(() => document.getElementById('feedback-status').textContent === 'Thanks. Your feedback is saved.');
  assert.equal(feedbackRows().length, 3, 'renderer error surface can report before reload');
  await context.close();
  console.log('PASS blank nickname creates three scored turns; feedback retry retains draft; replay prefills selected nickname');
  app.database.rotate('Shared recovery tests');
}
try {
  await scoredAndFeedback();
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
  await page.locator('#final-leaderboard').click();
  await page.locator('#result-open').click();
  assert.equal(await page.locator('#final-rank').textContent(), 'Score waiting to sync');
  await page.locator('#play-again').click();
  assert.equal(await page.locator('#name').inputValue(), 'Browser A');
  assert.equal(startKeys.length, 2, 'pending replay form does not issue a new start');
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('cloud-claw:pending:v2:'))));
  await page.locator('#register-cancel').click();
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
  await page.locator('#next-player').click();
  assert.equal(await page.locator('#name').inputValue(), '');
  await page.locator('#register-cancel').click();
  await page.close();
  page = await open(a); assert.equal(await page.locator('#leaders li').count(), 2);
  await openOperator(page);
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
