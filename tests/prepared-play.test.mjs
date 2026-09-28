import test from 'node:test';
import assert from 'node:assert/strict';
import { journalFixture } from './public-journal-fixture.mjs';
import { PUBLIC_JOURNAL } from '../src/public-run-journal.js';
import { createSessionApi } from '../src/session-api.js';
import { RULES, scoreTurn, turnContext } from '../src/event-session.js';
import { createPilotServer } from '../server/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const entry = await j.reservePrepared(input); assert.equal(entry.run.id, grant.slots[0].runId); assert.equal(entry.grant.packId, pack.id);
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
  for (const status of [401, 403, 409, 429, 503]) {
    const transient = status === 429 || status === 503;
    const f = journalFixture(); await seed(f); let calls = 0;
    let api = apiFor(f, { online: () => true, fetcher: async () => { calls++; return Response.json({ error: 'Stopped', code: transient ? undefined : 'admission_paused' }, { status, headers: { 'Retry-After': '60' } }); } });
    await api.initialize();
    if (transient) { const run = await api.start('Lan', id()); await complete(api, run); await api.start('Binh', id()); assert.equal(calls, 1); }
    else {
      await assert.rejects(api.start('Lan', id()), /Stopped/); api.dispose(); await Promise.resolve(); api = apiFor(f);
      await api.initialize(); await assert.rejects(api.start('Binh', id()), /Preparation on hold/);
    }
    api.dispose();
  }
});

// Contract: an authority refusal must stop admission even when its durable hold
// cannot be saved. Existing refusal coverage assumes all journal writes succeed.
test('failed durable holds retain authority refusals and block later offline starts until preparation succeeds', async () => {
  for (const status of [401, 403, 503]) {
    const f = journalFixture(), grant = await seed(f); let connected = true, refuse = true, holdAttempts = 0, failInstall = false;
    const api = apiFor(f, {
      online: () => connected,
      journalFactory: async () => {
        const journal = await f.open();
        return { ...journal, holdPreparation: async () => { holdAttempts++; throw Error('Disk unavailable'); },
          installPool: async (...args) => { if (failInstall) throw Error('Install unavailable'); return journal.installPool(...args); } };
      },
      fetcher: async path => {
        if (path.endsWith('/session')) return Response.json({});
        if (refuse) return Response.json({ error: 'Authority stopped', ...(status === 401 ? {} : { code: 'admission_paused' }) }, { status });
        return Response.json(grant);
      },
    });
    await api.initialize();
    const refusal = error => error.status === status && error.message === 'Authority stopped';
    await assert.rejects(api.start('Lan', id()), refusal);
    assert.ok(holdAttempts > 0);
    connected = false;
    await assert.rejects(api.start('Binh', id()), refusal);
    await api.request('/session', {}); // Authentication recovery alone cannot clear the preparation hold.
    await assert.rejects(api.start('Binh', id()), refusal);
    await assert.rejects(api.preparePermit(grant.id), refusal);
    await assert.rejects(api.start('Binh', id()), refusal);
    refuse = false;
    await api.request('/session', {});
    failInstall = true;
    await assert.rejects(api.preparePermit(grant.id), /Install unavailable/);
    await assert.rejects(api.start('Binh', id()), refusal);
    failInstall = false;
    await api.preparePermit(grant.id);
    const run = await api.start('Binh', id());
    assert.notEqual(run.id, grant.slots[0].runId, 'the refused slot cannot be reused');
    api.dispose();
  }
});

test('a preparation response started before a newer refusal cannot release its hold', async () => {
  const f = journalFixture(), grant = await seed(f); let release, started;
  const pending = new Promise(resolve => { started = resolve; });
  let api = apiFor(f, { fetcher: async path => {
    if (path.endsWith(grant.id)) { started(); await new Promise(resolve => { release = resolve; }); return Response.json(grant); }
    return Response.json({ error: 'Newer refusal', code: 'admission_paused' }, { status: 403 });
  } });
  await api.initialize();
  const preparing = api.preparePermit(grant.id);
  const rejected = assert.rejects(preparing, /Newer refusal/);
  await pending;
  await assert.rejects(api.request('/permits/live', {}), /Newer refusal/);
  release(); await rejected;
  await assert.rejects(api.start('Lan', id()), /Newer refusal/);
  api.dispose(); await Promise.resolve();
  api = apiFor(f); await api.initialize();
  await assert.rejects(api.start('Binh', id()), /Preparation on hold/);
  api.dispose();
});

test('20 offline players / 60 frozen scored turns survive reload and reconcile once through real HTTP and SQLite', async t => {
  const now = Date.parse('2026-09-29T10:00:00+07:00'), origin = 'http://127.0.0.1';
  const dist = await mkdtemp(join(tmpdir(), 'prepared-http-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  const app = await createPilotServer({ filename: ':memory:', dist, origin, staffCode: 'prepared-test-staff-secret', hostCode: 'prepared-host-secret',
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
