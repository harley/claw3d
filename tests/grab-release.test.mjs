import test from 'node:test';
import assert from 'node:assert/strict';
import { GrabRelease } from '../src/grab-release.js';
const open = {open:true,overTarget:true}, closed={closed:true,overTarget:true};
function fixture() {
 const g=new GrabRelease(); let now=0;
 const step=(sample,gap=65)=>g.update(sample,now+=gap);
 const repeat=(sample,n=5)=>{let r;for(let i=0;i<n;i++)r=step(sample);return r;};
 const grab=()=>{repeat(open);assert.equal(repeat(closed).stage,'gripped');};
 return {g,step,repeat,grab};
}
test('release stops steering but never drops; a fresh button clench drops once',()=>{
 const f=fixture();f.grab();assert.equal(f.step(open).steering,false);
 assert.equal(f.repeat(open).fired,false);
 const press={closed:true,overDrop:true}; f.step(press);
 assert.equal(f.repeat(press,2).fired,false);assert.equal(f.step(press).fired,true);
 assert.equal(f.repeat(press).fired,false);
});
test('a held fist cannot sweep onto either control',()=>{
 for(const target of ['overDrop','overTarget']) {
  const f=fixture();f.repeat(open);f.step({closed:true});
  assert.equal(f.repeat({closed:true,[target]:true}).stage,'seeking');
 }
});
test('press target cannot change while clenched',()=>{
 const f=fixture();f.repeat(open);f.step(closed);
 assert.equal(f.repeat({closed:true,overDrop:true}).fired,false);
});
for(const loss of ['missing','uncertain','stale'])test(`${loss} cancels attachment and button confirmation`,()=>{
 for(const press of [false,true]) {
  const f=fixture(); if(press){f.repeat(open);f.step({closed:true,overDrop:true});}else f.grab();
  if(loss==='missing')f.step({visible:false});else if(loss==='stale')f.step(closed,350);else f.repeat({},4);
  assert.equal(f.repeat(open).fired,false);assert.equal(f.g.stage,'seeking');
 }
});
test('a deliberate downward open-hand strike onto DROP fires once',()=>{
 const f=fixture();f.repeat(open);
 f.step({open:true,aboveDrop:true,point:{x:.6,y:.4}});
 assert.equal(f.step({open:true,overDrop:true,point:{x:.6,y:.47}}).fired,true);
 assert.equal(f.repeat({open:true,overDrop:true,point:{x:.6,y:.47}}).fired,false);
});
for(const action of ['slow','sideways','missing','uncertain','stale','unarmed'])test(`${action} is not a slam`,()=>{
 const f=fixture();if(action!=='unarmed')f.repeat(open);
 if(action!=='sideways')f.step({open:true,aboveDrop:true,point:{x:.6,y:.4}});
 if(action==='missing')f.step({visible:false});
 if(action==='uncertain')f.step({});
 const r=f.step({open:true,overDrop:true,point:{x:.6,y:.47}},action==='slow'?250:action==='stale'?400:65);
 assert.equal(r.fired,false);
});

import { HandController } from '../src/vision.js';
function cameraFixture() {
 const c=Object.create(HandController.prototype);let time=1000,phase='aim',profile='grab-release',target='stick',drops=0;
 c.getPhase=()=>phase;c.getControlProfile=()=>profile;c.getControlTarget=()=>({overTarget:target==='stick',overDrop:target==='drop'});
 c.onDrop=()=>{drops++;return true;};c.onInput=()=>{};c.onState=()=>{};c.draw=()=>{};c.resetOwner();
 const sample=(kind='open',x=.5)=>{
  const points=Array.from({length:21},()=>({x:1-x,y:.5,z:0}));points[0].y=.56;points[9].y=.44;points[5].x-=.06;points[17].x+=.06;
  c.handle({landmarks:[points],handedness:[[{categoryName:'Left'}]],gestures:[[{categoryName:kind==='open'?'Open_Palm':'Closed_Fist',score:.99}]]},time+=65);
 };
 const repeat=(kind,n=5,x=.5)=>{for(let i=0;i<n;i++)sample(kind,x);};repeat('open',15);
 return {c,sample,repeat,drops:()=>drops,phase:v=>phase=v,profile:v=>profile=v,target:v=>target=v};
}
test('real handler steers a fist, releases safely, and accepts a fresh button press',()=>{
 const f=cameraFixture();f.repeat('closed');assert.deepEqual(f.c.input,{x:0,z:0});
 f.repeat('closed',5,.57);assert.ok(f.c.input.x>0);
 f.sample('open',.57);assert.deepEqual(f.c.input,{x:0,z:0});assert.equal(f.drops(),0);
 f.repeat('open');f.target('drop');f.repeat('closed');assert.equal(f.drops(),1);
});
for(const boundary of ['pause','profile','delay'])test(`${boundary} clears a pending real-handler press`,()=>{
 const f=cameraFixture();f.target('drop');f.sample('closed');
 if(boundary==='pause'){f.phase('blocked');f.sample('closed');f.phase('aim');}
 if(boundary==='profile'){f.profile('hold-drop');f.sample('closed');f.profile('grab-release');}
 if(boundary==='delay')f.c.delayTracking();
 f.repeat('closed');assert.equal(f.drops(),0);
});

import { createGame, begin, drop, advance, moveCarousel, CAROUSEL, CONTACT_DELAY, carouselCue } from '../src/arcade-mechanics.js';
test('button cue catches the star with either instant contact or confirmed clench',()=>{
 const cueTime=CAROUSEL.period-CONTACT_DELAY-.15;
 assert.equal(carouselCue(cueTime,.15).now,true);
 for(const delay of [0,.15]) {
  const g=createGame({carousel:true});begin(g);moveCarousel(g,cueTime+delay);
  g.position={x:CAROUSEL.x,z:CAROUSEL.z+CAROUSEL.radius};drop(g);advance(g,CONTACT_DELAY);
  assert.equal(g.plan.prize?.id,CAROUSEL.id);
 }
});
