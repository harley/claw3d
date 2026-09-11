import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture, cameraInput, assertScoredStart } from './camera-fixture.mjs';
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(page);
  await page.addInitScript(() => {
    const NativeAudio = window.AudioContext;
    window.audioCheck = { contexts: 0, notes: [], gains: [], rejectResume: false };
    window.AudioContext = class extends NativeAudio {
      constructor() { super(); window.audioCheck.contexts++; window.audioCheck.context = this; }
      resume() { return window.audioCheck.rejectResume ? Promise.reject(new Error('Audio blocked')) : super.resume(); }
      createGain() { const gain = super.createGain(), set = gain.gain.setValueAtTime.bind(gain.gain); gain.gain.setValueAtTime = (value, time) => { gain.scheduledLevel = value; return set(value, time); }; window.audioCheck.gains.push(gain); return gain; }
      createOscillator() {
        const oscillator = super.createOscillator(), record = { stops: [] };
        const start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator), frequency = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
        const ramp = oscillator.frequency.exponentialRampToValueAtTime.bind(oscillator.frequency);
        oscillator.frequency.exponentialRampToValueAtTime = (value, time) => { record.endFrequency = value; return ramp(value, time); };
        oscillator.frequency.setValueAtTime = (value, time) => { record.frequency = value; return frequency(value, time); };
        oscillator.start = time => { Object.assign(record, { start: time, visible: !document.getElementById('jackpot-signal').hidden, phase: window.__littleCloud?.snapshot().phase, turn: window.__littleCloud?.snapshot().event.turn }); window.audioCheck.notes.push(record); start(time); };
        oscillator.stop = time => { record.stops.push(time ?? this.currentTime); stop(time); };
        return oscillator;
      }
    };
  });
  const open = async () => { await page.goto('http://127.0.0.1:4196'); await page.waitForFunction(() => window.__littleCloud); };
  const volume = value => page.locator('#sound-volume').evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const start = async () => {
    await page.locator('#play').click(); await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
    await page.locator('#play').click(); await page.locator('#name').press('Enter'); await assertScoredStart(page);
  };
  const starNotes = () => page.evaluate(() => window.audioCheck.notes.filter(n => Math.abs(n.stops[0] - n.start - .09) < .0001));
  await open(); await volume('25');
  assert.equal(await page.evaluate(() => window.audioCheck.contexts), 0, 'volume cannot activate audio');
  await page.locator('#sound').click();
  assert.equal(await page.evaluate(() => window.audioCheck.gains[0].scheduledLevel), .25);
  await page.evaluate(() => { document.getElementById('sound').click(); });
  await page.waitForFunction(() => window.audioCheck.gains[0].scheduledLevel === 0);
  assert.ok(await page.evaluate(() => window.audioCheck.notes.every(n => n.stops.length === 2)), 'mute cancels scheduled notes');
  await page.locator('#sound').click(); await volume('0');
  assert.equal(await page.locator('#sound').textContent(), 'MUTED');
  await page.waitForFunction(() => window.audioCheck.gains[0].scheduledLevel === 0);
  await volume('50'); await start();
  const motorCount = () => page.evaluate(() => window.audioCheck.notes.filter(n => n.frequency === 130).length);
  await page.waitForTimeout(250); assert.equal(await motorCount(), 0, 'hand presence alone makes no movement sound');
  await cameraInput(page, { x: 1, z: 0 }); await page.waitForTimeout(450);
  assert.ok(await motorCount() >= 2, 'actual steering has movement pulses');
  await cameraInput(page, { x: 0, z: 0 }); await page.waitForTimeout(100);
  const stoppedCount = await motorCount(); await page.waitForTimeout(350);
  assert.equal(await motorCount(), stoppedCount, 'stationary claw is quiet');
  await page.waitForTimeout(4700);
  assert.equal((await starNotes()).length, 0, 'no star beeps away from the visible ring');
  // Start a fresh aiming window for the near-ring and interruption checks.
  await open(); await page.locator('#operator-open').click(); await page.locator('#reset').click();
  await page.locator('#sound').click(); await start();
  for (const axis of ['x', 'z']) for (let i = 0; i < 6; i++) {
    const delta = ({ x: .80, z: .22 })[axis] - (await page.evaluate(() => window.__littleCloud.snapshot())).position[axis];
    if (Math.abs(delta) < .015) break;
    const speed = Math.abs(delta) < .15 ? .25 : 1;
    await cameraInput(page, { x: 0, z: 0, [axis]: Math.sign(delta) * speed });
    await page.waitForTimeout(Math.abs(delta) / (.85 * speed) * 1000); await cameraInput(page, { x: 0, z: 0 });
  }
  await page.waitForFunction(() => window.audioCheck.notes.some(n => Math.abs(n.stops[0] - n.start - .09) < .0001));
  assert.ok((await starNotes()).every(n => n.visible));
  const quiet = async () => { await page.waitForTimeout(100); assert.equal(await page.locator('#jackpot-signal').isVisible(), false); const count = (await starNotes()).length; await page.waitForTimeout(650); assert.equal((await starNotes()).length, count); };
  await page.locator('#feedback-open').click(); await quiet(); await page.locator('#feedback-dialog [aria-label="Close feedback"]').click();
  await page.locator('#operator-open').click(); await page.locator('#pause').click(); await quiet();
  await page.locator('#operator-open').click(); await page.locator('#pause').click();
  await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); }); await quiet();
  await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  await page.screenshot({ path: '.screenshots/audio-controls.png' });
  await page.waitForFunction(() => {
    const state = window.__littleCloud.snapshot();
    if (!window.audioHold) { if (state.event.cue.now) window.audioHold = state.event.carouselTime; return false; }
    if (state.event.carouselTime - window.audioHold < .55) return false;
    window.testCamera.clench(); return true;
  });
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'lift');
  assert.equal(await page.locator('#status').textContent(), 'GOT IT!', 'catch feedback appears at lift, before delivery');
  assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.run.turns.length), 0, 'early feedback does not score early');
  assert.ok(await page.evaluate(() => [360, 280, 120, 180, 554].every(f => window.audioCheck.notes.some(n => n.frequency === f))), 'descent, grip and lift have sound cues');
  assert.ok(await page.evaluate(() => window.audioCheck.notes.some(n => n.frequency === 880 && n.endFrequency === 110)), 'accepted drop uses a descending arcade sweep');
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'release');
  assert.equal(await page.locator('#status').textContent(), '');
  assert.equal(await page.evaluate(() => window.audioCheck.notes.filter(n => n.frequency === 980).length), 1, 'release cue plays once');
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'deliver');
  assert.ok(await page.evaluate(() => window.audioCheck.notes.filter(n => n.phase === 'anticipate' && n.frequency >= 587).length >= 6), 'drop has a musical phrase');
  assert.ok(await page.evaluate(() => window.audioCheck.notes.filter(n => n.phase === 'deliver' && n.frequency >= 587).length >= 8), 'trophy shelf travel has a fanfare');
  await page.evaluate(() => { window.shelfPauseAt = window.audioCheck.context.currentTime; });
  await page.locator('#operator-open').click(); await page.waitForTimeout(50);
  assert.ok(await page.evaluate(() => { const queued = window.audioCheck.notes.filter(n => n.phase === 'deliver' && n.frequency >= 587 && n.start > window.shelfPauseAt); return queued.length >= 4 && queued.every(n => n.stops.length === 2); }), 'settings cancel queued trophy music');
  await page.locator('#operator .panel-head button').click();
  await page.waitForFunction(() => {
    if (!window.audioCheck.notes.some(n => n.frequency === 1047)) return false;
    document.getElementById('sound').click(); return true;
  }, {}, { timeout: 30000 });
  assert.equal(await page.evaluate(() => window.audioCheck.notes.filter(n => n.frequency === 1047).length), 1);
  assert.ok(await page.evaluate(() => window.audioCheck.notes.filter(n => [659, 784, 1047].includes(n.frequency) && Math.abs(n.stops[0] - n.start - .18) < .0001).every(n => n.stops.length === 2)), 'mute cancels future catch melody notes');

  await page.locator('#sound').click();
  for (const turn of [2, 3]) {
    await page.waitForFunction(turn => { const s = window.__littleCloud.snapshot(); return s.phase === 'aim' && s.event.turn === turn; }, turn);
    await page.evaluate(() => window.testCamera.clench());
    await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'result', {}, { timeout: 30000 });
  }
  assert.equal(await page.locator('#final').isVisible(), true);
  assert.ok(await page.evaluate(() => window.audioCheck.notes.filter(n => n.phase === 'result' && n.turn === 3 && n.frequency >= 587).length >= 9), 'completed run has a distinct finale');

  await page.evaluate(() => { window.finalePauseAt = window.audioCheck.context.currentTime; });
  await page.locator('#final-feedback').click();
  await page.waitForTimeout(50);
  assert.ok(await page.evaluate(() => window.audioCheck.notes.filter(n => n.phase === 'result' && n.turn === 3 && n.frequency >= 587 && n.start > window.finalePauseAt).every(n => n.stops.length === 2)), 'feedback over results cancels the finale');

  // Browser refusal must restore the off state without an unhandled rejection.
  await open(); await page.evaluate(() => { window.audioCheck.rejectResume = true; }); await page.locator('#sound').click();
  await page.waitForFunction(() => document.getElementById('sound').getAttribute('aria-pressed') === 'false');
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '.screenshots/audio-mobile.png' });
  console.log('PASS explicit activation, volume, queued-note mute, visible star cues, dialog/pause/hand-loss silence and audio refusal');
} finally { await browser.close(); }
