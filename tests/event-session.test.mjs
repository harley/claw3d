import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, STORAGE_KEY, newStore, loadStore, currentBoard, startRun, recordTurn, leaderboard, rotateBoard } from '../src/event-session.js';
import { createGame, planGrab, FIELD } from '../src/arcade-mechanics.js';
test('three drops produce exactly one total; duplicate and extra results are ignored', () => {
  const store = newStore(); startRun(store, ' Linh ');
  assert.equal(recordTurn(store, 2, 'butter'), null);
  assert.equal(recordTurn(store, 1, 'butter').completed, false);
  assert.equal(recordTurn(store, 1, 'butter'), null);
  recordTurn(store, 2, null); const result = recordTurn(store, 3, 'sprout');
  assert.equal(result.run.total, 300); assert.equal(result.completed, true); assert.equal(store.active, null);
  assert.equal(recordTurn(store, 3, 'sprout'), null); assert.equal(currentBoard(store).runs.length, 1);
});
test('practice is saved but unranked; tied totals share rank; boards preserve history', () => {
  const store = newStore();
  for (const [name, practice, toy] of [['A', false, 'butter'], ['B', false, 'butter'], ['C', false, null], ['D', true, 'sprout']]) {
    startRun(store, name, practice); for (let i = 1; i <= 3; i++) recordTurn(store, i, toy);
  }
  assert.deepEqual(leaderboard(currentBoard(store)).map(r => [r.name, r.rank]), [['A', 1], ['B', 1], ['C', 3]]);
  rotateBoard(store, 'Afternoon'); assert.equal(leaderboard(currentBoard(store)).length, 0); assert.equal(store.boards[0].runs.length, 4);
});
test('active player survives storage and holds a rules snapshot; cannot rotate or replace mid-run', () => {
  const store = newStore(); const run = startRun(store, 'Hà'); recordTurn(store, 1, 'butter');
  assert.notEqual(run.rules, currentBoard(store).rules); assert.equal(run.badgeId, null);
  assert.throws(() => startRun(store, 'Other')); assert.throws(() => rotateBoard(store, 'Other'));
  const restored = loadStore({ getItem: key => { assert.equal(key, STORAGE_KEY); return JSON.stringify(store); } });
  assert.equal(restored.active.turns[0].score, 100); assert.equal(restored.active.playerId, run.playerId);
  assert.throws(() => loadStore({ getItem: () => '{invalid' }));
  assert.throws(() => recordTurn(store, 2, 'unknown'));
});
test('stationary toys have one value and the moving star is the only jackpot', () => {
  const game = createGame({ carousel: true });
  assert.equal(game.toys.length, 6);
  assert.deepEqual(Object.keys(RULES.points).sort(), game.toys.map(t => t.id).sort());
  for (const toy of game.toys) assert.equal(RULES.points[toy.id], toy.id === 'sprout' ? 200 : 100);
  assert.equal(planGrab({ x: -1.12, z: .66 }, game.toys).prize, null);
});
test('old scores and unfinished runs survive a rules upgrade on a separate board', () => {
  const store = newStore();
  const legacy = { version: 'cloud-day-v1', turns: 3, seconds: 15, points: { bonbon: 100, miso: 100, pip: 150, lilac: 150, 'blue-hour': 100, peach: 100, cocoa: 100, sprout: 200, butter: 150, cirrus: 200, otto: 200 } };
  currentBoard(store).rules = legacy;
  startRun(store, 'Earlier'); for (let i = 1; i <= 3; i++) recordTurn(store, i, 'butter');
  startRun(store, 'Interrupted'); recordTurn(store, 1, 'pip');
  const upgraded = loadStore({ getItem: () => JSON.stringify(store) });
  assert.equal(upgraded.boards[0].runs[0].total, 450);
  assert.equal(upgraded.boards[0].interruptedRuns[0].turns[0].score, 150);
  assert.equal(upgraded.active, null); assert.equal(upgraded.boards.length, 2);
  assert.equal(currentBoard(upgraded).rules.version, RULES.version);
  assert.equal(leaderboard(currentBoard(upgraded)).length, 0);
  assert.equal(loadStore({ getItem: () => JSON.stringify(upgraded) }).boards.length, 2);
});
