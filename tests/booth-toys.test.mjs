import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, BODY } from '../src/arcade-mechanics.js';
import { RULES, scoreTurn } from '../src/event-session.js';

// Art must preserve receipt identities and reward values. Existing mechanics
// tests cover the original assortment, not the replacement bodies and scales.
test('booth art preserves score IDs, slots, rewards and comparable support areas', () => {
  const old = createGame({ carousel: true });
  const fresh = createGame({ carousel: true, boothToys: true });
  assert.deepEqual(fresh.toys.map(t => t.id), old.toys.map(t => t.id));
  for (const toy of fresh.toys) {
    const prior = old.toys.find(t => t.id === toy.id);
    assert.deepEqual([toy.x, toy.z, toy.elevation], [prior.x, prior.z, prior.elevation]);
    if (!['blue-hour', 'peach'].includes(toy.id)) assert.deepEqual(toy, prior);
    const area = t => BODY[t.family].rx * BODY[t.family].rz * t.scale ** 2;
    assert.ok(Math.abs(area(toy) / area(prior) - 1) < .02);
    assert.equal(scoreTurn(RULES, { prizeId: toy.id, remainingMs: 0 }), RULES.points[toy.id]);
  }
  assert.equal(fresh.toys.find(t => t.id === 'blue-hour').family, 'bear');
  assert.equal(fresh.toys.find(t => t.id === 'peach').family, 'panda');
});
