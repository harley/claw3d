import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const source = await readFile(new URL('../src/vision.js', import.meta.url), 'utf8');
  await page.route('**/src/vision.js*', route => route.fulfill({ contentType: 'application/javascript', body: source + `
    HandController.prototype.start = async function() {
      this.running = true; this.starting = false; this.generation++;
      window.controller = this; this.lastCapture = -Infinity; this.lastResponseCapture = -Infinity;
      this.onState({ kind: 'ready' });
    };
    window.sample = (kind = 'open', x = .5, y = .5, age = 20) => {
      window.capture = (window.capture || performance.now()) + 65;
      const points = Array.from({length:21}, () => ({x:1-x,y,z:0}));
      points[0].y += .06; points[9].y -= .06; points[5].x -= .06; points[17].x += .06;
      const count = kind === 'missing' ? 0 : kind === 'second' ? 2 : 1;
      controller.acceptResult({ landmarks: Array.from({length:count},()=>points),
        handedness: Array.from({length:count},()=>[{categoryName:'Left'}]),
        gestures: Array.from({length:count},()=>[{categoryName:kind==='open'?'Open_Palm':'Closed_Fist',score:.99}])
      }, capture, controller.generation, capture + age);
      return { input: {...controller.input}, grip: controller.grab.read() };
    };
  ` }));
  await page.goto('http://127.0.0.1:4196/?setup=manual&controls=grab');
  await page.waitForFunction(() => window.__littleCloud);
  await page.locator('#play').click();
  await page.waitForFunction(() => window.controller);
  assert.equal(await page.evaluate(() => controller.getControlProfile()), 'hold-drop', 'menus retain hold selection');
  await page.locator('#play').click();
  await page.locator('#name').fill('Synthetic grab check'); await page.locator('#name').press('Enter');
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => { for(let i=0;i<15;i++) sample(); });
  assert.equal(await page.evaluate(() => controller.getControlProfile()), 'grab-release');
  const target = await page.locator('.stick-base').evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: .18 + (r.left+r.width/2)/innerWidth*.64, y:.15+(r.top+r.height/2)/innerHeight*.70 };
  });
  const burst = (kind, n=5, dx=0, age=20) => page.evaluate(({kind,n,target,dx,age}) => {
    let last; for(let i=0;i<n;i++) last=sample(kind,target.x+dx,target.y,age); return last;
  },{kind,n,target,dx,age});
  // Walk the tracked hand down to the stick without breaking ownership.
  await page.evaluate(target => { for(let i=1;i<=8;i++) sample('open',.5+(target.x-.5)*i/8,.5+(target.y-.5)*i/8); },target);
  assert.equal((await burst('closed')).grip.stage, 'gripped');
  await page.waitForFunction(() => document.getElementById('joystick-cursor').dataset.stage === 'gripped');
  assert.equal(await page.locator('.deck-drop').isVisible(), false);
  assert.equal(await page.locator('#deck-state').textContent(), 'RELEASE TO DROP');
  assert.equal((await page.evaluate(() => window.__littleCloud.snapshot())).phase, 'aim');
  assert.ok((await burst('closed',5,.07)).input.x>0);
  await page.screenshot({path:'.screenshots/grab-release-gripped.png'});
  await burst('second',1,.07);
  await burst('open',5,.07);
  assert.equal((await page.evaluate(() => window.__littleCloud.snapshot())).phase,'aim','extra hand cancels attachment without release');
  // Reattach at the same screen control and release intentionally.
  await burst('open'); await burst('closed');
  assert.deepEqual((await burst('open',1)).input,{x:0,z:0});
  await burst('open',3);
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase !== 'aim');
  await burst('missing');
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'result',{}, {timeout:30000});
  assert.equal((await page.evaluate(() => window.__littleCloud.snapshot())).event.run.turns.length,1);
  for (let turn = 2; turn <= 3; turn++) {
    await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim', {}, {timeout:10000});
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => { for(let i=0;i<15;i++) sample(); });
    await page.evaluate(target => { for(let i=1;i<=8;i++) sample('open',.5+(target.x-.5)*i/8,.5+(target.y-.5)*i/8); },target);
    assert.equal((await burst('closed')).grip.stage, 'gripped');
    await burst('open'); await burst('missing');
    await page.waitForFunction(turn => {
      const state = window.__littleCloud.snapshot().event;
      return turn === 3 ? Boolean(state.complete) : state.run?.turns.length === turn;
    },turn,{timeout:30000});
  }
  const completed = await page.evaluate(() => window.__littleCloud.snapshot().event.complete);
  assert.equal(completed.turns.length,3);
  assert.equal(new Set(completed.turns.map(t=>t.turn)).size,3);
  assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k=>k.endsWith(':grab-release'))));
  console.log('PASS real camera adapter grab, fist steering, explicit release, two-hand cancellation, isolated scores, three scored turns and delivery after loss');
} finally { await browser.close(); }
