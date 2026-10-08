import test from 'node:test';
import assert from 'node:assert/strict';
import { DualHandControls, HAND_ACQUIRE_MS, RIGHT_SLAM_MS } from '../src/dual-hand-controls.js';
import { inDropArea } from '../src/hand-workspace.js';
import { HandController } from '../src/vision.js';

const hand = (physicalHand, kind = 'open', x = physicalHand === 'left' ? .35 : .65, y = .6) => ({
  physicalHand, handednessScore: .99, center: { x, y }, fist: { open: kind === 'open', closed: kind === 'closed' },
});
const target = p => ({ overTarget: p.x < .5, overDrop: p.x > .5 && p.y >= .6, aboveDrop: p.x > .5 && p.y < .6, nearDrop: inDropArea(p) });
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
  const hands = [f.left, hand('right', 'open', .65, .50)];
  const s = f.step(hands); assert.equal(s.fired, true); assert.deepEqual(s.input, {x:0,z:0});
  assert.equal(f.repeat(hands).fired, false);
});
// Contract: an open palm acquired at the target drops once, without moving away.
// The former entry-only tests explicitly required the confusing extra movement.
test('a palm first acquired in the centre of DROP fires once without leaving', () => {
  const f = fixture(); f.grip(); let fired = 0;
  for (let i = 0; i < 60; i++) fired += Number(f.step([f.left, hand('right', 'open', .72, .44)]).fired);
  assert.equal(fired, 1);
});
// Contract: DROP needs the palm to arrive. Recorded two-hand play rests the
// open right hand inside DROP, so firing when the grip completed dropped at once.
test('a palm already resting on DROP when the grip becomes ready must leave before it presses', () => {
  const f=fixture(), resting=hand('right','open',.72,.44); f.repeat([hand('left'),resting]);
  let fired=0, s;
  for(let i=0;i<10;i++) { s=f.step([f.left,resting]); fired+=Number(s.fired); }
  assert.equal(fired,0); assert.equal(s.dropEnabled,true); assert.equal(s.hands.right.grab.stage,'resting');
  assert.equal(s.message,'MOVE RIGHT PALM OFF DROP');
  f.step([f.left,hand('right','open',.72,.60)]);
  for(let i=0;i<10;i++) fired+=Number(f.step([f.left,resting]).fired);
  assert.equal(fired,1);
});
// Contract: arrival belongs to the held grip, not to each pose sample. The grip
// tolerates a brief uncertain fist; that frame must not strand a returning palm.
test('an uncertain left frame while returning to DROP does not cancel the press', () => {
  const f=fixture(), resting=hand('right','open',.72,.44), away=hand('right','open',.72,.60); f.repeat([hand('left'),away]); f.repeat([f.left,away],5);
  assert.equal(f.step([hand('left','uncertain'),resting]).fired,false);
  let fired=0;
  for(let i=0;i<5;i++) fired+=Number(f.step([f.left,resting]).fired);
  assert.equal(fired,1);
});
test('jitter across the DROP edge is not an arrival', () => {
  const f=fixture(), edge=hand('right','open',.72,.555), jitter=hand('right','open',.72,.565); f.repeat([hand('left'),edge]); f.repeat([f.left,edge],5);
  let fired=0;
  for(let i=0;i<10;i++) fired+=Number(f.step([f.left,i%2?jitter:edge]).fired);
  assert.equal(fired,0);
});
// Contract: a right hand rising past the frame edge cannot cancel the left.
// A recorded session labelled it left for one or two frames below the right
// workspace (y > .88); both roles were cancelled and the held fist was stranded.
for (const held of ['gripped', 'acquired']) test(`a right hand rising mislabelled at the frame edge keeps the ${held} left hand`, () => {
  const f=fixture(), left=hand('left',held==='gripped'?'closed':'open',.21,.73);
  f.repeat([hand('left','open',.21,.73)]); if(held==='gripped') f.repeat([left],5);
  const rising=[hand('right','closed',.74,1.02),{...hand('right','closed',.73,1.01),physicalHand:'left'},{...hand('right','open',.83,.96),physicalHand:'left',handednessScore:.86}];
  for (const right of rising) {
    const s=f.step([left,right]);
    assert.notEqual(s.message,'SEPARATE YOUR HANDS'); assert.equal(s.hands.left.ready,true);
    if(held==='gripped') { assert.equal(s.hands.left.grab.stage,'gripped'); assert.equal(s.dropEnabled,true); }
  }
  if(held==='gripped') assert.equal(f.step([hand('left','closed',.15,.73),hand('right','closed',.74,1.02)]).hands.left.ready,true,'steering continues');
});
test('a held grip survives a missed left sample while the right rises past the frame edge', () => {
  const f=fixture(); f.grip();
  assert.equal(f.step([hand('right','open',.74,1.02)]).hands.left.grab.stage,'gripped');
  assert.equal(f.step([f.left,hand('right','open',.74,1.0)]).dropEnabled,true);
});
// Contract: re-clenching an owned left hand grips again. The same session
// released on a brief open sample, then held a fist for 5 s without gripping.
test('a quick release and re-clench grips again without a long open hand', () => {
  const f=fixture(); f.grip();
  assert.equal(f.step([hand('left')]).hands.left.grab.stage,'seeking');
  let s; for(let i=0;i<4;i++) s=f.step([f.left]);
  assert.equal(s.hands.left.grab.stage,'gripped'); assert.equal(s.dropEnabled,true);
});
test('a visible left hand outside the start area is told which way to move', () => {
  const f=fixture();
  assert.equal(f.step([hand('left','closed',.25,.87)]).message,'RAISE LEFT HAND');
  assert.equal(f.step([hand('left','open',.12,.50)]).message,'MOVE LEFT HAND IN');
  assert.equal(f.step([hand('left','open',.30,.15)]).message,'LOWER LEFT HAND');
  assert.equal(f.step([hand('left','open',.30,.50)]).message,'HOLD LEFT HAND STILL');
  const g=fixture();
  assert.equal(g.step([hand('left','open',.70,.95)]).message,'SHOW LEFT HAND','a mislabelled right hand rising is not told to raise the left');
});
// Contract: the wider grip zone cannot weaken DROP arrival or identity.
test('a left hand steered past the centre does not let a resting palm press after one missed frame', () => {
  const f=fixture(), resting=hand('right','open',.72,.44);
  f.repeat([hand('left','open',.40,.6),resting]); f.repeat([hand('left','closed',.40,.6),resting],5);
  for(const x of [.45,.50,.55]) f.step([hand('left','closed',x,.6),resting]);
  f.step([hand('left','closed',.55,.6)]);
  let fired=0;
  for(let i=0;i<20;i++) fired+=Number(f.step([hand('left','closed',.55,.6),resting]).fired);
  assert.equal(fired,0);
});
// The right hand is untracked in the centre gap, so only the previous-frame memory knows it was there.
test('a left label landing where the right hand just was cancels instead of inheriting the grip', () => {
  const f=fixture(); f.repeat([hand('left','open',.40,.6)]); f.repeat([hand('left','closed',.40,.6),hand('right','open',.51,.6)],5);
  const s=f.step([hand('left','closed',.51,.6)]);
  assert.equal(s.hands.left.ready,false); assert.deepEqual(s.input,{x:0,z:0}); assert.equal(f.controls.left.owner,null);
});
test('a right hand discarded as mislabelled noise cannot take over the grip on the next frame', () => {
  const f=fixture(); f.repeat([hand('left','open',.40,.6)]); f.repeat([hand('left','closed',.40,.6)],5);
  f.step([hand('left','closed',.45,.72)]); f.step([hand('left','closed',.50,.85)]);
  assert.equal(f.step([hand('left','closed',.50,.85),{...hand('right','closed',.64,1.0),physicalHand:'left'}]).hands.left.grab.stage,'gripped');
  const s=f.step([{...hand('right','closed',.57,.98),physicalHand:'left'}]);
  assert.equal(s.hands.left.ready,false); assert.deepEqual(s.input,{x:0,z:0}); assert.equal(f.controls.left.owner,null);
});
for (const glitch of ['missing', 'label-flip']) test(`a resting palm cannot press DROP by reacquiring after a ${glitch} right sample`, () => {
  const f=fixture(), resting=hand('right','open',.72,.44); f.repeat([hand('left'),resting]); f.repeat([f.left,resting],5);
  f.step(glitch==='missing'?[f.left]:[f.left,{...resting,physicalHand:'left'}]);
  assert.equal(f.controls.right.owner,null,'the glitch discards right ownership');
  let fired=0;
  for(let i=0;i<20;i++) fired+=Number(f.step([f.left,resting]).fired);
  assert.equal(fired,0);
});
test('a palm raised from out of view straight onto DROP presses after acquisition', () => {
  const f=fixture(), resting=hand('right','open',.72,.44); f.repeat([hand('left'),resting]); f.repeat([f.left,resting],5);
  f.repeat([f.left],5);
  let fired=0;
  for(let i=0;i<10;i++) fired+=Number(f.step([f.left,resting]).fired);
  assert.equal(fired,1);
});
for (const phase of ['recognizing', 'observing']) test(`a palm resting on DROP through the ${phase} count-in cannot drop at GO`, () => {
  const f=cameraFixture(); f.phase(phase);
  const resting=hand('right','open',.72,.44);
  f.repeat([hand('left'),resting]); f.repeat([hand('left','closed'),resting],8);
  assert.equal(f.c.state.hands.left.grab.stage,'gripped');
  f.c.neutralizeInput(); f.phase('aim');
  const go=f.repeat([hand('left','closed'),resting],20);
  assert.equal(f.drops(),0); assert.equal(go.hands.left.grab.stage,'gripped','the grip carries into aiming');
  assert.equal(go.dropEnabled,true); assert.equal(go.message,'MOVE RIGHT PALM OFF DROP');
  f.sample([hand('left','closed'),hand('right','open',.72,.60)]);
  f.sample([hand('left','closed'),resting]);
  assert.equal(f.drops(),1);
});
test('a visible left hand is told how to become ready instead of to show itself', () => {
  const f=fixture();
  assert.equal(f.step([]).message,'SHOW LEFT HAND');
  assert.equal(f.step([hand('left','closed')]).message,'OPEN LEFT HAND');
  assert.equal(f.step([hand('left')]).message,'HOLD LEFT HAND STILL');
  const clenching=f.repeat([hand('left')]);
  assert.equal(clenching.hands.left.ready,true);
  assert.equal(f.step([hand('left','uncertain')]).message,'LEFT HAND · GRAB JOYSTICK','a transitional pose keeps the grip step');
});
test('lowering an acquired right hand establishes the next upward stroke without a hold', () => {
  const f=fixture();f.arm();assert.equal(f.step([f.left,hand('right','open',.65,.72)]).fired,false);
  f.step([f.left,hand('right','open',.65,.62)]);
  assert.equal(f.step([f.left,hand('right','open',.72,.50)]).fired,true);
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
test('recognition-only first prep acquires both roles without steering or accepting a raise',()=>{
  const f=cameraFixture();f.phase('recognizing');
  const bothOpen=[hand('left'),hand('right','open',.65,.72)];
  const ready=f.repeat(bothOpen,10);
  assert.equal(ready.kind,'tracking');assert.equal(ready.profile,'dual');
  assert.equal(ready.hands.left.ready,true);assert.equal(ready.hands.right.ready,true);
  assert.equal(ready.hands.left.open,true);assert.equal(ready.hands.right.open,true);
  assert.equal(ready.controlEnabled,false);assert.deepEqual(ready.input,{x:0,z:0});assert.equal(f.drops(),0);

  const left=hand('left','closed');
  f.repeat([left,bothOpen[1]],5);
  assert.equal(f.c.state.hands.left.grab.stage,'gripped');
  f.sample([left,hand('right','open',.65,.65)]);
  assert.equal(f.drops(),0,'a valid dual raise during prep cannot accept a drop');
  assert.deepEqual(f.c.input,{x:0,z:0});
  f.phase('aim');
  const aiming=f.sample([left,hand('right','open',.65,.65)]);
  assert.equal(aiming.hands.left.ready,true);assert.equal(aiming.hands.right.ready,true,'recognized roles survive the START boundary');
});
test('START clears a partial dual raise while preserving recognized hand roles',()=>{
  const f=cameraFixture();f.phase('recognizing');
  const left=hand('left'),right=hand('right','open',.65,.72);
  f.repeat([left,right],10);
  const grippedLeft=hand('left','closed');
  f.repeat([grippedLeft,right],5);
  assert.equal(f.sample([grippedLeft,hand('right','open',.65,.68)]).hands.right.grab.armed,false);
  assert.equal(f.drops(),0);

  f.c.neutralizeInput();f.phase('aim');
  const boundary=f.sample([grippedLeft,hand('right','open',.65,.64)]);
  assert.equal(boundary.hands.left.ready,true);assert.equal(boundary.hands.right.ready,true);
  assert.equal(boundary.fired,false,'movement begun before START cannot complete a drop across it');
  assert.equal(f.sample([grippedLeft,hand('right','open',.72,.50)]).fired,true,'a fresh post-START raise still drops');
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
  if(role==='left') f.step([hand('left','closed',.50)]); // a held overshoot past the gap, then beyond the grip zone
  const outside=role==='left'?[hand('left','closed',.62)]:[f.left,hand('right','closed',.51)];
  const s=f.step(outside);assert.equal(s.fired,false);assert.equal(s.hands[role].outside,true);
  assert.equal(f.repeat(normal).fired,false);
  assert.equal(f.controls[role].owner,null);
});
test('right can approach DROP across its full workspace without interrupting left steering',()=>{
  const f=fixture();f.arm();
  const s=f.step([hand('left','closed',.30),hand('right','open',.65,.75)]);
  assert.ok(s.input.x<0);assert.equal(s.hands.right.outside,false);assert.equal(s.fired,false);
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
// Contract: full steering plus overshoot keeps the stick. A recorded player
// gripping at x .31 lost it at x .50 steering right and at y 1.0 steering down.
for (const [axis, path, beyond] of [['right', [[.40,.6],[.48,.6],[.53,.6],[.57,.6]], [.62,.6]], ['down', [[.33,.70],[.31,.80],[.31,.92],[.31,1.01],[.31,1.04]], [.31,1.12]]]) test(`sticky left grip overshoots ${axis} past full steering and releases only beyond its grip zone`,()=>{
  const f=fixture();f.arm();
  for(const [x,y] of path){
    const s=f.step([hand('left','closed',x,y)]);
    assert.equal(s.hands.left.grab.stage,'gripped');assert.equal(s.dropEnabled,true);assert.ok(axis==='right'?s.input.x>0:s.input.z>0);
  }
  const s=f.step([hand('left','closed',...beyond)]);
  assert.equal(s.hands.left.outside,true);assert.deepEqual(s.input,{x:0,z:0});assert.equal(s.dropEnabled,false);
});
test('right entry into the visible DROP target fires only once',()=>{
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
    assert.equal(f.step([hand('left', 'closed', .20, .70), hand('right', 'open', .65, .50)]).fired, true, 'fresh recovered evidence over DROP needs no exit');
  }
});
test('a right raise begun during left recovery needs fresh evidence after the grip returns', () => {
  const f = fixture(); f.arm();
  const lost = f.step([hand('right', 'open', .65, .72)]);
  assert.equal(lost.hands.left.ready, false);
  assert.equal(lost.hands.left.grab.steering, true);
  assert.equal(lost.fired, false);

  const recovered = f.step([f.left, hand('right', 'open', .65, .65)]);
  assert.equal(recovered.hands.left.ready, true);
  assert.equal(recovered.dropEnabled, true);
  assert.equal(recovered.fired, false, 'the raise began while DROP was disabled');
  assert.equal(f.step([f.left, hand('right', 'open', .65, .64)]).fired, false);
  assert.equal(f.step([f.left, hand('right', 'open', .72, .50)]).fired, true,
    'a new upward stroke after recovery can still drop');
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
  f.step([f.left, hand('right', 'closed', .65, .82)]);
  assert.equal(f.step([f.left, hand('right', 'closed', .65, .90)]).hands.right.outside, true);
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
  f.sample([hand('left', 'closed'), hand('right', 'open', .65, .60)]);
  f.sample([hand('left', 'closed'), hand('right', 'open', .65, .50)]);
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

// Contract: right-side ambiguity cannot erase a fresh, uniquely matched left
// grip. Existing ambiguity tests cover competing/missing left hands, not this
// recovery while the same left hand remains clenched. No extra test seam needed.
for (const fault of ['jump', 'weak-label-flip', 'confident-label-flip']) test(`${fault} on the right preserves left grip and reacquires DROP in place`, () => {
  const f = fixture(), left = hand('left', 'closed', .40, .55);
  const lowRight = hand('right', 'open', .72, .85), atDrop = hand('right', 'open', .72, .44);
  f.repeat([hand('left', 'open', .40, .55), lowRight]);
  f.repeat([left, lowRight], 5);
  const badRight = fault === 'jump' ? atDrop : { ...atDrop, physicalHand: 'left', handednessScore: fault === 'weak-label-flip' ? .4 : .99 };
  const rejected = f.step([left, badRight]);
  assert.equal(rejected.hands.left.ready, true);
  assert.equal(rejected.hands.left.grab.stage, 'gripped');
  assert.equal(rejected.hands.right.ready, false);
  assert.equal(rejected.fired, false, 'the ambiguous sample itself cannot drop');
  if (fault !== 'jump') {
    for (let i = 0; i < 8; i++) {
      const stillBad = f.step([left, badRight]);
      assert.equal(stillBad.hands.left.grab.stage, 'gripped');
      assert.equal(stillBad.fired, false, 'wrong labels never gain right-hand ownership');
    }
  }
  let fired = 0;
  for (let i = 0; i < 20; i++) {
    const recovered = f.step([left, atDrop]);
    assert.equal(recovered.hands.left.grab.stage, 'gripped');
    if (i < 5) assert.equal(recovered.fired, false, 'right must finish fresh open acquisition');
    fired += Number(recovered.fired);
  }
  assert.equal(fired, 1, 'recover and drop once without reopening the left or moving right out');
});

for (const fault of ['overlap', 'third-hand', 'left-label-flip', 'uncertain-left']) test(`${fault} cannot use right-side recovery to keep control`, () => {
  const f = fixture(); f.arm();
  const hands = fault === 'overlap' ? [hand('left', 'closed', .48), hand('right', 'open', .53)]
    : fault === 'third-hand' ? [f.left, hand('right'), hand('left', 'open', .72, .44)]
    : fault === 'left-label-flip' ? [hand('right', 'closed', .35), hand('left', 'open', .72, .44)]
    : [{ ...f.left, handednessScore: .4 }, hand('left', 'open', .72, .44)];
  const rejected = f.step(hands);
  assert.deepEqual(rejected.input, { x: 0, z: 0 });
  assert.equal(rejected.fired, false);
  assert.equal(Boolean(rejected.dropEnabled), false);
  assert.equal(f.controls.left.owner, null);
});

// Contract: missing/distant samples cannot replace a recently acquired player.
// Existing loss tests only returned the same hand, never a distant open hand.
test('a distant bystander cannot acquire the reserved left role during a dropout', () => {
  const f=fixture();f.grip();f.step([]);
  for(let i=0;i<7;i++) {
    const s=f.step([hand('left','open',.10,.35)]);
    assert.equal(s.hands.left.ready,false);assert.equal(s.fired,false);
  }
});
test('initial acquisition rejects a peripheral left hand', () => {
  const f=fixture();
  assert.equal(f.repeat([hand('left','open',.10,.5)],20).hands.left.ready,false);
  assert.equal(f.repeat([hand('left','open',.35,.5)]).hands.left.ready,true);
});
test('delivery recognizes and displays grip while providing no gameplay input or DROP',()=>{
  const f=cameraFixture();f.phase('observing');
  f.repeat([hand('left')]);f.repeat([hand('left','closed')],5);
  assert.equal(f.c.state.hands.left.grab.stage,'gripped');
  f.repeat([hand('left','closed',.30),hand('right')]);
  f.sample([hand('left','closed',.30),hand('right','open',.72,.44)]);
  assert.equal(f.c.state.observing,true);assert.deepEqual(f.c.input,{x:0,z:0});assert.equal(f.drops(),0);
});

test('the first clench after open acquisition grips without another hidden arming wait',()=>{
 const f=fixture();
 const ready=f.repeat([hand('left')],6);
 assert.equal(ready.hands.left.ready,true);
 assert.equal(f.repeat([f.left],4).hands.left.grab.stage,'gripped');
});
