import test from 'node:test';
import assert from 'node:assert/strict';
import { journalFixture } from './public-journal-fixture.mjs';
import { createSharedBoard } from '../src/shared-board.js';
import { RULES } from '../src/event-session.js';
import { setImmediate } from 'node:timers/promises';

test('START after a refused journal lock resumes automatic three-turn score sync', async t => {
  const fixture = journalFixture(), owner = await fixture.open();
  t.after(() => owner.close());
  for (const name of ['localStorage', 'sessionStorage']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name), data = new Map();
    Object.defineProperty(globalThis, name, { configurable: true, value: {
      get length() { return data.size; }, key: i => [...data.keys()][i],
      getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key),
    } });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  const issued = { id: crypto.randomUUID(), boardId: 'public', name: 'Lan', rules: RULES, status: 'active', turns: [] };
  const turns = [1, 2, 3].map(turn => ({ turn, prizeId: null, remainingMs: 0, score: 0 }));
  const requests = [], received = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(url);
    if (url === '/api/play/session') return Response.json({ role: 'public', board: { runs: [] } });
    if (url === '/api/play/board') return Response.json({ runs: [] });
    if (url === '/api/play/runs') return Response.json(issued);
    assert.equal(url, `/api/play/runs/${issued.id}/turns`);
    received.push(JSON.parse(options.body).turn);
    return Response.json({ ...issued, turns: turns.slice(0, received.length), status: received.length === 3 ? 'complete' : 'active', total: 0, rank: 1 });
  });
  const refused = Promise.withResolvers(), saved = Promise.withResolvers(), drained = Promise.withResolvers();
  let receiptSaved = false;
  const board = createSharedBoard({ enabled: true, publicPlay: true, journalFactory: fixture.open,
    getCompletedRun: () => null, onSaved: receipt => { receiptSaved = true; saved.resolve(receipt); }, onBoard: () => {},
    onSyncState: state => { if (receiptSaved && state.pending === 0) drained.resolve(); }, onConnectError: refused.resolve });
  t.after(() => board.dispose());
  board.connect();
  assert.match((await refused.promise).message, /Another tab/);
  await setImmediate(); // Let the scheduler settle into its initialization hold.
  assert.deepEqual(requests, [], 'lock refusal sends no network requests');
  owner.close(); await setImmediate();
  const run = await board.start('Lan', crypto.randomUUID());
  await board.queue({ ...run, turns });
  let deadline;
  const timeout = new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('Automatic score sync did not resume after START')), 5000); });
  t.after(() => clearTimeout(deadline));
  const [receipt] = await Promise.race([Promise.all([saved.promise, drained.promise]), timeout]);
  assert.equal(receipt.id, issued.id); assert.equal(receipt.status, 'complete');
  assert.deepEqual(received, [1, 2, 3]);
  assert.equal(requests.filter(url => url === '/api/play/runs').length, 1, 'only one physical attempt is admitted');
  assert.equal(board.state().pending, 0);
});

// A shared-IP throttle must not be retried by every timer tick or START click.
// Session API tests do not exercise the board's initialization retry lifecycle.
test('public initialization honors Retry-After and backs off subsequent outages', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  t.mock.method(Math, 'random', () => .5);
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
  const board = createSharedBoard({ enabled: true, publicPlay: true, journalFactory: journalFixture().open,
    getCompletedRun: () => null, onSaved: () => {}, onBoard: () => {}, onSyncState: () => {}, onConnectError: () => {} });
  t.after(() => board.dispose());
  const start = () => assert.rejects(board.start('Player', 'request'), /Temporarily unavailable/);
  await start();
  for (let i = 0; i < 29; i++) { t.mock.timers.tick(2000); await start(); }
  assert.equal(requests, 1, 'the server-requested minute is respected');
  t.mock.timers.tick(2000); await start();
  assert.equal(requests, 2);
  t.mock.timers.tick(2000); await start();
  assert.equal(requests, 2, 'the second failure backs off beyond the normal two-second tick');
  t.mock.timers.tick(2000); await start();
  assert.equal(requests, 3, 'recovery is retried after the bounded backoff');
});
