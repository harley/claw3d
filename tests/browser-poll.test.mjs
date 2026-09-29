import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForAsync } from './browser-poll.mjs';

// Regression: Promise<false> must not satisfy browser lifecycle readiness.
test('asynchronous false readiness is retried and persistent false times out', async () => {
  let calls = 0;
  const page = { evaluate: async () => ++calls >= 2 };
  await waitForAsync(page, () => {}, undefined, { timeout: 1000 });
  assert.equal(calls, 2);
  await assert.rejects(waitForAsync({ evaluate: async () => false }, () => {}, undefined, { timeout: 0 }), /Timed out/);
  await assert.rejects(waitForAsync({ evaluate: () => new Promise(() => {}) }, () => {}, undefined, { timeout: 10 }), /Timed out/);
});
