// Host-only production UI + real cache, journal and API. No game or camera input.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
const origin = 'http://127.0.0.1:4301';
let app, browser;
try {
  app = await createPilotServer({ filename: ':memory:', origin, secure: false, staffCode:'prepared-host-staff', hostCode:'prepared-host-code', publicTryEnabled:true,
    publicPermitPolicy:{maxSlots:5,maxRetentionMs:86400000} });
  await new Promise(resolve=>app.server.listen(4301,'127.0.0.1',resolve));
  browser = await chromium.launch(browserOptions);
  const context = await browser.newContext({acceptDownloads:true});
  const page = await context.newPage(), requests = [], errors = [];
  page.on('request',r=>requests.push(new URL(r.url()).pathname)); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/staff'); await page.locator('#code').fill('prepared-host-code'); await page.locator('#sign-in').click();
  try { await page.waitForFunction(()=>document.getElementById('setup').hidden===false && !document.getElementById('preparation-prepare').disabled); } catch(error) { console.error(await page.locator('body').innerText(),errors); throw error; }
  const event = await context.request.post(origin+'/api/host/public-events',{headers:{origin},data:{name:'Prepared browser test',requestKey:crypto.randomUUID(),timeZone:'Asia/Ho_Chi_Minh',startsAt:new Date(Date.now()+60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()}});
  assert.equal(event.status(),201); const created=await event.json();
  await page.locator('#event-refresh').click(); await page.locator('#event-select').selectOption(created.id); await page.locator('#station-enroll').click();
  await page.waitForFunction(()=>document.getElementById('station-status').textContent.includes('Ready'));
  assert.equal(await page.locator('#open-game').getAttribute('href'),'/','enrollment alone does not select offline game');
  const deadline=Date.now()+3600000;
  await page.locator('#permit-count').fill('3');
  await page.locator('#permit-deadline').fill(new Date(deadline-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));
  const issuance = [];
  await page.route('**/api/host/station/permits',async route => {
    issuance.push(route.request().postDataJSON());
    const response = await route.fetch(); assert.equal(response.status(),200);
    if (issuance.length === 1) await route.abort('failed');
    else await route.fulfill({response});
  });
  await page.locator('#preparation-prepare').click();
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('Check your connection'));
  await page.locator('#permit-count').fill('4');
  await page.locator('#preparation-prepare').click();
  await page.waitForFunction(()=>document.getElementById('preparation-status').textContent.startsWith('Ready for offline'),null,{timeout:90000});
  assert.equal(issuance.length,2); assert.deepEqual(issuance[0],issuance[1]);
  await page.unroute('**/api/host/station/permits');
  console.log('Host prepared real assets, storage and three bounded permits after a lost issuance receipt');
  assert.match(await page.locator('#preparation-capacity').textContent(),/3 usable starts/);
  assert.equal(await page.locator('#open-game').getAttribute('href'),'/prepared/index.html');
  assert.equal(await page.locator('#scene, #camera-video, #operator-open').count(),0);
  // Retain an interrupted unsynced physical attempt while the server still
  // reports three unregistered slots. Host must offer only two new starts.
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('cloud-claw:public-journal:v1',2);r.onsuccess=()=>resolve(r.result);});
    await new Promise(resolve=>{
      const tx=db.transaction(['pools','intents'],'readwrite');const req=tx.objectStore('pools').getAll();
      req.onsuccess=()=>{const pool=req.result[0],slot=pool.slots[0];slot.consumed=true;tx.objectStore('pools').put(pool);
        tx.objectStore('intents').add({version:1,requestKey:slot.requestKey,attemptKey:crypto.randomUUID(),name:'Retained Lan',controlMode:'one-hand',physical:'interrupted',liveAttempted:true,settled:false,admitted:false,turns:[],acknowledged:0,
          grant:{slotId:slot.id,poolId:pool.id,packId:pool.packId},run:{id:slot.runId,boardId:pool.boardId,name:'Retained Lan',status:'active',turns:[],rules:{...pool.rules,controlMode:'one-hand'}}});};tx.oncomplete=resolve;
    });db.close();
  });
  await page.locator('#preparation-check').click(); await page.waitForFunction(()=>document.getElementById('preparation-capacity').textContent.startsWith('2 usable'));
  assert.match(await page.locator('#preparation-pending').textContent(),/1 retained/);
  const original = (await context.cookies()).find(cookie=>cookie.name==='cc_player');
  await context.clearCookies({name:'cc_player'}); await page.reload();
  await page.waitForFunction(()=>document.getElementById('preparation-status').textContent.includes('Original ownership unavailable'));
  const downloadPromise=page.waitForEvent('download');await page.locator('#preparation-export').click();const download=await downloadPromise;
  const stream=await download.createReadStream(); let text='';for await(const chunk of stream)text+=chunk;
  const evidence=JSON.parse(text);assert.equal(evidence.results[0].name,'Retained Lan');assert.doesNotMatch(text,/cc_player|slotId|requestKey|cookie|landmarks|cameraFrame/);
  // Restoring the original test credential demonstrates repair, never importing
  // an export or allocating a replacement owner. Deadline/consumption persist.
  await context.addCookies([original]); await page.reload();
  await page.locator('#preparation-repair').click();
  await page.waitForFunction(()=>document.getElementById('preparation-status').textContent.startsWith('Ready for offline'));
  assert.match(await page.locator('#preparation-capacity').textContent(),/2 usable/);
  const status=await (await context.request.get(origin+'/api/host/station/preparation')).json();assert.equal(status.pools.length,1);assert.ok(status.pools[0].reconcileBy<=deadline && status.pools[0].reconcileBy>deadline-60000);
  // A different live manifest must not attest the old active pack as current.
  await page.route('**/prepared/manifest.json',async route=>{const r=await route.fetch();const m=await r.json();await route.fulfill({json:{...m,id:'different-pack',build:{commit:'new-build'}}});});
  await page.locator('#preparation-check').click();await page.waitForFunction(()=>document.getElementById('preparation-build').textContent.includes('new-build'));
  assert.equal(await page.locator('#open-game').getAttribute('href'),'/');
  await page.unroute('**/prepared/manifest.json');await page.locator('#preparation-check').click();await page.waitForFunction(()=>document.getElementById('preparation-status').textContent.startsWith('Ready for offline'));
  assert.ok(!requests.some(path=>/vision|camera|playtest|diagnostics/.test(path) && !path.startsWith('/assets/') && !path.startsWith('/vision/') && !path.startsWith('/prepared/prepared-vision-worker')), 'no camera/telemetry endpoints used');
  assert.deepEqual(errors,[]);
  await mkdir('.screenshots',{recursive:true});
  await page.screenshot({path:'.screenshots/host-preparation.png',fullPage:true});
  // Test the logout/navigation boundary without requiring a renderer.
  await Promise.all([page.waitForURL(origin+'/prepared/index.html',{waitUntil:'commit'}),page.locator('#open-game').click({noWaitAfter:true})]);
  await page.close();assert.equal((await context.request.get(origin+'/api/host/station/preparation')).status(),401);
  assert.equal((await context.request.get(origin+'/api/play/permits/'+status.pools[0].id)).status(),200);
  console.log('Host readiness, retained capacity, lost-owner export, same-owner repair, build compatibility and logout pass');
} finally {
  await browser?.close();if(app){await new Promise(resolve=>app.server.close(resolve));app.database.close();}
}
