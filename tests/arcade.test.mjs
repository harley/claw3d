import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ASSORTMENT, BED, FIELD, FINGER_ANGLES, OPEN_RADIUS, FINGER_DEPTH, HIGH, PHASES, MAX_FRAME_DELTA, createGame, begin, drop, advance, move, planGrab, clawPose, collectionSlot } from '../src/arcade-mechanics.js';

const finish = game => { for (let i = 0; i < 1500 && game.phase !== 'result'; i++) advance(game, 1 / 60); assert.equal(game.phase, 'result'); };

test('phase pacing stays readable while cutting passive wait, and 10 FPS is real time', () => {
  const delivery = Object.values(PHASES).reduce((sum, seconds) => sum + seconds, 0);
  assert.equal(delivery, 8.8);
  assert.equal(MAX_FRAME_DELTA, .1);
  const game = createGame(); begin(game); drop(game);
  for (let i = 0; i < 10; i++) advance(game, MAX_FRAME_DELTA);
  assert.ok(Math.abs(game.elapsed - .8) < 1e-9);
  assert.equal(game.phase, 'descend');
});

test('a miss returns home without empty delivery, with one drop and no score', () => {
 const game = createGame({ carousel: true }); begin(game); game.position = { x: -1.18, z: .6 }; drop(game);
 const phases = new Set(); let elapsed = 0;
 while (game.phase !== 'result' && elapsed < 15) { phases.add(game.phase); advance(game, .01); elapsed += .01; }
 assert.equal(game.phase, 'result'); assert.equal(game.plan.prize, null);
 assert.ok(elapsed < 6, 'miss completes in under six simulation seconds from drop');
 for (const phase of ['release', 'deliver', 'reveal']) assert.equal(phases.has(phase), false);
 assert.equal(game.rounds, 1); assert.deepEqual(game.collection, []);
 game.phase = 'transfer'; game.elapsed = PHASES.transfer;
 const returning = clawPose(game); game.phase = 'result'; game.elapsed = 0;
 assert.deepEqual(clawPose(game), returning, 'return-to-result pose stays continuous');
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
  game.position = {x:-1.18,z:.6}; begin(game); drop(game);
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
  const game=createGame(); assert.equal(drop(game),false); begin(game); assert.equal(drop(game),true);
  for(let i=0;i<1500 && game.phase!=='result';i++) { assert.equal(drop(game),false); assert.equal(begin(game),false); advance(game,1/60); }
  assert.equal(game.rounds,1); assert.deepEqual(game.collection,['butter']);
  begin(game); drop(game); finish(game); assert.equal(game.rounds,2); assert.deepEqual(game.collection,['butter']);
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
  const phases=Object.keys(PHASES);
  for(let i=0;i<phases.length-1;i++) {
    game.phase=phases[i];game.elapsed=PHASES[game.phase];const end=clawPose(game);
    game.phase=phases[i+1];game.elapsed=0;const start=clawPose(game);
    for(const axis of ['x','y','z'])assert.ok(Math.abs(end[axis]-start[axis])<1e-8,`${phases[i]} → ${phases[i+1]} ${axis}`);
  }
  game.phase='lift';game.elapsed=0;const start=clawPose(game);
  assert.ok(Math.abs(start.y-game.plan.offset.y-BED)<1e-8);
  assert.ok(start.y<HIGH);
});

test('reset state is fresh after interruption in every phase', () => {
  for(const phase of Object.keys(PHASES)) { let game=createGame();begin(game);drop(game);game.phase=phase;game.elapsed=.1;game=createGame();assert.equal(game.phase,'idle');assert.equal(game.plan,null);assert.deepEqual(game.collection,[]);assert.ok(game.toys.every(t=>!t.claimed)); }
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

test('replay starts at the returned claw position without a carriage jump', () => {
 const game=createGame();begin(game);drop(game);finish(game);const returned=clawPose(game);begin(game);const next=clawPose(game);
 assert.deepEqual(next,returned);assert.ok(next.x>=FIELD.minX&&next.x<=FIELD.maxX);
});

test('a missed grab keeps its fingers open across the lift/transfer boundary', () => {
 const game=createGame();begin(game);game.position={x:-1.18,z:.6};drop(game);assert.equal(game.plan.prize,null);
 game.phase='lift';game.elapsed=PHASES.lift;const before=clawPose(game);game.phase='transfer';game.elapsed=0;const after=clawPose(game);
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
