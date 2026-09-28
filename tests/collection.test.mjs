import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, planGrab, catchQuality, advance } from '../src/arcade-mechanics.js';
import { COLLECTION_RULES, RULES, newStore, startRun, recordTurn, currentBoard, loadStore, scoreTurn, turnContext, rotateBoard } from '../src/event-session.js';
import { resolvePlayMode } from '../src/play-mode.js';
import { playCollectionCue } from '../src/arcade-audio.js';

// Contract: the new rules and assortment cannot leak into hosted/default play.
// Existing profile tests predate the collection flag and isolated rule storage.
test('collection is an isolated local steel-claw preview', () => {
  const mode = resolvePlayMode('?toys=collection&contact=push&claw=rigid');
  assert.equal(mode.collection, true); assert.equal(mode.suspendedClaw, true); assert.equal(mode.pushContact, false);
  assert.notEqual(mode.storageKey, resolvePlayMode().storageKey);
  assert.equal(resolvePlayMode('?toys=collection', true).collection, false);
  assert.equal(resolvePlayMode('?toys=collection', true).storageKey, resolvePlayMode('', true).storageKey);
  assert.equal(createGame({ carousel: true }).collectionPreview, false);
  assert.deepEqual(createGame({ carousel: true }).toys.map(t => t.id), ['bonbon', 'miso', 'blue-hour', 'peach', 'sprout', 'butter']);
});

// Contract: a visible choice corresponds to a different geometric challenge.
// Sample the owner envelope, not screenshots or a parallel mock scoring engine.
test('all six targets are reachable and stationary tiers follow catchable area', () => {
  const game = createGame({ carousel: true, collection: true });
  assert.equal(game.toys.length, 6); assert.deepEqual(game.collection, []);
  const areas = {};
  for (const toy of game.toys) {
    assert.equal(planGrab(toy, game.toys).prize?.id, toy.id);
    let area = 0;
    for (let x = -.2; x <= .2; x += .01) for (let z = -.2; z <= .2; z += .01) {
      if (planGrab({ x: toy.x + x, z: toy.z + z }, game.toys).prize?.id === toy.id) area++;
    }
    areas[toy.id] = area;
  }
  for (const safe of ['bramble', 'miso']) for (const precise of ['bonbon', 'butter']) assert.ok(areas[safe] > areas[precise]);
  for (const precise of ['bonbon', 'butter']) assert.ok(areas[precise] > areas.mochi);
});

// Contract: precision is determined at support contact and is void after a
// mesh failure. Earlier tests verify binary catches, not bonus truthfulness.
test('centred and off-centre grips differ, but a failed mesh contact cannot be perfect', () => {
  const game = createGame({ carousel: true, collection: true, suspendedClaw: true });
  const toy = game.toys.find(t => t.id === 'butter');
  const centred = planGrab(toy, game.toys);
  const edge = planGrab({ x: toy.x + .075, z: toy.z }, game.toys);
  assert.equal(catchQuality(centred), 'perfect');
  assert.equal(edge.prize?.id, 'butter'); assert.equal(catchQuality(edge), 'ordinary');
  assert.equal(catchQuality({ ...centred, prize: null }), 'miss');
  game.suspendedClaw = true; game.phase = 'grip'; game.elapsed = .85;
  game.plan = { ...centred, gripContacts: ['butter', null, 'butter'] };
  // At the lift boundary all three physical contacts must still be present.
  advance(game, 0.000001);
  assert.equal(catchQuality(game.plan), 'miss');
});

// Contract: a precision score survives reload, counts once, and cannot be
// forged by treating a miss as perfect. Existing persistence covers speed only.
test('precision scores survive reload and exactly three turns, separate from speed', () => {
  let store = newStore(COLLECTION_RULES); startRun(store, 'Mochi');
  recordTurn(store, 1, 'butter', 0, 'perfect');
  assert.equal(recordTurn(store, 1, 'butter', 0, 'perfect'), null);
  store = loadStore({ getItem: () => JSON.stringify(store) }, COLLECTION_RULES);
  assert.equal(store.active.turns[0].quality, 'perfect');
  assert.equal(store.active.turns[0].score, 200);
  recordTurn(store, 2, 'miso', 15000, 'ordinary');
  const result = recordTurn(store, 3, null, 15000, 'miss');
  assert.equal(result.run.total, 300); assert.equal(currentBoard(store).runs.length, 1);
  assert.equal(recordTurn(store, 4, 'sprout', 0, 'perfect'), null);
  rotateBoard(store, 'Next collection', COLLECTION_RULES);
  assert.equal(currentBoard(store).rules.version, COLLECTION_RULES.version);
  for (const quality of [undefined, 'other', 'perfect']) assert.throws(() => scoreTurn(COLLECTION_RULES, turnContext([], null, 0, quality)));
  assert.throws(() => scoreTurn(COLLECTION_RULES, turnContext([], 'butter', 0, 'miss')));
  assert.equal(scoreTurn(RULES, turnContext([], 'butter', 15000, 'perfect')), 150, 'legacy scores ignore precision');
});

test('corrupt active precision receipts are rejected on recovery', () => {
  const store = newStore(COLLECTION_RULES); startRun(store, 'Mochi'); recordTurn(store, 1, 'butter', 0, 'perfect');
  store.active.turns[0].quality = 'ordinary';
  assert.throws(() => loadStore({ getItem: () => JSON.stringify(store) }, COLLECTION_RULES));
});

// Contract: dramatic cues are finite, distinct and fit existing phase timing.
// Audio lifecycle cancellation is exercised by the browser audio suite.
test('dramatic outcomes have distinct finite phrases without changing the audio master', () => {
  const phrases = {};
  for (const kind of ['anticipate', 'descend', 'grip', 'ordinary', 'perfect', 'miss']) {
    const notes = []; playCollectionCue({ note: (...args) => notes.push(args) }, kind); phrases[kind] = notes;
    assert.ok(notes.length);
    for (const [frequency, duration, delay, , endFrequency, level] of notes) {
      assert.ok(frequency > 0 && endFrequency > 0 && duration > 0 && delay >= 0);
      assert.ok(duration + delay <= 1.21); assert.ok(level <= .10);
    }
  }
  assert.ok(phrases.perfect.length > phrases.ordinary.length);
  assert.ok(phrases.miss.every(([f, , , , end]) => end < f));
});
