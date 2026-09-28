import test from 'node:test';
import assert from 'node:assert/strict';
import { journalFixture } from './public-journal-fixture.mjs';
import { PUBLIC_JOURNAL } from '../src/public-run-journal.js';
import { createSessionApi } from '../src/session-api.js';
import { RULES, scoreTurn, turnContext } from '../src/event-session.js';
import { createPilotServer } from '../server/index.js';
const id = () => crypto.randomUUID();
const storage = { length: 0, getItem: () => null, removeItem() {} };
const pack = { complete: true, controlling: true, id: 'verified-pack' };
const pool = (count = 20) => ({ id: id(), protocol: 1, boardId: id(), generation: id(), ready: true,
  rules: { ...RULES, controlVersion: 'camera-fist-hold-550-v2' }, controlModes: ['one-hand', 'two-hand'],
  reconcileBy: Date.now() + 86400000, ownerExpires: Date.now() + 86401000,
  slots: Array.from({ length: count }, () => ({ id: id(), runId: id(), requestKey: id() })) });
const apiFor = (f, options = {}) => createSessionApi({ publicPlay: true, prepared: true, storage, tabStorage: storage,
  journalFactory: f.open, verifyAssets: async () => pack, online: () => false, onWork() {}, ...options });
async function seed(f, grant = pool()) { const j = await f.open(); await j.installPool(grant, pack.id); j.close(); await Promise.resolve(); return grant; }
async function complete(api, run) {
  for (let i = 0; i < 3; i++) {
    const prizeId = ['butter', null, 'sprout'][i], remainingMs = [7500, 0, 5000][i];
    run.turns.push({ turn: i + 1, prizeId, remainingMs, score: scoreTurn(run.rules, turnContext(run.turns, prizeId, remainingMs)) });
    await api.queue(run);
  }
  run.total = run.turns.reduce((sum, turn) => sum + turn.score, 0);
}

test('slot and immutable intent commit together; abort cannot consume capacity; refresh cannot recycle it', async () => {
  const f = journalFixture(), grant = await seed(f, pool(1)), j = await f.open();
  const open = f.indexedDB.open(PUBLIC_JOURNAL, 2);
  const db = await new Promise(resolve => { open.onsuccess = () => resolve(open.result); });
  const proto = Object.getPrototypeOf(db.transaction('intents').objectStore('intents')), original = proto.add;
  proto.add = function(...args) { const req = original.apply(this, args); req.addEventListener('success', () => this.transaction.abort()); return req; };
  const input = { name: 'Lan', controlMode: 'one-hand', attemptKey: id(), packId: pack.id };
  try { await assert.rejects(j.reservePrepared(input), /abort/i); } finally { proto.add = original; db.close(); }
  assert.deepEqual(await j.all(), []);
  const entry = await j.reservePrepared(input); assert.equal(entry.run.id, grant.slots[0].runId);
  await assert.rejects(j.reservePrepared(input), /already reserved/);
  await j.installPool(grant, pack.id);
  await assert.rejects(j.reservePrepared({ ...input, attemptKey: id() }), /No usable/);
  await assert.rejects(j.installPool({ ...grant, slots: pool(1).slots }, pack.id), /identity changed/);
  assert.equal((await j.all()).length, 1); j.close();
});

test('build, clock rollback, deadline and durable authority holds refuse new starts without losing evidence', async () => {
  const f = journalFixture(), grant = await seed(f), j = await f.open();
  const input = { name: 'Lan', controlMode: 'two-hand', attemptKey: id(), packId: pack.id };
  await assert.rejects(j.reservePrepared({ ...input, packId: 'new-build' }), /build/);
  await assert.rejects(j.reservePrepared({ ...input, time: 1 }), /clock/);
  await assert.rejects(j.reservePrepared({ ...input, time: grant.reconcileBy }), /deadline/);
  await j.holdPreparation('Station revoked'); j.close(); await Promise.resolve();
  const next = await f.open(); await assert.rejects(next.reservePrepared(input), /Station revoked/);
  assert.deepEqual(await next.all(), []); next.close();
});

test('v1 migration retains interrupted input and results without recycling physical play', async () => {
  const f = journalFixture(), opening = f.indexedDB.open(PUBLIC_JOURNAL, 1), key = id();
  opening.onupgradeneeded = () => opening.result.createObjectStore('intents', { keyPath: 'requestKey' });
  const db = await new Promise(resolve => { opening.onsuccess = () => resolve(opening.result); });
  const record = { version: 1, name: 'Legacy', requestKey: key, controlMode: 'one-hand', liveAttempted: true, settled: false,
    physical: 'playing', acknowledged: 0, run: { id: id(), rules: RULES }, turns: [{ turn: 1, prizeId: null, score: 0, remainingMs: 0 }] };
  await new Promise(resolve => { const tx = db.transaction('intents', 'readwrite'); tx.objectStore('intents').add(record); tx.oncomplete = resolve; }); db.close();
  const j = await f.open(); assert.deepEqual(await j.all(), [{ ...record, physical: 'interrupted' }]);
  await j.installPool(pool(1), pack.id); j.close();
});

test('one-second live budget ignores late response without changing the current physical run', async () => {
  const f = journalFixture(); await seed(f); let release, calls = 0;
  const api = apiFor(f, { online: () => true, fetcher: async (_url, options) => { calls++; const data = JSON.parse(options.body); await new Promise(resolve => { release = resolve; }); return Response.json({ id: data.runId, name: data.name, rules: RULES, event: { id: 'late' } }); } });
  await api.initialize(); const start = performance.now(), first = await api.start('Lan', id());
  assert.ok(performance.now() - start < 1500, 'budget includes an uncooperative fetch');
  assert.equal(first.event, undefined); assert.equal(calls, 1);
  await complete(api, first); const second = await api.start('Binh', id(), 'two-hand');
  assert.notEqual(second.id, first.id); release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.event, undefined); assert.equal(second.event, undefined); assert.equal(calls, 1, 'cooldown starts locally without another live call');
  api.dispose(); await Promise.resolve(); const j = await f.open();
  assert.equal((await j.all()).find(entry => entry.run.id === first.id).admitted, false); j.close();
});

test('known live refusals hold future local admission across reload; throttling only imposes shared backoff', async () => {
  for (const status of [401, 403, 409, 429]) {
    const f = journalFixture(); await seed(f); let calls = 0;
    let api = apiFor(f, { online: () => true, fetcher: async () => { calls++; return Response.json({ error: 'Stopped', code: status === 429 ? undefined : 'admission_paused' }, { status, headers: { 'Retry-After': '60' } }); } });
    await api.initialize();
    if (status === 429) { const run = await api.start('Lan', id()); await complete(api, run); await api.start('Binh', id()); assert.equal(calls, 1); }
    else {
      await assert.rejects(api.start('Lan', id()), /Stopped/); api.dispose(); await Promise.resolve(); api = apiFor(f);
      await api.initialize(); await assert.rejects(api.start('Binh', id()), /Preparation on hold/);
    }
    api.dispose();
  }
});

test('20 offline players / 60 frozen scored turns survive reload and reconcile once through real HTTP and SQLite', async t => {
  const now = Date.parse('2026-09-29T10:00:00+07:00'), origin = 'http://127.0.0.1';
  const app = await createPilotServer({ filename: ':memory:', origin, staffCode: 'prepared-test-staff-secret', hostCode: 'prepared-host-secret',
    secure: false, publicTryEnabled: true, publicPermitPolicy: { maxSlots: 20, maxRetentionMs: 86400000 }, now: () => now });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.database.close(); });
  let cookie = ''; const calls = [];
  async function http(path, options = {}) {
    calls.push(path);
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { ...options, headers: { ...options.headers, origin, cookie } });
    const renewed = response.headers.getSetCookie().map(value => value.split(';')[0]);
    for (const value of renewed) { const name = value.split('=')[0]; cookie = cookie.split('; ').filter(old => !old.startsWith(name + '=')).concat(value).filter(Boolean).join('; '); }
    return response;
  }
  const post = (path, data) => http(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  for (const [path, data] of [['/api/play/session', {}], ['/api/host/sign-in', { code: 'prepared-host-secret' }], ['/api/host/station', {}]]) assert.equal((await post(path, data)).status, 200);
  const response = await post('/api/host/station/permits', { protocol: 1, requestKey: id(), count: 20, reconcileBy: now + 3600000 });
  assert.equal(response.status, 200); const grant = await response.json();
  const f = journalFixture(); let j = await f.open(); await j.installPool(grant, pack.id, now); j.close(); await Promise.resolve();
  calls.length = 0; const runs = [];
  for (let player = 0; player < 20; player++) {
    const api = apiFor(f, { now: () => now, fetcher: () => { throw Error('network disconnected'); } });
    await api.initialize(); const run = await api.start(`Player ${player}`, id(), player % 2 ? 'two-hand' : 'one-hand');
    await complete(api, run); runs.push(structuredClone(run)); api.dispose(); await Promise.resolve();
  }
  assert.equal(calls.length, 0);
  j = await f.open(); assert.equal((await j.all()).length, 20); assert.equal((await j.all()).reduce((n, entry) => n + entry.turns.length, 0), 60); j.close(); await Promise.resolve();
  let lose = true, clock = now; const saved = [];
  const api = apiFor(f, { now: () => clock, online: () => true, onChange: state => { if (state.saved) saved.push(state.saved); }, fetcher: async (...args) => {
    const response = await http(...args);
    if (lose && args[0].endsWith('/reconcile')) { lose = false; throw Error('Receipt lost after commit'); }
    return response;
  } });
  await api.initialize(); await assert.rejects(api.start('No capacity', id()), /No usable/);
  await api.flush(); clock += 60001; await api.flush();
  assert.equal(api.state().pending, 0); assert.equal(saved.length, 20);
  for (const run of runs) { const receipt = saved.find(saved => saved.id === run.id); assert.equal(receipt.total, run.total); assert.deepEqual(receipt.turns, run.turns); assert.deepEqual(receipt.rules, run.rules); assert.equal(receipt.event, undefined); }
  assert.equal(app.database.db.prepare("SELECT COUNT(*) n FROM runs WHERE status='complete'").get().n, 20);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) n FROM turns').get().n, 60);
  assert.equal(calls.filter(path => path.endsWith('/live') || path.endsWith('/session')).length, 0, 'recovery never replays live admission or replaces ownership');
  api.dispose();
});

test('timely live authority is retained, while interrupted prepared play reconciles outcomes without a second live start', async () => {
  for (const count of [1, 2]) {
    const f = journalFixture(); await seed(f); const calls = []; let issued, turns = [];
    const fetcher = async (path, options) => {
      calls.push(path); const input = JSON.parse(options.body || '{}');
      if (path.endsWith('/live')) {
        issued = { id: input.runId, name: input.name, status: 'active', turns: [], event: { id: 'hanoi-2026-09-29' },
          rules: { ...RULES, controlMode: input.controlMode, controlVersion: 'camera-fist-hold-550-v2' } };
        return Response.json(issued);
      }
      if (path.endsWith('/turns')) { turns.push({ ...input, score: 0 }); return Response.json({ ...issued, turns }); }
      if (path.endsWith('/abandon')) return Response.json({ ...issued, status: 'abandoned', turns });
      throw Error(path);
    };
    let api = apiFor(f, { fetcher, online: () => true }); await api.initialize();
    const run = await api.start('Lan', id()); assert.equal(run.event.id, 'hanoi-2026-09-29');
    run.turns = Array.from({ length: count }, (_, i) => ({ turn: i + 1, prizeId: null, remainingMs: 0, score: 0 }));
    await api.queue(run); api.dispose(); await Promise.resolve();
    api = apiFor(f, { fetcher }); await api.initialize(); await api.flush();
    assert.equal(api.state().pending, 0); assert.equal(turns.length, count);
    assert.equal(calls.filter(path => path.endsWith('/live')).length, 1);
    assert.equal(calls.at(-1).endsWith('/abandon'), true); api.dispose();
  }
});
