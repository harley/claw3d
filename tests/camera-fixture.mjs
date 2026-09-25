import assert from 'node:assert/strict';
import { recordStartCue, assertStartCueDuration, assertPreparationTiming } from './start-cue-observation.mjs';
// Deterministic camera events for game-flow tests; hardware/model smoke is separate.
export async function installCameraFixture(page) {
  await page.route('**/src/vision.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export class HandController {
      constructor(options) { Object.assign(this, options); this.running = false; this.input = {x:0,z:0}; this.visible = true; this.feedback = {}; window.testCamera = this; }
      resetOwner() { this.input = {x:0,z:0}; this.onInput(this.input); }
      async start() { this.running = true; this.tick(); this.timer = setInterval(() => this.tick(), 30); }
      tick() {
        const profile = this.getControlProfile?.() || 'hold-drop';
        const common = { profile, kind: this.visible ? 'tracking' : 'lost', message: this.visible ? profile === 'dual' ? 'Both hands recognized' : 'One hand to steer · clench to drop' : profile === 'dual' ? 'Show both hands to continue' : 'Show one hand to continue', handCount: this.visible ? profile === 'dual' ? 2 : 1 : 0, controlEnabled: true };
        const modeFeedback = profile === 'dual'
          ? { hands: { left: { ready: this.visible, open: true, closed: false }, right: { ready: this.visible, open: true, closed: false } }, dropEnabled: false }
          : profile === 'grab-release' ? { grab: { stage: 'seeking' }, open: true, closed: false } : { open: true, closed: false };
        this.onInput(this.visible ? this.input : {x:0,z:0});
        this.onState({ ...common, ...modeFeedback, ...this.feedback });
      }
      setFeedback(feedback) { this.feedback = feedback; this.tick(); }
      clearFeedback() { this.feedback = {}; this.tick(); }
      neutralizeInput() { this.input = {x:0,z:0}; this.onInput(this.input); }
      stop() { clearInterval(this.timer); this.running = false; this.onState({kind:'off',message:'Start the camera to play'}); }
      setPerformanceMode() { return false; }
      clench() { return this.onDrop(); }
    }
  ` }));
}
export const cameraInput = (page, input) => page.evaluate(input => { window.testCamera.input = input; window.testCamera.tick(); }, input);
export const cameraDrop = page => page.evaluate(() => window.testCamera.clench());

export async function assertScoredStart(page, { captureScreenshots = false, exerciseClosedReadiness = false } = {}) {
  if (exerciseClosedReadiness) {
    await page.evaluate(() => window.testCamera.setFeedback({ kind: 'clenching', closed: true }));
    await page.waitForFunction(() => document.getElementById('status').textContent === 'OPEN HAND TO READY' &&
      window.__littleCloud.snapshot().event.firstTurnControlReady === false &&
      window.__littleCloud.snapshot().event.firstTurnPreparationElapsed === 0);
    await page.waitForTimeout(250);
    const waiting = await page.evaluate(() => ({
      elapsed: window.__littleCloud.snapshot().event.firstTurnPreparationElapsed,
      turn: window.__littleCloud.snapshot().event.turn,
      remaining: window.__littleCloud.snapshot().event.remaining,
    }));
    assert.equal(waiting.elapsed, 0, 'a closed hand cannot advance the first count-in');
    assert.equal(waiting.turn, 0, 'a closed hand cannot start a scored turn');
    assert.equal(waiting.remaining, 15, 'a closed hand cannot consume aiming time');
    await page.evaluate(() => window.testCamera.clearFeedback());
  }
  await page.waitForFunction(() => {
    const state = window.__littleCloud.snapshot();
    return state.event.run && state.phase === 'idle' && document.getElementById('status').textContent === 'ROUND 1';
  });
  const prepared = await page.evaluate(() => ({
    state: window.__littleCloud.snapshot(),
    turn: document.getElementById('turn').textContent,
    timer: document.getElementById('timer').textContent,
    speed: document.getElementById('speed-bonus').textContent,
    score: document.getElementById('score').textContent,
    cue: document.getElementById('score-cue').textContent,
    controlReady: window.__littleCloud.snapshot().event.firstTurnControlReady,
  }));
  assert.equal(prepared.state.event.run.turns.length, 0);
  assert.equal(prepared.state.event.turn, 0, 'no scored turn starts during preparation');
  assert.equal(prepared.state.event.remaining, 15, 'preparation preserves the full aiming clock');
  assert.equal(prepared.turn, '1 / 3');
  assert.equal(prepared.timer, '15');
  assert.equal(prepared.speed, 'SPEED +50');
  assert.equal(prepared.score, '000');
  assert.equal(prepared.cue, 'Catch faster. Earn more points.');
  assert.equal(prepared.controlReady, true, 'the count-in starts only after the camera fixture recognizes the selected controller');
  const wideCamera = prepared.state.camera;

  const desktop = await page.evaluate(() => ({
    width: innerWidth,
    scoreSize: parseFloat(getComputedStyle(document.getElementById('score')).fontSize),
    timerSize: parseFloat(getComputedStyle(document.getElementById('timer')).fontSize),
    cueSize: parseFloat(getComputedStyle(document.getElementById('score-cue')).fontSize),
    scoreColor: getComputedStyle(document.getElementById('score')).color,
    timerColor: getComputedStyle(document.getElementById('timer')).color,
  }));
  if (desktop.width > 1000) {
    assert.ok(desktop.scoreSize >= 40, `desktop score is large (${desktop.scoreSize}px)`);
    assert.ok(desktop.cueSize >= 14, `desktop speed reminder is readable (${desktop.cueSize}px)`);
    assert.notEqual(desktop.scoreColor, desktop.timerColor, 'score and time have separate colors');
  }
  if (captureScreenshots) {
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    await page.screenshot({ path: '.screenshots/issue-93-countdown-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      const hud = document.querySelector('.player-hud').getBoundingClientRect();
      const score = rect('score'), timer = rect('timer'), cue = rect('score-cue');
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scoreSize: parseFloat(getComputedStyle(document.getElementById('score')).fontSize), cueSize: parseFloat(getComputedStyle(document.getElementById('score-cue')).fontSize), hud, score, timer, cue };
    });
    assert.ok(narrow.scoreSize >= 24, `narrow score remains readable (${narrow.scoreSize}px)`);
    assert.ok(narrow.cueSize >= 11, `narrow speed reminder is readable (${narrow.cueSize}px)`);
    assert.ok(narrow.scrollWidth <= narrow.width, 'narrow HUD has no horizontal overflow');
    assert.ok(narrow.score.right <= narrow.hud.right && narrow.timer.right <= narrow.hud.right, 'score and timer stay inside the HUD');
    assert.ok(narrow.score.right < narrow.timer.left, 'score stays distinct from time left');
    assert.ok(narrow.cue.left >= narrow.hud.left && narrow.cue.right <= narrow.hud.right, 'speed cue stays inside the HUD');
    await page.screenshot({ path: '.screenshots/issue-93-countdown-narrow.png' });
    await page.setViewportSize(viewport);
  }

  assert.equal(await cameraDrop(page), false, 'no drop is accepted during the first-turn count-in');
  await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
  await page.waitForFunction(() => {
    const event = window.__littleCloud.snapshot().event;
    return !event.firstTurnControlReady && event.firstTurnPreparationElapsed === 0;
  }, null, { timeout: 2500 });
  const waiting = await page.evaluate(() => ({ state: window.__littleCloud.snapshot(), title: document.getElementById('status').textContent }));
  assert.equal(waiting.state.phase, 'idle');
  assert.equal(waiting.state.event.remaining, 15);
  assert.equal(waiting.state.event.turn, 0);
  assert.equal(waiting.title, waiting.state.event.controlProfile === 'dual' ? 'SHOW BOTH HANDS OPEN' : 'SHOW ONE HAND');
  assert.equal(await cameraDrop(page), false, 'control loss cannot turn unfinished first prep into a scored drop');

  const observation = await page.evaluateHandle(recordStartCue);
  try {
    await observation.evaluate(record => {
      record.reacquiredAt = performance.now();
      window.testCamera.visible = true;
      window.testCamera.tick();
    });
    await page.waitForFunction(record => record.start && record.aim, observation);
    const record = await observation.jsonValue();
    assertPreparationTiming(record);
    for (const { cue, state } of record.cues) {
      assert.equal(state.phase, 'idle', `${cue} remains preparation`);
      assert.equal(state.event.remaining, 15, `${cue} does not consume aiming time`);
      assert.equal(state.event.turn, 0, `${cue} does not start a scored turn`);
      assert.equal(state.event.firstTurnControlReady, true, `${cue} requires the selected controller`);
    }
    const { start, aim } = record;
    assert.equal(start.dropAccepted, false, 'the START cue still rejects drops');
    const startCamera = start.state.camera;
    assert.ok(Math.hypot(...startCamera.map((value, i) => value - wideCamera[i])) > .1, 'the count-in moves the camera into the play view before START');
    assertStartCueDuration({ start, aim });
    const scored = aim.state;
    assert.equal(scored.phase, 'aim');
    assert.equal(scored.event.run.turns.length, 0); assert.equal(scored.event.turn, 1);
    assert.ok(scored.event.remaining >= 14.9, `aiming begins with the full clock (${scored.event.remaining.toFixed(2)} s after the first aim frame)`);
    assert.ok(Math.hypot(...scored.camera.map((value, i) => value - startCamera[i])) < .001, 'the camera is settled before the first timed frame');
    assert.equal(await page.locator('#practice, #practice-marker, #rehearsal-exit').count(), 0);
  } finally {
    await observation.evaluate(record => cancelAnimationFrame(record.frame));
    await observation.dispose();
  }
}
