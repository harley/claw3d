import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture } from './camera-fixture.mjs';
const browser=await chromium.launch(browserOptions);
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));await installCameraFixture(page);
 await page.goto('http://127.0.0.1:4196/?setup=manual');
 await page.waitForFunction(()=>document.getElementById('button-text').textContent==='PLAY · 1 HAND');
 assert.equal(await page.locator('#play-alternate').isVisible(),true,'both modes are named before camera startup');
 await page.goto('http://127.0.0.1:4196/');
 await page.waitForFunction(()=>document.getElementById('button-text').textContent==='PLAY · 1 HAND');
 assert.equal(await page.locator('#play-alternate').textContent(),'PLAY · 2 HANDS');
 for(const size of [{width:1440,height:900},{width:390,height:700}]) {
  await page.setViewportSize(size);
  const a=await page.locator('#play').boundingBox(),b=await page.locator('#play-alternate').boundingBox();
  assert.ok(a.x>=0&&b.x+b.width<=size.width&&a.x+a.width<b.x,'both choices fit without overlap');
  await page.screenshot({path:'.screenshots/play-modes-'+size.width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:900});
 await page.locator('#play-alternate').click();await page.locator('#registration').waitFor();
 assert.equal(new URL(page.url()).searchParams.get('controls'),'dual');
 assert.equal(new URL(page.url()).searchParams.has('start'),false,'one-shot start is removed from URL');
 await page.locator('#register-play').click();
 await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='aim');
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.controlProfile),'dual');
 assert.equal(await page.locator('#play-alternate').isVisible(),false,'mode cannot change inside an active run');
 const id=await page.evaluate(()=>window.__littleCloud.snapshot().event.run.id);
 await page.reload();await page.waitForFunction(()=>document.getElementById('button-text').textContent==='CONTINUE');
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.run.id),id);
 assert.equal(await page.locator('#play-alternate').isVisible(),false);
 await page.locator('#operator-open').click();await page.locator('#reset').click();
 await page.locator('#play-alternate').click();await page.locator('#registration').waitFor();
 assert.equal(new URL(page.url()).searchParams.has('controls'),false);
 await page.locator('#register-play').click();
 await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='aim');
 assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().event.controlProfile),'hold-drop');
 assert.equal(await page.locator('#control-deck').isVisible(),false);
 assert.equal(await page.locator('#machine-drop').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('PASS both mode choices, responsive layout, one-shot selection, recovery isolation and cabinet controls');
}finally{await browser.close();}
