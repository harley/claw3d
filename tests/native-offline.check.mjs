// Packaged-asset simulation, no physical camera or Android lifecycle claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';

const root=resolve(import.meta.dirname,'..');
await mkdir(join(root,'.screenshots'),{recursive:true});
const extracted=await mkdtemp(join(tmpdir(),'claw-apk-assets-'));
execFileSync('unzip',['-q',join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),'assets/*','-d',extracted]);
const assets=join(extracted,'assets');
const manifest=JSON.parse(await readFile(join(assets,'asset-manifest.json'),'utf8'));
assert.equal(manifest.commit,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
assert.ok(manifest.files['gesture_recognizer.task']);
assert.ok(manifest.files['web/index.html']);
for(const [name,expected] of Object.entries(manifest.files)){
 assert.equal(createHash('sha256').update(await readFile(join(assets,name))).digest('hex'),expected,name);
}
const profile=await mkdtemp(join(tmpdir(),'tomko-offline-test-'));
const origin='https://appassets.androidplatform.net';
const failures=[], external=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.glb':'model/gltf-binary'};
async function launch() {
 const context=await chromium.launchPersistentContext(profile,{...browserOptions,viewport:{width:1280,height:720},serviceWorkers:'block'});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==origin){external.push(url.href);return route.abort();}
  const source=url.pathname.startsWith('/__testsrc/');
  const base=source?join(root,'src'):join(assets,'web');
  const path=resolve(base,decodeURIComponent(source?url.pathname.slice(11):url.pathname==='/'?'index.html':['/privacy','/privacy.html'].includes(url.pathname)?'privacy-android.html':url.pathname.slice(1)));
  if(!path.startsWith(base+'/'))return route.abort();
  try{return await route.fulfill({body:await readFile(path),contentType:mime[extname(path)]||'application/octet-stream'});}
  catch(error){failures.push(url.pathname);return route.abort();}
 });
 await context.setOffline(true);
 await context.addInitScript(()=>{
  globalThis.__nativeMessages=[];globalThis.__pose=null;
  let generation=null,timer,id=0;
  globalThis.TomkoNative={postMessage(value){
   const message=JSON.parse(value);globalThis.__nativeMessages.push(message);
   if(message.type==='stop' && message.generation===generation){clearInterval(timer);generation=null;}
   if(message.type==='start'){
    clearInterval(timer);generation=message.generation;
    setTimeout(()=>{
     if(generation!==message.generation)return;
     TomkoNative.onmessage({data:JSON.stringify({type:'clock',generation,jsTime:message.jsTime,nativeTime:message.jsTime})});
     TomkoNative.onmessage({data:JSON.stringify({type:'ready',generation})});
     // A real camera keeps reporting empty frames when hands leave view. Keep
     // that liveness after every start/reload, without fabricating control input.
     timer=setInterval(()=>{
      const points=Array.from({length:21},()=>({x:.5,y:.5,z:0}));
      points[0].y=.56;points[9].y=.44;points[5].x=.44;points[17].x=.56;
      const present=__pose!==null;
      TomkoNative.onmessage({data:JSON.stringify({type:'result',generation,id:++id,capturedAt:performance.now(),width:640,height:480,
       result:{landmarks:present?[points]:[],handedness:present?[[{categoryName:'Left',score:.99}]]:[],gestures:present?[[{categoryName:__pose,score:.99}]]:[]}})});
     },65);
    },150);
   }
  }};
 });
 return context;
}
let context=await launch();
try {
 let page=context.pages()[0]||await context.newPage();
 await page.goto(origin+'/?setup=manual&hands=manual&geometry=indexed');
 await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
 assert.doesNotMatch(await page.locator('#mode-label').textContent(), /LOCAL PREVIEW/);
 await page.screenshot({path:join(root,'.screenshots','android-packaged-toy-refresh.png')});
 assert.match(await page.locator('#operator-help').textContent(), /Scores saved on this device/);
 await page.locator('#how-to-play').click();
 await page.locator('#hand-guide-next').click();
 await page.locator('#hand-guide-next').click();
 await page.locator('#hand-guide-next').click();
 await page.locator('#hand-guide').waitFor({state:'hidden'});
 const seeded=await page.evaluate(async()=>{
  const e=await import('/__testsrc/event-session.js');
  const output=[];
  for(const mode of ['one-hand','two-hand']){
   const key=e.STORAGE_KEY+(mode==='two-hand'?':dual-controls':'');
   const store=e.newStore();e.startRun(store,'Offline '+mode,false,mode);
   for(let turn=1;turn<=3;turn++){
    e.recordTurn(store,turn,'butter',0);
    if(e.recordTurn(store,turn,'butter',0)!==null)throw Error('Duplicate turn accepted');
   }
   if(e.recordTurn(store,4,'butter',0)!==null)throw Error('Fourth turn accepted');
   if(mode==='one-hand'){
    e.startRun(store,'Previous touch play',false,'one-hand',e.TOMKO_RULES);
    for(let turn=1;turn<=3;turn++) e.recordTurn(store,turn,null,0,undefined,true);
   }
   localStorage.setItem(key,JSON.stringify(store));
   output.push({mode,total:e.currentBoard(store).runs[0].total});
  }
  return output;
 });
 assert.deepEqual(seeded,[{mode:'one-hand',total:300},{mode:'two-hand',total:375}]);
 await context.close();
 context=await launch();page=context.pages()[0]||await context.newPage();
 for(const mode of ['one-hand','two-hand']){
  await page.goto(origin+'/?setup=manual&hands=manual&geometry=indexed'+(mode==='two-hand'?'&controls=dual':''));
  await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
  const board=await page.locator('#leaders').innerText();
  assert.ok(board.includes('Offline one-hand'),board);
  assert.equal(new URL(page.url()).searchParams.has('controls'),false);
  assert.equal(await page.locator('#register-other').isVisible(),false);
  assert.equal(await page.locator('.hand-toggle').isVisible(),false);
  const keptTwoHand=await page.evaluate(()=>localStorage.getItem('coderpush:event:v1:dual-controls'));
  assert.ok(keptTwoHand.includes('Offline two-hand'));
  assert.ok(keptTwoHand.includes('375'));
  assert.ok(board.includes('300'),board);
  assert.ok(!board.includes('Offline two-hand'));
  assert.equal(await page.evaluate(()=>navigator.onLine),false);
  assert.ok((await page.locator('#build-info').textContent()).includes(manifest.commit.slice(0,7)), 'packaged operator BUILD matches manifest');
  if(mode==='two-hand'){
   await page.locator('#camera-open').click();
   await page.locator('#camera-toggle').click();
   await page.waitForFunction(()=>!document.querySelector('#camera-setup').open && document.querySelector('#camera-toggle').textContent==='STOP CAMERA');
  }
  await page.locator('#operator-open').click();
  assert.match(await page.locator('#operator-stats').textContent(), /50% catch rate/, 'sympathy points do not count as caught toys');
  await page.locator('#export').click();
  const exported=await page.evaluate(()=>globalThis.__nativeMessages.find(message=>message.type==='export'));
  assert.ok(exported,'packaged Export button reaches the native bridge with camera off or running');
  assert.ok(exported.filename.includes('one-hand'));
  const store=JSON.parse(exported.data);
  assert.ok(JSON.stringify(store).includes('Offline one-hand'));
  assert.ok(!JSON.stringify(store).includes('Offline two-hand'));
  assert.equal(await page.locator('#score').textContent(),'0','native score has no zero padding');
  await page.evaluate(id=>TomkoNative.onmessage({data:JSON.stringify({type:'export-result',id,status:'saved'})}),exported.id);
  await page.waitForFunction(()=>document.querySelector('#operator-message').textContent.includes('scores saved'));
  assert.equal(await page.locator('#export').isDisabled(),false);
  await page.screenshot({path:join(root,'.screenshots',`android-packaged-${mode}.png`)});
 }
 // Contract: the packaged game's real caller grants preview changes only between
 // runs, including explicit camera restarts during accepted-drop delivery/recovery.
 // Unit/JVM tests cannot catch a missing or permanently-true caller callback.
 await page.goto(origin+'/?setup=manual&hands=manual&geometry=indexed');
 await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
 const startCamera=async(restart=false)=>{
  await page.locator('#camera-open').click();
  if(restart)await page.locator('#camera-toggle').click();
  await page.locator('#camera-toggle').click();
  await page.waitForFunction(()=>!document.querySelector('#camera-setup').open && document.querySelector('#camera-toggle').textContent==='STOP CAMERA');
  return page.evaluate(()=>__nativeMessages.filter(m=>m.type==='start').at(-1));
 };
 assert.equal((await startCamera()).applyPreview,true,'between-run start can apply a pending preview');
 assert.equal(await page.evaluate(()=>__nativeMessages.filter(m=>m.type==='start').at(-1).hands),1);
 // Synthetic poses pass through the packaged native adapter, not a stub controller.
 await page.evaluate(()=>globalThis.__pose='Open_Palm');
 await page.locator('#play').click();await page.locator('#name').fill('Preview timing');await page.locator('#register-play').click();
 await page.waitForFunction(()=>tomkoStatus().phase==='aim',{},{timeout:15000});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('coderpush:event:v1')).active.rules.touchPoints),10);
 assert.equal((await startCamera(true)).applyPreview,false,'active aiming cannot apply a preview change');
 await page.waitForFunction(()=>tomkoStatus().camera==='tracking');
 // Contract: the new non-modal restart freezes aiming until fresh control returns;
 // existing setup restart coverage does not exercise this corner control or its UI.
 await page.locator('[data-health-toggle]').click();
 assert.equal(await page.locator('#tracking-health-panel').isVisible(),true);
 assert.equal(await page.locator('dialog[open]').count(),0,'details do not pause gameplay');
 await page.locator('[data-health-close]').click();
 await page.evaluate(()=>globalThis.__pose=null);
 await page.waitForTimeout(800);
 const remainingBefore=await page.locator('#timer').textContent();
 const startsBefore=await page.evaluate(()=>__nativeMessages.filter(m=>m.type==='start').length);
 await page.locator('[data-health-restart]').click();
 await page.waitForFunction(n=>__nativeMessages.filter(m=>m.type==='start').length===n+1,startsBefore);
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('#timer').textContent(),remainingBefore,'restart and missing hand preserve aiming time');
 assert.equal(await page.evaluate(()=>__nativeMessages.filter(m=>m.type==='start').at(-1).applyPreview),false);
 await page.waitForFunction(()=>document.querySelector('[data-health-fresh]').textContent!=='Measuring',{},{timeout:30000});
 assert.match(await page.locator('[data-health-status]').textContent(),/Waiting for hand|Tracking slow|Tracking delayed/,'slow CI rendering must remain a truthful health warning');
 assert.equal(await page.locator('.camera-image').evaluate(node=>getComputedStyle(node).opacity),'0','restart never reveals camera mirror');
 await page.screenshot({path:'.screenshots/tracking-health-205.png'});
 await page.evaluate(()=>globalThis.__pose='Open_Palm');
 await page.waitForFunction(()=>tomkoStatus().camera==='tracking');
 // Allow fresh open-hand arming after the explicit camera restart.
 await page.waitForTimeout(500);await page.evaluate(()=>globalThis.__pose='Closed_Fist');
 await page.waitForFunction(()=>['anticipate','descend'].includes(tomkoStatus().phase));
 await page.waitForFunction(()=>document.querySelector('[data-health-restart]').disabled);
 assert.equal(await page.locator('[data-health-restart]').textContent(),'Wait for claw to finish');
 await page.evaluate(()=>globalThis.__pose=null);
 assert.equal((await startCamera(true)).applyPreview,false,'accepted drop cannot apply a preview change');
 const storageKey=await page.evaluate(async()=>(await import('/__testsrc/event-session.js')).STORAGE_KEY);
 await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).active?.turns.length===1,storageKey,{timeout:30000});
 assert.equal(await page.evaluate(async()=>{
  const e=await import('/__testsrc/event-session.js');return JSON.parse(localStorage.getItem(e.STORAGE_KEY)).active.turns.length;
 }),1,'accepted drop finishes exactly once through camera restart and hand loss');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
 assert.equal((await startCamera()).applyPreview,false,'recovered run keeps the preview configuration locked');
 await page.waitForTimeout(7200);
 assert.equal(await page.locator('#camera-toggle').textContent(),'STOP CAMERA','empty frames keep acquisition alive beyond the seven-second watchdog after reload');
 // Finish the recovered run through the packaged native adapter. No app-state
 // injection: open/fist poses are the same synthetic camera input as above.
 await page.evaluate(()=>globalThis.__pose='Open_Palm');
 await page.locator('#play').click();
 for(let turn=2;turn<=3;turn++){
  await page.waitForFunction(()=>tomkoStatus().phase==='aim',{}, {timeout:15000});
  await page.evaluate(()=>globalThis.__pose='Open_Palm');await page.waitForTimeout(700);
  await page.evaluate(()=>globalThis.__pose='Closed_Fist');
  await page.waitForFunction(()=>['anticipate','descend','grip','lift'].includes(tomkoStatus().phase));
  await page.evaluate(()=>globalThis.__pose=null);
  await page.waitForFunction(({key,turn})=>{
   const store=JSON.parse(localStorage.getItem(key));
   return turn===3 ? !store.active : store.active?.turns.length===turn;
  },{key:storageKey,turn},{timeout:30000});
 }
 const receipt=await page.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key));return s.boards.find(b=>b.id===s.current).runs.at(-1);},storageKey);
 assert.equal(receipt.turns.length,3);
 assert.equal(receipt.rules.touchPoints,10);
 for(const turn of receipt.turns) if(!turn.prizeId)assert.equal(turn.score,turn.touched?10:0);
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('#final-score').innerText(),String(receipt.total));
 assert.equal(await page.locator('#final-board').innerText(),`Previous play: 30 · This play: ${receipt.total}`);
 await page.screenshot({path:join(root,'.screenshots','tomko-feedback-result.png')});
 await page.locator('#next-player').click();
 assert.notEqual(await page.locator('#name').inputValue(),receipt.name,'fresh replay nickname is retained');
 assert.equal(await page.locator('#register-other').isVisible(),false);
 await page.locator('#register-cancel').click();
 await page.locator('#operator-open').click();await page.locator('#reset').click();
 assert.equal((await startCamera(true)).applyPreview,true,'ending the run permits the next camera start to apply preview');
 await page.goto(origin+'/privacy');
 assert.match(await page.locator('body').innerText(),/Names and scores stay on this device/);
 await page.getByRole('link',{name:'Return to Cloud Claw'}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
 assert.deepEqual(failures,[],'every requested packaged asset exists');
 assert.deepEqual(external,[],'local play does not request external resources');
 console.log('PASS: packaged BUILD, between-run preview eligibility, accepted-drop completion through restart, recovery lock, delayed native readiness, camera-off/on export, offline boot, one-hand-only play, historical two-hand storage, three-turn contact scoring, plain scores, previous-play comparison, fresh nickname, duplicate-turn rejection, and persistence across browser process restart. Synthetic scores; not physical gameplay or Android force-stop validation.');
} finally {await context.close();}
