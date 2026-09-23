// Synthetic timestamped input. Does not establish physical webcam recognition.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser=await chromium.launch({...browserOptions,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
  await mkdir('.screenshots',{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:960}}), errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.route(/\/src\/grab-and-glide\/camera\.js(?:\?.*)?$/,r=>r.fulfill({contentType:'application/javascript',body:`
    export class GlideCamera {
      constructor(o){this.o=o;this.running=false;this.e={point:{x:.5,y:.5},open:true,closed:false,valid:true};window.syntheticCamera=this;}
      async start(){this.running=true;this.o.onStatus({kind:'tracking',message:'Synthetic camera evidence'});this.timer=setInterval(()=>this.tick(),50);}
      tick(){this.o.onEvidence({...this.e,at:performance.now()});}
      resetOwner(){} stop(){clearInterval(this.timer);this.running=false;}
    }`}));
  const snap=()=>page.evaluate(()=>window.__grabGlide.snapshot());
  const pose=async(kind,x,y)=>{
    await page.evaluate(({kind,x,y})=>{const a=window.__grabGlide, c=window.syntheticCamera;c.e={valid:kind!=='lost',open:kind==='open',closed:kind==='closed',point:{x:.5+(x-a.input.offset.x)/16,y:.5-(y-a.input.offset.y)/10}};},{kind,x,y});
  };
  const waitPhase=phase=>page.waitForFunction(p=>window.__grabGlide.game.phase===p,phase);
  async function move(kind,x,y){await pose(kind,x,y);await page.waitForFunction(({x,y})=>Math.hypot(window.__grabGlide.game.position.x-x,window.__grabGlide.game.position.y-y)<.025,{x,y});}
  async function ready(){await page.waitForFunction(()=>window.syntheticCamera?.running);await pose('open',-1.8,-.2);await page.waitForFunction(()=>window.__grabGlide.input.armed);}
  async function grab(id){const t=await page.evaluate(id=>window.__grabGlide.game.toys.find(t=>t.id===id),id);await move('open',t.x,t.y);await pose('closed',t.x+.8,t.y+.5);await waitPhase('carry');}
  async function release(){const s=await snap();await pose('open',s.position.x+.8,s.position.y+.5);await waitPhase('outcome');}
  await page.goto(`${process.env.GLIDE_ORIGIN||'http://127.0.0.1:4196'}/grab-and-glide.html`);
  await page.waitForFunction(()=>window.__grabGlide);
  await page.screenshot({path:'.screenshots/grab-glide-menu.png'});
  await page.locator('#play').click();await ready();await grab('bear');
  assert.equal((await snap()).results.length,0);
  await page.screenshot({path:'.screenshots/grab-glide-pickup.png'});
  // Safe route; interruption must preserve cargo/time, opening cannot release after loss.
  await move('closed',-1.7,-.8);await pose('lost',0,0);await page.waitForTimeout(180);
  const frozen=await snap();await page.waitForTimeout(400);assert.deepEqual((await snap()).cargo,frozen.cargo);assert.equal((await snap()).remaining,frozen.remaining);
  await pose('open',3,-2);await page.waitForTimeout(450);assert.equal((await snap()).phase,'carry');assert.equal((await snap()).armed,false);
  await page.screenshot({path:'.screenshots/grab-glide-recovery.png'});
  await pose('closed',3,-2);await page.waitForFunction(()=>window.__grabGlide.input.armed);
  assert.deepEqual((await snap()).cargo,frozen.cargo);
  await move('closed',3.85,-.8);await page.screenshot({path:'.screenshots/grab-glide-carry.png'});await release();assert.equal((await snap()).score,100);
  await page.screenshot({path:'.screenshots/grab-glide-bank.png'});
  await waitPhase('position');await ready();await move('open',0,-2);await pose('closed',0,-2);await waitPhase('outcome');assert.equal((await snap()).results[1].kind,'miss');
  await waitPhase('position');await ready();await grab('star');await release();assert.equal((await snap()).results[2].kind,'drop');
  await page.waitForTimeout(100);
  const bear=await page.evaluate(()=>{const p=window.__grabGlide.scene.toys.get('bear').root.position;return {x:p.x,y:p.y};});
  assert.ok(Math.abs(bear.x-3.3)<.02&&Math.abs(bear.y+.9)<.02,'earlier banked toy stays settled during a later outcome');
  await waitPhase('result');
  assert.equal((await snap()).results.length,3);assert.equal((await snap()).score,100);assert.equal(await page.locator('#result').isVisible(),true);
  await page.screenshot({path:'.screenshots/grab-glide-result.png'});
  await page.locator('#replay').click();await ready();assert.equal((await snap()).score,0);assert.equal((await snap()).results.length,0);
  // Clean detour, then contact detour, then timeout. Every outcome goes through normal input except elapsed time.
  await grab('bear');await move('closed',-1.5,1.7);await move('closed',1.5,1.7);assert.equal((await snap()).gate,'clean');
  await page.screenshot({path:'.screenshots/grab-glide-gate.png'});
  await move('closed',3.85,-.8);await release();assert.equal((await snap()).score,150);
  await waitPhase('position');await ready();await grab('bunny');await move('closed',-1.5,2.15);await move('closed',1.5,2.15);assert.equal((await snap()).gate,'failed');assert.equal((await snap()).phase,'carry');
  await move('closed',3.85,-.8);await release();assert.equal((await snap()).score,250);
  await waitPhase('position');await ready();await page.evaluate(()=>window.__grabGlide.game.tick(15));await waitPhase('result');assert.equal((await snap()).results.length,3);
  await page.locator('#sound').click();assert.equal(await page.locator('#sound').textContent(),'Sound off');await page.locator('#replay').click();assert.equal(await page.locator('#sound').textContent(),'Sound off');
  await page.locator('summary').click();await page.locator('#reduce-motion').check();assert.equal(await page.locator('#reduce-motion').isChecked(),true);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.screenshots/grab-glide-mobile.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(writes,[],'no production or other writes');assert.deepEqual(errors,[]);
  await page.close();
  const real=await browser.newPage({viewport:{width:1280,height:900},permissions:['camera']});
  real.on('pageerror',e=>errors.push(e.message));
  await real.goto(`${process.env.GLIDE_ORIGIN||'http://127.0.0.1:4196'}/grab-and-glide.html`);
  await real.locator('#play').click();
  await real.waitForFunction(()=>window.__grabGlide?.camera?.running,null,{timeout:35000});
  assert.equal(await real.evaluate(()=>window.__grabGlide.camera.maxHands),2);
  await real.waitForFunction(()=>document.getElementById('camera-video').videoWidth>0);
  assert.ok(await real.evaluate(()=>{const v=document.getElementById('camera-video'),r=v.parentElement.getBoundingClientRect();return Math.abs(r.width/r.height-v.videoWidth/v.videoHeight)<.01;}),'camera overlay keeps the uncropped capture aspect');
  await real.waitForTimeout(700);
  assert.equal(await real.evaluate(()=>window.__grabGlide.game.remaining),15,'blank synthetic camera must not spend time');
  await real.locator('#camera-restart').click();
  await real.waitForFunction(()=>window.__grabGlide.camera.running,null,{timeout:35000});
  assert.equal(await real.evaluate(()=>window.__grabGlide.game.results.length),0);
  assert.deepEqual(errors,[]);await real.close();
  console.log('PASS real experiment MediaPipe startup/restart with synthetic video, two-hand ambiguity observation, no unowned clock/action.');
  console.log('PASS Grab & Glide browser: safe bank, miss, early drop, clean/contact gate, tracking freeze/rearm, 3 attempts, replay, mute, reduced motion, mobile; zero writes/errors.');
}finally{await browser.close();}
