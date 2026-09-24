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
  const results = []; let peakGame;
  for (const [name, x, z, time] of [['centred',-.38,.72,0],['jackpot',.8,.22,CAROUSEL.period-CONTACT_DELAY],['side',-.18,.72,0],['front',-.03,.40,0],['empty',-1.12,.66,0]]) {
   const game = createGame({ carousel: true }); scene.groundToys(game); begin(game); moveCarousel(game,time); game.position={x,z}; drop(game);
   let maxTilt=0,blocked=false,minGround=Infinity,peak=null;
   for(let i=0;i<1000&&game.phase!=='result';i++) {
    advance(game,1/60); scene.update(game,1/60,i/60,{x:0,z:0},null); blocked ||= Boolean(game.plan.blockedDescent);
    for(const toy of game.toys) if(toy.impact) {
     if(toy.impact.angle>maxTilt){maxTilt=toy.impact.angle;peak={phase:game.phase,elapsed:game.elapsed};if(name==='front')peakGame=structuredClone(game);}
     const bounds=scene.toyBounds(toy.id); minGround=Math.min(minGround,bounds.min[1]-BED-(toy.elevation||0));
    }
   }
   results.push({name,impacts:game.toys.filter(t=>t.impact).map(t=>({id:t.id,...t.impact})),caught:game.plan.prize?.id||null,maxTilt,blocked,minGround:Number.isFinite(minGround)?minGround:null,peak});
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
  scene.renderer.render=render; if(peakGame){scene.update(peakGame,0,0,{x:0,z:0},null);scene.inspect('butter');} return { results, transitions };
 });
 console.log(JSON.stringify(report,null,2)); await page.screenshot({path:'.screenshots/toy-contact.png'});
 assert.equal(report.results.find(r=>r.name==='centred').caught,'butter'); assert.equal(report.results.find(r=>r.name==='jackpot').caught,'sprout');
 for(const name of ['side','front']) {const row=report.results.find(r=>r.name===name);assert.equal(row.caught,null);if(name==='front')assert.ok(row.maxTilt>.03,`${name} visible contact reaction`);assert.ok(row.blocked,`${name} mesh descent stop`);assert.ok(row.minGround>-.015);}
 assert.equal(report.results.find(r=>r.name==='empty').maxTilt,0);
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
