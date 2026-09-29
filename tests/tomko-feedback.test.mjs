import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, TOMKO_RULES, newStore, currentBoard, startRun, recordTurn, scoreTurn, loadStore, turnContext } from '../src/event-session.js';
import { resolvePlayMode, tomkoPlaySearch } from '../src/play-mode.js';
import { playCollectionCue } from '../src/arcade-audio.js';
import { ToyContacts } from '../src/arcade-contact.js';
import { createGame, begin, drop, HIGH, OPEN_RADIUS, BODY } from '../src/arcade-mechanics.js';

// The mesh replay covers contact geometry; this boundary test covers competing
// sweep candidates, where a floor stop must discard a more distant toy hit.
test('a floor collision before a toy cannot earn contact points', () => {
  for (const [fraction, touched] of [[.99, false], [.1, true]]) {
    const game = createGame({ suspendedClaw: true }); begin(game); drop(game); game.phase = 'descend';
    const pose = { x: 0, y: 2, z: 0, rotation: { x: 0, y: 0, z: 0 }, radii: [OPEN_RADIUS, OPEN_RADIUS, OPEN_RADIUS], carriage: { x: 0, y: 2, z: 0 } };
    game.plan.previousClawPose = { ...pose, y: HIGH, carriage: { x: 0, y: HIGH, z: 0 } };
    let calls = 0;
    const contacts = {
      toys: new Map(game.toys.map(toy => [toy.id, { updateWorldMatrix() {} }])),
      hit: () => calls++ === 0 ? { fraction, toy: game.toys[0], point: { x: 0, y: 0, z: 0 } } : null,
      impact() {},
    };
    ToyContacts.prototype.resolveSuspended.call(contacts, game, pose);
    assert.equal(game.plan.toyContact === true, touched);
    assert.equal(game.plan.stop, touched ? 'mesh-contact' : 'bed');
    assert.equal(scoreTurn(TOMKO_RULES, { prizeId: null, touched: game.plan.toyContact }), touched ? 10 : 0);
  }
});

// Contract: new native receipts may reward actual contact without rewriting
// booth history. Existing zero-miss tests do not cover this per-run rule version.
test('native contact points are capped per turn; catches and browser rules stay unchanged', () => {
  for (const touched of [undefined, false, true]) {
    assert.equal(scoreTurn(TOMKO_RULES, { prizeId: null, remainingMs: 15000, touched }), touched === true ? 10 : 0);
    assert.equal(scoreTurn(RULES, { prizeId: null, remainingMs: 15000, touched }), 0);
    assert.equal(scoreTurn(TOMKO_RULES, { prizeId: 'butter', remainingMs: 15000, touched }), 150);
  }
  assert.equal(scoreTurn(TOMKO_RULES, turnContext([], null, 0, undefined, 'yes')), 0);
  const store = newStore(); const boardId = store.current;
  startRun(store, 'Earlier'); for (let i=1;i<=3;i++) recordTurn(store,i,'butter');
  const earlier = JSON.stringify(currentBoard(store).runs);
  startRun(store, 'New play', false, 'one-hand', TOMKO_RULES);
  recordTurn(store,1,null,0,undefined,true);
  assert.equal(recordTurn(store,1,null,0,undefined,true), null);
  const restored = loadStore({getItem:()=>JSON.stringify(store)});
  assert.equal(restored.current, boardId);
  assert.equal(JSON.stringify(currentBoard(restored).runs), earlier);
  assert.equal(restored.active.turns[0].score,10);
  recordTurn(restored,2,null,0,undefined,false);
  const result=recordTurn(restored,3,'butter',15000,undefined,true);
  assert.equal(result.run.total,160);
  assert.deepEqual(result.run.turns.map(t=>t.score),[10,0,150]);
  assert.equal(recordTurn(restored,4,null,0,undefined,true),null);
  assert.equal(JSON.stringify(currentBoard(restored).runs[0]),JSON.parse(earlier).map(r=>JSON.stringify(r))[0]);
  assert.throws(()=>startRun(restored,'Two',false,'two-hand',TOMKO_RULES),/Invalid run rules/);
});

test('native old URLs cannot enable two hands or experimental rules; browser still can',()=>{
  const search='?controls=dual&toys=collection&steer=absolute&hold=200&contact=push&claw=rigid&setup=manual';
  const mode=resolvePlayMode(tomkoPlaySearch(search));
  assert.equal(mode.profile,'hold-drop'); assert.equal(mode.collection,false); assert.equal(mode.suspendedClaw,true);
  assert.equal(mode.holdMs,undefined); assert.equal(mode.steering,'relative');
  assert.equal(resolvePlayMode(search).dual,true);
  assert.equal(new URLSearchParams(tomkoPlaySearch(search)).get('setup'),'manual');
});

test('touch acknowledgement is finite and distinct from a caught-toy celebration',()=>{
  const capture=kind=>{const notes=[];playCollectionCue({note:(...args)=>notes.push(args)},kind);return notes;};
  const touch=capture('touch'),caught=capture('ordinary');
  assert.equal(touch.length,2);assert.ok(caught.length>touch.length);
  assert.ok(touch.every(n=>n[1]+n[2]<.5));
});

// Contract: changing art must not create new scoring IDs, precision rules or a
// new board. Existing receipt tests do not cover replacement toy definitions.
test('refreshed booth toys retain score identities, rewards, slots and familiar catch area', () => {
  const old = createGame({ carousel: true, suspendedClaw: true });
  const fresh = createGame({ carousel: true, suspendedClaw: true, boothToys: true });
  assert.deepEqual(fresh.toys.map(t => t.id), old.toys.map(t => t.id));
  assert.equal(fresh.collectionPreview, false);
  for (const toy of fresh.toys) {
    const prior = old.toys.find(t => t.id === toy.id);
    assert.deepEqual([toy.x, toy.z, toy.elevation], [prior.x, prior.z, prior.elevation]);
    if (!['blue-hour', 'peach'].includes(toy.id)) assert.deepEqual(toy, prior);
    const area = t => BODY[t.family].rx * BODY[t.family].rz * t.scale ** 2;
    assert.ok(Math.abs(area(toy) / area(prior) - 1) < .02, `${toy.id}: support area stays within 2%`);
    for (const remainingMs of [0, 7500, 15000]) {
      assert.equal(scoreTurn(TOMKO_RULES, { prizeId: toy.id, remainingMs }), (toy.id === 'sprout' ? 200 : 100) + Math.floor(50 * remainingMs / 15000));
    }
  }
  assert.equal(fresh.toys.find(t => t.id === 'blue-hour').family, 'bear');
  assert.equal(fresh.toys.find(t => t.id === 'peach').family, 'panda');
});
