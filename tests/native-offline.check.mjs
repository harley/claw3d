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
  globalThis.__nativeMessages=[];
  globalThis.TomkoNative={postMessage(value){
   const message=JSON.parse(value);globalThis.__nativeMessages.push(message);
   if(message.type==='start')setTimeout(()=>{
    TomkoNative.onmessage({data:JSON.stringify({type:'clock',generation:message.generation,jsTime:message.jsTime,nativeTime:message.jsTime})});
    TomkoNative.onmessage({data:JSON.stringify({type:'ready',generation:message.generation})});
   },150);
  }};
 });
 return context;
}
let context=await launch();
try {
 let page=context.pages()[0]||await context.newPage();
 await page.goto(origin+'/?setup=manual&hands=manual');
 await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
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
   localStorage.setItem(key,JSON.stringify(store));
   output.push({mode,total:e.currentBoard(store).runs[0].total});
  }
  return output;
 });
 assert.deepEqual(seeded,[{mode:'one-hand',total:300},{mode:'two-hand',total:375}]);
 await context.close();
 context=await launch();page=context.pages()[0]||await context.newPage();
 for(const mode of ['one-hand','two-hand']){
  await page.goto(origin+'/?setup=manual&hands=manual'+(mode==='two-hand'?'&controls=dual':''));
  await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
  const board=await page.locator('#leaders').innerText();
  assert.ok(board.includes('Offline '+mode),board);
  assert.ok(board.includes(mode==='one-hand'?'300':'375'),board);
  assert.ok(!board.includes('Offline '+(mode==='one-hand'?'two-hand':'one-hand')));
  assert.equal(await page.evaluate(()=>navigator.onLine),false);
  assert.ok((await page.locator('#build-info').textContent()).includes(manifest.commit.slice(0,7)), 'packaged operator BUILD matches manifest');
  if(mode==='two-hand'){
   await page.locator('#camera-open').click();
   await page.locator('#camera-toggle').click();
   await page.waitForFunction(()=>!document.querySelector('#camera-setup').open && document.querySelector('#camera-toggle').textContent==='STOP CAMERA');
  }
  await page.locator('#operator-open').click();
  await page.locator('#export').click();
  const exported=await page.evaluate(()=>globalThis.__nativeMessages.find(message=>message.type==='export'));
  assert.ok(exported,'packaged Export button reaches the native bridge with camera off or running');
  assert.ok(exported.filename.includes(mode));
  const store=JSON.parse(exported.data);
  assert.ok(JSON.stringify(store).includes('Offline '+mode));
  assert.ok(!JSON.stringify(store).includes('Offline '+(mode==='one-hand'?'two-hand':'one-hand')));
  await page.evaluate(id=>TomkoNative.onmessage({data:JSON.stringify({type:'export-result',id,status:'saved'})}),exported.id);
  await page.waitForFunction(()=>document.querySelector('#operator-message').textContent.includes('scores saved'));
  assert.equal(await page.locator('#export').isDisabled(),false);
  await page.screenshot({path:join(root,'.screenshots',`android-packaged-${mode}.png`)});
 }
 await page.goto(origin+'/privacy');
 assert.match(await page.locator('body').innerText(),/Names and scores stay on this device/);
 await page.getByRole('link',{name:'Return to Cloud Claw'}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.arcadeReady==='true');
 assert.deepEqual(failures,[],'every requested packaged asset exists');
 assert.deepEqual(external,[],'local play does not request external resources');
 console.log('PASS: packaged BUILD, delayed native readiness, camera-off/on export, offline boot, both mode leaderboards, duplicate-turn rejection, and persistence across browser process restart. Synthetic scores; not physical gameplay or Android force-stop validation.');
} finally {await context.close();}
