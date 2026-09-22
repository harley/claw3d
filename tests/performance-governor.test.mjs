import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceGovernor } from '../src/performance-governor.js';

const healthy = { averageFps: 30, resultHz: 18, results: 90, rejected: 1 };
const slowRender = { averageFps: 18, resultHz: 18, results: 90, rejected: 0 };
const staleCamera = { averageFps: 30, resultHz: 5, results: 25, rejected: 25 };

test('sustained slow rendering enters simple mode without reacting to one bad window', () => {
  const changes = [], governor = new PerformanceGovernor({ onChange: mode => changes.push(mode) });
  assert.equal(governor.observe(slowRender), 'full');
  assert.equal(governor.observe(healthy), 'full');
  governor.observe(slowRender);
  assert.equal(governor.observe(slowRender), 'simple');
  assert.deepEqual(changes, ['simple']);
});

test('camera rejects trigger adaptation and recovery requires a stable healthy period', () => {
  const changes = [], governor = new PerformanceGovernor({ onChange: mode => changes.push(mode) });
  governor.observe(staleCamera); governor.observe(staleCamera);
  assert.equal(governor.mode, 'simple');
  for (let i = 0; i < 5; i++) governor.observe(healthy);
  assert.equal(governor.mode, 'simple');
  governor.observe(healthy);
  assert.equal(governor.mode, 'full');
  assert.deepEqual(changes, ['simple', 'full']);
});

test('small camera samples do not cause a mode change', () => {
  const governor = new PerformanceGovernor();
  for (let i = 0; i < 4; i++) governor.observe({ averageFps: 30, resultHz: 1, results: 1, rejected: 1 });
  assert.equal(governor.mode, 'full');
});

test('an operator selection stays pinned and reports its source', () => {
  const changes = [], governor = new PerformanceGovernor({ onChange: (mode, source) => changes.push([mode, source]) });
  governor.setMode('simple', 'operator');
  for (let i = 0; i < 8; i++) governor.observe(healthy);
  assert.equal(governor.mode, 'simple');
  governor.setMode('full', 'operator');
  for (let i = 0; i < 4; i++) governor.observe(slowRender);
  assert.equal(governor.mode, 'full');
  assert.deepEqual(changes, [['simple', 'operator'], ['full', 'operator']]);
});

test('without camera samples the governor still adapts to rendering alone', () => {
  const changes = [], governor = new PerformanceGovernor({ onChange: mode => changes.push(mode) });
  const noCamera = { averageFps: 18, resultHz: 0, results: 0, rejected: 0 };
  governor.observe(noCamera); governor.observe(noCamera);
  assert.equal(governor.mode, 'simple');
  for (let i = 0; i < 6; i++) governor.observe({ averageFps: 60, resultHz: 0, results: 0, rejected: 0 });
  assert.equal(governor.mode, 'full');
  assert.deepEqual(changes, ['simple', 'full']);
});
