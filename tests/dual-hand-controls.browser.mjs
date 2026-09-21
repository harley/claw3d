import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: {width:1440,height:900}, reducedMotion:'reduce' });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const source=await readFile(new URL('../src/vision.js',import.meta.url),'utf8');
  await page.route('**/src/vision.js*',route=>route.fulfill({contentType:'application/javascript',body:source+`
    HandController.prototype.start=async function(){
      this.running=true;this.starting=false;this.generation++;window.controller=this;
      this.lastCapture=-Infinity;this.lastResponseCapture=-Infinity;this.onState({kind:'ready'});
    };
    window.sample=(hands,age=20)=>{
      window.capture=(window.capture||performance.now())+65;
      const result={landmarks:[],handedness:[],gestures:[]};
      for(const {role,kind='open',x,y} of hands){
        const points=Array.from({length:21},()=>({x:1-x,y,z:0}));
        points[0].y+=.06;points[9].y-=.06;points[5].x-=.06;points[17].x+=.06;
        result.landmarks.push(points);result.handedness.push([{categoryName:role==='left'?'Left':'Right',score:.99}]);
        result.gestures.push([{categoryName:kind==='open'?'Open_Palm':kind==='closed'?'Closed_Fist':'None',score:.99}]);
      }
      controller.acceptResult(result,capture,controller.generation,capture+age);
      return {...controller.input,left:controller.dual.left.gesture.read(),right:controller.dual.right.gesture.read()};
    };` }));
  await page.route('**/src/arcade.js*',async route=>{
    const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.testAim=(x,z,orbit)=>{game.position={x,z};if(orbit!==undefined)moveCarousel(game,orbit-game.carouselTime);};'});
  });
  await page.goto('http://127.0.0.1:4196/?setup=manual&controls=dual');
  await page.waitForFunction(()=>window.__littleCloud);
  await page.locator('#play').click();await page.waitForFunction(()=>window.controller);
  assert.equal(await page.evaluate(()=>controller.getControlProfile()),'hold-drop');
  await page.locator('#play').click();await page.locator('#name').fill('Synthetic dual check');await page.locator('#name').press('Enter');
  const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const aim=async()=>{await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='aim',{},{timeout:10000});await frame();};
  await aim();
  assert.equal(await page.evaluate(()=>controller.getControlProfile()),'dual');
  const targets=async()=>({stick:{x:.25,y:.48},drop:{x:.75,y:.48}});
  const burst=(hands,n=10,age=20)=>page.evaluate(({hands,n,age})=>{let s;for(let i=0;i<n;i++)s=sample(hands,age);return s;},{hands,n,age});
  let t=await targets(),left={role:'left',...t.stick},right={role:'right',...t.drop};
  await burst([]);await frame();
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-left'),'open');
  assert.equal(await page.locator('#action-copy').evaluate(el=>getComputedStyle(el).opacity),'0','webcam guides replace central hand instructions');
  const alpha=await page.evaluate(()=>{
    const c=document.getElementById('camera-overlay'),ctx=c.getContext('2d');
    const at=(x,y)=>ctx.getImageData(Math.round(x*c.width),Math.round(y*c.height),1,1).data[3];
    return {outside:at(.02,.5),gap:at(.5,.5),inside:at(.1,.4)};
  });
  assert.ok(alpha.outside>180&&alpha.gap>180&&alpha.inside<30,'outside and centre gap dim while hand windows stay clear');
  await page.screenshot({path:'.screenshots/dual-camera-waiting.png'});
  const acquire=async()=>{
    t=await targets();left={role:'left',...t.stick};right={role:'right',...t.drop};
    await burst([left]);left.kind='closed';assert.equal((await burst([left],5)).left.stage,'gripped');
    await burst([left,right]);
  };
  await acquire();await frame();
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-left'),'active');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'active');
  assert.equal(await page.locator('#machine-drop').getAttribute('data-ready'),'true');
  await burst([left]);await frame();
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-left'),'active');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'open');
  assert.equal(await page.locator('#machine-drop').getAttribute('data-ready'),'false','missing right hand clears button highlight');
  await burst([left,right]);
  assert.equal(await page.locator('#control-deck').isVisible(),false);
  // Entering closed cannot arm, and independent loss must not stop steering.
  await burst([left]);right.kind='closed';
  const moved={...left,x:left.x-.045};
  assert.ok((await burst([moved,right])).x<0);
  assert.equal((await page.evaluate(()=>window.__littleCloud.snapshot())).phase,'aim');
  await burst([left]);assert.equal((await burst([left,right])).right.stage,'seeking');
  right.kind='open';await burst([left,right]);await frame();
  for(const selector of ['#joystick-cursor','#right-hand-cursor'])assert.equal(await page.locator(selector).isVisible(),true);
  assert.ok((await page.locator('#right-hand-cursor').boundingBox()).width<=66);
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await page.locator('#machine-drop').evaluate(el=>getComputedStyle(el,'::before').animationName),'right-hold-spin');
  await page.screenshot({path:'.screenshots/dual-controls.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const size of [{width:820,height:900},{width:390,height:844},{width:390,height:700},{width:1440,height:900}]){
    await page.setViewportSize(size);await frame();
    const controls=await page.evaluate(()=>window.__littleCloud.snapshot().machineControls);
    assert.ok(controls.drop.x-controls.stick.x>(controls.bounds.right-controls.bounds.left)*.40,'actual controls sit well apart');
    for(const [selector,control] of [['#joystick-cursor',controls.stick],['#right-hand-cursor',controls.drop]]){
      const glove=await page.locator(selector).boundingBox();
      assert.ok(Math.abs(glove.x+glove.width/2-control.x)<3,'comfortable hand position maps to its own control after resize');
    }
    const box=await page.locator('#machine-drop').boundingBox();
    assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=size.width&&box.y+box.height<=size.height);
    if(size.width===390){
      const camera=await page.locator('#camera-preview').boundingBox();
      assert.ok(camera.y>=controls.bounds.bottom,'camera preview sits below the play area');
      assert.ok(camera.width>=210,'two hand windows stay readable on phones');
      assert.ok(camera.y+camera.height<Math.max(740,size.height)-40,'camera fits above the footer');
    }
    if(size.width===390&&size.height===844)await page.screenshot({path:'.screenshots/dual-mobile.png'});
  }
  await burst([left]);
  await burst([left,right]);
  // Cross the physical centre: the affected hand must release, never clamp into a press.
  await burst([left,{...right,x:.60}],1);
  await burst([left,{...right,x:.49,kind:'closed'}],1);await frame();
  assert.equal((await page.evaluate(()=>window.__littleCloud.snapshot())).phase,'aim');
  assert.equal(await page.locator('#status').textContent(),'RETURN RIGHT HAND TO ITS AREA');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'return');
  assert.equal(await page.locator('#action-copy').evaluate(el=>getComputedStyle(el).opacity),'0');
  assert.equal((await burst([left,{...right,kind:'closed'}])).right.stage,'seeking');
  await burst([left,right]);
  // Stale capture invalidates both roles, even if it contains a fist over DROP.
  await burst([left,{...right,kind:'closed'}],1,350);
  await frame();
  assert.equal(await page.locator('#machine-drop').getAttribute('data-charging'),'false','stale input clears spinner');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-left'),'inactive');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'inactive');
  assert.equal((await burst([left,{...right,kind:'closed'}])).right.stage,'seeking');
  await acquire();
  // Overshooting the stick's soft range must not detach the glove or disarm DROP.
  for(const y of [.62,.76,.90]){
    left={...left,y};
    const held=await burst([left,right],2);
    assert.equal(held.left.stage,'gripped');assert.equal(held.right.armed,true);assert.ok(held.z>0&&held.z<=1);
  }
  await frame();
  const stick=await page.evaluate(()=>window.__littleCloud.snapshot().machineControls.stick);
  const glove=await page.locator('#joystick-cursor').boundingBox();
  assert.ok(Math.abs(glove.x+glove.width/2-stick.x)<3,'gripped glove stays docked during overshoot');
  // Uncertain evidence resets the hold. A fist and physical stroke cannot fire.
  assert.equal((await burst([left,{...right,kind:'uncertain'}],1)).right.progress,0);
  assert.equal((await burst([left,{...right,kind:'closed'}],10)).right.stage,'seeking');
  await page.evaluate(()=>testAim(.80,.22,4.55));
  await burst([left,right],25);await frame();
  assert.equal(await page.locator('#machine-drop').getAttribute('data-charging'),'true');
  assert.equal(await page.locator('#machine-drop').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
  assert.equal(await page.locator('#joystick-cursor .glove-forearm').evaluate(el=>getComputedStyle(el).display),'block');
  const before=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.equal(before.phase,'aim');assert.equal(before.event.pendingSlam,null);
  await page.evaluate(()=>testAim(.80,.22,4.55-.36));
  await burst([left,right],24);
  const locked=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.ok(locked.event.pendingSlam,'completed hold starts the virtual slam before mechanics accepts DROP');
  await burst([]);await frame();
  assert.equal(await page.locator('#right-hand-cursor').getAttribute('data-stage'),'slamming');
  assert.equal(await page.locator('#machine-drop').getAttribute('data-charging'),'false','accepted slam stops charging feedback');
  const during=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.deepEqual(during.position,locked.position);assert.equal(during.event.remaining,locked.event.remaining);
  await burst([]);
  await page.waitForFunction(()=>window.__littleCloud.snapshot().phase==='result',{},{timeout:30000});
  assert.equal((await page.evaluate(()=>window.__littleCloud.snapshot())).event.run.turns[0].prizeId,'sprout');
  for(let turn=2;turn<=3;turn++){
    await aim();assert.ok((await page.evaluate(()=>window.__littleCloud.snapshot())).toys.find(t=>t.id==='sprout').claimed);
    await acquire();await page.evaluate(()=>testAim(.80,.22));
    await burst([left]);await frame();
    assert.equal(await page.locator('#status').textContent(),'RAISE RIGHT HAND OPEN');
    assert.equal(await page.locator('#action-copy').evaluate(el=>el.classList.contains('quiet')),true);
    assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'open');
    await burst([left,right]);
    await page.waitForFunction(()=>document.getElementById('jackpot-signal').hidden);
    if(turn===2){
      await burst([left,{...right,y:right.y-.10}],1);
      assert.notEqual((await burst([left,right],1)).right.stage,'fired');
      await page.evaluate(hands=>{for(let i=0;i<50;i++)sample(hands);document.getElementById('pause').click();},[left,right]);
      await frame();
      const pausedSlam=await page.evaluate(()=>window.__littleCloud.snapshot());
      assert.ok(pausedSlam.event.pendingSlam);assert.equal(pausedSlam.event.paused,true);
      await page.waitForTimeout(420);
      assert.deepEqual((await page.evaluate(()=>window.__littleCloud.snapshot())).event.pendingSlam,pausedSlam.event.pendingSlam,'host pause suspends committed slam');
      await page.evaluate(()=>document.getElementById('pause').click());
    }else{
      await burst([]);await page.locator('#machine-drop').click();
    }
    await burst([]);
    await page.waitForFunction(turn=>{const e=window.__littleCloud.snapshot().event;return turn===3?Boolean(e.complete):e.run?.turns.length===turn;},turn,{timeout:30000});
  }
  const complete=await page.evaluate(()=>window.__littleCloud.snapshot().event.complete);
  assert.equal(complete.turns.length,3);assert.equal(complete.turns.filter(t=>t.prizeId==='sprout').length,1);
  await page.locator('#next-player').click();await page.locator('#register-play').click();await aim();
  assert.ok((await page.evaluate(()=>window.__littleCloud.snapshot().toys)).every(t=>!t.claimed));
  await acquire();await burst([left,right],15);
  await page.evaluate(()=>document.getElementById('operator-open').click());await burst([left,right],1);
  assert.equal((await burst([left,right],60)).right.progress,0,'menu cancels unfinished charge');
  await page.evaluate(()=>document.getElementById('operator').close());await acquire();
  await page.evaluate(hands=>{for(let i=0;i<50;i++)sample(hands);document.getElementById('reset').click();},[left,right]);
  await frame();
  const reset=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.equal(reset.event.pendingSlam,null);assert.equal(reset.event.run,null);assert.equal(reset.phase,'idle');
  assert.deepEqual(errors,[]);
  console.log('PASS sticky grip, three-second open hold, virtual contact, locked aim and score time, dual roles, closed entry, independent loss, stale captures, forearm, hold/slam/click, persistent toys and three turns');
}finally{await browser.close();}
