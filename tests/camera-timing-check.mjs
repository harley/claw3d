import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Keep the real capture gate, recognition handler, drawing and camera adapter.
// Replace hardware startup only; all observations below are synthetic.
export async function checkCameraTiming(browser, origin) {
  const source = await readFile(new URL('../src/vision.js', import.meta.url), 'utf8');
  const measurements = [];
  async function setup() {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new Error('Timing checks must not open a physical camera'); };
    });
    await page.route('**/src/vision.js*', route => route.fulfill({ contentType: 'application/javascript', body: source + `
      HandController.prototype.start = async function() {
        this.running = true; this.starting = false; this.generation++;
        window.timingController = this;
        this.lastCapture = -Infinity; this.lastResponseCapture = -Infinity;
        this.onState({ kind: 'ready', message: 'Show one hand' });
      };
      window.timingSample = (kind = 'open', gap = 65, x = .5, age = 20) => {
        const c = window.timingController;
        window.captureTime = (window.captureTime || performance.now()) + gap;
        const hand = position => {
          const lm = Array.from({ length: 21 }, () => ({ x: 1-position, y: .5, z: 0 }));
          lm[0].y = .56; lm[9].y = .44; lm[5].x -= .06; lm[17].x += .06;
          return lm;
        };
        const count = kind === 'missing' ? 0 : kind === 'second' ? 2 : 1;
        const result = {
          landmarks: Array.from({ length: count }, (_, i) => hand(i ? .7 : x)),
          handedness: Array.from({ length: count }, () => [{ categoryName: 'Left' }]),
          gestures: Array.from({ length: count }, () => [{ categoryName: kind === 'open' ? 'Open_Palm' : 'Closed_Fist', score: .99 }]),
        };
        const accepted = c.acceptResult(result, window.captureTime, c.generation, window.captureTime + age);
        return { accepted, held: c.fist.held, armed: c.fist.armed, input: { ...c.input }, phase: window.__littleCloud.snapshot().phase };
      };
    ` }));
    await page.goto(origin);
    await page.waitForFunction(() => window.__littleCloud);
    await page.locator('#play').click();
    await page.waitForFunction(() => window.timingController);
    await page.evaluate(() => { for (let i = 0; i < 14; i++) timingSample(); });
    await page.locator('#play').click();
    await page.locator('#name').fill('Synthetic local timing check');
    await page.locator('#name').press('Enter');
    await page.waitForFunction(() => window.__littleCloud.snapshot().event.run);
    // Let the count-in finish and the rendered first aim reset ownership before
    // injecting a whole acquisition sequence in one synthetic burst. Real
    // camera samples arrive across frames; CI can observe the run before its
    // first frame.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { for (let i = 0; i < 14; i++) timingSample(); });
    return page;
  }

  // Capture times are deterministic; receipt times stay chronological even for
  // late results. No inference or camera recognition accuracy is asserted.
  for (const kind of ['stale', 'silence', 'missing', 'second']) {
    const page = await setup();
    try {
      const result = await page.evaluate(kind => {
        for (let i = 0; i < 5; i++) timingSample('open', 65, .6);
        timingSample('closed', 65, .6);
        timingSample('closed', 200, .6);
        const pending = timingSample('closed', 200, .6);
        if (kind === 'stale') timingSample('closed', 65, .6, 350);
        else if (kind === 'silence') timingController.supervise(captureTime + 350);
        else timingSample(kind, 65, .6);
        const cancelled = { held: timingController.fist.held, armed: timingController.fist.armed };
        // A returning fist must not fire; open again to re-arm.
        const returning = timingSample('closed', 400, .65);
        for (let i = 0; i < 4; i++) timingSample('closed', 200, .65);
        const unarmedPhase = window.__littleCloud.snapshot().phase;
        const resumed = timingSample('open', 65, .65);
        return { pending, cancelled, returning, unarmedPhase, resumed };
      }, kind);
      assert.equal(result.pending.held, 400);
      assert.deepEqual(result.cancelled, { held: 0, armed: false }, `${kind} cancels the pending hold`);
      assert.equal(result.returning.phase, 'aim');
      assert.equal(result.unarmedPhase, 'aim', `${kind} cannot fire a returning fist`);
      assert.deepEqual(result.resumed.input, { x: 0, z: 0 });
      measurements.push({ kind, heldBeforeCancel: 400, heldAfterCancel: 0, drop: false });
    } finally { await page.close(); }
  }

  // Test open-hand recovery separately: a closed hand itself clears neutral and
  // would conceal a stale-result steering jump.
  for (const kind of ['stale', 'silence', 'missing']) {
    const page = await setup();
    try {
      const resumed = await page.evaluate(kind => {
        for (let i = 0; i < 6; i++) timingSample('open', 65, .6);
        if (kind === 'stale') timingSample('open', 65, .6, 350);
        else if (kind === 'silence') timingController.supervise(captureTime + 350);
        else timingSample('missing');
        return timingSample('open', 400, .65);
      }, kind);
      measurements.push({ kind: `${kind}-recovery`, input: resumed.input });
      assert.deepEqual(resumed.input, { x: 0, z: 0 }, `${kind} recovery starts at zero`);
      const position = await page.evaluate(() => window.__littleCloud.snapshot().position);
      await page.waitForTimeout(200);
      assert.deepEqual(await page.evaluate(() => window.__littleCloud.snapshot().position), position,
        'rendered claw stays still when tracking resumes');
      if (kind === 'stale') await page.screenshot({ path: '.screenshots/camera-stale-recovery.png' });
    } finally { await page.close(); }
  }

  for (const intervals of [Array(17).fill(33), Array(9).fill(65), [33, 90, 120, 45, 200, 61, 1], [275, 275]]) {
    const page = await setup();
    try {
      const samples = await page.evaluate(intervals => {
        timingSample('closed');
        return intervals.map(gap => timingSample('closed', gap));
      }, intervals);
      for (const sample of samples.slice(0, -1)) assert.equal(sample.phase, 'aim', 'less than 550ms never fires');
      const last = samples.at(-1);
      assert.equal(last.phase, 'anticipate');
      assert.ok(last.held >= 550);
      measurements.push({ intervals, acceptedClosedMs: last.held });
      if (intervals.length === 2) {
        await page.evaluate(() => timingSample('missing'));
        await page.waitForFunction(() => window.__littleCloud.snapshot().event.run.turns.length === 1, {}, { timeout: 30000 });
        assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.run.turns.length), 1);
      }
    } finally { await page.close(); }
  }
  console.log('PASS real camera adapter timing and recovery', JSON.stringify(measurements));
}
