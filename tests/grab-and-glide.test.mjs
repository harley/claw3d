import test from 'node:test';
import assert from 'node:assert/strict';
import { GlideGame, GATE, TRAY } from '../src/grab-and-glide/game.js';
import { GlideInput } from '../src/grab-and-glide/input.js';
const start = () => { const g = new GlideGame(); g.start(); return g; };
const grab = (g, id = 'bear') => { const t = g.toys.find(t => t.id === id); g.move(t, true); g.grab(); assert.equal(g.phase, 'carry'); };
test('three attempts, one result per action, banked toys unavailable, replay clears all', () => {
  const g = start(); grab(g); g.move(TRAY, true); g.release(); g.release(); assert.equal(g.score, 100); assert.equal(g.results.length, 1);
  g.next(); grab(g, 'star'); g.release(); assert.equal(g.event.kind, 'drop'); g.next(); g.move({x:0,y:-2}); g.grab(); g.grab(); g.next();
  assert.equal(g.phase, 'result'); assert.equal(g.results.length, 3); assert.equal(g.score, 100); g.start(); assert.equal(g.score, 0); assert.equal(g.results.length, 0);
});
test('visible aperture contains the complete footprint; hard toy is tighter, no snapping', () => {
  for (const id of ['bear','bunny','star']) { const g = start(), t = g.toys.find(t => t.id === id); g.move({x:t.x+t.aperture-t.radius+.001,y:t.y}); assert.equal(g.target(),null); g.move({x:t.x+.1,y:t.y}); const p = {...g.position}; g.grab(); assert.deepEqual(g.position,p); assert.equal(g.cargo.x,t.x); }
});
test('whole cargo must fit tray; early release and timeout finish one attempt', () => {
  const g = start(); grab(g); g.move({x:TRAY.x+TRAY.halfX-.2,y:TRAY.y},true); assert.equal(g.canBank(),false); g.release(); assert.equal(g.score,0); g.tick(20); assert.equal(g.results.length,1);
  g.next(); g.tick(15); assert.equal(g.event.kind,'timeout'); assert.equal(g.results.length,2);
});
test('clean full-footprint traversal awards 50 only on bank and once', () => {
  for (const bank of [true,false]) { const g = start(); grab(g); g.move({x:-2,y:GATE.y},true); g.move({x:2,y:GATE.y},true); assert.equal(g.gate,'clean'); g.move(bank?TRAY:{x:2,y:-2},true); g.release(); assert.equal(g.score,bank?150:0); }
});
test('swept gate contact forfeits bonus, preserves cargo; around rail is not traversal', () => {
  const g = start(); grab(g); g.move({x:-2,y:GATE.y+.5},true); g.move({x:2,y:GATE.y+.5},true); assert.equal(g.gate,'failed'); assert.equal(g.phase,'carry'); g.move(TRAY,true); g.release(); assert.equal(g.score,100);
  const safe = start(); grab(safe); safe.move({x:-2,y:-1},true); safe.move({x:2,y:-1},true); assert.equal(safe.gate,'available');
});
function inputFixture() {
  const g = start(), i = new GlideInput(g); let now = 1000;
  const sample = (pose='open',extra={}) => { now += 65; i.sample({valid:true,at:now,point:{x:.5,y:.5},open:pose==='open',closed:pose==='closed',...extra},now,true); };
  const hold = (pose,n=6) => {for(let j=0;j<n;j++)sample(pose);};
  return {g,i,sample,hold,now:()=>now};
}
test('confirmation uses fresh timestamps, freezes pose before shape change and fires once', () => {
  const f=inputFixture(); f.g.move(f.g.toys[0]); f.hold('open'); const p={...f.g.position}; f.sample('closed',{point:{x:.8,y:.2}}); assert.deepEqual(f.g.position,p); assert.equal(f.g.phase,'position'); f.hold('closed'); assert.equal(f.g.phase,'carry'); assert.deepEqual(f.g.position,p); f.hold('closed'); assert.equal(f.g.results.length,0);
});
for(const loss of ['missing','ambiguous','stale','duplicate','out-of-order','future','gap'])test(`${loss} never releases; safe rearm preserves cargo and clock`,()=>{
  const f=inputFixture(); grab(f.g); f.hold('closed'); f.sample('open');
  if(loss==='missing')f.sample('open',{valid:false});
  if(loss==='ambiguous')f.sample('open',{closed:true});
  if(loss==='stale')f.sample('open',{at:f.now()-500});
  if(loss==='duplicate')f.sample('open',{at:f.now()});
  if(loss==='out-of-order')f.sample('open',{at:f.now()-1});
  if(loss==='future')f.sample('open',{at:f.now()+1000});
  if(loss==='gap')f.i.tick(f.now()+500,.5);
  const cargo={...f.g.cargo}, time=f.g.remaining; f.i.tick(f.now()+600,1); assert.equal(f.g.remaining,time);
  f.hold('open',12); assert.equal(f.g.phase,'carry'); assert.deepEqual(f.g.cargo,cargo); assert.equal(f.i.armed,false);
  f.hold('closed'); assert.equal(f.i.armed,true); assert.deepEqual(f.g.cargo,cargo); f.hold('open'); assert.equal(f.g.results.length,1);
});
test('reset at attempt/replay boundary rejects a carried-over closed pose',()=>{
  const f=inputFixture(); f.hold('open'); f.sample('closed'); f.i.reset(); f.hold('closed'); assert.equal(f.g.results.length,0); assert.equal(f.i.armed,false);
});

import { GlideCamera } from '../src/grab-and-glide/camera.js';
// Exercise the actual inherited ownership/classifier path, with synthetic landmarks.
function realCameraFixture(handedness='Left') {
  const game=start(), input=new GlideInput(game); let at=1000, camera;
  const originalDocument=globalThis.document;
  globalThis.document={addEventListener(){}};
  try {
    camera=new GlideCamera({video:null,overlay:null,select:{addEventListener(){}},onStatus:()=>{},onEvidence:e=>input.sample(e,at,true)});
  } finally {
    if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  }
  assert.equal(camera.maxHands,2,'real constructor requests enough observations to detect ambiguity');
  camera.draw=()=>{};camera.running=true;camera.generation=1;
  const sample=(pose='open',count=1)=>{
    at+=65;const points=Array.from({length:21},()=>({x:.5,y:.5,z:0}));points[0].y=.56;points[9].y=.44;points[5].x-=.06;points[17].x+=.06;
    const result={landmarks:Array.from({length:count},()=>points),handedness:Array.from({length:count},()=>[{categoryName:handedness,score:.99}]),gestures:Array.from({length:count},()=>[{categoryName:pose==='open'?'Open_Palm':'Closed_Fist',score:.99}])};
    camera.acceptResult(result,at,1,at);
  };
  const hold=(pose,n=15,count=1)=>{for(let j=0;j<n;j++)sample(pose,count);};
  return {game,input,camera,hold,sample};
}
for(const hand of ['Left','Right'])test(`production camera ownership works with ${hand}; reacquired open cannot drop cargo`,()=>{
  const f=realCameraFixture(hand);f.game.move(f.game.toys[0]);f.hold('open');assert.equal(f.input.armed,true);f.hold('closed',6);assert.equal(f.game.phase,'carry');
  f.hold('open',15,0);assert.equal(f.input.armed,false);const cargo={...f.game.cargo};f.hold('open',25);assert.equal(f.game.phase,'carry');assert.equal(f.input.armed,false);assert.deepEqual(f.game.cargo,cargo);
  f.hold('closed',6);assert.equal(f.input.armed,true);f.hold('open',6);assert.equal(f.game.results.length,1);
});
test('production camera rejects a second hand and old-generation results without an outcome',()=>{
  const f=realCameraFixture();f.game.move(f.game.toys[0]);f.hold('open');f.sample('closed');f.sample('open',2);f.hold('closed',8);assert.equal(f.game.phase,'position');assert.equal(f.input.armed,false);
  f.hold('open');assert.equal(f.input.armed,true);f.camera.acceptResult({},100,0,200);assert.equal(f.input.armed,false);assert.equal(f.game.results.length,0);
});
test('active clock uses elapsed time and silent tracking expiry freezes it',()=>{
  const f=inputFixture();f.hold('open');f.i.tick(f.now(),.2);assert.equal(f.g.remaining,14.8);const time=f.g.remaining;f.i.tick(f.now()+301,.301);assert.equal(f.g.remaining,time);assert.equal(f.i.armed,false);
});
test('brief intermediate hand shapes freeze motion/time but permit deliberate grab/release',()=>{
  const f=inputFixture();f.g.move(f.g.toys[0]);f.hold('open');const p={...f.g.position};
  f.sample('uncertain',{point:{x:.8,y:.2}});assert.equal(f.i.valid,false);assert.equal(f.i.armed,true);assert.deepEqual(f.g.position,p);
  f.i.tick(f.now(),.065);assert.equal(f.g.remaining,15);f.hold('closed');assert.equal(f.g.phase,'carry');
  f.sample('uncertain');assert.equal(f.g.phase,'carry');f.hold('open');assert.equal(f.g.results.length,1);
});
test('sustained uncertain pose requires explicit rearm and cannot release cargo',()=>{
  const f=inputFixture();grab(f.g);f.hold('closed');f.hold('uncertain');assert.equal(f.i.armed,false);f.hold('open');assert.equal(f.g.phase,'carry');
});
test('gate corners respect visible circular clearance, including a swept near miss',()=>{
  const g=start();grab(g);g.move({x:-1.8,y:-.5},true);g.move({x:-.63,y:.19},true);assert.equal(g.gate,'available','diagonal clearance is not a square expanded hitbox');
  g.move({x:-.48,y:.34},true);assert.equal(g.gate,'failed','actual circular contact with the lower-left corner counts');
});
test('sparse evidence cannot bridge uncertainty beyond its grace period',()=>{
  const f=inputFixture();grab(f.g);f.hold('closed');f.sample('uncertain');
  const at=f.now()+250;
  f.i.sample({at,point:{x:.5,y:.5},valid:true,open:true,closed:false},at,true);
  assert.equal(f.i.armed,false);assert.equal(f.g.phase,'carry');
});
