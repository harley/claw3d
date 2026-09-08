import assert from 'node:assert/strict';
// Deterministic camera events for game-flow tests; hardware/model smoke is separate.
export async function installCameraFixture(page) {
  await page.route('**/src/vision.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export class HandController {
      constructor(options) { Object.assign(this, options); this.running = false; this.input = {x:0,z:0}; this.visible = true; window.testCamera = this; }
      resetOwner() { this.input = {x:0,z:0}; this.onInput(this.input); }
      async start() { this.running = true; this.tick(); this.timer = setInterval(() => this.tick(), 30); }
      tick() { this.onInput(this.visible ? this.input : {x:0,z:0}); this.onState({kind: this.visible ? 'tracking' : 'lost', message: this.visible ? 'One hand to steer · clasp to drop' : 'Show one hand to continue', ...this.feedback}); }
      stop() { clearInterval(this.timer); this.running = false; this.onState({kind:'off',message:'Start the camera to play'}); }
      clasp() { return this.onDrop(); }
    }
  ` }));
}
export const cameraInput = (page, input) => page.evaluate(input => { window.testCamera.input = input; window.testCamera.tick(); }, input);
export const cameraDrop = page => page.evaluate(() => window.testCamera.clasp());

export async function completeRehearsal(page) {
  const before = await page.evaluate(() => window.__littleCloud.snapshot());
  if (!before.event.rehearsal) return;
  assert.equal(before.event.rehearsal, 'steer');
  assert.equal(before.event.run, null); assert.equal(before.event.remaining, 15);
  // Deliberately stay before the ring: it is guidance, never a drop gate.
  assert.equal(await cameraDrop(page), true);
  assert.equal(await cameraDrop(page), false);
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'descend');
  assert.equal(await page.locator('#rehearsal-exit').isEnabled(), false);
  await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); document.getElementById('rehearsal-exit').click(); });
  const inFlight = await page.evaluate(() => window.__littleCloud.snapshot());
  assert.equal(inFlight.event.rehearsal, 'delivery'); assert.equal(inFlight.event.run, null);
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.rehearsal === 'complete', {}, { timeout: 30000 });
  const completed = await page.evaluate(() => window.__littleCloud.snapshot());
  assert.equal(completed.phase, 'result'); assert.equal(completed.event.run, null);
  assert.equal(completed.event.board.runs.length, before.event.board.runs.length);
  assert.equal(completed.event.remaining, 15);
  await page.screenshot({ path: '.screenshots/camera-rehearsal.png' });
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.run);
  const scored = await page.evaluate(() => window.__littleCloud.snapshot());
  assert.equal(scored.event.run.turns.length, 0); assert.equal(scored.event.turn, 1);
  await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
}
