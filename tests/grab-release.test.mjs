import test from 'node:test';
import assert from 'node:assert/strict';
import { GrabRelease } from '../src/grab-release.js';
import { createGame, begin, moveCarousel, drop, advance, CAROUSEL, CONTACT_DELAY, carouselCue } from '../src/arcade-mechanics.js';
const open = { open: true, overTarget: true }, closed = { closed: true, overTarget: true };
function fixture() {
  const g = new GrabRelease(); let now = 0;
  const step = (sample, gap = 65) => g.update(sample, now += gap);
  const repeat = (sample, n = 5) => { let result; for (let i = 0; i < n; i++) result = step(sample); return result; };
  const grab = () => { repeat(open); assert.equal(repeat(closed).stage, 'gripped'); };
  return { g, step, repeat, grab };
}
test('open hand does not steer; clench grabs and confirmed release fires exactly once', () => {
  const f = fixture(); assert.equal(f.repeat(open).steering, false);
  assert.equal(f.step(closed).stage, 'grabbing');
  assert.equal(f.repeat(closed, 3).steering, true);
  assert.equal(f.step(open).steering, false);
  assert.equal(f.repeat(open, 2).fired, false);
  assert.equal(f.step(open).fired, true);
  assert.equal(f.repeat(open).fired, false);
});
test('a fist formed away from the joystick cannot sweep onto it', () => {
  const f = fixture(); f.repeat(open); f.step({ closed: true });
  assert.equal(f.repeat(closed).stage, 'seeking'); f.grab();
});
for (const loss of ['missing', 'uncertain', 'stale']) test(`${loss} cancels attachment without dropping`, () => {
  const f = fixture(); f.grab();
  if (loss === 'missing') f.step({ visible: false });
  else if (loss === 'stale') f.step(closed, 350);
  else f.repeat({}, 4);
  assert.equal(f.repeat(open).fired, false);
  assert.equal(f.g.stage, 'seeking'); f.grab();
});
test('uncertainty immediately freezes motion and cannot count as release', () => {
  const f = fixture(); f.grab(); assert.equal(f.step({}).steering, false);
  assert.equal(f.step(closed).grabbed, true);
  f.step(open); f.step({}); f.step(open);
  assert.equal(f.repeat(open, 2).fired, false);
  assert.equal(f.step(open).fired, true);
});
test('interrupted release reseeds steering and needs a new full release', () => {
  const f = fixture(); f.grab(); f.step(open); f.step(open);
  assert.equal(f.step(closed).grabbed, true);
  assert.equal(f.step(open).progress, 0);
  assert.equal(f.repeat(open, 3).fired, true);
});
test('release cue predicts a star catch after its confirmation delay', () => {
  const cueTime = CAROUSEL.period - CONTACT_DELAY - .15;
  assert.equal(carouselCue(cueTime, .15).now, true);
  const game = createGame({ carousel: true }); begin(game);
  moveCarousel(game, cueTime + .15);
  game.position = { x: CAROUSEL.x, z: CAROUSEL.z + CAROUSEL.radius };
  drop(game); advance(game, CONTACT_DELAY);
  assert.equal(game.plan.prize?.id, CAROUSEL.id);
});

// Real recognition handler: synthetic evidence tests integration, not camera accuracy.
import { HandController } from '../src/vision.js';
function controllerFixture() {
  const c = Object.create(HandController.prototype);
  let phase = 'aim', profile = 'grab-release', time = 1000, drops = 0;
  c.getPhase = () => phase; c.getControlProfile = () => profile; c.canGrab = () => true;
  c.onDrop = () => { drops++; return true; }; c.onInput = () => {}; c.onState = () => {}; c.draw = () => {}; c.resetOwner();
  function sample(kind = 'open', x = .5) {
    const lm = Array.from({length:21}, () => ({x:1-x,y:.5,z:0}));
    lm[0].y = .56; lm[9].y = .44; lm[5].x -= .06; lm[17].x += .06;
    c.handle({landmarks:[lm], handedness:[[{categoryName:'Left'}]],gestures:[[{categoryName:kind==='open'?'Open_Palm':'Closed_Fist',score:.99}]]},time+=65);
  }
  const repeat = (kind,n=5,x=.5) => { for(let i=0;i<n;i++) sample(kind,x); };
  repeat('open',15);
  return { c, sample, repeat, drops:()=>drops, phase:v=>{phase=v;}, profile:v=>{profile=v;} };
}
test('handler seeds a neutral grab, steers with a fist and freezes immediately on opening', () => {
  const f = controllerFixture(); f.repeat('closed'); assert.deepEqual(f.c.input,{x:0,z:0});
  f.repeat('closed',5,.57); assert.ok(f.c.input.x>0);
  f.sample('open',.57); assert.deepEqual(f.c.input,{x:0,z:0});
  f.repeat('open',3,.57); assert.equal(f.drops(),1);
});
for(const boundary of ['pause','profile','delay']) test(`${boundary} invalidates attachment before a later open hand`, () => {
  const f = controllerFixture(); f.repeat('closed');
  if(boundary==='pause') { f.phase('blocked'); f.sample('closed'); f.phase('aim'); }
  if(boundary==='profile') { f.profile('hold-drop'); f.sample('closed'); f.profile('grab-release'); }
  if(boundary==='delay') f.c.delayTracking();
  f.repeat('open'); assert.equal(f.drops(),0); assert.equal(f.c.grab.stage,'seeking');
});
