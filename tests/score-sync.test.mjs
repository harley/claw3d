import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createSessionApi } from '../src/session-api.js';
import { createScoreSync } from '../src/score-sync.js';

const prefix = 'cloud-claw:public:pending:v1:';
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
function queued(local, id) {
  local.setItem(`${prefix}${id}:run`, JSON.stringify({ id }));
  for (const turn of [1, 2, 3]) local.setItem(`${prefix}${id}:turn:${turn}`, JSON.stringify({ turn, prizeId: null }));
}
function harness(t, fetcher, { board = true, initialize = false } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const local = storage(), events = new EventTarget(), visibility = new EventTarget(), calls = [], saved = [];
  let sync, visible = true, playing = false;
  const api = createSessionApi({ publicPlay: true, storage: local, tabStorage: storage(), random: () => .5,
    onWork: () => sync.wake(), onChange: state => { if (state.saved) { saved.push(state.saved); sync.wake(true); } },
    fetcher: async (url, options) => { calls.push({ url, time: Date.now() }); return fetcher(url, options); } });
  sync = createScoreSync({ api, events, visibility, initialize: initialize ? () => api.initialize() : undefined,
    refresh: board ? () => api.request('/board') : undefined, canRefresh: () => visible && !playing });
  t.after(() => sync.dispose());
  return { api, sync, local, events, visibility, calls, saved,
    visible: value => { visible = value; visibility.dispatchEvent(new Event('visibilitychange')); },
    playing: value => { playing = value; },
    advance: async ms => { t.mock.timers.tick(ms); await setImmediate(); },
  };
}
const receipt = (url, options) => Response.json(url.endsWith('/turns')
  ? { id: url.split('/')[4], status: JSON.parse(options.body).turn === 3 ? 'complete' : 'active', rank: 1 }
  : { runs: [] });

// Owner-boundary tests use actual transport/outbox + scheduler. Existing API tests
// cover scoring/idempotency; these cover wake timing, work ordering and lifecycle.
test('120-second throttle survives START, flush, online and visibility storms', async t => {
  let throttled = true;
  const h = harness(t, (url, options) => throttled
    ? Response.json({ error: 'Slow down' }, { status: 429, headers: { 'Retry-After': '120' } }) : receipt(url, options));
  queued(h.local, 'first'); h.sync.start(); await h.advance(0);
  assert.equal(h.calls.length, 1);
  for (let i = 0; i < 59; i++) {
    h.events.dispatchEvent(new Event('online')); h.visible(true);
    await assert.rejects(h.api.start('Player', 'request'), /Slow down/);
    await h.api.flush(); await h.advance(2000);
  }
  assert.equal(h.calls.length, 1);
  throttled = false; await h.advance(2000);
  assert.deepEqual(h.calls.map(call => call.url.split('/').at(-1)), ['turns', 'turns', 'turns', 'turns', 'board']);
  assert.equal(h.calls[1].time - h.calls[0].time, 120000);
  assert.equal(h.saved.length, 1); assert.equal(h.local.length, 0);
});

test('five-minute outage has bounded exponential attempts, then ordered scores before one board refresh', async t => {
  let online = false;
  const h = harness(t, (url, options) => { if (!online) throw new TypeError('Offline'); return receipt(url, options); });
  queued(h.local, 'first'); queued(h.local, 'second'); h.sync.start(); await h.advance(0);
  for (let i = 0; i < 300; i++) await h.advance(1000);
  assert.deepEqual(h.calls.map(call => call.time - 1000), [0, 2000, 6000, 14000, 30000, 62000, 122000, 182000, 242000]);
  assert.equal(h.calls.length, 9, 'old two-second loop attempted 151 drains over the same window');
  online = true; h.events.dispatchEvent(new Event('online')); await h.advance(1000);
  assert.equal(h.calls.length, 9, 'online is a hint, not permission to bypass the cooldown');
  await h.advance(1000);
  assert.deepEqual(h.calls.slice(9).map(call => call.url.split('/').at(-1)), ['turns', 'turns', 'turns', 'turns', 'turns', 'turns', 'board']);
  assert.equal(h.saved.length, 2); assert.equal(h.api.state().pending, 0);
});

test('conflicting records are retained once while later valid records save', async t => {
  const h = harness(t, (url, options) => url.includes('/bad/')
    ? Response.json({ error: 'Conflicting turn' }, { status: 409 }) : receipt(url, options));
  queued(h.local, 'bad'); queued(h.local, 'good'); h.sync.start(); await h.advance(0);
  assert.deepEqual(h.saved.map(run => run.id), ['good']);
  assert.equal(h.api.state().pending, 1); assert.equal(h.api.state().blocked, 1);
  assert.match(h.api.state().error, /host recovery/);
  for (let i = 0; i < 4; i++) await h.advance(15000);
  assert.equal(h.calls.filter(call => call.url.includes('/bad/')).length, 1);
  assert.equal(h.local.length, 4, 'original start and all three turns remain recoverable');
});

test('slow drain coalesces signals and does not overlap reads or drop new work', async t => {
  let release, active = 0, maxActive = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness(t, async (url, options) => {
    active++; maxActive = Math.max(maxActive, active);
    if (url.endsWith('/turns')) await gate;
    active--; return receipt(url, options);
  });
  queued(h.local, 'first'); h.sync.start(); await h.advance(0);
  for (let i = 0; i < 10; i++) { h.events.dispatchEvent(new Event('online')); void h.sync.refresh(); await h.advance(2000); }
  assert.equal(h.calls.length, 1); assert.equal(maxActive, 1);
  queued(h.local, 'second'); h.sync.wake();
  release(); await setImmediate(); await h.advance(0);
  assert.equal(h.saved.length, 2); assert.equal(maxActive, 1);
  // A record added after the initial snapshot drains in the immediately following
  // cycle. The first cycle must not spend a board request while scores remain.
  assert.equal(h.calls.at(-1).url, '/api/play/board');
  assert.equal(h.calls.filter(call => call.url.endsWith('/board')).length, 1);
});

test('boards poll at 15 seconds only when visible and idle; hidden scores still drain', async t => {
  const h = harness(t, receipt); h.sync.start(); await h.advance(0);
  await h.advance(14999); assert.equal(h.calls.length, 1);
  await h.advance(1); assert.equal(h.calls.length, 2);
  h.playing(true); await h.advance(15000); assert.equal(h.calls.length, 2);
  h.visible(false); queued(h.local, 'hidden'); h.sync.wake(); await h.advance(0);
  assert.equal(h.saved.length, 1); assert.equal(h.calls.filter(call => call.url.endsWith('/board')).length, 2);
  h.playing(false); h.visible(true); await h.advance(0);
  assert.equal(h.calls.filter(call => call.url.endsWith('/board')).length, 3);
  h.sync.dispose(); h.events.dispatchEvent(new Event('online')); await h.advance(60000);
  assert.equal(h.calls.length, 6, 'disposal clears timer and event listeners');
});

test('paused-ranked recovery drains without bootstrap, board reads or creating runs', async t => {
  const h = harness(t, receipt, { board: false }); queued(h.local, 'retained'); h.sync.start(); await h.advance(0);
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(call => call.url.endsWith('/turns')));
  await h.advance(60000); assert.equal(h.calls.length, 3);
});

test('expired access suspends background work and keeps the original outbox', async t => {
  const h = harness(t, () => Response.json({ error: 'Expired' }, { status: 401 }));
  queued(h.local, 'retained'); h.sync.start(); await h.advance(0);
  for (let i = 0; i < 10; i++) { h.events.dispatchEvent(new Event('online')); await h.advance(60000); }
  assert.equal(h.calls.length, 1); assert.equal(h.local.length, 4); assert.equal(h.api.state().accessBlocked, true);
});

test('Retry-After HTTP date is a minimum beyond the backoff cap', async t => {
  const h = harness(t, () => Response.json({ error: 'Wait' }, { status: 503, headers: { 'Retry-After': new Date(181000).toUTCString() } }));
  queued(h.local, 'retained'); h.sync.start(); await h.advance(0);
  await h.advance(179000); assert.equal(h.calls.length, 1);
  await h.advance(1000); assert.equal(h.calls.length, 2);
});

test('disposal during bootstrap cannot begin a score drain', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness(t, async () => { await gate; return Response.json({ role: 'public' }); }, { initialize: true });
  queued(h.local, 'retained'); h.sync.start(); await h.advance(0);
  h.sync.dispose(); release(); await setImmediate(); await h.advance(60000);
  assert.deepEqual(h.calls.map(call => call.url), ['/api/play/session']);
});

test('an older in-flight success cannot clear a newer throttle', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness(t, async url => {
    if (url.endsWith('/board')) { await gate; return Response.json({ runs: [] }); }
    return Response.json({ error: 'Wait' }, { status: 429, headers: { 'Retry-After': '120' } });
  });
  const read = h.api.request('/board');
  await assert.rejects(h.api.start('Player', 'request'), /Wait/);
  release(); await read;
  assert.equal(h.api.state().retryAt, 121000);
  await assert.rejects(h.api.start('Player', 'request'), /Wait/);
  assert.equal(h.calls.length, 2);
});
