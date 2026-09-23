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
    const response=await route.fetch();await route.fulfill({response,body:(await response.text())+'\nwindow.testHands=()=>({error:scene.cabinetHands.error,visible:scene.cabinetHands.root.visible,hands:Object.fromEntries(Object.entries(scene.cabinetHands.hands).map(([role,h])=>[role,{visible:h.pivot.visible,curl:h.curl,position:h.pivot.position.toArray(),skinned:h.pivot.getObjectByProperty("type","SkinnedMesh")?.skeleton.bones.length,shadows:h.pivot.getObjectByProperty("type","SkinnedMesh")?.castShadow}]))});window.testDropShape=()=>({type:scene.button.geometry.type,thetaLength:scene.button.geometry.parameters.thetaLength,scale:scene.button.scale.toArray(),y:scene.button.position.y});window.testAim=(x,z,orbit)=>{game.position={x,z};if(orbit!==undefined)moveCarousel(game,orbit-game.carouselTime);};'});
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
  const dome=await page.evaluate(()=>testDropShape());
  assert.equal(dome.type,'SphereGeometry');assert.equal(dome.thetaLength,Math.PI/2);
  assert.deepEqual(dome.scale,[.21,.135,.21]);
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
    await burst([]);await burst([left,right]);left.kind='closed';assert.equal((await burst([left,right],5)).left.stage,'gripped');
  };
  await acquire();await frame();
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-left'),'active');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'active');
  // The ready highlight follows live input freshness (700 ms); re-feed right before reading it on slow runners.
  await burst([left,right],1);await frame();
  assert.equal(await page.locator('#machine-drop').getAttribute('data-ready'),'true');
  // A single missing detection holds the grip, but supplies no movement/drop permission.
  await burst([right],1);
  assert.equal(await page.evaluate(()=>controller.dualFeedback.dropEnabled),false);
  assert.deepEqual(await page.evaluate(()=>controller.input),{x:0,z:0});
  await burst([left,right],1);await frame();
  assert.equal(await page.evaluate(()=>controller.dualFeedback.dropEnabled),true);
  assert.equal(await page.evaluate(()=>window.__littleCloud.snapshot().phase),'aim','recovery cannot bank a right raise');
  await page.screenshot({path:'.screenshots/dual-grip-recovered.png'});
  await burst([left]);await frame();
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-left'),'active');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'open');
  assert.equal(await page.locator('#machine-drop').getAttribute('data-ready'),'false','missing right hand clears button highlight');
  assert.equal(await page.locator('#control-deck').isVisible(),false);
  // Entering closed cannot arm, and independent loss must not stop steering.
  await burst([left]);right.kind='closed';
  const moved={...left,x:left.x-.045};
  assert.ok((await burst([moved,right])).x<0);
  assert.equal((await page.evaluate(()=>window.__littleCloud.snapshot())).phase,'aim');
  await burst([left]);assert.equal((await burst([left,right])).right.stage,'seeking');
  await acquire();await frame();
  await page.waitForFunction(()=>Object.keys(testHands().hands).length===2);
  const rendered=await page.evaluate(()=>testHands());
  assert.equal(rendered.error,null);assert.equal(rendered.visible,true);
  for(const hand of Object.values(rendered.hands)) {
    assert.equal(hand.visible,true);assert.ok(hand.skinned>=25);assert.equal(hand.shadows,true);
  }
  assert.equal(await page.locator('#joystick-cursor').isVisible(),false,'dual hands belong to the 3D scene');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await page.locator('#machine-drop').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
  await page.screenshot({path:'.screenshots/dual-controls.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const size of [{width:820,height:900},{width:390,height:844},{width:390,height:700},{width:1440,height:900}]){
    // Screenshots and layout reads on slow runners outlast the 700 ms input freshness window; re-feed the hands first.
    await page.setViewportSize(size);await burst([left,right]);await frame();
    const controls=await page.evaluate(()=>window.__littleCloud.snapshot().machineControls);
    assert.ok(controls.drop.x-controls.stick.x>(controls.bounds.right-controls.bounds.left)*.40,'actual controls sit well apart');
    const hands=await page.evaluate(()=>testHands().hands);
    assert.ok(hands.left.position[0]<0 && hands.right.position[0]>0,'3D hands stay on their physical control sides');
    assert.equal(hands.left.visible,true);assert.equal(hands.right.visible,true);
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
  const dock=await page.evaluate(()=>testHands().hands.right.position);
  await burst([left,{...right,x:right.x+.10,y:right.y+.03}],1);await frame();
  const driftDock=await page.evaluate(()=>testHands().hands.right.position);
  assert.deepEqual(dock,driftDock,'physical right-hand drift cannot move docked 3D hand');
  // Cross the physical centre: the affected hand must release, never clamp into a press.
  await burst([left,{...right,x:.60}],1);
  await burst([left,{...right,x:.49,kind:'closed'}],1);await frame();
  assert.equal((await page.evaluate(()=>window.__littleCloud.snapshot())).phase,'aim');
  assert.equal(await page.locator('#status').textContent(),'RETURN RIGHT HAND TO ITS AREA');
  assert.equal(await page.locator('#camera-overlay').getAttribute('data-right'),'return');
  assert.equal(await page.locator('#action-copy').evaluate(el=>getComputedStyle(el).opacity),'0');
  assert.equal((await burst([left,{...right,kind:'closed'}])).right.stage,'seeking');
  await acquire();
  // Stale capture invalidates both roles, even if it contains a fist over DROP.
  await burst([left,{...right,kind:'closed'}],1,350);
  await frame();
  assert.equal(await page.locator('#machine-drop').evaluate(el=>el.style.getPropertyValue('--hold')),'0','no right-hand charge indicator');
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
  assert.equal((await page.evaluate(()=>testHands().hands.left)).curl,1,'3D grip survives steering overshoot');
  // Uncertain evidence cannot fire. A fist and physical stroke cannot fire.
  assert.equal((await burst([left,{...right,kind:'uncertain'}],1)).right.progress,0);
  assert.equal((await burst([left,{...right,kind:'closed'}],10)).right.stage,'seeking');
  await page.evaluate(()=>testAim(.80,.22,4.55));
  await burst([left,right],25);await frame();
  assert.equal(await page.locator('#machine-drop').evaluate(el=>el.style.getPropertyValue('--hold')),'0');
  assert.equal(await page.locator('#machine-drop').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
  assert.equal((await page.evaluate(()=>testHands().hands.left)).visible,true);
  const before=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.equal(before.phase,'aim');assert.equal(before.event.pendingSlam,null);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>testAim(.80,.22,4.55-.36));
  await burst([left,{...right,y:right.y-.10}],1);
  const locked=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.ok(locked.event.pendingSlam,'one upward sample starts the virtual slam without holding before mechanics accepts DROP');
  await burst([]);await frame();
  assert.equal((await page.evaluate(()=>testHands().hands.right)).visible,true,'committed 3D strike survives tracking loss');
  assert.equal(await page.locator('#machine-drop').evaluate(el=>el.style.getPropertyValue('--hold')),'0');
  const during=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.deepEqual(during.position,locked.position);assert.equal(during.event.remaining,locked.event.remaining);
  await page.screenshot({path:'.screenshots/dual-slam-windup.png'});
  await page.waitForFunction(()=>{if(window.__littleCloud.snapshot().phase!=='anticipate')return false;window.contactShape=testDropShape();return true;});
  assert.ok(Math.abs((await page.evaluate(()=>contactShape.y))-(dome.y-.05))<.001,'dome depresses at virtual hand contact');
  const contactHand=await page.evaluate(()=>testHands().hands.right);
  assert.equal(contactHand.visible,true);
  assert.ok(Math.abs(contactHand.position[0]-1.28)<.001,'palm arrives at actual button x');
  assert.ok(Math.abs(contactHand.position[1]-(dome.y-.05+.231))<.001,'palm follows depressed cap at contact');
  await page.screenshot({path:'.screenshots/dual-slam-contact.png'});
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
    await page.waitForFunction(()=>document.getElementById('jackpot-signal').hidden);
    if(turn===2){
      // A newly raised hand commits at its existing acquisition boundary.
      await page.evaluate(hands=>{for(let i=0;i<6;i++)sample(hands);document.getElementById('pause').click();},[left,right]);
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
  await burst([left,{...right,y:right.y-.10}],60);
  const menuState=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.equal(menuState.event.pendingSlam,null,'menu blocks right-hand actions');
  assert.equal(menuState.phase,'aim');assert.equal(menuState.event.run.turns.length,0);
  await page.evaluate(()=>document.getElementById('operator').close());await frame();await acquire();
  await page.evaluate(hands=>{sample(hands);document.getElementById('reset').click();},[left,{...right,y:right.y-.10}]);
  await frame();
  const reset=await page.evaluate(()=>window.__littleCloud.snapshot());
  assert.equal(reset.event.pendingSlam,null);assert.equal(reset.event.run,null);assert.equal(reset.phase,'idle');
  assert.deepEqual(errors,[]);
  console.log('PASS sticky grip, instant right raise, virtual contact, locked aim and score time, dual roles, closed entry, independent loss, stale captures, forearm, hold/slam/click, persistent toys and three turns');
}finally{await browser.close();}
