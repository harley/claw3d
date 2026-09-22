import test from 'node:test';
import assert from 'node:assert/strict';
import { rimColorFor, marqueeGlowFor, RIM_COLORS, BLOOM_LAYER } from '../src/arcade-fx.js';

test('the rim light answers aim, catch and miss, and rests otherwise', () => {
  assert.equal(rimColorFor({ phase: 'aim', aligned: false }), RIM_COLORS.base);
  assert.equal(rimColorFor({ phase: 'aim', aligned: true }), RIM_COLORS.aligned);
  for (const phase of ['lift', 'transfer', 'release', 'deliver', 'reveal']) {
    assert.equal(rimColorFor({ phase, prize: true }), RIM_COLORS.catch, phase);
    assert.equal(rimColorFor({ phase, prize: false }), RIM_COLORS.miss, phase);
  }
  for (const phase of ['idle', 'anticipate', 'descend', 'grip', 'result']) assert.equal(rimColorFor({ phase, aligned: true, prize: true }), RIM_COLORS.base, phase);
});

test('the marquee light follows the lit pattern: strobe on a jackpot, chase on delivery, glow at rest', () => {
  assert.ok(marqueeGlowFor('j0') > marqueeGlowFor('d1') && marqueeGlowFor('d1') > marqueeGlowFor('i2') && marqueeGlowFor('i2') > marqueeGlowFor('rest'));
  assert.ok(marqueeGlowFor('j1') < 1, 'the jackpot strobe has an off beat');
  assert.equal(marqueeGlowFor('js'), 4.5, 'reduced motion holds the bright beat');
  assert.equal(BLOOM_LAYER, 1);
});
