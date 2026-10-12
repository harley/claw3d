// Controlled latency traverses real capture scheduling, result freshness,
// adaptive render quality, recognition, turns and menus. Hardware/model are
// replaced; this is not sustained physical-camera performance evidence.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser = await chromium.launch(browserOptions);
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw Error('No physical camera in sustained test'); }; });
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><script>window.__PUBLIC_TRY__=true;</script>') });
  });
  const source = await readFile(new URL('../src/vision.js', import.meta.url), 'utf8');
  await page.route('**/src/vision.js*', route => route.fulfill({ contentType: 'application/javascript', body: source + `
    window.sustained = { pending:0,maxPending:0,started:0,terminated:0,stopped:0,compactFrames:0 };
    const runtime = delegate => {
      sustained.started++; let timer, stopped=false;
      return {local:true,delegate,postMessage(data) {
        sustained.pending++; sustained.maxPending=Math.max(sustained.maxPending,sustained.pending);
        if(data.captureWidth===320) sustained.compactFrames++;
        const age=delegate==='GPU'&&(data.captureWidth!==320||window.forceCompactDelay)?600:20;
        timer=setTimeout(()=>{
          sustained.pending--; if(stopped)return;
          const lm=Array.from({length:21},()=>({x:.5,y:.5,z:0}));
          lm[0].y=.56;lm[9].y=.44;lm[5].x-=.06;lm[17].x+=.06;
          this.onmessage({data:{type:'result',now:data.now,result:{landmarks:[lm],handedness:[[{categoryName:'Left',score:.99}]],gestures:[[{categoryName:'Open_Palm',score:.99}]]}}});
        },age);
      },terminate(){stopped=true;clearTimeout(timer);if(sustained.pending)sustained.pending--;sustained.terminated++;}};
    };
    HandController.prototype.start=async function(){
      this.stop(false);this.generation++;this.running=true;this.starting=false;this.busy=false;
      this.latencyLimited=false;this.lateSamples=0;this.lateSince=undefined;this.workerRecoveryUsed=false;
      this.lastCapture=this.lastResponseCapture=-Infinity;
      this.lastFrame=-1;this.lastResult=this.lastActivity=this.lastFreshReceipt=performance.now();
      const track={getSettings:()=>({width:960,height:540,frameRate:30}),getConstraints:()=>({}),applyConstraints:async()=>{},stop:()=>sustained.stopped++};
      this.stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
      Object.defineProperties(this.video,{readyState:{configurable:true,get:()=>2},currentTime:{configurable:true,get:()=>performance.now()/1000},videoWidth:{configurable:true,get:()=>960},videoHeight:{configurable:true,get:()=>540},srcObject:{configurable:true,writable:true,value:this.stream}});
      this.delegate='GPU';this.worker=runtime('GPU');this.createMainThreadVision=async(_base,delegate)=>runtime(delegate);
      this.bindWorker(this.generation);this.configureCapture();this.onState({kind:'ready'});
      this.timer=setInterval(()=>this.frame(),65);window.sustainedController=this;
    };
  ` }));
  const snap = () => page.evaluate(() => window.__littleCloud.snapshot());
  await page.goto('http://127.0.0.1:4196/?setup=manual&cameraDebug=1');
  await page.locator('#play:not([disabled])').click();
  await page.locator('#register-play').click();
  await page.waitForFunction(()=>window.sustainedController?.latencyLimited,{},{timeout:10000});
  await page.waitForFunction(()=>window.__littleCloud.snapshot().lowQuality===true);
  assert.equal(await page.evaluate(()=>sustainedController.captureWidth),320);
  await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='aim',{},{timeout:15000});
  const startedAt=Date.now();
  // A second sustained slowdown during play must retain the run/stream and
  // move to CPU once; it cannot accept a600ms-old hand or spend aiming time.
  await page.evaluate(()=>{window.forceCompactDelay=true;window.sameStream=sustainedController.stream;});
  await page.waitForFunction(()=>sustainedController.delegate==='CPU'&&!sustainedController.recovering,{},{timeout:10000});
  assert.equal(await page.evaluate(()=>sameStream===sustainedController.stream),true);
  assert.equal(await page.evaluate(()=>sustained.stopped),0);
  await page.locator('#mobile-menu-open').click(); await page.locator('#mobile-camera').click();
  await page.waitForFunction(()=>document.getElementById('camera-debug').textContent.includes('main-thread · CPU · timer'));
  assert.match(await page.locator('#camera-debug').textContent(),/320 px/);
  await page.screenshot({path:'.screenshots/tracking-compact-debug-390.png'});
  await page.locator('[aria-label="Close camera setup"]').click();
  await page.waitForFunction(()=>document.getElementById('final').open,{},{timeout:90000});
  const finished=await snap();
  assert.equal(finished.event.complete.turns.length,3);
  assert.equal(await page.evaluate(()=>sustained.maxPending),1,'one inference only; no accumulating queue');
  assert.equal(await page.evaluate(()=>sustained.started),2,'exactly one replacement');
  assert.equal(await page.evaluate(()=>sustainedController.latencyLimited),true);
  assert.equal(finished.lowQuality,true,'the sustained compact session cannot auto-promote');
  assert.ok(await page.evaluate(()=>sustained.compactFrames)>400,'sustained capture beyond startup');
  await page.locator('#final-more').click(); await page.locator('#mobile-help').click();
  await page.locator('#hand-guide-close').click();
  await page.locator('#mobile-menu[open]').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'mobile-help');
  await page.locator('#mobile-menu-close').click();
  await page.locator('#play-again').click(); await page.locator('#register-play').click();
  await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='aim',{},{timeout:15000});
  assert.equal(await page.evaluate(()=>sustained.started),2,'replay reuses the healthy camera');
  assert.equal(await page.evaluate(()=>sustained.maxPending),1);
  await page.screenshot({path:'.screenshots/tracking-sustained-replay-390.png'});
  console.log('PASS sustained real capture/quality/turn integration',await page.evaluate(()=>({...sustained,delegate:sustainedController.delegate,captureWidth:sustainedController.captureWidth})),{elapsedMs:Date.now()-startedAt});
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
