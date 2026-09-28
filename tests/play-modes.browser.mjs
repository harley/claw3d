import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture, assertScoredStart } from './camera-fixture.mjs';
async function assertLocalLabel(page, hands, unsaved = false) {
 assert.equal(await page.locator('#mode-label').textContent(), `LOCAL PREVIEW · ${hands}${unsaved ? ' · UNSAVED' : ''}`);
 const original = page.viewportSize();
 for (const width of [320, 390]) {
  await page.setViewportSize({width, height:844});
  const bounds = await page.locator('#mode-label').evaluate(el => {
   const r = el.getBoundingClientRect();
   return {left:r.left, right:r.right, height:r.height, fits:el.scrollWidth <= el.clientWidth};
  });
  assert.ok(bounds.height > 0 && bounds.left >= 0 && bounds.right <= width && bounds.fits,
   `local mode label fits ${width}px: ${JSON.stringify(bounds)}`);
 }
 await page.setViewportSize(original);
}
const browser=await chromium.launch(browserOptions);
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
 const modelRequests=[]; page.on('request', request=>{if(/\/models\/hands\/.*\.glb/.test(request.url())) modelRequests.push(request.url());});
 page.on('pageerror',e=>errors.push(e.message));await installCameraFixture(page);
 await page.goto('http://127.0.0.1:4196/?setup=manual');
 await page.waitForFunction(()=>document.getElementById('button-text').textContent==='PLAY · 1 HAND');
 await assertLocalLabel(page, '1 HAND');
 assert.equal(await page.locator('#mode-two').isVisible(),true,'both modes are named before camera startup');
 await page.goto('http://127.0.0.1:4196/');
 await page.waitForFunction(()=>document.getElementById('button-text').textContent==='PLAY · 1 HAND');
 assert.equal(await page.locator('#mode-two').textContent(),'2 Hands');
 assert.deepEqual(modelRequests, [], 'one-hand play must not fetch either anatomical model');
 // Contract: the dialog choice, not the previous header mode, controls the
 // immutable run. This covers the reload/name/hand-menu wiring unit tests cannot.
 await page.locator('#play').click(); await page.locator('#registration').waitFor();
 await page.locator('#name').fill('Mode chooser');
 for(const size of [{width:1440,height:900},{width:390,height:844},{width:320,height:700}]) {
  await page.setViewportSize(size);
  for (const id of ['register-play', 'register-other']) {
   await page.locator(`#${id}`).scrollIntoViewIfNeeded();
   const b = await page.locator(`#${id}`).boundingBox();
   assert.ok(b.x >= 0 && b.x+b.width <= size.width, 'start choice fits narrow screens');
  }
  await page.screenshot({path:'.screenshots/play-modes-'+size.width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:900});
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.run),null);
 assert.match(await page.locator('#register-other').textContent(), /2 Hands.*\+25 per catch/);
 // Select the alternate mode with the real menu adapter and synthetic hand data.
 const box = await page.locator('#register-other').boundingBox();
 await page.evaluate(({x,y})=>window.testCamera.setFeedback({kind:'tracking',pointer:{x,y}}), {
  x:.18+(box.x+box.width/2)/1440*.64, y:.15+(box.y+box.height/2)/900*.70,
 });
 await page.waitForFunction(()=>document.getElementById('register-other').classList.contains('hand-hover'));
 await page.evaluate(()=>window.testCamera.setFeedback({kind:'clenching',progress:.8,pointer:window.testCamera.feedback.pointer}));
 await page.waitForFunction(()=>{
  if(Number(document.getElementById('hand-cursor').style.getPropertyValue('--hold'))<=0) return false;
  window.testCamera.tick(); return window.testCamera.clench();
 });
 await page.waitForFunction(()=>window.__littleCloud?.snapshot().event.run?.name==='Mode chooser');
 assert.equal(new URL(page.url()).searchParams.get('controls'),'dual');
 assert.equal(new URL(page.url()).searchParams.has('start'),false,'start marker is consumed once');
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('claw:mode-start')),null,'selection is consumed once');
 await assertScoredStart(page);
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.controlProfile),'dual');
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.run.rules.twoHandBonus),25);
 await page.waitForFunction(()=>document.getElementById('hand-art-status').hidden);
 assert.equal(modelRequests.length,2);
 await assertLocalLabel(page, '2 HANDS');
 assert.equal(await page.locator('#mode-one').isDisabled(),true,'mode cannot change inside an active run');
 const id=await page.evaluate(()=>window.__littleCloud.snapshot().event.run.id);
 await page.reload();await page.waitForFunction(()=>document.getElementById('button-text').textContent==='CONTINUE');
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.run.id),id);
 assert.equal(await page.locator('#mode-one').isDisabled(),true);
 await page.locator('#operator-open').click();await page.locator('#reset').click();
 await page.locator('#play').click();await page.locator('#registration').waitFor();
 await page.locator('#register-other').click();
 await page.waitForFunction(()=>window.__littleCloud?.snapshot().event.run && window.__littleCloud.snapshot().event.controlProfile==='hold-drop');
 assert.equal(new URL(page.url()).searchParams.has('controls'),false);
 await assertScoredStart(page);
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.controlProfile),'hold-drop');
 await assertLocalLabel(page, '1 HAND');
 assert.equal(await page.locator('#control-deck').isVisible(),false);
 await page.locator('#machine-drop').waitFor({state:'visible',timeout:5000});
 assert.equal(await page.locator('#machine-drop').isVisible(),true);
 assert.deepEqual(errors,[]);
 await page.close();
 // A denied storage read must retain both the selected mode and UNSAVED.
 // This is a rendering contract; it needs no additional scored journey.
 const blocked = await browser.newPage({viewport:{width:390,height:844}});
 await blocked.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('Storage unavailable'); }; });
 for (const [query, hands] of [['', '1 HAND'], ['&controls=dual', '2 HANDS']]) {
  await blocked.goto(`http://127.0.0.1:4196/?setup=manual${query}`);
  await blocked.waitForFunction(() => window.__littleCloud);
  await assertLocalLabel(blocked, hands, true);
 }
 await blocked.close();
 // Asset-only lifecycle checks: no scored journey or camera is needed.
 const assets = await browser.newPage();
 const requests=[];
 assets.on('request', request=>{if(/\/models\/hands\/.*\.glb/.test(request.url())) requests.push(request.url());});
 await assets.goto('http://127.0.0.1:4196/?setup=manual&controls=grab');
 await assets.waitForFunction(()=>window.__littleCloud);
 assert.deepEqual(requests, [], 'local grab play does not load anatomical hands');
 let release;
 const delayed = new Promise(resolve=>{release=resolve;});
 await assets.route('**/models/hands/*.glb', async route=>{await delayed; await route.continue();});
 await assets.goto('http://127.0.0.1:4196/?setup=manual&controls=dual');
 await assets.waitForFunction(()=>window.__littleCloud);
 assert.equal(requests.length, 2);
 assert.match(await assets.locator('#hand-art-status').textContent(), /loading.*controls remain available/);
 assert.equal(await assets.evaluate(()=>window.__littleCloud.snapshot().event.run), null);
 await assets.locator('#camera-open').click();
 await assets.screenshot({path:'.screenshots/hand-assets-loading.png'});
 await assets.locator('#camera-setup [aria-label="Close camera setup"]').click();
 release();
 await assets.waitForFunction(()=>document.getElementById('hand-art-status').hidden);
 await assets.unroute('**/models/hands/*.glb');
 await assets.route('**/models/hands/right.glb', route=>route.abort());
 await assets.reload(); await assets.waitForFunction(()=>window.__littleCloud);
 await assets.waitForFunction(()=>document.getElementById('hand-art-status').textContent.includes('Reload to retry'));
 assert.equal(await assets.evaluate(()=>window.__littleCloud.snapshot().event.controlProfile), 'dual');
 assert.equal(await assets.evaluate(()=>window.__littleCloud.snapshot().event.run), null);
 await assets.locator('#camera-open').click();
 await assets.screenshot({path:'.screenshots/hand-assets-unavailable.png'});
 await assets.unroute('**/models/hands/right.glb');
 await assets.reload(); await assets.waitForFunction(()=>window.__littleCloud && document.getElementById('hand-art-status').hidden);
 assert.equal(requests.length, 6, 'each reload makes exactly two requests without in-page retry loops');
 await assets.close();
 console.log('PASS both mode choices, responsive layout, one-shot selection, recovery isolation and cabinet controls');
}finally{await browser.close();}
