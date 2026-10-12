// Synthetic landmarks traverse the real HandController, menu hit testing and mechanics.
// Acquisition is replaced; this is not physical-camera or detector validation.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPilotServer } from '../server/index.js';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const directory = await mkdtemp(join(tmpdir(),'claw-phone-hands-'));
const app = await createPilotServer({filename:join(directory,'scores.sqlite'),origin:'http://127.0.0.1:4196',staffCode:'phone-hands-fixture-staff',hostCode:'phone-hands-fixture-host',secure:false,publicTryEnabled:true});
await new Promise(resolve=>app.server.listen(4292,'127.0.0.1',resolve));
const browser = await chromium.launch(browserOptions);
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script>window.__PUBLIC_TRY__=true;window.__PUBLIC_PLAY__=true;</script>') });
  });
  const source = await readFile(new URL('../src/vision.js', import.meta.url), 'utf8');
  await page.route('**/src/vision.js*', route => route.fulfill({ contentType: 'application/javascript', body: source + `
    HandController.prototype.start = async function() {
      this.running = true; this.starting = false; this.generation++; window.controller = this;
      this.lastCapture = this.lastResponseCapture = -Infinity; this.onState({kind:'ready'});
    };
    window.sample = hands => {
      window.capture = (window.capture || performance.now()) + 65;
      const result = {landmarks:[], handedness:[], gestures:[]};
      for (const {role, kind='open', x, y} of hands) {
        const points = Array.from({length:21}, () => ({x:1-x,y,z:0}));
        points[0].y += .06; points[9].y -= .06; points[5].x -= .06; points[17].x += .06;
        result.landmarks.push(points); result.handedness.push([{categoryName:role==='left'?'Left':'Right',score:.99}]);
        result.gestures.push([{categoryName:kind==='closed'?'Closed_Fist':'Open_Palm',score:.99}]);
      }
      controller.acceptResult(result,capture,controller.generation,capture+20);
    };` }));
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:'http://127.0.0.1:4292'+url.pathname+url.search});await route.fulfill({response});});
  const snap = () => page.evaluate(() => window.__littleCloud.snapshot());
  const burst = async (hands, count=16) => {
    for (let i=0;i<count;i++) await page.evaluate(async hands => { sample(hands); await new Promise(requestAnimationFrame); }, hands);
  };
  const left = (kind='open',x=.35,y=.55) => ({role:'left',kind,x,y});
  const right = (x=.85,y=.62) => ({role:'right',kind:'open',x,y});
  const select = async id => {
    const locator = page.locator('#'+id); await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox(), viewport=page.viewportSize();
    const point = {x:.18+(box.x+box.width/2)/viewport.width*.64,y:.15+(box.y+box.height/2)/viewport.height*.70};
    await burst([right(),left('open',point.x,point.y)],32); // Reacquire after a large move between separated targets.
    await page.waitForFunction(id => document.getElementById(id).classList.contains('hand-hover'),id);
    assert.ok(await page.locator('#hand-cursor').isVisible());
    assert.ok((await page.locator('#hand-cursor').boundingBox()).width<=32);
    if(id==='mobile-menu-open') {
      assert.equal(await page.locator('.camera-feedback').isVisible(),false,'idle hand-found banner cannot overlap Play');
      await page.screenshot({path:'.screenshots/repair-menu-target-390.png'});
    }
    await burst([right(),left('closed',point.x,point.y)],12);
  };
  await page.goto('http://127.0.0.1:4196/?setup=manual');
  await page.locator('#play:not([disabled])').waitFor();
  await page.locator('#play').click(); await page.locator('#input-two').click();
  assert.equal(await page.locator('#mobile-aim-hint').textContent(),'Open left hand to start');
  await page.locator('#register-play').click();
  await page.waitForFunction(() => window.controller?.running && window.__littleCloud?.snapshot().event.run);
  assert.equal(await page.evaluate(() => controller.maxHands),2);
  await burst([left('closed')]);
  assert.equal((await snap()).event.firstTurnControlReady,false,'closed-first hand cannot acquire the run');
  await burst([left()]);
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.firstTurnControlReady);
  await page.evaluate(hands => { window.prepSamples=setInterval(()=>sample(hands),130); },[left('closed')]);
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase==='aim');
  await page.evaluate(() => clearInterval(window.prepSamples));
  assert.equal(await page.evaluate(() => controller.dual.left.gesture.stage),'gripped','acquired left grip survives GO');
  await page.locator('#mobile-menu-open').click();
  await select('mobile-pause');
  assert.equal((await snap()).event.paused,true);
  const paused=(await snap()).event.remaining; await page.waitForTimeout(150);
  assert.equal((await snap()).event.remaining,paused);
  await select('play'); assert.equal((await snap()).event.paused,false,'ranked phone can resume by hand without host access');
  await burst([left()]); await burst([left('closed')],12);
  await burst([right(),left('closed')],8); // Seed the neutral after GO before moving.
  const start=(await snap()).position.x;
  await burst([right(),left('closed',.30)],10);
  assert.ok((await snap()).position.x<start,'mirrored anatomical left hand steers with reversed result order');
  for(let turn=1;turn<=3;turn++) {
    await page.waitForFunction(() => window.__littleCloud.snapshot().phase==='aim');
    if(turn>1) { await burst([left()]); await burst([right(),left('closed')],10); }
    // Acquire away from DROP, then approach in continuous steps.
    await burst([right(),left('closed',turn===1?.30:.35)],8);
    await burst([right(.78,.50),left('closed',turn===1?.30:.35)],3);
    await burst([right(.72,.44),left('closed',turn===1?.30:.35)],6);
    await page.waitForFunction(() => Boolean(window.__littleCloud.snapshot().event.pendingSlam)||window.__littleCloud.snapshot().phase!=='aim');
    await burst([],3); // Loss after acceptance cannot freeze or duplicate delivery.
    await page.waitForFunction(turn => (window.__littleCloud.snapshot().event.complete||window.__littleCloud.snapshot().event.run)?.turns.length===turn,turn,{timeout:18000});
  }
  await page.locator('#final[open]').waitFor();
  assert.equal((await snap()).event.complete.turns.length,3);
  await select('final-more'); await page.locator('#mobile-menu[open]').waitFor();
  await select('mobile-help'); await page.locator('#hand-guide[open]').waitFor();
  assert.match(await page.locator('#hand-guide-title').textContent(),/SHOW LEFT HAND/);
  await select('hand-guide-next'); assert.match(await page.locator('#hand-guide-title').textContent(),/FIST TO AIM/);
  await select('hand-guide-next'); assert.match(await page.locator('#hand-guide-title').textContent(),/PALM TO DROP/);
  await page.screenshot({path:'.screenshots/repair-dual-help-390.png'});
  await select('hand-guide-close'); await page.locator('#mobile-menu[open]').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'mobile-help');
  await select('mobile-menu-close'); await page.locator('#final[open]').waitFor();
  await select('final-how-to-play'); await page.locator('#hand-guide[open]').waitFor();
  await select('hand-guide-close'); await page.locator('#final[open]').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'final-how-to-play');
  await page.screenshot({path:'.screenshots/repair-results-390.png'});
  await select('next-player'); await page.locator('#registration[open]').waitFor();
  await select('input-one'); assert.equal(await page.locator('#input-one').getAttribute('aria-pressed'),'true');
  await select('input-two'); assert.equal(await page.locator('#input-two').getAttribute('aria-pressed'),'true');
  await select('register-cancel'); await select('mobile-menu-open');
  await select('mobile-help'); await select('hand-guide-close');
  await select('mobile-menu-close'); assert.equal(await page.evaluate(()=>document.activeElement.id),'mobile-menu-open');
  for(const viewport of [{width:320,height:568},{width:844,height:390}]) {
    await page.setViewportSize(viewport); await page.locator('#play').click();
    assert.ok(await page.locator('#registration').evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.screenshot({path:'.screenshots/repair-setup-'+viewport.width+'.png'});
    await page.locator('#register-cancel').click();
    await page.locator('#mobile-menu-open').click(); await page.locator('#mobile-help').click();
    assert.ok(await page.locator('#hand-guide').evaluate(el=>el.scrollWidth<=el.clientWidth),'help fits '+viewport.width);
    const next=await page.locator('#hand-guide-next').boundingBox();
    assert.ok(next.x>=0&&next.x+next.width<=viewport.width&&next.y>=0&&next.y+next.height<=viewport.height,'Next is reachable '+viewport.width);
    await page.screenshot({path:'.screenshots/repair-help-'+viewport.width+'.png'});
    await page.locator('#hand-guide-close').click(); await page.locator('#mobile-menu-close').click();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS real phone landmark acquisition, grip/GO, mirrored steering, palm drop, input-loss delivery, three turns, menu/help/result/replay gestures and focus restoration');
} finally { await browser.close();const closed=new Promise(resolve=>app.server.close(resolve));app.server.closeAllConnections();await closed;app.database.close();await rm(directory,{recursive:true,force:true}); }
