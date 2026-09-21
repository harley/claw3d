import test from 'node:test';
import assert from 'node:assert/strict';
import { DualHandControls } from '../src/dual-hand-controls.js';
import { HandController } from '../src/vision.js';

const hand = (physicalHand, kind = 'open', x = physicalHand === 'left' ? .35 : .65, y = .6) => ({
  physicalHand, handednessScore: .99, center: { x, y }, fist: { open: kind === 'open', closed: kind === 'closed' },
});
const target = p => ({ overTarget: p.x < .5, overDrop: p.x > .5 && p.y >= .6, aboveDrop: p.x > .5 && p.y < .6 });
function fixture() {
  const controls = new DualHandControls(); let now = 0;
  const step = (hands, gap = 65) => controls.update(hands, now += gap, target);
  const repeat = (hands, n = 10) => { let result; for (let i = 0; i < n; i++) result = step(hands); return result; };
  const left = hand('left', 'closed');
  const grip = () => { repeat([hand('left')]); assert.equal(repeat([left], 5).hands.left.grab.stage, 'gripped'); };
  const arm = () => { grip(); repeat([left, hand('right')]); };
  return { controls, step, repeat, left, grip, arm };
}
test('right enters closed without interrupting left steering or dropping', () => {
  const f = fixture(); f.grip();
  const s = f.repeat([hand('left', 'closed', .30), hand('right', 'closed')]);
  assert.ok(s.input.x < 0); assert.equal(s.fired, false); assert.equal(s.hands.right.ready, false);
});
test('independent fresh right clench accepts once and locks input on that frame', () => {
  const f = fixture(); f.arm(); const hands = [f.left, hand('right', 'closed')];
  assert.equal(f.step(hands).fired, false); assert.equal(f.repeat(hands, 2).fired, false);
  const s = f.step(hands); assert.equal(s.fired, true); assert.deepEqual(s.input, {x:0,z:0});
  assert.equal(f.repeat(hands).fired, false);
});
test('right loss cancels its press but left continues steering', () => {
  const f = fixture(); f.arm(); f.step([f.left, hand('right','closed')]);
  assert.ok(f.repeat([hand('left','closed',.30)], 4).input.x < 0);
  assert.equal(f.repeat([f.left,hand('right','closed')]).fired,false);
  f.repeat([f.left,hand('right')]); assert.equal(f.repeat([f.left,hand('right','closed')],4).fired,true);
});
for (const loss of ['missing','uncertain','low-confidence','stale']) test(`${loss} left cancels right press and requires fresh intent`, () => {
  const f=fixture();f.arm();f.step([f.left,hand('right','closed')]);
  const left = loss==='missing'?[]:[loss==='uncertain'?hand('left','uncertain'):loss==='low-confidence'?{...f.left,handednessScore:.4}:f.left];
  const s=f.step([...left,hand('right','closed')],loss==='stale'?350:65);
  assert.deepEqual(s.input,{x:0,z:0});assert.equal(s.fired,false);
  assert.equal(f.repeat([f.left,hand('right','closed')]).fired,false);
  f.repeat([hand('left'),hand('right')]); f.repeat([f.left,hand('right')]);
  assert.equal(f.repeat([f.left,hand('right','closed')],4).fired,true);
});
for (const ambiguity of ['labels','crossing','duplicate','third']) test(`${ambiguity} cannot transfer roles or drop`,()=>{
  const f=fixture();f.arm();f.step([f.left,hand('right','closed')]);
  const hands=ambiguity==='labels'?[hand('right','closed',.35),hand('left','closed',.65)]:ambiguity==='crossing'?[hand('left','closed',.49),hand('right','closed',.51)]:ambiguity==='duplicate'?[f.left,hand('left','closed',.65)]:[f.left,hand('right','closed'),hand('right','closed',.8)];
  const s=f.step(hands);assert.equal(s.fired,false);assert.deepEqual(s.input,{x:0,z:0});
  assert.equal(f.repeat([f.left,hand('right','closed')]).fired,false);
});
test('only an armed right hand can slam; right loss discards its approach',()=>{
  for(const interrupted of [false,true]){
    const f=fixture();f.arm();f.step([f.left,hand('right','open',.65,.50)]);
    if(interrupted)f.step([f.left]);
    assert.equal(f.step([f.left,hand('right','open',.65,.62)]).fired,!interrupted);
  }
});

function cameraFixture() {
  const c=Object.create(HandController.prototype);let time=1000,phase='aim',profile='dual',drops=0;
  c.getPhase=()=>phase;c.getControlProfile=()=>profile;c.getControlTarget=target;
  c.onDrop=()=>{drops++;return true;};c.onInput=()=>{};c.onState=state=>c.state=state;c.draw=()=>{};c.resetOwner();
  const sample=(hands)=>{
    const result={landmarks:[],handedness:[],gestures:[]};
    for(const h of hands){
      const {x,y}=h.center,points=Array.from({length:21},()=>({x:1-x,y,z:0}));
      points[0].y+=.06;points[9].y-=.06;points[5].x-=.06;points[17].x+=.06;
      result.landmarks.push(points);
      result.handedness.push([{categoryName:h.physicalHand==='left'?'Left':'Right',score:h.handednessScore}]);
      result.gestures.push([{categoryName:h.fist.open?'Open_Palm':h.fist.closed?'Closed_Fist':'None',score:.99}]);
    }
    c.handle(result,time+=65); return c.state;
  };
  const repeat=(hands,n=10)=>{let s;for(let i=0;i<n;i++)s=sample(hands);return s;};
  const arm=()=>{repeat([hand('left')]);repeat([hand('left','closed')],5);repeat([hand('left','closed'),hand('right')]);};
  return {c,sample,repeat,arm,drops:()=>drops,phase:v=>phase=v,profile:v=>profile=v};
}
test('real camera controller normalizes roles and accepts an independent right clench once',()=>{
  const f=cameraFixture();f.arm();
  assert.equal(f.c.state.hands.left.grab.stage,'gripped');assert.equal(f.c.state.hands.right.ready,true);
  f.repeat([hand('left','closed'),hand('right','closed')]);assert.equal(f.drops(),1);
});
for(const boundary of ['pause','profile','delay'])test(`${boundary} clears real two-hand press evidence`,()=>{
  const f=cameraFixture();f.arm();const hands=[hand('left','closed'),hand('right','closed')];f.sample(hands);
  if(boundary==='pause'){f.phase('blocked');f.sample(hands);f.phase('aim');}
  if(boundary==='profile'){f.profile('hold-drop');f.sample(hands);f.profile('dual');}
  if(boundary==='delay')f.c.delayTracking();
  f.repeat(hands);assert.equal(f.drops(),0);
});

test('a closed entering right hand cannot inherit a lost left role after a label flip',()=>{
  const f=fixture();f.grip();f.repeat([f.left,hand('right','closed',.49)]);
  const s=f.step([hand('left','closed',.49)]);
  assert.deepEqual(s.input,{x:0,z:0});assert.equal(s.fired,false);assert.equal(s.kind,'lost');
});

test('one uncertain right sample cancels confirmation until a fresh open-to-closed gesture',()=>{
  const f=fixture();f.arm();const hands=[f.left,hand('right','closed')];
  f.repeat(hands,3);f.step([f.left,hand('right','uncertain')]);
  assert.equal(f.repeat(hands,4).fired,false);
  assert.equal(f.controls.right.gesture.stage,'seeking');
  f.repeat([f.left,hand('right')]);assert.equal(f.repeat(hands,4).fired,true);
});

// Recorded from the installed model on a public, visibly right-handed image
// and its horizontal flip through both actual runtimes. Unlike the synthetic
// fixture above, these labels are independent of our role mapping assumption.
import { readFileSync } from 'node:fs';
const knownHands = JSON.parse(readFileSync(new URL('./fixtures/handedness-model-results.json', import.meta.url), 'utf8'));
for (const { physicalHand, result } of knownHands.cases) test(`real model ${physicalHand} output routes to the same anatomical role`, () => {
  const f = cameraFixture();
  for (let i = 0; i < 12; i++) f.c.handle(result, 3000 + i * 65);
  const other = physicalHand === 'left' ? 'right' : 'left';
  assert.ok(f.c.state.hands[physicalHand].pointer);
  assert.equal(f.c.state.hands[other].pointer, null);
  const landmarks = result.landmarks[0];
  assert.equal(f.c.state.hands[physicalHand].pointer.x, 1 - (landmarks[0].x + landmarks[9].x) / 2, 'only cursor x is mirrored');
  assert.equal(f.drops(), 0);
});


test('acquisition seeds each local workspace at a comfortable separated position',()=>{
  const f=fixture();f.repeat([hand('left','open',.22,.42)]);
  assert.deepEqual(f.controls.left.origin,{x:.22,y:.42});
  f.repeat([hand('left','closed',.22,.42)],5);
  const s=f.repeat([hand('left','closed',.22,.42),hand('right','open',.78,.45)]);
  assert.deepEqual(s.hands.left.workspace,{x:0,y:0});assert.deepEqual(s.hands.right.workspace,{x:0,y:0});
  assert.deepEqual(s.input,{x:0,z:0});
});
for(const role of ['left','right'])test(`${role} workspace exit cancels its action and cannot resume clenched`,()=>{
  const f=fixture();f.arm();const normal=[f.left,hand('right','closed')];f.step(normal);
  const outside=role==='left'?[hand('left','closed',.49),hand('right')]:[f.left,hand('right','closed',.51)];
  const s=f.step(outside);assert.equal(s.fired,false);assert.equal(s.hands[role].outside,true);
  assert.equal(f.repeat(normal).fired,false);
  assert.equal(f.controls[role].owner,null);
});
test('right local range exit leaves left steering active, even while still on the right side',()=>{
  const f=fixture();f.arm();f.step([hand('left','closed',.30),hand('right','open',.65,.72)]);
  const s=f.step([hand('left','closed',.30),hand('right','open',.65,.82)]);
  assert.ok(s.input.x<0);assert.equal(s.hands.right.outside,true);assert.equal(s.fired,false);
});


test('gripped joystick stays attached beyond its soft movement range and clamps steering',()=>{
  const f=fixture();f.arm();
  for(const [x,y] of [[.25,.70],[.12,.80],[.04,.90],[.16,.80],[.30,.80],[.44,.80],[.47,.90]]){
    const s=f.repeat([hand('left','closed',x,y),hand('right')],3);
    assert.equal(s.hands.left.grab.stage,'gripped');assert.equal(s.hands.left.outside,false);
    assert.equal(s.dropEnabled,true);assert.ok(s.input.z>0 && s.input.z<=1);assert.ok(Math.abs(s.input.x)<=1);
  }
  const release=f.step([hand('left','open',.47,.90),hand('right','closed')]);
  assert.deepEqual(release.input,{x:0,z:0});assert.equal(release.fired,false);
  assert.equal(f.repeat([hand('left','closed',.47,.90),hand('right','closed')]).dropEnabled,false);
});
test('sticky left grip still releases when crossing into the right half',()=>{
  const f=fixture();f.arm();f.step([hand('left','closed',.48)]);
  const s=f.step([hand('left','closed',.55)]);
  assert.equal(s.hands.left.outside,true);assert.deepEqual(s.input,{x:0,z:0});assert.equal(s.dropEnabled,false);
});
test('armed right hand can pass through brief uncertain evidence while forming its fist',()=>{
  const f=fixture();f.arm();
  assert.equal(f.step([f.left,hand('right','uncertain')]).fired,false);
  assert.equal(f.repeat([f.left,hand('right','closed')],4).fired,true);
});
test('prolonged uncertain right evidence discards arming and cannot resume closed',()=>{
  const f=fixture();f.arm();f.repeat([f.left,hand('right','uncertain')],4);
  assert.equal(f.repeat([f.left,hand('right','closed')]).fired,false);
  assert.equal(f.controls.right.gesture.stage,'seeking');
});
test('a deliberate right press tolerates small drift but cannot start outside DROP',()=>{
  for(const startOnButton of [false,true]){
    const controls=new DualHandControls();let now=0;
    const target=()=>({overTarget:true,overDrop:onButton,nearDrop:true});let onButton=true;
    const step=(right)=>controls.update([hand('left','closed'),right],now+=65,target);
    for(let i=0;i<10;i++)controls.update([hand('left')],now+=65,target);
    for(let i=0;i<10;i++)step(hand('right'));
    onButton=startOnButton;step(hand('right','closed'));onButton=false;
    step(hand('right','closed'));step(hand('right','closed'));
    assert.equal(step(hand('right','closed')).fired,startOnButton);
  }
});
test('a right press moving beyond the capture margin cancels until reopened',()=>{
  const f=fixture();f.arm();let now=f.controls.last;
  const update=target=>f.controls.update([f.left,hand('right','closed')],now+=65,(_,role)=>role==='left'?{overTarget:true}:target);
  update({overDrop:true,nearDrop:true});update({overDrop:false,nearDrop:false});
  for(let i=0;i<5;i++)assert.equal(update({overDrop:true,nearDrop:true}).fired,false);
});
