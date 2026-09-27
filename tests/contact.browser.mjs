import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser = await chromium.launch(browserOptions);
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 await page.goto('http://127.0.0.1:4196/?setup=manual'); await page.waitForFunction(() => window.__littleCloud);
 const report = await page.evaluate(async () => {
  const { ArcadeScene } = await import('/src/arcade-scene.js');
  const { createGame, begin, drop, advance, moveCarousel, CAROUSEL, CONTACT_DELAY, BED } = await import('/src/arcade-mechanics.js');
  const canvas = document.createElement('canvas'); canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:100'; document.body.append(canvas);
  const scene = new ArcadeScene(canvas), render = scene.renderer.render.bind(scene.renderer); scene.renderer.render = () => {};
  const results = [];
  for (const pushContact of [false, true]) for (const [name, x, z, time] of [['centred',-.38,.72,0],['jackpot',.8,.22,CAROUSEL.period-CONTACT_DELAY],['side',-.18,.72,0],['front',-.03,.40,0],['empty',-1.12,.66,0]]) {
   const game = createGame({ carousel: true, pushContact }); scene.groundToys(game); begin(game); moveCarousel(game,time); game.position={x,z}; drop(game);
   let maxTilt=0,blocked=false,minGround=Infinity,peak=null;
   for(let i=0;i<1000&&game.phase!=='result';i++) {
    advance(game,1/60); scene.update(game,1/60,i/60,{x:0,z:0},null); blocked ||= Boolean(game.plan.blockedDescent);
    for(const toy of game.toys) if(toy.impact) {
     if(toy.impact.angle>maxTilt){maxTilt=toy.impact.angle;peak={phase:game.phase,elapsed:game.elapsed};}
     const bounds=scene.toyBounds(toy.id); minGround=Math.min(minGround,bounds.min[1]-BED-(toy.elevation||0));
    }
   }
   results.push({name: pushContact ? `push-${name}` : name, displaced: game.toys.filter(t => t.restPose).map(t => ({id:t.id,angle:t.restPose.angle})),impacts:game.toys.filter(t=>t.impact).map(t=>({id:t.id,...t.impact})),caught:game.plan.prize?.id||null,maxTilt,blocked,minGround:Number.isFinite(minGround)?minGround:null,peak});
  }
  // Replay the three physical-test drop positions. Catch decisions were right,
  // but mesh-constrained fingers snapped inward when grip changed to lift.
  const transitions = [];
  for (const fps of [60, 30, 10]) {
   const game = createGame({ carousel: true }); scene.groundToys(game);
   for (const [x, z] of [[-.8743454896599882, -.09096446216904708], [-.8689965941913619, .03224019320669446], [-.41070862716818013, .73]]) {
    begin(game); game.position = { x, z }; drop(game);
    let lastGrip, firstLift, gripTargets, targetsUnchanged = true;
    for (let i = 0; i < 1000 && game.phase !== 'result'; i++) {
     advance(game, 1 / fps);
     if (game.phase === 'grip') gripTargets ??= [...game.plan.radii];
     scene.update(game, 1 / fps, i / fps, { x: 0, z: 0 }, null);
     const radii = scene.fingers.map(finger => finger.pad.position.x + .017);
     if (game.phase === 'grip') {
      lastGrip = radii;
      targetsUnchanged &&= game.plan.radii.every((r, index) => r === gripTargets[index]);
     }
     if (game.phase === 'lift') firstLift ??= radii;
    }
    transitions.push({ fps, caught: game.plan.prize?.id || null, targetsUnchanged,
     constrained: Math.max(...lastGrip.map((r, i) => r - gripTargets[i])),
     snap: Math.max(...lastGrip.map((r, i) => Math.abs(r - firstLift[i]))) });
   }
  }
  // Contract: a real mesh yields to a glancing hit, stays grounded, and is
  // catchable where it settles. Legacy rocking assertions cannot detect stale
  // catch geometry or a descent that remains latched after the obstacle moves.
  const pushes = []; let pushedGame;
  for (const fps of [60, 30, 10]) {
   const game = createGame({ pushContact: true });
   game.toys = game.toys.filter(t => t.id === 'butter');
   const toy = game.toys[0]; toy.x = toy.z = 0;
   scene.groundToys(game); begin(game); game.position = { x: 0, z: .3 }; drop(game);
   let firstStop, lowestAfterStop = Infinity, minGround = Infinity, maxGround = -Infinity, wallSafe = true;
   for (let i = 0; i < 1000 && game.phase !== 'result'; i++) {
    advance(game, 1 / fps); scene.update(game, 1 / fps, i / fps, { x: 0, z: 0 }, null);
    if (game.phase === 'descend' && toy.restPose) firstStop ??= game.plan.pushDescent.y;
    if (game.phase === 'descend' && firstStop) lowestAfterStop = Math.min(lowestAfterStop, game.plan.pushDescent.y);
    const bounds = scene.toyBounds(toy.id);
    minGround = Math.min(minGround, bounds.min[1] - BED); maxGround = Math.max(maxGround, bounds.min[1] - BED);
    wallSafe &&= bounds.min[0] >= -1.62 && bounds.max[0] <= 1.62 && bounds.min[2] >= -1.10 && bounds.max[2] <= 1.17;
   }
   if (fps === 60) pushedGame = structuredClone(game);
   const firstCaught = game.plan.prize?.id || null;
   const resting = { x: toy.x, z: toy.z, angle: toy.restPose?.angle || 0 };
   begin(game); scene.update(game, 0, 0, { x: 0, z: 0 }, null);
   const persisted = toy.x === resting.x && toy.z === resting.z && toy.restPose?.angle === resting.angle;
   // A later touch must follow its own direction, not the original lean.
   game.position = { x: toy.x, z: toy.z - .3 }; drop(game);
   const beforeOpposite = toy.z;
   const oppositeMoved = scene.contacts.push(game, { toy, point: { x: toy.x + .15, z: toy.z } }, game.position, .012);
   const oppositeYields = oppositeMoved > 0 && toy.z > beforeOpposite && toy.restPose.angle < resting.angle;
   game.phase = 'result'; game.plan = null; begin(game);
   game.position = { x: toy.support?.x ?? toy.x, z: toy.support?.z ?? toy.z }; drop(game);
   let lastGrip, firstLift;
   for (let i = 0; i < 1000 && game.phase !== 'result'; i++) {
    advance(game, 1 / fps); scene.update(game, 1 / fps, i / fps, { x: 0, z: 0 }, null);
    if (game.phase === 'grip') lastGrip = scene.fingers.map(f => f.pad.position.x);
    if (game.phase === 'lift') firstLift ??= scene.fingers.map(f => f.pad.position.x);
   }
   pushes.push({ fps, firstCaught, resting, minGround, maxGround, wallSafe, persisted, resumed: firstStop - lowestAfterStop,
    oppositeYields, recaught: game.plan.prize?.id || null, rounds: game.rounds, collection: [...game.collection],
    snap: Math.max(...lastGrip.map((r, i) => Math.abs(r - firstLift[i]))) });
  }
  const reset = createGame({ pushContact: true }).toys.every(toy => !toy.restPose && !toy.support);
  const crowded = createGame({ pushContact: true });
  crowded.toys = crowded.toys.filter(t => ['butter', 'miso'].includes(t.id));
  Object.assign(crowded.toys.find(t => t.id === 'butter'), { x: 0, z: 0 });
  Object.assign(crowded.toys.find(t => t.id === 'miso'), { x: 0, z: -.62 });
  scene.groundToys(crowded); scene.update(crowded, 0, 0, { x: 0, z: 0 }, null);
  const overlap = () => {
   const a = scene.toyBounds('butter'), b = scene.toyBounds('miso');
   return [0, 1, 2].reduce((volume, axis) => volume * Math.max(0, Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis])), 1);
  };
  const initialOverlap = overlap(); let maxOverlap = initialOverlap;
  begin(crowded); crowded.position = { x: 0, z: .3 }; drop(crowded);
  for (let i = 0; i < 1000 && crowded.phase !== 'result'; i++) {
   advance(crowded, 1 / 60); scene.update(crowded, 1 / 60, i / 60, { x: 0, z: 0 }, null);
   maxOverlap = Math.max(maxOverlap, overlap());
  }
  const neighbour = { initialOverlap, maxOverlap, caught: crowded.plan.prize?.id || null,
   distance: Math.abs(crowded.toys.find(t => t.id === 'butter').z) };
  const pinned = [];
  for (const [name, x, z] of [['top', 0, .41], ['wall', 0, -.34]]) {
   const game = createGame({ pushContact: true }); game.toys = game.toys.filter(t => t.id === 'butter');
   const toy = game.toys[0]; toy.x = 0; toy.z = name === 'wall' ? -.64 : 0;
   scene.groundToys(game); begin(game); game.position = { x, z }; drop(game);
   for (let i = 0; i < 1000 && game.phase !== 'result'; i++) { advance(game, 1 / 60); scene.update(game, 1 / 60, i / 60, { x: 0, z: 0 }, null); }
   pinned.push({ name, caught: game.plan.prize?.id || null, stop: game.plan.stop, bounds: scene.toyBounds(toy.id), displacement: Math.hypot(toy.x, toy.z - (name === 'wall' ? -.64 : 0)) });
  }
  scene.renderer.render=render; if(pushedGame){for(const [id,object] of scene.toys)object.visible=id==='butter';scene.update(pushedGame,0,0,{x:0,z:0},null);scene.inspect('butter');} return { results, transitions, pushes, pinned, reset, neighbour };
 });
 console.log(JSON.stringify(report,null,2)); await page.screenshot({path:'.screenshots/toy-push-contact.png'});
 assert.equal(report.results.find(r=>r.name==='centred').caught,'butter'); assert.equal(report.results.find(r=>r.name==='jackpot').caught,'sprout');
 for(const name of ['side','front']) {const row=report.results.find(r=>r.name===name);assert.equal(row.caught,null);if(name==='front')assert.ok(row.maxTilt>.03,`${name} visible contact reaction`);assert.ok(row.blocked,`${name} mesh descent stop`);assert.ok(row.minGround>-.015);}
 assert.equal(report.results.find(r=>r.name==='empty').maxTilt,0);
 assert.equal(report.results.find(r=>r.name==='push-centred').caught,'butter');
 assert.equal(report.results.find(r=>r.name==='push-jackpot').caught,'sprout');
 assert.ok(report.results.find(r=>r.name==='push-side').displaced.some(t=>t.angle>.03), 'stock layout also yields to an edge hit');
 for (const row of report.pushes) {
  assert.equal(row.firstCaught, null, 'a shove does not award a catch');
  assert.ok(row.resting.z < -.08 && row.resting.angle > .25, `${row.fps} FPS visibly pushes and tips`);
  assert.ok(row.minGround > -.015 && row.maxGround < .015 && row.wallSafe, 'pushed toy rests on the bed without sinking or hovering');
  assert.ok(row.resumed > .05, 'descent continues when the toy yields');
  assert.ok(row.persisted, 'next turn preserves the displaced pose');
  assert.equal(row.recaught, 'butter', `${row.fps} FPS catches the visible displaced toy`);
  assert.ok(row.oppositeYields, 'opposite-side contact pushes back and reduces the old lean');
  assert.equal(row.rounds, 3); assert.deepEqual(row.collection, ['butter']);
  assert.ok(row.snap < 1e-8, 'a tilted catch preserves its finger contacts into lift');
 }
 assert.ok(report.reset, 'new run restocks poses');
 assert.ok(report.neighbour.maxOverlap <= report.neighbour.initialOverlap + .0001, 'pushing does not overlap a neighbour');
 assert.ok(report.neighbour.distance < .19, 'the neighbouring toy limits the shove');
 assert.equal(report.neighbour.caught, null);
 for (const row of report.pinned) {
  assert.equal(row.caught, null); assert.equal(row.stop, 'mesh-contact', `${row.name} resists descent`);
  assert.ok(row.bounds.min[1] >= 1.645 && row.bounds.max[2] <= 1.17);
 }

 for (const fps of [60, 30, 10]) {
  const rows = report.transitions.filter(row => row.fps === fps);
  assert.deepEqual(rows.map(row => row.caught), [null, 'blue-hour', 'butter'], `${fps} FPS preserves the three outcomes`);
  for (const row of rows) {
   assert.ok(row.targetsUnchanged, 'resolved contacts do not feed back into the closing targets');
   if (row.caught) assert.ok(row.constrained > .02, 'the rendered mesh actually limits the grip');
   assert.ok(row.snap < 1e-8, `${fps} FPS ${row.caught || 'miss'} preserves contact at the lift boundary: ${row.snap}`);
  }
 }
} finally {await browser.close();}
