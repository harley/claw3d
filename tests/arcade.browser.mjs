// Camera-event acceptance. Synthetic input, real game and scoring; no injected catches.
import { installCameraFixture, cameraInput, cameraDrop, assertScoredStart } from './camera-fixture.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch(browserOptions);
const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
await context.addInitScript(() => { window.mediaCalls=[]; if(navigator.mediaDevices) for(const name of ['getUserMedia','enumerateDevices','getDisplayMedia']) navigator.mediaDevices[name]=()=>{window.mediaCalls.push(name);throw Error('No camera');}; });
const page = await context.newPage(), errors=[]; page.on('pageerror', e=>errors.push(e.message));
await installCameraFixture(page);
const snap=()=>page.evaluate(()=>window.__littleCloud.snapshot());
const phase=state=>page.waitForFunction(state=>window.__littleCloud.snapshot().phase===state,state,{timeout:30000});
const open=async()=>{await page.goto('http://127.0.0.1:4196/?setup=manual');await page.waitForFunction(()=>window.__littleCloud);};
const register=async name=>{if(!(await snap()).event.handCamera.running){await page.locator('#play').click();await page.waitForFunction(()=>window.__littleCloud.snapshot().event.handCamera.running);}await page.locator('#play').click();assert.equal(await page.locator('#name').getAttribute('required'),null);await page.locator('#name').fill(name);await page.locator('#name').press('Enter');await assertScoredStart(page);await phase('aim');};
async function aimButter(){ for(const axis of ['x','z']) for(let i=0;i<6;i++){const delta=({x:-.38,z:.72})[axis]-(await snap()).position[axis];if(Math.abs(delta)<.025)break;const speed=Math.abs(delta)<.14?.25:1;await cameraInput(page,{x:0,z:0,[axis]:Math.sign(delta)*speed});await page.waitForTimeout(Math.abs(delta)/(.85*speed)*1000);await cameraInput(page,{x:0,z:0});} assert.equal((await snap()).aligned,'butter');}
let checkedDelivery = false;
async function catchTurn(){
 await cameraDrop(page);
 assert.equal(await page.locator('#status').textContent(), 'DROP!', 'drop text updates synchronously');
 for(let i=0;i<5;i++)await cameraDrop(page);
 await phase('lift');
 const caught = (await snap()).caught;
 assert.equal(await page.locator('#status').textContent(), caught ? 'GOT IT!' : 'MISSED');
 if (caught) assert.ok((await snap()).effects.burst > 0, 'catch payoff burst fires at lift');
 if (!caught) {
  await phase('transfer');
  assert.equal(await page.locator('#hint').textContent(), '');
 }
 if (!checkedDelivery) {
  await phase('deliver');
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.testCamera.visible = false; window.testCamera.tick(); });
  await page.locator('#camera-open').click();
  assert.equal(await page.locator('#operator').isVisible(), false);
  await phase('result'); assert.equal((await snap()).event.paused, false);
  await page.locator('#camera-setup .panel-head button').click();
  await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  checkedDelivery = true;
  console.log('PASS drop completes through blur, lost hands and camera settings');
 } else await phase('result');
 if ((await snap()).event.run) {
  const next = (await snap()).event.turn + 1;
  assert.equal(await page.locator('#status').textContent(), `ROUND ${next}`);
  assert.equal(await cameraDrop(page), false, 'round announcement cannot accept another drop');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'START!');
  assert.equal((await snap()).phase, 'result', 'start cue precedes active aiming');
 }
}
try {
 await open();await page.screenshot({path:'.screenshots/event-hero.png'});
 const idleWrites = await page.evaluate(async () => {
  let writes = 0;
  const observer = new MutationObserver(records => { writes += records.length; });
  observer.observe(document.getElementById('arcade'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
  observer.disconnect();
  return writes;
 });
 assert.equal(idleWrites, 0, 'idle presentation must not rewrite unchanged visibility every frame');
 assert.equal(await page.locator('#practice').count(),0);
 await register('Linh r h'); assert.equal((await snap()).event.run.name,'Linh r h');
 const camera=(await snap()).camera; await page.waitForTimeout(100); assert.deepEqual((await snap()).camera,camera);
 await aimButter();await catchTurn();assert.equal((await snap()).event.run.turns.length,1);assert.ok((await snap()).event.run.turns[0].score>100);
 await phase('aim');
 assert.ok((await snap()).toys.every(t=>!t.claimed));
 // A clear miss at the far left: no consolation or hidden points.
 await cameraInput(page,{x:-1,z:0});await page.waitForTimeout(1800);await cameraInput(page,{x:0,z:0});await catchTurn();
 assert.equal((await snap()).event.run.turns[1].score,0);
 await phase('aim');assert.equal((await snap()).event.turn,3);
 await aimButter();await page.screenshot({path:'.screenshots/event-last-claw.png'});await catchTurn();await page.locator('#final').waitFor();
 assert.ok((await snap()).event.complete.total>200 && (await snap()).event.complete.total<=300);assert.equal((await snap()).event.board.runs.length,1);
 await page.locator('#final-leaderboard').click(); await page.locator('#result-open').click();
 assert.equal(await page.locator('#final-score').textContent(),String((await snap()).event.complete.total),'reopening restores the full score after interrupted count-up');
 await page.screenshot({path:'.screenshots/event-result.png'});
 await page.reload();await page.waitForFunction(()=>window.__littleCloud);assert.equal((await snap()).event.board.runs.length,1);
 console.log('PASS official: catch + miss + catch, restock, exactly three turns, persisted speed-score total');
 await register('');
 await page.locator('#operator-open').click();const before=(await snap()).event.remaining;await page.waitForTimeout(350);assert.equal((await snap()).event.remaining,before);await page.locator('#operator .panel-head button').click();await page.locator('#scene').focus();
 await catchTurn();await phase('aim');await catchTurn();await phase('aim');
 // Final turn runs out naturally and commits one drop.
 await phase('result');await page.locator('#final').waitFor();assert.match((await snap()).event.complete.name,/^[A-Z]+-\d{3}$/);assert.equal((await snap()).event.board.runs.length,2);assert.equal(await page.locator('#leaders li').count(),2);
 console.log('PASS blank nickname scored, modal pause, timeout commits once');
 await page.locator('#next-player').click();await page.locator('#name').fill('Recover');await page.locator('#name').press('Enter');await assertScoredStart(page);await page.reload();await page.waitForFunction(()=>window.__littleCloud);
 assert.equal((await snap()).event.run.name,'Recover');assert.equal((await snap()).phase,'idle');await page.locator('#operator-open').click();await page.locator('#pause').click();await phase('aim');
 await page.locator('#operator-open').click();await page.locator('#new-board').click();assert.match(await page.locator('#operator-message').textContent(),/Finish or reset/);await page.locator('#reset').click();
 await page.locator('#operator-open').click();await page.locator('#session-name').fill('Afternoon');await page.locator('#new-board').click();assert.equal((await snap()).event.board.name,'Afternoon');assert.equal(await page.locator('#leaders li').count(),0);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('coderpush:event:v1')));assert.equal(saved.boards[0].runs.length,2);
 const download=page.waitForEvent('download');await page.locator('#export').click();assert.match((await download).suggestedFilename(),/cloud-claw-sessions/);await page.locator('#operator .panel-head button').click();
 console.log('PASS interrupted player recovery, safe board rotation, export');
 await page.setViewportSize({width:820,height:900});await page.screenshot({path:'.screenshots/event-narrow.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 // An unfinished practice run from an older client stays excluded when resumed.
 await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('coderpush:event:v1'));
  const board = saved.boards.find(board => board.id === saved.current);
  saved.active = { id: crypto.randomUUID(), name: 'Earlier player', practice: true, boardId: board.id, rules: board.rules,
   startedAt: new Date().toISOString(), turns: [1, 2].map(turn => ({ turn, prizeId: null, score: 0 })) };
  localStorage.setItem('coderpush:event:v1', JSON.stringify(saved));
 });
 await page.reload(); await page.waitForFunction(()=>window.__littleCloud);
 await page.locator('#camera-open').click(); await page.locator('#camera-toggle').click();
 await page.locator('#camera-setup').waitFor({state:'hidden'});
 await page.locator('#operator-open').click(); await page.locator('#pause').click(); await phase('aim');
 await page.waitForFunction(()=>!window.__littleCloud.snapshot().event.handCamera.waiting);
 await cameraDrop(page); await page.locator('#final').waitFor({timeout:30000});
 assert.equal(await page.locator('#final-rank').textContent(),'LOCAL PREVIEW');
 assert.equal(await page.locator('#leaders li').count(),0);
 assert.equal((await snap()).event.board.runs[0].practice,true);
 assert.equal((await snap()).event.board.runs[0].turns.length,3);
 console.log('PASS legacy unfinished practice remains preserved and excluded without a fabricated rank');
 assert.deepEqual(await page.evaluate(()=>window.mediaCalls),[]);assert.deepEqual(errors,[]);
 await writeFile('.screenshots/event-verification.json',JSON.stringify({checks:['official three-turn run with speed bonus','catch/miss and repeated drop','restock each turn','blank nickname scored','legacy practice preserved and excluded','timer auto-drop','modal pause','reload persistence and recovery','session history','export','820px viewport','no camera access'],errors},null,2));
 console.log('ALL EVENT BROWSER CHECKS PASSED');
} finally {await browser.close();}
