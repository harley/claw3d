import assert from 'node:assert/strict';
// Deterministic camera events for game-flow tests; hardware/model smoke is separate.
export async function installCameraFixture(page) {
  await page.route('**/src/vision.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export class HandController {
      constructor(options) { Object.assign(this, options); this.running = false; this.input = {x:0,z:0}; this.visible = true; window.testCamera = this; }
      resetOwner() { this.input = {x:0,z:0}; this.onInput(this.input); }
      async start() { this.running = true; this.tick(); this.timer = setInterval(() => this.tick(), 30); }
      tick() { this.onInput(this.visible ? this.input : {x:0,z:0}); this.onState({kind: this.visible ? 'tracking' : 'lost', message: this.visible ? 'One hand to steer · clench to drop' : 'Show one hand to continue', ...this.feedback}); }
      stop() { clearInterval(this.timer); this.running = false; this.onState({kind:'off',message:'Start the camera to play'}); }
      setPerformanceMode() { return false; }
      clench() { return this.onDrop(); }
    }
  ` }));
}
export const cameraInput = (page, input) => page.evaluate(input => { window.testCamera.input = input; window.testCamera.tick(); }, input);
export const cameraDrop = page => page.evaluate(() => window.testCamera.clench());

export async function assertScoredStart(page, { captureScreenshots = false } = {}) {
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
  }));
  assert.equal(prepared.state.event.run.turns.length, 0);
  assert.equal(prepared.state.event.turn, 0, 'no scored turn starts during preparation');
  assert.equal(prepared.state.event.remaining, 15, 'preparation preserves the full aiming clock');
  assert.equal(prepared.turn, '1 / 3');
  assert.equal(prepared.timer, '15');
  assert.equal(prepared.speed, 'SPEED +50');
  assert.equal(prepared.score, '000');
  assert.equal(prepared.cue, 'Catch faster. Earn more points.');
  const wideCamera = prepared.state.camera;

  const desktop = await page.evaluate(() => ({
    width: innerWidth,
    scoreSize: parseFloat(getComputedStyle(document.getElementById('score')).fontSize),
    timerSize: parseFloat(getComputedStyle(document.getElementById('timer')).fontSize),
    scoreColor: getComputedStyle(document.getElementById('score')).color,
    timerColor: getComputedStyle(document.getElementById('timer')).color,
  }));
  if (desktop.width > 1000) {
    assert.ok(desktop.scoreSize >= 40, `desktop score is large (${desktop.scoreSize}px)`);
    assert.notEqual(desktop.scoreColor, desktop.timerColor, 'score and time have separate colors');
  }
  if (captureScreenshots) {
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    await page.screenshot({ path: '.screenshots/issue-90-countdown-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const narrow = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      const hud = document.querySelector('.player-hud').getBoundingClientRect();
      const score = rect('score'), timer = rect('timer'), cue = rect('score-cue');
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scoreSize: parseFloat(getComputedStyle(document.getElementById('score')).fontSize), hud, score, timer, cue };
    });
    assert.ok(narrow.scoreSize >= 24, `narrow score remains readable (${narrow.scoreSize}px)`);
    assert.ok(narrow.scrollWidth <= narrow.width, 'narrow HUD has no horizontal overflow');
    assert.ok(narrow.score.right <= narrow.hud.right && narrow.timer.right <= narrow.hud.right, 'score and timer stay inside the HUD');
    assert.ok(narrow.score.right < narrow.timer.left, 'score stays distinct from time left');
    assert.ok(narrow.cue.left >= narrow.hud.left && narrow.cue.right <= narrow.hud.right, 'speed cue stays inside the HUD');
    await page.screenshot({ path: '.screenshots/issue-90-countdown-narrow.png' });
    await page.setViewportSize(viewport);
  }

  assert.equal(await cameraDrop(page), false, 'no drop is accepted during the first-turn count-in');
  for (const cue of ['3', '2', '1', 'START!']) {
    await page.waitForFunction(expected => document.getElementById('status').textContent === expected, cue);
    const state = await page.evaluate(() => window.__littleCloud.snapshot());
    assert.equal(state.phase, 'idle', `${cue} remains preparation`);
    assert.equal(state.event.remaining, 15, `${cue} does not consume aiming time`);
    assert.equal(state.event.turn, 0, `${cue} does not start a scored turn`);
  }
  assert.equal(await cameraDrop(page), false, 'the START cue still rejects drops');
  const startCamera = await page.evaluate(() => window.__littleCloud.snapshot().camera);
  assert.ok(Math.hypot(...startCamera.map((value, i) => value - wideCamera[i])) > .1, 'the count-in moves the camera into the play view before START');
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  const scored = await page.evaluate(() => window.__littleCloud.snapshot());
  assert.equal(scored.phase, 'aim');
  assert.equal(scored.event.run.turns.length, 0); assert.equal(scored.event.turn, 1);
  assert.equal(scored.event.remaining, 15, 'aiming begins with the full clock');
  assert.ok(Math.hypot(...scored.camera.map((value, i) => value - startCamera[i])) < .001, 'the camera is settled before the first timed frame');
  assert.equal(await page.locator('#practice, #practice-marker, #rehearsal-exit').count(), 0);
}
