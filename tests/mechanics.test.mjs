import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, moveClaw, findCatch, pinchRatio, joystickAxis, matchHand } from '../src/mechanics.js';
import { HandController } from '../src/vision.js';

test('movement stays within the actual prize bed, including an extreme input',()=>{
  assert.deepEqual(moveClaw({x:1.2,z:-.8},{x:500,z:-500},10),{x:FIELD.maxX,z:FIELD.minZ});
  assert.deepEqual(moveClaw({x:.2,z:.1},{x:0,z:0},10),{x:.2,z:.1});
});

test('empty space never awards a prize, and the closest eligible prize wins',()=>{
  const a={id:'a',x:0,z:0,catchRadius:.24},b={id:'b',x:.4,z:0,catchRadius:.24};
  assert.equal(findCatch({x:1,z:1},[a,b]),null);
  assert.equal(findCatch({x:.23,z:0},[a,b]),b);
  assert.equal(findCatch({x:0,z:0},[{...a,claimed:true}]),null);
  assert.equal(findCatch({x:.241,z:0},[a]),null);
  assert.equal(findCatch({x:.24,z:0},[a]),a);
});

test('joystick has a steady neutral zone and clamps its travel',()=>{
  assert.equal(joystickAxis(.01),0);assert.equal(joystickAxis(-.01),0);
  assert.equal(joystickAxis(.34),1);assert.equal(joystickAxis(-.34),-1);
});

test('a pinch uses palm-relative scale, not distance from the camera',()=>{
  const landmarks=Array.from({length:21},()=>({x:0,y:0}));
  landmarks[5]={x:0,y:0};landmarks[17]={x:.2,y:0};landmarks[4]={x:0,y:.1};landmarks[8]={x:.03,y:.1};
  assert.equal(pinchRatio(landmarks),.15);
  assert.equal(pinchRatio(landmarks.map(p=>({x:p.x*2,y:p.y*2}))),.15);
  assert.equal(pinchRatio(Array.from({length:21},()=>({x:0,y:0}))),Infinity);
});

test('hand ownership rejects other handedness, distant hands, and ambiguous matches',()=>{
  const owner={x:.5,y:.5};const hand={center:{x:.52,y:.51},handedness:'Right'};
  assert.equal(matchHand([hand],owner,'Right'),hand);
  assert.equal(matchHand([hand],owner,'Left'),null);
  assert.equal(matchHand([{...hand,center:{x:.9,y:.9}}],owner,'Right'),null);
  assert.equal(matchHand([hand,{...hand,center:{x:.55,y:.51}}],owner,'Right'),null);
});

function result({pinch=true,open=false,dx=0}={}){
  const landmarks=Array.from({length:21},()=>({x:.5+dx,y:.5,z:0}));
  landmarks[0]={x:.5+dx,y:.6};landmarks[9]={x:.5+dx,y:.45};
  landmarks[5]={x:.43+dx,y:.45};landmarks[17]={x:.57+dx,y:.45};
  landmarks[4]={x:.49+dx,y:.4};landmarks[8]={x:(pinch?.50:.67)+dx,y:.4};
  return {landmarks:[landmarks],handedness:[[{categoryName:'Right'}]],gestures:[[{categoryName:open?'Open_Palm':'None',score:.95}]]};
}
function controller(){
  const c=Object.create(HandController.prototype);const events={starts:0,drops:0,inputs:[],states:[]};
  let phase='idle';c.getPhase=()=>phase;c.onInput=input=>events.inputs.push({...input});
  c.onState=state=>events.states.push(state);c.onStart=()=>{events.starts++;phase='aim';};c.onDrop=()=>events.drops++;
  c.draw=()=>{};c.resetOwner();return{c,events};
}

test('claiming the joystick requires a stable half-second pinch',()=>{
  const{c,events}=controller();c.handle(result(),1000);c.handle(result(),1499);assert.equal(events.starts,0);
  c.handle(result(),1501);assert.equal(events.starts,1);c.handle(result(),1700);assert.equal(events.starts,1);
});

test('a second visible hand prevents a new player from claiming control',()=>{
  const{c,events}=controller();const two=result();two.landmarks.push(two.landmarks[0]);two.handedness.push(two.handedness[0]);two.gestures.push(two.gestures[0]);
  c.handle(two,1000);c.handle(two,1700);assert.equal(events.starts,0);
});

test('opening a palm must be deliberate and cannot fire repeated drops',()=>{
  const{c,events}=controller();c.handle(result(),1000);c.handle(result(),1501);
  c.handle(result({pinch:false,open:true}),1600);c.handle(result({pinch:false,open:true}),2399);assert.equal(events.drops,0);
  c.handle(result({pinch:false,open:true}),2401);c.handle(result({pinch:false,open:true}),3400);assert.equal(events.drops,1);
});

test('losing the hand stops movement and cancels a pending DROP gesture',()=>{
  const{c,events}=controller();c.handle(result(),1000);c.handle(result(),1501);
  c.handle(result({dx:-.05}),1600);assert.ok(events.inputs.at(-1).x>0);
  c.handle(result({pinch:false,open:true}),1700);
  c.handle({landmarks:[],handedness:[],gestures:[]},2300);assert.deepEqual(events.inputs.at(-1),{x:0,z:0});assert.equal(events.states.at(-1).kind,'lost');
  c.handle(result({pinch:false,open:true}),2400);c.handle(result({pinch:false,open:true}),2600);assert.equal(events.drops,0);
});

test('re-grabbing after release recalibrates neutral instead of jumping',()=>{
  const{c,events}=controller();c.handle(result(),1000);c.handle(result(),1501);c.handle(result({dx:-.05}),1600);
  c.handle(result({pinch:false,dx:-.05}),1700);assert.deepEqual(events.inputs.at(-1),{x:0,z:0});
  c.handle(result({dx:-.06}),1800);assert.deepEqual(events.inputs.at(-1),{x:0,z:0});
});

test('a single-frame handedness flip does not lose the same spatial hand',()=>{
  const{c,events}=controller();c.handle(result(),1000);c.handle(result(),1501);
  const frame=result({dx:-.04});frame.handedness[0][0].categoryName='Left';
  c.handle(frame,1600);assert.notEqual(events.states.at(-1).kind,'lost');
  assert.ok(events.inputs.at(-1).x>0);
});

test('a slightly loosened pinch keeps the same joystick neutral',()=>{
  const{c,events}=controller();c.handle(result(),1000);c.handle(result(),1501);
  c.handle(result({dx:-.04}),1600);
  const relaxed=result({dx:-.05});relaxed.landmarks[0][8].x=relaxed.landmarks[0][4].x+.07;
  c.handle(relaxed,1700);assert.ok(events.inputs.at(-1).x>0);
  c.handle(result({dx:-.06}),1800);assert.ok(events.inputs.at(-1).x>.1);
});

test('easy mode claims and steers with a relaxed hand without auto-dropping',()=>{
  const{c,events}=controller();c.getProfile=()=>'palm';
  c.handle(result({pinch:false,open:true}),1000);c.handle(result({pinch:false,open:true}),1501);
  assert.equal(events.starts,1);
  c.handle(result({pinch:false,open:true,dx:-.06}),1700);assert.ok(events.inputs.at(-1).x>0);
  c.handle(result({pinch:false,open:true,dx:-.06}),2700);assert.equal(events.drops,0);
});

for(const profile of ['clasp','fist'])test(`${profile} profile: two-hand clasp freezes steering, drops once, and resumes safely after cancellation`,()=>{
  const{c,events}=controller();c.getProfile=()=>profile;
  c.handle(result({pinch:false}),1000);c.handle(result({pinch:false}),1501);
  const pair=(a,b)=>{
    const frame=result({pinch:false,dx:a}),second=result({pinch:false,dx:b});
    frame.landmarks.push(second.landmarks[0]);frame.handedness.push([{categoryName:'Left'}]);frame.gestures.push(second.gestures[0]);return frame;
  };
  for(let t=1600;t<=1990;t+=65)c.handle(pair(0,-.30),t);
  assert.deepEqual(events.inputs.at(-1),{x:0,z:0});assert.equal(events.states.at(-1).kind,'clasping');
  for(let t=2055;t<=2705;t+=65)c.handle(pair(-.08,-.19),t);
  assert.equal(events.drops,1);c.handle(pair(-.08,-.19),2800);assert.equal(events.drops,1);
  c.resetOwner();c.handle(result({pinch:false}),3000);c.handle(result({pinch:false}),3501);
  c.handle(pair(0,-.30),3600);c.handle(result({pinch:false}),4000);
  assert.deepEqual(events.inputs.at(-1),{x:0,z:0});assert.equal(events.states.at(-1).kind,'tracking');
  c.handle(result({pinch:false,dx:-.06}),4100);assert.ok(events.inputs.at(-1).x>0);
});
