import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
const browser = await chromium.launch(browserOptions);
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 await page.goto('http://127.0.0.1:4196'); await page.waitForFunction(() => window.__littleCloud);
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
  scene.renderer.render=render; if(peakGame){scene.update(peakGame,0,0,{x:0,z:0},null);scene.inspect('butter');} return results;
 });
 console.log(JSON.stringify(report,null,2)); await page.screenshot({path:'.screenshots/toy-contact.png'});
 assert.equal(report.find(r=>r.name==='centred').caught,'butter'); assert.equal(report.find(r=>r.name==='jackpot').caught,'sprout');
 for(const name of ['side','front']) {const row=report.find(r=>r.name===name);assert.equal(row.caught,null);if(name==='front')assert.ok(row.maxTilt>.03,`${name} visible contact reaction`);assert.ok(row.blocked,`${name} mesh descent stop`);assert.ok(row.minGround>-.015);}
 assert.equal(report.find(r=>r.name==='empty').maxTilt,0);
} finally {await browser.close();}
