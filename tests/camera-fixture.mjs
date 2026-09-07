import assert from 'node:assert/strict';
// Deterministic camera events for game-flow tests; hardware/model smoke is separate.
export async function installCameraFixture(page) {
  await page.route('**/src/vision.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export class HandController {
      constructor(options) { Object.assign(this, options); this.running = false; this.input = {x:0,z:0}; this.visible = true; window.testCamera = this; }
      resetOwner() { this.input = {x:0,z:0}; this.onInput(this.input); }
      async start() { this.running = true; this.tick(); this.timer = setInterval(() => this.tick(), 30); }
      tick() { this.onInput(this.visible ? this.input : {x:0,z:0}); this.onState({kind: this.visible ? 'tracking' : 'lost', message: this.visible ? 'One hand to steer · clasp to drop' : 'Show one hand to continue'}); }
      stop() { clearInterval(this.timer); this.running = false; this.onState({kind:'off',message:'Start the camera to play'}); }
      clasp() { this.onDrop(); }
    }
  ` }));
}
export const cameraInput = (page, input) => page.evaluate(input => { window.testCamera.input = input; window.testCamera.tick(); }, input);
export const cameraDrop = page => page.evaluate(() => window.testCamera.clasp());

export async function completeRehearsal(page) {
  if (!(await page.evaluate(() => window.__littleCloud.snapshot().event.rehearsal))) return;
  for (const axis of ['x', 'z']) for (let i = 0; i < 8; i++) {
    const state = await page.evaluate(() => window.__littleCloud.snapshot());
    if (state.event.rehearsal !== 'steer') break;
    const delta = ({ x: -.65, z: .50 })[axis] - state.position[axis];
    if (Math.abs(delta) < .015) break;
    await cameraInput(page, { x: 0, z: 0, [axis]: Math.sign(delta) * .5 });
    await page.waitForTimeout(Math.abs(delta) / (.85 * .5) * 1000);
    await cameraInput(page, { x: 0, z: 0 });
  }
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.rehearsal === 'drop');
  const before = await page.evaluate(() => window.__littleCloud.snapshot());
  assert.equal(before.event.run, null); assert.equal(before.event.remaining, 15);
  await page.screenshot({ path: '.screenshots/camera-rehearsal.png' });
  await cameraDrop(page);
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.run);
}
