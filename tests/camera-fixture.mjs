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

export async function assertScoredStart(page) {
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.run);
  const scored = await page.evaluate(() => window.__littleCloud.snapshot());
  assert.equal(scored.phase, 'aim');
  assert.equal(scored.event.run.turns.length, 0); assert.equal(scored.event.turn, 1);
  assert.equal(await page.locator('#practice, #practice-marker, #rehearsal-exit').count(), 0);
}
