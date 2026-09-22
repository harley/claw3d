import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlayMode, cueLeadSeconds } from '../src/play-mode.js';
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
