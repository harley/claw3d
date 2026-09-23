import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlayMode, cueLeadSeconds, firstTurnControlReady } from '../src/play-mode.js';
import { STORAGE_KEY } from '../src/event-session.js';
import { HAND_ACQUIRE_MS, RIGHT_SLAM_MS } from '../src/dual-hand-controls.js';
import { PRESS_MS } from '../src/grab-release.js';

test('play mode resolves once from the URL and the shared gate', () => {
  const rows = [
    ['', false, { profile: 'hold-drop', dual: false, grab: false, controlMode: 'one-hand', storageKey: STORAGE_KEY, holdMs: undefined, steering: 'relative' }],
    ['?controls=grab', false, { profile: 'grab-release', dual: false, grab: true, controlMode: 'one-hand', storageKey: `${STORAGE_KEY}:cabinet-controls` }],
    ['?controls=dual', false, { profile: 'dual', dual: true, grab: true, controlMode: 'two-hand', storageKey: `${STORAGE_KEY}:dual-controls` }],
    ['?controls=banana', false, { profile: 'hold-drop', dual: false, grab: false, storageKey: STORAGE_KEY }],
    ['?hold=300&steer=absolute', false, { holdMs: 300, steering: 'absolute' }],
    ['?hold=100', false, { holdMs: undefined }],
    ['?hold=950', false, { holdMs: undefined }],
    ['?controls=dual', true, { profile: 'dual', dual: true, controlMode: 'two-hand', shared: true }],
    ['?controls=grab', true, { profile: 'hold-drop', grab: false }],
    ['?hold=300&steer=absolute', true, { holdMs: undefined, steering: 'relative' }],
  ];
  for (const [search, shared, expected] of rows) {
    const mode = resolvePlayMode(search, shared);
    for (const [key, value] of Object.entries(expected)) assert.equal(mode[key], value, `${search} shared=${shared} ${key}`);
    assert.equal(mode.cabinet, true); assert.ok(Object.isFrozen(mode));
  }
});

test('the cue lead is one helper for every surface', () => {
  assert.equal(cueLeadSeconds({}), undefined, 'default fist hold');
  assert.equal(cueLeadSeconds({ holdMs: 300 }), .3);
  assert.equal(cueLeadSeconds({ grab: true }), PRESS_MS / 1000);
  assert.equal(cueLeadSeconds({ dual: true }), (HAND_ACQUIRE_MS + RIGHT_SLAM_MS) / 1000, 'a right hand not yet acquired');
  assert.equal(cueLeadSeconds({ dual: true }, { hands: { right: { ready: true } } }), RIGHT_SLAM_MS / 1000, 'an acquired right hand only needs the strike');
});

test('first-turn readiness follows the selected profile and requires fresh usable hands', () => {
  const oneHand = resolvePlayMode('', false), grab = resolvePlayMode('?controls=grab', false), dual = resolvePlayMode('?controls=dual', false);
  assert.equal(firstTurnControlReady(oneHand, { profile: 'hold-drop', kind: 'tracking', handCount: 1, open: true, closed: false }), true);
  assert.equal(firstTurnControlReady(oneHand, { profile: 'hold-drop', kind: 'tracking', handCount: 1, open: false, closed: false }), false, 'an ambiguous pose is not positive open-hand evidence');
  assert.equal(firstTurnControlReady(oneHand, { profile: 'hold-drop', kind: 'tracking', handCount: 1 }), false, 'missing openness evidence cannot pass readiness');
  assert.equal(firstTurnControlReady(oneHand, { profile: 'hold-drop', kind: 'tracking', handCount: 1, closed: true }), false, 'a closed fist cannot pass readiness');
  assert.equal(firstTurnControlReady(oneHand, { profile: 'hold-drop', kind: 'tracking', handCount: 2, closed: false }), false);
  assert.equal(firstTurnControlReady(oneHand, { profile: 'hold-drop', kind: 'clenching', handCount: 1 }), false);
  assert.equal(firstTurnControlReady(oneHand, { profile: 'grab-release', kind: 'tracking', handCount: 1 }), false, 'a different effective profile cannot start prep');
  assert.equal(firstTurnControlReady(grab, { profile: 'grab-release', kind: 'tracking', handCount: 1, grab: { stage: 'seeking' }, open: true, closed: false }), true);
  assert.equal(firstTurnControlReady(grab, { profile: 'grab-release', kind: 'tracking', handCount: 1, grab: { stage: 'seeking' }, open: false, closed: false }), false);
  assert.equal(firstTurnControlReady(grab, { profile: 'grab-release', kind: 'tracking', handCount: 1, grab: { stage: 'seeking' }, closed: true }), false);
  assert.equal(firstTurnControlReady(grab, { profile: 'grab-release', kind: 'tracking', handCount: 1, grab: { stage: 'gripped' }, closed: true }), true, 'an acquired joystick grip is ready');
  const hands = { left: { ready: true, open: true, closed: false }, right: { ready: true, open: true, closed: false } };
  assert.equal(firstTurnControlReady(dual, { profile: 'dual', kind: 'tracking', hands }), true);
  assert.equal(firstTurnControlReady(dual, { profile: 'dual', kind: 'tracking', hands: { ...hands, right: { ready: true, open: false, closed: false } } }), false, 'a tracked ambiguous pose is not ready');
  assert.equal(firstTurnControlReady(dual, { profile: 'dual', kind: 'tracking', hands: { ...hands, right: { ready: false, closed: false } } }), false);
  assert.equal(firstTurnControlReady(dual, { profile: 'dual', kind: 'tracking', hands: { ...hands, left: { ready: true, closed: true } } }), false);
});
