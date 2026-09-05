import test from 'node:test';
import assert from 'node:assert/strict';
import {ClaspGesture} from '../src/clasp.js';

const owner={x:.4,y:.5};
function hand(x,y=.5,size=.12){
  const landmarks=Array.from({length:21},()=>({x,y}));
  landmarks[0]={x,y:y+size/2};landmarks[9]={x,y:y-size/2};
  landmarks[5]={x:x-size/2,y};landmarks[17]={x:x+size/2,y};
  return{center:{x,y},landmarks};
}
const apart=()=>[hand(.4),hand(.7)],together=()=>[hand(.46),hand(.55)];
function run(g,hands,start,count){let state;for(let i=0;i<count;i++)state=g.update(hands(),owner,start+i*65);return state;}
function arm(g){run(g,apart,1000,6);assert.equal(g.armed,true);}

test('apart, together and a deliberate hold fires once',()=>{
  const g=new ClaspGesture();arm(g);
  assert.equal(run(g,together,1390,9).fired,false);
  assert.equal(run(g,together,1975,1).fired,true);
  assert.equal(run(g,together,2040,8).fired,false);
});
test('one hand, overlapping detections and an unarmed clasp cannot drop',()=>{
  for(const hands of [()=>[hand(.4)],()=>[hand(.4),hand(.4)],together]){
    const g=new ClaspGesture();assert.notEqual(run(g,hands,1000,40).fired,true);
  }
});
test('separating hands cancels accumulated hold time',()=>{
  const g=new ClaspGesture();arm(g);run(g,together,1390,6);
  assert.equal(g.update(apart(),owner,1780).progress,0);
  assert.equal(run(g,together,1845,9).fired,false);
});
test('brief occlusion pauses the hold and longer loss cancels it',()=>{
  const g=new ClaspGesture();arm(g);run(g,together,1390,5);const held=g.held;
  assert.equal(g.update([hand(.46)],owner,1715).progress,held/650);
  assert.equal(g.update([hand(.46)],owner,1780).progress,held/650);
  assert.equal(g.update([],owner,2040).active,false);assert.equal(g.armed,false);
  assert.notEqual(run(g,together,2105,20).fired,true);
});
test('distant bystanders and very different palm sizes cannot arm a DROP',()=>{
  for(const hands of [()=>[hand(.8),hand(.95)],()=>[hand(.4),hand(.7,.5,.035)]]){
    const g=new ClaspGesture();run(g,hands,1000,20);assert.equal(g.armed,false);
  }
});
