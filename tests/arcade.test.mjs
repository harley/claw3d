import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ASSORTMENT, BED, FIELD, FINGER_ANGLES, OPEN_RADIUS, FINGER_DEPTH, HIGH, PHASES, PHASE_ORDER, MISS_LIFT, MISS_REASONS, CAROUSEL, phaseSeconds, MAX_FRAME_DELTA, createGame, begin, drop, advance, move, planGrab, clawPose, collectionSlot } from '../src/arcade-mechanics.js';

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

test('a catch still travels to the chute and the next turn starts there', () => {
 const game = createGame(); begin(game); drop(game); assert.ok(game.plan.prize);
 for (let i = 0; i < 2000 && game.phase !== 'result'; i++) advance(game, 1 / 120);
 assert.equal(game.phase, 'result');
 const pose = clawPose(game); assert.ok(Math.abs(pose.x - (-1.08 - game.plan.offset.x)) < 1e-9);
 assert.ok(begin(game)); assert.ok(Math.abs(game.position.x - pose.x) < 1e-9);
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

test('replay starts at the returned claw position without a carriage jump', () => {
 const game=createGame();begin(game);drop(game);finish(game);const returned=clawPose(game);begin(game);const next=clawPose(game);
 assert.deepEqual(next,returned);assert.ok(next.x>=FIELD.minX&&next.x<=FIELD.maxX);
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

test('every miss carries a reason a player can act on', () => {
  const game = createGame({ carousel: true }); const toy = id => game.toys.find(t => t.id === id);
  // Clearly over a toy but off-centre: fingers cannot all reach it.
  const slipped = planGrab({ x: toy('butter').x + .20, z: toy('butter').z }, game.toys);
  assert.equal(slipped.prize, null); assert.equal(slipped.reason, 'slipped'); assert.equal(slipped.touched.id, 'butter');
  // Barely off the support triangle with all three fingers touching.
  let near = null;
  for (let d = .02; d < .24 && !near; d += .005) { const plan = planGrab({ x: toy('butter').x + d, z: toy('butter').z + d * .3 }, game.toys); if (!plan.prize && plan.contacts.every(r => r != null)) near = plan; }
  assert.ok(near, 'an all-contact unsupported pose exists'); assert.equal(near.reason, 'near'); assert.equal(near.blocker, null);
  // Nothing under the claw at all.
  const empty = planGrab({ x: -1.18, z: .6 }, game.toys);
  assert.equal(empty.reason, 'empty'); assert.equal(empty.stop, 'bed');
  // A finger landing on a neighbour stops the descent above it.
  const blocked = planGrab({ x: toy('miso').x + OPEN_RADIUS * .55, z: toy('miso').z + OPEN_RADIUS * .55 }, game.toys);
  if (blocked.stop === 'neighbour') { assert.equal(blocked.reason, 'blocked'); assert.equal(blocked.blocker, 'miso'); }
  // A supported toy jammed against another cannot be lifted through it.
  const crowded = createGame(); const cirrus = crowded.toys.find(t => t.id === 'cirrus'), butter = crowded.toys.find(t => t.id === 'butter');
  cirrus.x = butter.x + .30; cirrus.z = butter.z;
  const jammed = planGrab({ x: butter.x, z: butter.z }, crowded.toys);
  assert.equal(jammed.prize, null); assert.equal(jammed.reason, 'crowded'); assert.equal(jammed.blocker, 'cirrus'); assert.equal(jammed.touched.id, 'butter');
  // A drop over the carousel deck with the star elsewhere is a timing miss.
  const timing = createGame({ carousel: true }); begin(timing); timing.position = { x: CAROUSEL.x, z: CAROUSEL.z }; timing.carouselTime = 0; drop(timing);
  assert.equal(timing.plan.stop, 'platform');
  advance(timing, PHASES.anticipate + PHASES.descend + .01);
  assert.equal(timing.phase, 'grip'); assert.equal(timing.plan.prize, null);
  if (!timing.plan.touched) { assert.equal(timing.plan.reason, 'platform'); assert.equal(timing.plan.stop, 'platform'); }
  // A supported grab reports success, and the reason set is closed.
  assert.equal(planGrab({ x: toy('butter').x, z: toy('butter').z }, game.toys).reason, 'supported');
  assert.deepEqual([...MISS_REASONS].sort(), ['blocked', 'bumped', 'crowded', 'empty', 'near', 'platform', 'slipped']);
});
