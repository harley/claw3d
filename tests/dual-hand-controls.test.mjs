import test from 'node:test';
import assert from 'node:assert/strict';
import { DualHandControls, HAND_ACQUIRE_MS, RIGHT_RAISE_DISTANCE, RIGHT_SLAM_MS } from '../src/dual-hand-controls.js';
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
  const arm = () => { repeat([hand('left'), hand('right')]); repeat([left, hand('right')], 5); };
  return { controls, step, repeat, left, grip, arm };
}
test('right enters closed without interrupting left steering or dropping', () => {
  const f = fixture(); f.grip();
  const s = f.repeat([hand('left', 'closed', .30), hand('right', 'closed')]);
  assert.ok(s.input.x < 0); assert.equal(s.fired, false); assert.equal(s.hands.right.ready, false);
});
test('raising an acquired right hand fires on that sample, once, and locks input', () => {
  const f = fixture(); f.arm();
  assert.equal(f.repeat([f.left, hand('right')], 60).fired, false, 'a stationary visible hand is not a raise');
  const hands = [f.left, hand('right', 'open', .65, .6-RIGHT_RAISE_DISTANCE-.001)];
  const s = f.step(hands); assert.equal(s.fired, true); assert.deepEqual(s.input, {x:0,z:0});
  assert.equal(f.repeat(hands).fired, false);
});
test('a newly raised open right hand fires at acquisition without an extra hold', () => {
  const f = fixture(); f.grip();
  for (let i=0;i<5;i++) assert.equal(f.step([f.left,hand('right')]).fired,false);
  assert.equal(f.step([f.left,hand('right')]).fired,true);
});

test('raising before left grip cannot be banked into an automatic drop', () => {
  const f=fixture();f.repeat([hand('left'),hand('right')]);
  f.repeat([hand('left'),hand('right','open',.65,.50)]);
  for(let i=0;i<10;i++)assert.equal(f.step([f.left,hand('right','open',.65,.50)]).fired,false);
  assert.equal(f.step([f.left,hand('right','open',.65,.43)]).fired,true);
});
test('lowering an acquired right hand establishes the next upward stroke without a hold', () => {
  const f=fixture();f.arm();assert.equal(f.step([f.left,hand('right','open',.65,.72)]).fired,false);
  assert.equal(f.step([f.left,hand('right','open',.65,.65)]).fired,true);
});
for (const loss of ['missing', 'uncertain', 'closed', 'low-confidence', 'outside', 'stale', 'left']) test(`${loss} cancels incomplete right acquisition`, () => {
  const f = fixture(); f.grip(); f.repeat([f.left, hand('right')], 3);
  const right = loss === 'missing' ? [] : [{...hand('right', ['uncertain','closed'].includes(loss) ? loss : 'open', loss === 'outside' ? .49 : .65), handednessScore: loss === 'low-confidence' ? .4 : .99}];
  const s = f.step([...(loss === 'left' ? [] : [f.left]), ...right], loss === 'stale' ? 350 : 65);
  assert.equal(s.fired, false); assert.equal(s.hands.right.grab.progress, 0);
  for(let i=0;i<5;i++) assert.equal(f.step([f.left,hand('right')]).fired,false);
});
test('clenching and physical downward strokes never trigger dual DROP', () => {
  const f=fixture();f.arm();assert.equal(f.repeat([f.left,hand('right','closed')],60).fired,false);
  f.repeat([f.left,hand('right')]);
  assert.equal(f.step([f.left,hand('right','open',.65,.72)]).fired,false);
  assert.equal(f.step([f.left,hand('right','open',.65,.75)]).fired,false);
});
for (const ambiguity of ['labels','crossing','duplicate','third']) test(`${ambiguity} cannot transfer roles or drop`,()=>{
  const f=fixture();f.arm();
  const hands=ambiguity==='labels'?[hand('right','closed',.35),hand('left','closed',.65)]:ambiguity==='crossing'?[hand('left','closed',.49),hand('right','open',.51)]:ambiguity==='duplicate'?[f.left,hand('left','open',.65)]:[f.left,hand('right'),hand('right','open',.8)];
  assert.equal(f.step(hands).fired,false);
  assert.equal(f.repeat([f.left,hand('right')],20).fired,false);
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
  const arm=()=>{repeat([hand('left'),hand('right')]);repeat([hand('left','closed'),hand('right')],5);};
  return {c,sample,repeat,arm,drops:()=>drops,phase:v=>phase=v,profile:v=>profile=v};
}
test('real camera controller normalizes roles and accepts an upward right-hand gesture immediately once',()=>{
  const f=cameraFixture();f.arm();
  assert.equal(f.c.state.hands.left.grab.stage,'gripped');assert.equal(f.c.state.hands.right.ready,true);
  f.sample([hand('left','closed'),hand('right','open',.65,.50)]);assert.equal(f.drops(),1);
  f.repeat([hand('left','closed'),hand('right','open',.65,.50)],60);assert.equal(f.drops(),1);
});
for(const boundary of ['pause','profile','delay'])test(`${boundary} clears real two-hand raise evidence`,()=>{
  const f=cameraFixture();f.arm();const hands=[hand('left','closed'),hand('right')];f.sample(hands);
  assert.equal(f.c.state.hands.right.grab.armed,true);assert.equal(f.drops(),0);
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
test('right raise works throughout the valid workspace without a button hit',()=>{
  const f=fixture();f.arm(); let fired=0;
  for(let i=0;i<60;i++) fired+=Number(f.step([f.left,hand('right','open',.70,.50)]).fired);
  assert.equal(fired,1);
});
test('reset requires a fresh left acquisition and grip before another raised right hand can fire',()=>{
  const f=fixture();f.arm();f.repeat([f.left,hand('right')],60);f.controls.reset();
  const s=f.repeat([f.left,hand('right')],60);assert.equal(s.fired,false);assert.equal(s.hands.right.grab.progress,0);
});

import { createGame, begin, drop, advance, moveCarousel, carouselCue, CAROUSEL, CONTACT_DELAY } from '../src/arcade-mechanics.js';
for (const acquired of [false, true]) test(`${acquired ? 'acquired' : 'fresh'} right-hand star cue accounts for remaining recognition and contact`, () => {
  const lead = ((acquired ? 0 : HAND_ACQUIRE_MS) + RIGHT_SLAM_MS) / 1000;
  const game = createGame({ carousel: true }); begin(game); game.position = { x: .80, z: .22 };
  moveCarousel(game, CAROUSEL.period - CONTACT_DELAY - lead);
  assert.equal(carouselCue(game.carouselTime, lead).now, true);
  moveCarousel(game, lead);
  assert.equal(drop(game), true);
  for (let i=0;i<110;i++) advance(game,.01);
  assert.equal(game.plan.prize?.id, CAROUSEL.id);
});

test('brief missing or low-confidence left evidence stops actions then recovers the held grip', () => {
  for (const uncertain of [[], [{ ...hand('left', 'closed'), handednessScore: .4 }]]) {
    const f = fixture(); f.arm();
    const moved = hand('left', 'closed', .30, .70);
    const before = f.step([moved, hand('right', 'open', .65, .60)]);
    assert.notDeepEqual(before.input, { x: 0, z: 0 });
    const lost = f.step([...uncertain, hand('right', 'open', .65, .50)]);
    assert.deepEqual(lost.input, { x: 0, z: 0 });
    assert.equal(lost.dropEnabled, false); assert.equal(lost.fired, false);
    assert.equal(lost.hands.left.ready, false);
    const recovered = f.step([moved, hand('right', 'open', .65, .50)]);
    assert.equal(recovered.hands.left.grab.stage, 'gripped');
    assert.equal(recovered.dropEnabled, true);
    assert.deepEqual(recovered.input, { x: 0, z: 0 }, 'recovery recentres steering');
    assert.equal(recovered.fired, false, 'a raise during the interruption is not banked');
    assert.ok(f.step([hand('left', 'closed', .20, .70), hand('right', 'open', .65, .50)]).input.x < 0);
    assert.equal(f.step([hand('left', 'closed', .20, .70), hand('right', 'open', .65, .43)]).fired, true);
  }
});
test('sustained loss expires the held grip and requires reopening', () => {
  const f = fixture(); f.arm(); f.repeat([hand('right')], 4);
  assert.equal(f.repeat([f.left, hand('right')]).dropEnabled, false);
  f.repeat([hand('left'), hand('right')]);
  assert.equal(f.repeat([f.left, hand('right')], 5).dropEnabled, true);
});
test('explicit open during recovery releases the stick', () => {
  const f = fixture(); f.arm(); f.step([hand('right')]);
  assert.equal(f.step([hand('left'), hand('right')]).dropEnabled, false);
});
test('workspace reacquisition recentres instead of remaining trapped at the old origin', () => {
  const f = fixture(); f.arm();
  f.step([f.left, hand('right', 'closed', .65, .72)]);
  assert.equal(f.step([f.left, hand('right', 'closed', .65, .82)]).hands.right.outside, true);
  // Reopen comfortably inside the absolute workspace, outside the old local range.
  const s = f.repeat([hand('left'), hand('right', 'open', .65, .82)]);
  assert.equal(s.hands.right.ready, true);
  assert.deepEqual(f.controls.right.origin, { x: .65, y: .82 });
  assert.equal(s.fired, false);
});

test('a returning sample after the grace deadline cannot revive a closed grip', () => {
  const f = fixture(); f.arm(); f.step([hand('right')]);
  assert.equal(f.step([f.left, hand('right')], 195).dropEnabled, false);
});

test('camera integration recovers a brief missing left hand without accepting a banked raise', () => {
  const f = cameraFixture(); f.arm();
  f.sample([hand('right', 'open', .65, .50)]);
  assert.equal(f.c.state.dropEnabled, false); assert.equal(f.drops(), 0);
  f.sample([hand('left', 'closed'), hand('right', 'open', .65, .50)]);
  assert.equal(f.c.state.dropEnabled, true); assert.equal(f.drops(), 0);
  f.sample([hand('left', 'closed'), hand('right', 'open', .65, .43)]);
  assert.equal(f.drops(), 1);
});

test('low-confidence recovery uses the full held-joystick travel bounds', () => {
  const f = fixture(); f.arm();
  for (const [x,y] of [[.25,.70],[.12,.80],[.04,.90]]) f.step([hand('left','closed',x,y),hand('right')]);
  const left = hand('left','closed',.04,.90);
  const lost = f.step([{...left,handednessScore:.4},hand('right')]);
  assert.equal(lost.dropEnabled,false); assert.deepEqual(lost.input,{x:0,z:0});
  assert.equal(f.step([left,hand('right')]).dropEnabled,true);
});
test('duplicate right identities cannot preserve an absent left grip', () => {
  const f = fixture(); f.arm();
  f.step([hand('right'),hand('right','open',.80)]);
  assert.equal(f.repeat([f.left,hand('right')]).dropEnabled,false);
});

test('duplicate left identities cancel the held grip even when one label is low confidence', () => {
  const f = fixture(); f.arm();
  const result = f.step([f.left, { ...hand('left', 'closed', .30, .60), handednessScore: .4 }]);
  assert.equal(result.kind, 'lost');
  assert.deepEqual(result.input, { x: 0, z: 0 }); assert.equal(Boolean(result.dropEnabled), false);
  assert.equal(f.controls.left.owner, null); assert.equal(f.controls.right.owner, null);
});

test('duplicate right observations cancel the established left grip', () => {
  const f = fixture(); f.arm();
  const result = f.step([hand('right', 'open', .65, .60), hand('right', 'open', .80, .60)]);
  assert.equal(result.kind, 'lost');
  assert.deepEqual(result.input, { x: 0, z: 0 }); assert.equal(Boolean(result.dropEnabled), false);
  assert.equal(f.controls.left.owner, null); assert.equal(f.controls.right.owner, null);
});
