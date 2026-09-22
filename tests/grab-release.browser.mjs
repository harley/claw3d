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
  await page.route('**/src/arcade.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nwindow.testAim = (x,z,orbit) => { game.position = {x,z}; if (orbit !== undefined) moveCarousel(game,orbit-game.carouselTime); };' });
  });
  await page.goto('http://127.0.0.1:4196/?setup=manual&controls=grab');
  await page.waitForFunction(() => window.__littleCloud);
  await page.screenshot({path:'.screenshots/machine-play.png'});
  await page.locator('#play').click();
  await page.waitForFunction(() => window.controller);
  assert.equal(await page.evaluate(() => controller.getControlProfile()), 'hold-drop', 'menus retain hold selection');
  await page.locator('#play').click();
  await page.locator('#name').fill('Synthetic grab check'); await page.locator('#name').press('Enter');
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => { for(let i=0;i<15;i++) sample(); });
  assert.equal(await page.evaluate(() => controller.getControlProfile()), 'grab-release');
  for (const viewport of [{width:820,height:900},{width:390,height:844},{width:390,height:700},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(viewport.width===390 && viewport.height===844) await page.screenshot({path:'.screenshots/machine-mobile.png'});
    const button=await page.locator('#machine-drop').boundingBox();
    assert.ok(button && button.x>=0 && button.y>=0 && button.x+button.width<=viewport.width && button.y+button.height<=viewport.height, `cabinet button stays on screen at ${viewport.width}x${viewport.height}`);
  }
  const targets = async () => page.evaluate(() => {
    const {stick,drop}=window.__littleCloud.snapshot().machineControls;
    const hand = p => ({x:.18+p.x/innerWidth*.64,y:.15+p.y/innerHeight*.70});
    return {stick:hand(stick),drop:hand(drop)};
  });
  let target=(await targets()).stick;
  const burst = (kind,n=5,p=target) => page.evaluate(({kind,n,p})=>{
    let last;for(let i=0;i<n;i++)last=sample(kind,p.x,p.y);return last;
  },{kind,n,p});
  const reach = async p => {
    await page.evaluate(p=>{ const c=controller.owner || {x:.5,y:.5}; const start={...c}; for(let i=1;i<=8;i++)sample('open',start.x+(p.x-start.x)*i/8,start.y+(p.y-start.y)*i/8); },p);
    await burst('open',5,p);
  };
  await reach(target);
  assert.equal((await burst('closed')).grip.stage,'gripped');
  await page.waitForFunction(()=>document.getElementById('joystick-cursor').dataset.stage==='gripped');
  assert.equal(await page.locator('#control-deck').isVisible(),false);
  assert.equal(await page.locator('#machine-drop').isVisible(),true);
  assert.ok((await burst('closed',5,{x:target.x+.07,y:target.y})).input.x>0);
  await burst('open');
  assert.equal((await page.evaluate(()=>window.__littleCloud.snapshot())).phase,'aim','release only lets go');
  await page.screenshot({path:'.screenshots/machine-controls.png'});
  // A real catch must remain removed on later turns. Test hook sets aim only;
  // the real contact, delivery, score and new-turn paths resolve it.
  await page.evaluate(()=>testAim(.80,.22,4.55));
  await page.locator('#machine-drop').click();
  await burst('missing');
  await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='result',{}, {timeout:30000});
  const first=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.equal(first.event.run.turns[0].prizeId,'sprout');
  for(let turn=2;turn<=3;turn++) {
    await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='aim',{}, {timeout:10000});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const state=await page.evaluate(()=>window.__littleCloud.snapshot());
    assert.ok(state.toys.find(t=>t.id==='sprout').claimed);
    assert.ok(state.collection.includes('sprout'));
    if(turn===2) await page.screenshot({path:'.screenshots/machine-star-removed.png'});
    await page.evaluate(()=>testAim(.80,.22));
    await page.evaluate(()=>{for(let i=0;i<15;i++)sample();});
    await page.waitForFunction(()=>document.getElementById('jackpot-signal').hidden);
    const d=(await targets()).drop;
    if(turn===2) {
      await reach(d); await burst('closed',5,d);
    } else {
      const above={x:d.x,y:d.y-.10}; await reach(above);
      await burst('open',1,{x:d.x,y:d.y-.055});
      await burst('open',1,d);
    }
    await page.waitForFunction(()=>window.__littleCloud.snapshot().phase!=='aim');
    await burst('missing');
    await page.waitForFunction(turn=>{const e=window.__littleCloud.snapshot().event;return turn===3?Boolean(e.complete):e.run?.turns.length===turn;},turn,{timeout:30000});
  }
  const completed=await page.evaluate(()=>window.__littleCloud.snapshot().event.complete);
  assert.equal(completed.turns.length,3);
  assert.equal(completed.turns.filter(t=>t.prizeId==='sprout').length,1,'caught toy cannot score again');
  await page.locator('#next-player').click();
  await page.locator('#register-play').click();
  await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='aim');
  assert.ok((await page.evaluate(()=>window.__littleCloud.snapshot().toys)).every(t=>!t.claimed),'new player restocks');
  assert.deepEqual(errors,[]);
  console.log('PASS cabinet controls, safe release, click/clench/slam drops, persistent caught toys and exactly three turns');
} finally { await browser.close(); }
