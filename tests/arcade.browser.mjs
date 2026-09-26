// Camera-event acceptance. Synthetic input, real game and scoring; no injected catches.
import { installCameraFixture, cameraInput, cameraDrop, assertScoredStart } from './camera-fixture.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { readFile, writeFile } from 'node:fs/promises';
const browser = await chromium.launch(browserOptions);
const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
await context.addInitScript(() => { window.mediaCalls=[]; if(navigator.mediaDevices) for(const name of ['getUserMedia','enumerateDevices','getDisplayMedia']) navigator.mediaDevices[name]=()=>{window.mediaCalls.push(name);throw Error('No camera');}; });
const page = await context.newPage(), errors=[]; page.on('pageerror', e=>errors.push(e.message));
await installCameraFixture(page);
const snap=()=>page.evaluate(()=>window.__littleCloud.snapshot());
const phase=state=>page.waitForFunction(state=>window.__littleCloud.snapshot().phase===state,state,{timeout:30000});
const open=async()=>{await page.goto('http://127.0.0.1:4196/?setup=manual');await page.waitForFunction(()=>window.__littleCloud);};
async function assertInstructions({ profile, scene, camera, attractTitle, attractRule }) {
 assert.equal(await page.locator('#scene').getAttribute('aria-label'), scene, `${profile} scene description`);
 assert.equal(await page.locator('#camera-menu-help').textContent(), profile === 'dual' ? 'Use your left hand and hold a fist to select menu buttons. Your right hand can stay visible.' : 'Use one open hand and hold a fist to select menu buttons.', `${profile} keeps menu help separate`);
 assert.equal(await page.locator('#camera-help').textContent(), camera, `${profile} camera gameplay help`);
 assert.equal(await page.locator('#attract-title').textContent(), attractTitle, `${profile} attract title`);
 assert.equal(await page.locator('#attract-rule').textContent(), attractRule, `${profile} attract rule`);
}
const instructions = {
 holdDrop: { profile: 'one-hand', scene: 'Steer with one open hand. Clench and hold your fist to drop.', camera: 'Move one open hand to steer. Clench and hold your fist to drop; open to cancel.', attractTitle: 'SHOW YOUR HAND', attractRule: 'OPEN HAND STEERS · FIST DROPS' },
 grab: { profile: 'grab-release', scene: 'Clench on MOVE to grip and steer. Open to release without dropping. Click or clench DROP to drop.', camera: 'Clench on MOVE to grip and steer. Open to release without dropping. Click, clench, or swipe down on DROP to drop.', attractTitle: 'SHOW YOUR HAND', attractRule: 'GRIP MOVE · OPEN TO RELEASE · PRESS DROP' },
 dual: { profile: 'dual', scene: 'Clench your left hand to grip and steer. Raise your open right hand to drop. Open your left hand to release.', camera: 'Show both open hands. Clench your left hand to grip and steer; raise your open right hand to drop. Open your left hand to release without dropping.', attractTitle: 'SHOW BOTH HANDS', attractRule: 'LEFT HAND STEERS · RIGHT HAND DROPS' },
};
async function aimToy(id='butter'){ for(const axis of ['x','z']) for(let i=0;i<6;i++){const delta=({butter:{x:-.38,z:.72},peach:{x:.20,z:.72}}[id])[axis]-(await snap()).position[axis];if(Math.abs(delta)<.025)break;const speed=Math.abs(delta)<.14?.25:1;await cameraInput(page,{x:0,z:0,[axis]:Math.sign(delta)*speed});await page.waitForTimeout(Math.abs(delta)/(.85*speed)*1000);await cameraInput(page,{x:0,z:0});} assert.equal((await snap()).aligned,id);}
let checkedDelivery = false;
async function catchTurn({ timeout = false } = {}){
 if (timeout) await phase('anticipate');
 else assert.equal(await cameraDrop(page), true, 'the intended drop is accepted');
 assert.equal(await page.locator('#status').textContent(), 'DROP!', 'drop text updates synchronously');
 for(let i=0;i<5;i++)assert.equal(await cameraDrop(page), false, 'an accepted drop cannot be repeated');
 await phase('lift');
 const caught = (await snap()).caught;
 assert.equal(await page.locator('#status').textContent(), caught ? 'GOT IT!' : 'MISSED');
 if (caught) assert.ok((await snap()).effects.burst > 0, 'catch payoff burst fires at lift');
 if (!caught) {
  const missCamera = (await snap()).camera;
  await phase('result');
  assert.match(await page.locator('#hint').textContent(), /^(SO CLOSE|SLIPPED OFF [A-Z ]+|[A-Z ]+ STUCK BESIDE [A-Z ]+|BLOCKED BY [A-Z ]+|BUMPED [A-Z ]+|STAR MOVED ON|NOTHING THERE)$/, 'a miss says why');
  assert.deepEqual((await snap()).camera, missCamera, 'a miss keeps the close view');
  assert.ok(Math.abs((await snap()).claw.x - (await snap()).position.x) < 1e-6, 'the empty claw stays over its drop');
 }
 if (!checkedDelivery) {
  await phase('deliver');
  await page.locator('#operator-open').click();await page.locator('#pause').click();
  await page.waitForFunction(()=>window.__littleCloud.snapshot().event.paused);
  await page.evaluate(()=>window.testCamera.stop());
  const pausedDelivery=(await snap()).elapsed;await page.waitForTimeout(150);
  assert.equal((await snap()).elapsed,pausedDelivery);
  await page.locator('#play').click();
  await page.waitForFunction(()=>!window.__littleCloud.snapshot().event.paused);
  assert.equal((await snap()).event.handCamera.running,false,'resuming an accepted drop does not require a camera');
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.testCamera.visible = false; window.testCamera.tick(); });
  await page.locator('#camera-open').click();
  assert.equal(await page.locator('#operator').isVisible(), false);
  await phase('result'); assert.equal((await snap()).event.paused, false);
  await page.locator('#camera-toggle').click();
  await page.locator('#camera-setup').waitFor({state:'hidden'});
  await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  checkedDelivery = true;
  console.log('PASS drop completes through blur, lost hands and camera settings');
 } else await phase('result');
 const resultState=await snap();
 const cumulative=resultState.event.run?.turns.reduce((sum,turn)=>sum+turn.score,0)??resultState.event.complete?.total??0;
 assert.equal(await page.locator('#score').textContent(),String(cumulative).padStart(3,'0'),'HUD score shows the cumulative total after each scored turn');
 if ((await snap()).event.run) {
  const next = (await snap()).event.turn + 1;
  assert.equal(await page.locator('#status').textContent(), caught ? `ROUND ${next}` : 'MISSED');
  assert.equal(await cameraDrop(page), false, 'round announcement cannot accept another drop');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'START!');
  assert.equal((await snap()).phase, 'result', 'start cue precedes active aiming');
 }
}
try {
 await open();
 await assertInstructions(instructions.holdDrop);
 await page.waitForFunction(() => document.body.classList.contains('attract'));
 await page.screenshot({path:'.screenshots/control-help-one-hand.png'});
 await page.locator('#mode-two').click();
 await page.waitForFunction(() => location.search.includes('controls=dual') && document.documentElement.dataset.arcadeReady === 'true');
 await assertInstructions(instructions.dual);
 await page.waitForFunction(() => document.body.classList.contains('attract'));
 await page.screenshot({path:'.screenshots/control-help-dual.png'});
 await page.locator('#mode-one').click();
 await page.waitForFunction(() => !location.search.includes('controls=') && document.documentElement.dataset.arcadeReady === 'true');
 await assertInstructions(instructions.holdDrop);
 await page.goto('http://127.0.0.1:4196/?setup=manual&controls=grab');
 await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
 await assertInstructions(instructions.grab);
 await page.waitForFunction(() => document.body.classList.contains('attract'));
 await page.screenshot({path:'.screenshots/control-help-grab-release.png'});
 await page.route('**/models/hands/*.glb', route => route.abort());
 await page.goto('http://127.0.0.1:4196/?setup=manual&controls=dual');
 await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
 await page.waitForFunction(() => !document.getElementById('hand-art-status').hidden);
 assert.equal(await page.locator('#hand-art-status').textContent(), 'One or more 3D hand models failed to load. Camera tracking and game controls remain available.');
 assert.equal(await page.locator('#error').isVisible(), false, 'missing hand artwork does not block the game renderer');
 await page.locator('#camera-open').click();
 assert.equal(await page.locator('#hand-art-status').isVisible(), true, 'camera setup explains the missing 3D artwork');
 await page.locator('#camera-setup [aria-label="Close camera setup"]').click();
 await page.locator('#play').click();
 await page.waitForFunction(() => window.testCamera?.running);
 assert.equal(await page.evaluate(() => window.testCamera.maxHands), 2, 'camera recognition remains available after model failure');
 await page.unroute('**/models/hands/*.glb');
 await page.goto('http://127.0.0.1:4196/?setup=manual');
 await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
 await assertInstructions(instructions.holdDrop);
 await page.screenshot({path:'.screenshots/event-hero.png'});
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
 await page.locator('#play').click();await page.waitForFunction(()=>window.__littleCloud.snapshot().event.handCamera.running);
 await page.locator('#play').click();assert.equal(await page.locator('#name').getAttribute('required'),null);
 await page.locator('#name').fill('Linh r h');await page.locator('#name').press('Enter');
 await assertScoredStart(page,{captureScreenshots:true});
 assert.equal((await snap()).event.run.name,'Linh r h');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const camera=(await snap()).camera; await page.waitForTimeout(100); assert.deepEqual((await snap()).camera,camera);
 await aimToy();await catchTurn();assert.equal((await snap()).event.run.turns.length,1);assert.ok((await snap()).event.run.turns[0].score>100);
 await phase('aim');
 assert.equal((await snap()).toys.find(t=>t.id==='butter').claimed,true);
 assert.deepEqual((await snap()).collection,['butter']);
 await page.locator('.turn-chip[data-prize="butter"]').waitFor();
 assert.equal(await page.locator('.trophy-name').textContent(),'Butter');
 const trophyRun=(await snap()).event.run.id;
 await page.reload();await page.waitForFunction(()=>window.__littleCloud);
 assert.deepEqual((await snap()).collection,['butter'],'reload restores shelf trophies before Continue');
 await page.locator('.turn-chip[data-prize="butter"]').waitFor();
 await page.locator('#play').click();await phase('aim');
 assert.equal((await snap()).event.run.id,trophyRun);
 assert.equal((await snap()).event.turn,2);
 assert.equal((await snap()).toys.find(t=>t.id==='butter').claimed,true);
 await page.setViewportSize({width:390,height:844});
 const trophyBox=await page.locator('#turn-chips').boundingBox(),sceneBox=await page.locator('#scene').boundingBox();
 assert.ok(trophyBox&&trophyBox.y+trophyBox.height<=sceneBox.y,'trophies stay visible above the chamber on phones');
 await page.screenshot({path:'.screenshots/persistent-trophy-mobile.png'});
 // Rendering contract: emoji fallback fonts must not push the recovered trophies
 // into the chamber. Reuse this real catch/reload; vary only the rendered label.
 for (const width of [390, 320]) {
  await page.setViewportSize({width,height:844});
  const layouts = await page.evaluate(() => {
   const label = document.getElementById('player-name'), original = label.textContent;
   const names = ['🦀 Coral', '🦀 Pebble', '🦀 Cove', '🦊 Ember', '🦊 Rusty', '🦊 Maple',
    '🐻 Kuma', '🐻 Chestnut', '🐻 Cocoa', '🐱 Miso', '🐱 Sesame', '🐱 Socks',
    '🐰 Mochi', '🐰 Clover', '🐰 Taro', '🦦 Ripple', '🦦 River', '🦦 Nori',
    '🐧 Pip', '🐧 Waddle', '🐧 Pogo', '🐉 Jade', '🐉 Flint', '🐉 Ash'];
   try {
    return names.map(name => {
     label.textContent = name;
     const trophies = document.getElementById('turn-chips').getBoundingClientRect();
     const scene = document.getElementById('scene').getBoundingClientRect();
     return {name, trophyBottom:trophies.bottom, trophyHeight:trophies.height, sceneTop:scene.top};
    });
   } finally { label.textContent = original; }
  });
  for (const layout of layouts) {
   assert.ok(layout.trophyHeight > 0 && layout.trophyBottom <= layout.sceneTop,
    `emoji trophies stay above the chamber at ${width}px: ${JSON.stringify(layout)}`);
  }
  console.log(`PASS emoji trophy layout ${width} × 844`, JSON.stringify(layouts.find(({name}) => name === '🦀 Pebble')));
 }

 await page.setViewportSize({width:1440,height:900});
 // A clear miss at the far left: no consolation or hidden points.
 await cameraInput(page,{x:-1,z:0});await page.waitForTimeout(1800);await cameraInput(page,{x:0,z:0});await catchTurn();
 assert.equal((await snap()).event.run.turns[1].score,0);
 await phase('aim');assert.equal((await snap()).event.turn,3);
 assert.deepEqual((await snap()).collection,['butter']);
 await aimToy('peach');await page.screenshot({path:'.screenshots/event-last-claw.png'});await catchTurn({timeout:true});await page.locator('#final').waitFor();
 assert.ok((await snap()).event.complete.total>200 && (await snap()).event.complete.total<=300);assert.equal((await snap()).event.board.runs.length,1);
 await page.locator('#final-leaderboard').click(); await page.locator('#result-open').click();
 assert.equal(await page.locator('#final-score').textContent(),String((await snap()).event.complete.total),'reopening restores the full score after interrupted count-up');
 await page.screenshot({path:'.screenshots/event-result.png'});
 assert.equal(await page.locator('#final-rank').textContent(),'LOCAL PREVIEW · 1 HAND · RANK #1');
 assert.equal(await page.locator('#mode-label').textContent(),'LOCAL PREVIEW · 1 HAND');
 assert.equal(await page.locator('#final-turns .catch-card').count(),3);
 assert.deepEqual(await page.locator('#final-turns .catch-name').allTextContents(),['BUTTER','MISS','PEACH']);
 const completed=(await snap()).event.complete;
 assert.equal(completed.turns[2].remainingMs,0,'the final turn expires naturally');
 assert.equal(completed.turns[2].score,100,'a timed-out catch earns base points without speed bonus');
 assert.deepEqual(await page.locator('#final-turns .catch-points').allTextContents(),completed.turns.map(t=>`+${t.score}`));
 for(const width of [390,320]) {
  await page.setViewportSize({width,height:844});
  assert.ok(await page.locator('#final').evaluate(el=>el.scrollWidth<=el.clientWidth),'finale cards fit the phone dialog without horizontal scrolling');
  await page.screenshot({path:`.screenshots/finale-${width}.png`});
 }
 await page.setViewportSize({width:1440,height:900});

 console.log('PASS distinct catches, persistent trophies, exactly three turns and natural timeout');
 // Blank-name admission and persistence use the next-player recovery journey.
 await page.locator('#next-player').click();await page.locator('#name').fill('');await page.locator('#name').press('Enter');await assertScoredStart(page);
 const generated=(await snap()).event.run.name;
 assert.match(generated,/^(?:🦀|🦊|🐻|🐱|🐰|🦦|🐧|🐉) [A-Z][a-z]+$/u);
 assert.equal((await snap()).event.run.practice,false,'a blank nickname starts an official scored run');
 assert.ok((await snap()).toys.every(t=>!t.claimed),'new player restocks the machine');
 assert.equal(await page.locator('#turn-chips .turn-chip[data-prize]').count(),0,'the new player has no HUD trophies');
 await page.locator('#operator-open').click();const before=(await snap()).event.remaining;await page.waitForTimeout(350);assert.equal((await snap()).event.remaining,before);await page.locator('#operator .panel-head button').click();await page.locator('#scene').focus();
 await page.reload();await page.waitForFunction(()=>window.__littleCloud);
 assert.deepEqual((await snap()).event.board.runs,[completed],'completed result survives the next player and reload');
 assert.equal((await snap()).event.run.name,generated);assert.equal((await snap()).phase,'idle');
 const recoveredId=(await snap()).event.run.id;
 assert.equal(await page.locator('#button-text').textContent(),'CONTINUE');
 assert.equal(await page.locator('#hint').isVisible(),false);
 await page.locator('#play').click();await phase('aim');
 assert.equal((await snap()).event.run.id,recoveredId);assert.equal((await snap()).event.run.turns.length,0);
 await page.reload();await page.waitForFunction(()=>window.__littleCloud);
 assert.equal((await snap()).event.run.id,recoveredId);assert.equal((await snap()).event.run.turns.length,0);
 await page.locator('#camera-open').click();await page.locator('#camera-toggle').click();await page.locator('#camera-setup').waitFor({state:'hidden'});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('#operator-open').click();await page.locator('#pause').click();
 await assertScoredStart(page);await phase('aim');
 await page.emulateMedia({reducedMotion:'no-preference'});
 assert.equal((await snap()).event.run.id,recoveredId);assert.equal((await snap()).event.run.turns.length,0);
 assert.equal(await page.locator('#operator').isVisible(),false);
 await page.locator('#operator-open').click();await page.locator('#pause').click();
 await page.waitForFunction(()=>document.getElementById('status').textContent==='PAUSED');
 const heldTime=(await snap()).event.remaining;await page.waitForTimeout(200);
 assert.equal((await snap()).event.remaining,heldTime);assert.equal(await page.locator('#button-text').textContent(),'RESUME');
 await page.locator('#play').click();await page.waitForFunction(()=>!window.__littleCloud.snapshot().event.paused);
 assert.equal((await snap()).event.run.id,recoveredId);
 await page.locator('#operator-open').click();await page.locator('#new-board').click();assert.match(await page.locator('#operator-message').textContent(),/Finish or reset/);await page.locator('#reset').click();
 assert.equal((await snap()).event.run,null);assert.equal((await snap()).phase,'idle');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('coderpush:event:v1')).active),null,'reset clears the saved active run before the legacy fixture');
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
 await page.locator('#play').click(); await phase('aim');
 assert.equal((await snap()).event.run.turns.length,2);assert.equal((await snap()).event.turn,3);
 await page.waitForFunction(()=>!window.__littleCloud.snapshot().event.handCamera.waiting);
 await cameraDrop(page); await page.locator('#final').waitFor({timeout:30000});
 assert.equal(await page.locator('#final-rank').textContent(),'LOCAL PREVIEW · 1 HAND');
 assert.deepEqual(await page.locator('#final-turns .catch-name').allTextContents(),['MISS','MISS','MISS']);
 assert.equal(await page.locator('#final-kicker').textContent(),'THE CLAW WINS THIS ONE');
 assert.deepEqual((await page.locator('#final-turns .catch-detail').allTextContents()).slice(0,2),['TURN 1','TURN 2'],'recovered misses do not inherit another run reason');
 await page.screenshot({path:'.screenshots/finale-all-misses.png'});
 assert.equal(await page.locator('#leaders li').count(),1,'legacy practice never joins the official result');
 const practice=(await snap()).event.complete;
 assert.equal(practice.practice,true);assert.equal(practice.turns.length,3);
 await page.reload();await page.waitForFunction(()=>window.__littleCloud);
 assert.deepEqual((await snap()).event.board.runs,[completed,practice],'both results append once and survive reload');

 console.log('PASS legacy unfinished practice remains preserved and excluded without a fabricated rank');
 await page.locator('#operator-open').click();await page.locator('#session-name').fill('Afternoon');await page.locator('#new-board').click();assert.equal((await snap()).event.board.name,'Afternoon');assert.equal(await page.locator('#leaders li').count(),0);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('coderpush:event:v1')));assert.deepEqual(saved.boards[0].runs,[completed,practice]);
 const download=page.waitForEvent('download');await page.locator('#export').click();const exported=await download;assert.match(exported.suggestedFilename(),/cloud-claw-sessions/);
 assert.deepEqual(JSON.parse(await readFile(await exported.path(),'utf8')),saved,'export preserves the saved boards and results');await page.locator('#operator .panel-head button').click();
 await page.reload();await page.waitForFunction(()=>window.__littleCloud);
 assert.equal((await snap()).event.board.name,'Afternoon');assert.equal(await page.locator('#leaders li').count(),0);
 console.log('PASS interrupted player recovery, safe board rotation, export');
 await page.setViewportSize({width:820,height:900});await page.screenshot({path:'.screenshots/event-narrow.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(await page.evaluate(()=>window.mediaCalls),[]);assert.deepEqual(errors,[]);
 await writeFile('.screenshots/event-verification.json',JSON.stringify({checks:['official three-turn run with speed bonus','catch/miss and repeated drop','caught toys stay removed until a new player','blank nickname accepted and recovered','legacy practice preserved and excluded','timer auto-drop','modal pause','reload persistence and recovery','session history','export contents','820px viewport','no camera access'],errors},null,2));
 console.log('ALL EVENT BROWSER CHECKS PASSED');
} finally {await browser.close();}
