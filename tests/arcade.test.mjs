import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ASSORTMENT, BED, FIELD, FINGER_ANGLES, OPEN_RADIUS, FINGER_DEPTH, HIGH, PHASES, PHASE_ORDER, MISS_LIFT, START, CHUTE, phaseSeconds, homeClaw, MAX_FRAME_DELTA, createGame, begin, drop, advance, move, planGrab, clawPose, collectionSlot } from '../src/arcade-mechanics.js';

const finish = game => { for (let i = 0; i < 1500 && game.phase !== 'result'; i++) advance(game, 1 / 60); assert.equal(game.phase, 'result'); };

test('phase pacing stays readable while cutting passive wait, and 10 FPS is real time', () => {
  const delivery = PHASE_ORDER.reduce((sum, phase) => sum + PHASES[phase], 0);
  assert.equal(+delivery.toFixed(2), 7.2, 'a catch runs the full shelf choreography in 7.2 s');
  assert.deepEqual(Object.keys(PHASES).sort(), [...PHASE_ORDER].sort(), 'every duration has a place in the explicit order');
  assert.equal(MAX_FRAME_DELTA, .1);
  const game = createGame(); begin(game); drop(game);
  for (let i = 0; i < 10; i++) advance(game, MAX_FRAME_DELTA);
  assert.ok(Math.abs(game.elapsed - .8) < 1e-9);
  assert.equal(game.phase, 'descend');
});

test('a miss ends over its drop after a short lift, with one drop and no score', () => {
 const game = createGame({ carousel: true }); begin(game); game.position = { x: -1.18, z: .6 }; drop(game);
 const phases = new Set(); let elapsed = 0;
 while (game.phase !== 'result' && elapsed < 15) { phases.add(game.phase); advance(game, .01); elapsed += .01; }
 assert.equal(game.phase, 'result'); assert.equal(game.plan.prize, null);
 assert.ok(Math.abs(elapsed - (PHASES.anticipate + PHASES.descend + PHASES.grip + MISS_LIFT)) < .02, 'miss ends 2.45 s after the drop');
 assert.equal(phaseSeconds(game, 'lift'), MISS_LIFT);
 for (const phase of ['transfer', 'release', 'deliver', 'reveal']) assert.equal(phases.has(phase), false);
 assert.equal(game.rounds, 1); assert.deepEqual(game.collection, []);
 game.phase = 'lift'; game.elapsed = MISS_LIFT;
 const lifted = clawPose(game); game.phase = 'result'; game.elapsed = 0;
 assert.deepEqual(clawPose(game), lifted, 'lift-to-result pose stays continuous');
 assert.deepEqual([lifted.x, lifted.z], [-1.18, .6], 'the empty claw stays over the drop instead of returning to the chute');
 assert.equal(lifted.y, HIGH);
 assert.ok(begin(game)); assert.deepEqual(game.position, { x: -1.18, z: .6 }, 'the next turn starts where the miss ended');
});

test('a catch parks at the chute, homes to the start during the announce, and the next turn begins there', () => {
 const game = createGame(); begin(game); game.position = { x: -.38, z: .72 }; drop(game); assert.ok(game.plan.prize);
 for (let i = 0; i < 2000 && game.phase !== 'result'; i++) advance(game, 1 / 120);
 assert.equal(game.phase, 'result');
 const parked = clawPose(game); assert.ok(Math.abs(parked.x - (CHUTE.x - game.plan.offset.x)) < 1e-9, 'delivery ends over the chute');
 assert.equal(homeClaw(game, 0), false);
 let seconds = 0; while (homeClaw(game, 1 / 60)) seconds += 1 / 60;
 assert.ok(seconds > .8 && seconds < 2.2, `homing takes ${seconds.toFixed(2)} s at claw speed, inside the 2.5 s announce`);
 assert.deepEqual([clawPose(game).x, clawPose(game).z], [START.x, START.z]);
 assert.equal(homeClaw(game, 1 / 60), false, 'homing stops at the start');
 assert.ok(begin(game)); assert.deepEqual(game.position, { x: START.x, z: START.z });
});

test('runs and turns start clear of every toy at the bed centre', () => {
 const game = createGame({ carousel: true });
 assert.deepEqual(game.position, { x: 0, z: .03 });
 assert.ok(Math.abs(START.x - (FIELD.minX + FIELD.maxX) / 2) < 1e-9 && Math.abs(START.z - (FIELD.minZ + FIELD.maxZ) / 2) < .01);
 assert.ok(begin(game)); assert.equal(planGrab(game.position, game.toys).touched, null, 'nothing is under the claw at the start');
 const missed = createGame({ carousel: true }); begin(missed); missed.position = { x: -1.18, z: .6 }; drop(missed);
 for (let i = 0; i < 2000 && missed.phase !== 'result'; i++) advance(missed, 1 / 120);
 assert.equal(homeClaw(missed, 1 / 60), false, 'a miss never homes');
 assert.ok(begin(missed)); assert.deepEqual(missed.position, { x: -1.18, z: .6 });
});

test('every one of eleven distinct toys has a supported centred grip with independent contacts', () => {
  const game = createGame();
  assert.equal(ASSORTMENT.length, 11); assert.equal(new Set(ASSORTMENT.map(t => t.family)).size, 5);
  for (const toy of game.toys) {
    const plan = planGrab(toy, game.toys);
    assert.equal(plan.prize?.id, toy.id);
    assert.ok(plan.contacts.every(r => r > .065 && r < OPEN_RADIUS));
    assert.ok(Math.max(...plan.contacts) - Math.min(...plan.contacts) > .005);
  }
});

test('an unsupported edge and an empty patch never turn into wins', () => {
  const game = createGame(), toy = game.toys.find(t => t.id === 'butter');
  assert.equal(planGrab({x:toy.x + .23,z:toy.z},game.toys).prize,null);
  begin(game); game.position = {x:-1.18,z:.6}; drop(game);
  assert.equal(game.plan.prize,null); assert.equal(game.plan.stop,'bed');
  game.phase='descend'; game.elapsed=PHASES.descend;
  assert.ok(Math.abs(clawPose(game).y - FINGER_DEPTH - BED - .021) < 1e-8);
  finish(game); assert.deepEqual(game.collection,[]);
});

test('aiming has no snap and the carried toy preserves the player offset', () => {
  const game=createGame(); const position={x:-.36,z:.71}; const plan=planGrab(position,game.toys);
  assert.equal(plan.prize.id,'butter'); assert.deepEqual(plan.position,position);
  assert.ok(Math.abs(plan.position.x+plan.offset.x-plan.prize.x)<1e-9);
  assert.ok(Math.abs(plan.low-plan.offset.y-BED)<1e-9);
});

test('full open fingers stay inside the chamber at all keyboard travel limits', () => {
  for (const x of [FIELD.minX,FIELD.maxX]) for (const z of [FIELD.minZ,FIELD.maxZ]) for (const angle of FINGER_ANGLES) {
    const tipX=x+Math.cos(angle)*OPEN_RADIUS,tipZ=z+Math.sin(angle)*OPEN_RADIUS;
    assert.ok(Math.abs(tipX)+.04<1.65); assert.ok(tipZ-.035> -1.13); assert.ok(tipZ+.035<1.20);
  }
  const p=move({x:0,z:0},{x:200,z:-200},99); assert.deepEqual(p,{x:FIELD.maxX,z:FIELD.minZ});
  assert.ok(move({x:0,z:0},{x:1,z:0},1,true).x<move({x:0,z:0},{x:1,z:0},1).x);
});

test('Space cannot overlap any phase or award the same toy twice', () => {
  const game=createGame(); assert.equal(drop(game),false); begin(game); game.position={x:-.38,z:.72}; assert.equal(drop(game),true);
  for(let i=0;i<1500 && game.phase!=='result';i++) { assert.equal(drop(game),false); assert.equal(begin(game),false); advance(game,1/60); }
  assert.equal(game.rounds,1); assert.deepEqual(game.collection,['butter']);
  begin(game); game.position={x:-.38,z:.72}; drop(game); finish(game); assert.equal(game.rounds,2); assert.deepEqual(game.collection,['butter']);
});

test('collection persists across replays, has distinct full-size shelf slots, and can be completed', () => {
  const game=createGame(),slots=new Set();
  for(const toy of game.toys) {
    begin(game); game.position={x:toy.x,z:toy.z}; drop(game); assert.equal(game.plan.prize.id,toy.id); finish(game);
    slots.add(JSON.stringify(collectionSlot(toy.id)));
  }
  assert.equal(game.collection.length,11); assert.equal(slots.size,11); assert.equal(begin(game),false);
  const fresh=createGame(); assert.equal(fresh.collection.length,0); assert.ok(fresh.toys.every(t=>!t.claimed));
});

test('phase boundaries keep the claw continuous and the lift has no vertical jump', () => {
  const game=createGame(); begin(game); drop(game);
  const phases=PHASE_ORDER;
  for(let i=0;i<phases.length-1;i++) {
    game.phase=phases[i];game.elapsed=phaseSeconds(game);const end=clawPose(game);
    game.phase=phases[i+1];game.elapsed=0;const start=clawPose(game);
    for(const axis of ['x','y','z'])assert.ok(Math.abs(end[axis]-start[axis])<1e-8,`${phases[i]} → ${phases[i+1]} ${axis}`);
  }
  game.phase='lift';game.elapsed=0;const start=clawPose(game);
  assert.ok(Math.abs(start.y-game.plan.offset.y-BED)<1e-8);
  assert.ok(start.y<HIGH);
});

test('reset state is fresh after interruption in every phase', () => {
  for(const phase of PHASE_ORDER) { let game=createGame();begin(game);drop(game);game.phase=phase;game.elapsed=.1;game=createGame();assert.equal(game.phase,'idle');assert.equal(game.plan,null);assert.deepEqual(game.collection,[]);assert.ok(game.toys.every(t=>!t.claimed)); }
});

test('boot imports stay free of eager camera, tracking, and legacy scene dependencies', async () => {
  const visited=new Set();
  async function inspect(url) {
    if(visited.has(url.href))return;visited.add(url.href);
    const source=await readFile(url,'utf8');
    assert.doesNotMatch(source,/getUserMedia|getDisplayMedia|enumerateDevices|vision\.js|vision-worker|from ['"]\.\/scene\.js/);
    for(const match of source.matchAll(/from\s+['"](\.\/.+?\.js)['"]/g))await inspect(new URL(match[1],url));
  }
  await inspect(new URL('../src/arcade.js',import.meta.url));assert.ok(visited.size>=4);
});

test('replay starts where the homed claw stands, without a carriage jump', () => {
 const game=createGame();begin(game);game.position={x:-.38,z:.72};drop(game);finish(game);
 while(homeClaw(game,1/60));const homed=clawPose(game);begin(game);const next=clawPose(game);
 assert.deepEqual(next,homed);assert.ok(next.x>=FIELD.minX&&next.x<=FIELD.maxX);
});

test('a missed grab keeps its fingers open across the lift/result boundary', () => {
 const game=createGame();begin(game);game.position={x:-1.18,z:.6};drop(game);assert.equal(game.plan.prize,null);
 game.phase='lift';game.elapsed=MISS_LIFT;const before=clawPose(game);game.phase='result';game.elapsed=0;const after=clawPose(game);
 assert.deepEqual(before.radii,after.radii);assert.ok(after.radii.every(r=>r===OPEN_RADIUS));
});

 test('mesh-blocked descent retains its height and cannot become a supported catch', () => {
  const game = createGame({ carousel: true }); begin(game);
  game.position = { x: -.38, z: .72 }; drop(game);
  game.phase = 'descend'; game.elapsed = PHASES.descend - .01;
  const stop = HIGH - .2;
  game.plan.low = stop; game.plan.blockedDescent = stop;
  game.plan.touched = game.toys.find(toy => toy.id === 'butter');
  assert.equal(clawPose(game).y, stop);
  advance(game, .02);
  assert.equal(game.phase, 'grip'); assert.equal(clawPose(game).y, stop);
  assert.equal(game.plan.prize, null); assert.equal(game.plan.stop, 'mesh-contact');
  finish(game); assert.deepEqual(game.collection, []);
});
