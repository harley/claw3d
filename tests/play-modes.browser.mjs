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
 page.on('pageerror',e=>errors.push(e.message));await installCameraFixture(page);
 await page.goto('http://127.0.0.1:4196/?setup=manual');
 await page.waitForFunction(()=>document.getElementById('button-text').textContent==='PLAY · 1 HAND');
 await assertLocalLabel(page, '1 HAND');
 assert.equal(await page.locator('#mode-two').isVisible(),true,'both modes are named before camera startup');
 await page.goto('http://127.0.0.1:4196/');
 await page.waitForFunction(()=>document.getElementById('button-text').textContent==='PLAY · 1 HAND');
 assert.equal(await page.locator('#mode-two').textContent(),'2 Hands');
 for(const size of [{width:1440,height:900},{width:390,height:700}]) {
  await page.setViewportSize(size);
  const a=await page.locator('#mode-one').boundingBox(),b=await page.locator('#mode-two').boundingBox();
  assert.ok(a.x>=0&&b.x+b.width<=size.width&&a.x+a.width<=b.x,'both choices fit without overlap');
  await page.screenshot({path:'.screenshots/play-modes-'+size.width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:900});
 await page.locator('#mode-two').click();await page.waitForFunction(()=>document.getElementById('mode-two').getAttribute('aria-pressed')==='true' && !document.getElementById('mode-two').disabled && window.testCamera?.running); await page.locator('#play').click();await page.locator('#registration').waitFor();
 await assertLocalLabel(page, '2 HANDS');
 assert.equal(new URL(page.url()).searchParams.get('controls'),'dual');
 assert.equal(new URL(page.url()).searchParams.has('start'),false,'one-shot start is removed from URL');
 await page.locator('#register-play').click();
 await assertScoredStart(page);
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.controlProfile),'dual');
 await assertLocalLabel(page, '2 HANDS');
 assert.equal(await page.locator('#mode-one').isDisabled(),true,'mode cannot change inside an active run');
 const id=await page.evaluate(()=>window.__littleCloud.snapshot().event.run.id);
 await page.reload();await page.waitForFunction(()=>document.getElementById('button-text').textContent==='CONTINUE');
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.run.id),id);
 assert.equal(await page.locator('#mode-one').isDisabled(),true);
 await page.locator('#operator-open').click();await page.locator('#reset').click();
 await page.locator('#mode-one').click();await page.waitForFunction(()=>document.getElementById('mode-one').getAttribute('aria-pressed')==='true' && !document.getElementById('mode-one').disabled && window.testCamera?.running); await page.locator('#play').click();await page.locator('#registration').waitFor();
 assert.equal(new URL(page.url()).searchParams.has('controls'),false);
 await page.locator('#register-play').click();
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
 console.log('PASS both mode choices, responsive layout, one-shot selection, recovery isolation and cabinet controls');
}finally{await browser.close();}
