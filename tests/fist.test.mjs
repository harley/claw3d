import test from 'node:test';
import assert from 'node:assert/strict';
import {FistDrop,fistEvidence} from '../src/fist.js';
import {HandController} from '../src/vision.js';

function landmarks(folded=0,dx=0){
  const points=Array.from({length:21},()=>({x:.5+dx,y:.5,z:0}));
  points[0].y=.66;
  for(const [i,m] of [5,9,13,17].entries()){
    const x=.44+i*.04+dx;
    points[m]={x,y:.51};points[m+1]={x,y:.43};points[m+2]={x,y:.38};
    points[m+3]={x,y:i<folded?.57:.32};
  }
  return points;
}
const open={open:true},closed={closed:true};
function arm(g){for(let t=1000;t<=1260;t+=65)g.update(open,t);assert.equal(g.armed,true);}
test('folded fingers recognize a fist without requiring a particular thumb pose',()=>{
  assert.equal(fistEvidence(landmarks(4),'None').closed,true);
  const loose=landmarks(3);loose[20].y=.44;
  assert.equal(fistEvidence(loose,'None').closed,true);
  assert.equal(fistEvidence(landmarks(3),'Pointing_Up',.9).closed,false);
  assert.equal(fistEvidence(landmarks(1),'None').closed,false);
  assert.equal(fistEvidence(landmarks(0),'None').open,true);
  assert.equal(fistEvidence(landmarks(2),'Closed_Fist',.9).closed,true);
  assert.equal(fistEvidence(landmarks(2),'Closed_Fist',.3).closed,false);
});
test('a fist needs an open hand first and a sustained hold, and fires only once',()=>{
  const g=new FistDrop();for(let t=100;t<1000;t+=65)assert.equal(g.update(closed,t).fired,false);
  g.reset();arm(g);
  for(let t=1325;t<=1780;t+=65)assert.equal(g.update(closed,t).fired,false);
  assert.equal(g.update(closed,1845).fired,true);
  for(let t=1910;t<3000;t+=65)assert.equal(g.update(closed,t).fired,false);
});
test('opening cancels a pending fist without carrying hold time into the next attempt',()=>{
  const g=new FistDrop();arm(g);
  for(let t=1325;t<=1585;t+=65)g.update(closed,t);
  assert.equal(g.update(open,1650).active,false);
  assert.equal(g.update(closed,1715).progress,65/550);
});
test('uncertain frames do not advance the hold and a long loss requires rearming',()=>{
  const g=new FistDrop();arm(g);g.update(closed,1325);const held=g.held;
  assert.equal(g.update({},1390).progress,held/550);
  assert.equal(g.update(closed,1455).progress,held/550);
  assert.equal(g.update(closed,1800).active,false);
  for(let t=1865;t<2900;t+=65)assert.equal(g.update(closed,t).fired,false);
});
test('another hand or disappearance cancels the fist confirmation',()=>{
  for(const evidence of [{visible:false},{}]){
    const g=new FistDrop();arm(g);g.update(closed,1325);
    for(let t=1390;t<=1650;t+=65)g.update(evidence,t);
    assert.equal(g.held,0);assert.equal(g.update(closed,1715).fired,false);
  }
});

function controller(){
  const c=Object.create(HandController.prototype),events={drops:0,starts:0,inputs:[],states:[]};
  let phase='idle';c.getPhase=()=>phase;c.getProfile=()=>'fist';
  c.onInput=input=>events.inputs.push({...input});c.onState=state=>events.states.push(state);
  c.onDrop=()=>events.drops++;c.onStart=()=>{events.starts++;phase='aim';};c.draw=()=>{};c.resetOwner();
  return{c,events};
}
function result(folded=0,dx=0){return{landmarks:[landmarks(folded,dx)],handedness:[[{categoryName:'Right'}]],gestures:[[{categoryName:'None',score:0}]]};}
function claim(c){c.handle(result(),1000);c.handle(result(),1520);for(let t=1585;t<=1845;t+=65)c.handle(result(),t);}
test('camera steering freezes during fist confirmation and drops once',()=>{
  const{c,events}=controller();claim(c);assert.equal(events.starts,1);
  c.handle(result(0,-.06),1910);assert.ok(events.inputs.at(-1).x>0);
  for(let t=1975;t<=2495;t+=65){c.handle(result(4,-.06),t);assert.deepEqual(events.inputs.at(-1),{x:0,z:0});}
  assert.equal(events.drops,1);c.handle(result(4,-.06),2560);assert.equal(events.drops,1);
});
test('opening after a partial fist recentres the joystick without a jump',()=>{
  const{c,events}=controller();claim(c);
  c.handle(result(0,-.06),1910);c.handle(result(4,-.06),1975);c.handle(result(4,-.07),2040);
  c.handle(result(0,-.07),2105);assert.deepEqual(events.inputs.at(-1),{x:0,z:0});assert.equal(events.drops,0);
  c.handle(result(0,-.12),2170);assert.ok(events.inputs.at(-1).x>0);
});
test('an already closed hand cannot claim the machine',()=>{
  const{c,events}=controller();for(let t=1000;t<3000;t+=65)c.handle(result(4),t);
  assert.equal(events.starts,0);assert.equal(events.drops,0);
});
