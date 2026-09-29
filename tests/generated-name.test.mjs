import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedName } from '../src/hand-menu.js';

// Contract: a replay never inherits the previous callsign, even if the RNG
// selects the same slot. Browser journeys separately exercise replay wiring.
test('generated replay names exclude the previous name without retrying randomness', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: values => { values.fill(0); return values; } } });
  try {
    assert.equal(generatedName(), '🦀 Coral');
    assert.equal(generatedName('🦀 Coral'), '🦀 Pebble');
    assert.equal(generatedName('Nẽt'), '🦀 Coral');
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});
