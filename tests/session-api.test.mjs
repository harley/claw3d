import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionApi } from '../src/session-api.js';
import { journalFixture } from './public-journal-fixture.mjs';
import { RULES } from '../src/event-session.js';

function storage() { const data = new Map(); return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; }
test('outbox retries response loss, preserves ownership on reauth, and drains completed scores after reload', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const local = storage(), tab = storage(), received = new Map(), notices = [];
  let lose = false, unauthorized = false;
  const issued = { id: crypto.randomUUID(), boardId: 'board', name: 'Lan', status: 'active', turns: [], rules: RULES };
  const fetcher = async (url, options) => {
    if (unauthorized) return new Response(JSON.stringify({ error: 'Sign in' }), { status: 401 });
    if (url === '/api/runs') return Response.json(issued);
    if (url === '/api/session') return Response.json({ role: 'staff' });
    const data = JSON.parse(options.body);
    if (url.endsWith('/turns')) {
      received.set(data.turn, data);
      if (lose) { lose = false; throw Error('Response lost after server commit'); }
      return Response.json({ ...issued, status: received.size === 3 ? 'complete' : 'active', turns: [...received.values()], total: 300, rank: 1 });
    }
    throw Error(url);
  };
  let api = createSessionApi({ storage: local, tabStorage: tab, fetcher, onChange: notice => notices.push(notice) });
  await api.initialize(); // An empty first poll must not latch the flush lock forever.
  const run = await api.start('Lan', crypto.randomUUID());
  lose = true; run.turns.push({ turn: 1, prizeId: 'butter', score: 125, remainingMs: 7500 }); api.queue(run); await api.flush();
  assert.equal(api.state().pending, 1); assert.equal(received.size, 1);
  t.mock.timers.tick(2500);
  unauthorized = true;
  run.turns.push({ turn: 2, prizeId: 'butter', score: 100 }, { turn: 3, prizeId: 'butter', score: 100 }); api.queue(run); await api.flush();
  assert.equal(api.state().needsLogin, true); assert.equal(api.state().pending, 1);
  unauthorized = false;
  api = createSessionApi({ storage: local, tabStorage: tab, fetcher, onChange: notice => notices.push(notice) });
  await api.initialize();
  assert.equal(received.size, 3); assert.equal(received.get(1).remainingMs, 7500); assert.equal(local.length, 0); assert.equal(tab.length, 0);
  assert.equal(notices.find(notice => notice.saved)?.saved.rank, 1);
});
test('reload submits completed turns before abandonment; another tab cannot abandon the live run', async () => {
  const local = storage(), tab = storage(), secondTab = storage(), calls = [], savedTurns = [];
  let savedStatus = 'active';
  const issued = { id: crypto.randomUUID(), boardId: 'board', name: 'Linh', status: 'active', turns: [], rules: RULES };
  let offline = false;
  const fetcher = async (url, options) => {
    if (offline) throw Error('offline');
    if (url === '/api/runs') return Response.json(issued);
    if (url === '/api/session') return Response.json({ role: 'staff' });
    calls.push(url);
    if (url.endsWith('/turns')) savedTurns.push(JSON.parse(options.body));
    else if (url.endsWith('/abandon')) savedStatus = 'abandoned';
    else throw Error(url);
    return Response.json({ ...issued, status: savedStatus, turns: savedTurns });
  };
  let api = createSessionApi({ storage: local, tabStorage: tab, fetcher });
  const run = await api.start('Linh', crypto.randomUUID());
  await createSessionApi({ storage: local, tabStorage: secondTab, fetcher }).initialize();
  assert.equal(calls.length, 0);
  offline = true; run.turns.push({ turn: 1, prizeId: null, score: 0 }); api.queue(run); await api.flush();
  offline = false; api = createSessionApi({ storage: local, tabStorage: tab, fetcher }); await api.initialize();
  assert.deepEqual(calls.map(url => url.split('/').at(-1)), ['turns', 'abandon']);
  assert.equal(savedStatus, 'abandoned'); assert.deepEqual(savedTurns, [{ turn: 1, prizeId: null }]);
  assert.equal(local.length, 0);
});

test('a delayed acknowledgement from another tab cannot erase later completed turns', async () => {
  const local = storage(), tabA = storage(), tabB = storage(), received = new Map();
  const issued = { id: crypto.randomUUID(), boardId: 'board', name: 'Linh', status: 'active', turns: [], rules: RULES };
  let offlineA = true, offlineB = false, release, started;
  const began = new Promise(resolve => { started = resolve; });
  const fetcher = who => async (url, options) => {
    if (url === '/api/runs') return Response.json(issued);
    if (url === '/api/session') return Response.json({ role: 'staff' });
    if (who === 'a' && offlineA || who === 'b' && offlineB) throw Error('offline');
    const turn = JSON.parse(options.body);
    if (who === 'b' && turn.turn === 1) { started(); await new Promise(resolve => { release = resolve; }); }
    received.set(turn.turn, turn);
    return Response.json({ ...issued, turns: [...received.values()], status: received.size === 3 ? 'complete' : 'active', rank: 1 });
  };
  const a = createSessionApi({ storage: local, tabStorage: tabA, fetcher: fetcher('a') });
  const run = await a.start('Linh', crypto.randomUUID());
  run.turns.push({ turn: 1, prizeId: null }); a.queue(run); await a.flush();
  const b = createSessionApi({ storage: local, tabStorage: tabB, fetcher: fetcher('b') });
  const background = b.flush(); await began;
  run.turns.push({ turn: 2, prizeId: 'butter' }, { turn: 3, prizeId: 'sprout' }); a.queue(run); await a.flush();
  offlineB = true; release(); await background;
  offlineA = false;
  await createSessionApi({ storage: local, tabStorage: tabA, fetcher: fetcher('a') }).initialize();
  assert.deepEqual([...received.keys()], [1, 2, 3]); assert.equal(local.length, 0);
});
test('idle 401 remains visible across empty flushes until successful sign-in', async () => {
  let signedIn = false;
  const api = createSessionApi({ storage: storage(), tabStorage: storage(), fetcher: async url => {
    if (url === '/api/login') { signedIn = true; return Response.json({ ok: true }); }
    return signedIn ? Response.json({}) : Response.json({ error: 'Sign in' }, { status: 401 });
  } });
  await assert.rejects(api.request('/board')); await api.flush(); await api.flush();
  assert.equal(api.state().needsLogin, true);
  await api.request('/login', { code: 'staff' }); assert.equal(api.state().needsLogin, false);
});

test('unavailable browser storage prevents a shared start before any request', async () => {
  let calls = 0;
  const local = storage(); local.setItem = () => { throw new Error('Storage unavailable'); };
  const api = createSessionApi({ storage: local, tabStorage: storage(), fetcher: async () => { calls++; return Response.json({}); } });
  await assert.rejects(api.start('Player', crypto.randomUUID()), /Storage unavailable/);
  assert.equal(calls, 0);
});

test('full storage after start retains all completed turns for same-page retry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const local = storage(), tab = storage(), notices = [], received = new Set();
  const write = local.setItem;
  let full = false, online = false;
  local.setItem = (key, value) => { if (full) throw new Error('Quota exceeded'); write(key, value); };
  const issued = { id: crypto.randomUUID(), boardId: 'board', name: 'Player', status: 'active', turns: [], rules: RULES };
  const api = createSessionApi({ storage: local, tabStorage: tab, onChange: notice => notices.push(notice), fetcher: async (url, options) => {
    if (url === '/api/runs') return Response.json(issued);
    if (!online) throw new Error('offline');
    received.add(JSON.parse(options.body).turn);
    return Response.json({ ...issued, status: received.size === 3 ? 'complete' : 'active', rank: 1, total: 0 });
  } });
  const run = await api.start('Player', crypto.randomUUID());
  full = true;
  run.turns = [1, 2, 3].map(turn => ({ turn, prizeId: null, score: 0 }));
  api.queue(run); await api.flush();
  assert.equal(api.state().pending, 1); assert.ok(api.state().error);
  assert.equal(notices.some(notice => notice.saved), false);
  full = false; online = true; t.mock.timers.tick(2500); await api.flush();
  assert.deepEqual([...received], [1, 2, 3]); assert.equal(api.state().pending, 0);
  assert.equal(notices.find(notice => notice.saved).saved.total, 0);
  assert.equal(local.length, 0); assert.equal(tab.length, 0);
});

// A separate public transport must never submit or erase a staff outbox.
test('public client isolates storage and retries its completed results across reload', async () => {
  const journal = journalFixture();
  const local = storage(), tab = storage(), urls = [], received = new Map();
  const staffId = crypto.randomUUID(), staffKey = `cloud-claw:pending:v2:${staffId}:run`;
  local.setItem(staffKey, JSON.stringify({ id: staffId }));
  tab.setItem('cloud-claw:active:v2', staffId);
  const issued = { id: crypto.randomUUID(), boardId: 'public', name: 'Mochi', status: 'active', turns: [], rules: RULES };
  let offline = false;
  const fetcher = async (url, options) => {
    urls.push(url); assert.ok(url.startsWith('/api/play/'));
    if (url.endsWith('/session')) { assert.equal(options.method, 'POST'); return Response.json({ role: 'public' }); }
    if (url === '/api/play/runs') return Response.json(issued);
    if (offline) throw Error('Offline');
    const turn = JSON.parse(options.body); received.set(turn.turn, turn);
    return Response.json({ ...issued, status: received.size === 3 ? 'complete' : 'active', turns: [...received.values()].map(turn => ({ ...turn, score: 0 })), total: 0, rank: 1 });
  };
  let api = createSessionApi({ publicPlay: true, journalFactory: journal.open, storage: local, tabStorage: tab, fetcher });
  await api.initialize();
  const run = await api.start('Mochi', crypto.randomUUID());
  offline = true; run.turns = [1, 2, 3].map(turn => ({ turn, prizeId: null, score: 0 })); await api.queue(run); await api.flush();
  assert.equal(api.state().pending, 1);
  offline = false; api.dispose(); await Promise.resolve(); api = createSessionApi({ publicPlay: true, journalFactory: journal.open, storage: local, tabStorage: tab, fetcher }); await api.initialize();
  assert.equal(received.size, 3); assert.equal(api.state().pending, 0);
  assert.equal(local.length, 1); assert.ok(local.getItem(staffKey)); assert.equal(tab.getItem('cloud-claw:active:v2'), staffId);
  assert.ok(!urls.some(url => url.includes(staffId))); api.dispose();
});

test('inaccessible retained public scores cannot block a new owner from saving', async () => {
  const journal = journalFixture();
  const local = storage(), tab = storage(), saved = [], oldId = crypto.randomUUID();
  local.setItem(`cloud-claw:public:pending:v1:${oldId}:run`, JSON.stringify({ id: oldId }));
  local.setItem(`cloud-claw:public:pending:v1:${oldId}:turn:1`, JSON.stringify({ turn: 1, prizeId: null }));
  const issued = { id: crypto.randomUUID(), boardId: 'public', name: 'New player', status: 'active', turns: [], rules: RULES };
  const received = new Map();
  const fetcher = async (url, options) => {
    if (url.includes(oldId)) return Response.json({ error: 'Run not found for this browser.' }, { status: 404 });
    if (url.endsWith('/session')) return Response.json({ role: 'public' });
    if (url === '/api/play/runs') return Response.json(issued);
    const turn = JSON.parse(options.body); received.set(turn.turn, turn);
    return Response.json({ ...issued, status: received.size === 3 ? 'complete' : 'active', turns: [...received.values()].map(turn => ({ ...turn, score: 0 })), total: 0, rank: 1 });
  };
  const api = createSessionApi({ publicPlay: true, journalFactory: journal.open, storage: local, tabStorage: tab, fetcher, onChange: state => { if (state.saved) saved.push(state.saved); } });
  await api.initialize();
  const run = await api.start('New player', crypto.randomUUID());
  run.turns = [1, 2, 3].map(turn => ({ turn, prizeId: null })); await api.queue(run); await api.flush();
  assert.equal(saved.length, 1); assert.equal(saved[0].id, issued.id); assert.equal(received.size, 3);
  assert.ok(local.getItem(`cloud-claw:public:pending:v1:${oldId}:run`));
  assert.equal(api.state().pending, 1); assert.match(api.state().error, /new scores can still save/); api.dispose();
});

test('host authentication can explicitly recover after an incorrect host code', async () => {
  let calls = 0;
  const api = createSessionApi({ storage: storage(), tabStorage: storage(), fetcher: async () => {
    return ++calls === 1 ? Response.json({ error: 'Incorrect code' }, { status: 401 }) : Response.json({ role: 'host' });
  } });
  await assert.rejects(api.request('/host/login', { code: 'wrong' }), /Incorrect code/);
  await api.flush(); assert.equal(calls, 1);
  await api.request('/host/login', { code: 'correct' });
  assert.equal(calls, 2); assert.equal(api.state().accessBlocked, false);
});

test('lost public admission is looked up after restart, never recreated or resumed', async () => {
  const journal = journalFixture(), inputKey = crypto.randomUUID(), requests = [];
  let saved, lose = true;
  const fetcher = async (url, options) => {
    requests.push([url, options.method || 'GET']);
    if (url.endsWith('/session')) return Response.json({ role: 'public' });
    if (url === '/api/play/runs') {
      saved = { id: crypto.randomUUID(), name: 'Lan', rules: RULES, status: 'active', turns: [] };
      if (lose) { lose = false; throw Error('Response lost'); }
    } else if (url.endsWith('/abandon')) saved.status = 'abandoned';
    return Response.json(saved);
  };
  const options = { publicPlay: true, journalFactory: journal.open, storage: storage(), tabStorage: storage(), fetcher };
  let api = createSessionApi(options);
  await assert.rejects(api.start('Lan', inputKey), /Response lost/);
  api.dispose(); await Promise.resolve();
  api = createSessionApi({ ...options, tabStorage: storage() });
  await api.initialize();
  assert.equal(requests.filter(([url]) => url === '/api/play/runs').length, 1);
  assert.ok(requests.some(([url, method]) => url === `/api/play/intents/${inputKey}` && method === 'GET'));
  assert.equal(saved.status, 'abandoned'); assert.equal(api.state().pending, 0);
  await assert.rejects(api.start('Lan', inputKey), /already used/);
  api.dispose();
});
