import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedBoard } from '../src/shared-board.js';

// A shared-IP throttle must not be retried by every timer tick or START click.
// Session API tests do not exercise the board's initialization retry lifecycle.
test('public initialization honors Retry-After and backs off subsequent outages', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(JSON.stringify({ error: 'Temporarily unavailable' }), {
      status: requests === 1 ? 429 : 503,
      headers: requests === 1 ? { 'Retry-After': '60' } : {},
    });
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous); else delete globalThis.sessionStorage; });
  const board = createSharedBoard({ enabled: true, publicPlay: true,
    getCompletedRun: () => null, onSaved: () => {}, onBoard: () => {}, onSyncState: () => {}, onConnectError: () => {} });
  const start = () => assert.rejects(board.start('Player', 'request'), /Temporarily unavailable/);
  await start();
  for (let i = 0; i < 29; i++) { t.mock.timers.tick(2000); await start(); }
  assert.equal(requests, 1, 'the server-requested minute is respected');
  t.mock.timers.tick(2000); await start();
  assert.equal(requests, 2);
  t.mock.timers.tick(4000); await start();
  assert.equal(requests, 2, 'the second failure backs off beyond the normal two-second tick');
  t.mock.timers.tick(6000); await start();
  assert.equal(requests, 3, 'recovery is retried after the bounded backoff');
});
