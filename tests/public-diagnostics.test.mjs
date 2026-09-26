import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPilotServer } from '../server/index.js';
import { createPublicDiagnostics, PUBLIC_BUDGETS } from '../server/public-diagnostics.js';
import { createPlaytestStore } from '../server/playtest.js';
import { openDatabase } from '../server/database.js';

const batch = (sessionId = randomUUID()) => ({ sessionId, build: 'abcdef1', events: [{ id: randomUUID(), type: 'page_open', mode: 'practice', elapsedMs: 0 }] });
const staffCode = 'test-staff-diagnostics-secret', hostCode = 'test-host-secret';

test('staged HTTP diagnostics preserve staff/host boundaries, body limits, retry and rollback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claw-public-'));
  await writeFile(join(dir, 'index.html'), '<head></head>Staff pilot fixture');
  let app;
  const origin = 'https://pilot.example';
  async function start(enabled) {
    app = await createPilotServer({ filename: join(dir, 'pilot.sqlite'), origin, staffCode, hostCode, dist: dir, secure: true, publicDiagnosticsEnabled: enabled, officialEventsEnabled: true, officialAdmissionsEnabled: true });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  }
  async function stop() { await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
  async function request(path, data, cookie = '', headers = {}) {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', cookie, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text };
  }
  try {
    await start(false);
    assert.equal((await request('/api/public/session', {})).status, 404);
    await stop(); await start(true);
    assert.equal((await request('/api/public/session', {}, '', { origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/public/session', { role: 'host' })).status, 400);
    assert.equal((await request('/api/public/session', {}, '', { 'content-type': 'text/plain' })).status, 415);
    const issued = await request('/api/public/session', {});
    assert.equal(issued.status, 200);
    const setCookie = issued.headers.getSetCookie()[0], cookie = setCookie.split(';')[0];
    assert.match(setCookie, /Path=\/api\/public; HttpOnly; SameSite=Strict; Max-Age=1800; Secure/);
    const reuse = await request('/api/public/session', {}, cookie);
    assert.equal(reuse.text, issued.text); assert.equal(reuse.headers.getSetCookie().length, 0);
    for (const path of ['/api/board', '/api/host/export', '/api/host/playtest', '/api/host/public-playtest', '/asset.js']) assert.equal((await request(path, undefined, cookie)).status, 401);
    assert.equal((await request('/api/runs', {}, cookie)).status, 401);
    assert.equal((await request('/api/official/redeem', {}, cookie)).status, 401);
    assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM owners').get().n, 0);
    // Rotating forged forwarding headers cannot escape the same direct-peer budget.
    for (let i = 0; i < 15; i++) await request('/api/public/session', {}, '', { 'x-real-ip': `192.0.2.${i}` });
    const denied = await request('/api/public/session', {}, '', { 'x-real-ip': '198.51.100.1' });
    assert.equal(denied.status, 429); assert.ok(Number(denied.headers.get('retry-after')) >= 1);
    assert.equal((await request('/api/public/playtest', batch())).status, 401);
    const valid = batch();
    for (let i = 0; i < 2; i++) assert.equal((await request('/api/public/playtest', valid, cookie)).status, 200);
    assert.equal((await request('/api/public/playtest', { ...valid, build: 'abcdef2' }, cookie)).status, 409);
    for (const event of [{ ...batch().events[0], mode: 'event' }, { ...batch().events[0], runId: randomUUID() }, { ...batch().events[0], type: 'feedback', data: { category: 'other', comment: 'private' } }, { ...batch().events[0], data: { landmarks: [] } }]) assert.equal((await request('/api/public/playtest', { ...batch(), events: [event] }, cookie)).status, 400);
    assert.equal((await request('/api/public/playtest', { padding: 'x'.repeat(17000) }, cookie)).status, 413);
    const feedback = { ...batch(), events: [{ ...batch().events[0], type: 'feedback', data: { category: 'controls' } }] };
    assert.equal((await request('/api/public/playtest', feedback, cookie)).status, 200);
    assert.equal((await request('/api/public/playtest', feedback, cookie)).status, 200);
    assert.equal((await request('/api/public/playtest', feedback, cookie)).status, 429);
    const login = await request('/api/login', { code: staffCode });
    let staffCookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.equal((await request('/api/host/public-playtest', undefined, staffCookie)).status, 403);
    const host = await request('/api/host/login', { code: hostCode }, staffCookie);
    staffCookie = host.headers.getSetCookie()[0].split(';')[0];
    const report = await request('/api/host/public-playtest', undefined, staffCookie);
    assert.equal(JSON.parse(report.text).summary.events, 2);
    assert.equal(JSON.parse((await request('/api/host/playtest', undefined, staffCookie)).text).summary.events, 0);
    // A disposable disabled restart leaves accepted data and staff sessions readable.
    await stop(); await start(false);
    assert.equal((await request('/api/public/playtest', valid, cookie)).status, 404);
    assert.equal((await request('/api/host/export', undefined, staffCookie)).status, 200);
    assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM public_playtest_events').get().n, 2);
    await stop(); await start(true);
    assert.equal((await request('/api/public/playtest', valid, cookie)).status, 401, 'ephemeral diagnostics credentials expire at restart');
    assert.equal(JSON.parse((await request('/api/host/public-playtest', undefined, staffCookie)).text).summary.events, 2);
    app.database.db.prepare('UPDATE public_playtest_events SET received_at=?').run(new Date(Date.now() - 31 * 86400_000).toISOString());
    await stop(); await start(false);
    assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM public_playtest_events').get().n, 0, 'disabled startup expires existing public observations');
    assert.equal((await request('/api/host/export', undefined, staffCookie)).status, 200);
  } finally { if (app?.server.listening) await stop(); await rm(dir, { recursive: true, force: true }); }
});

// Strongest boundary for deterministic capacity and TTL: the actual route adapter,
// with real SQLite ingest and a fake clock; no WebGL or real waiting required.
function fixture() {
  let time = Date.parse('2026-09-26T00:00:00Z');
  const database = openDatabase(':memory:');
  const api = createPublicDiagnostics({ db: database.db, now: () => time,
    body: async req => req.input, cookies: req => ({ cc_diagnostics: req.cookie }), cookie: (_name, value) => value,
    json: (res, status, data) => Object.assign(res, { status, data }), clientAddress: req => req.ip });
  return { database, api, advance(ms) { time += ms; }, async call(path, ip, cookie, input = {}) {
    const res = { setHeader(_name, value) { this.cookie = value; } };
    try { await api.handle({ method: 'POST', ip, cookie, input }, res, `/api/public/${path}`); }
    catch (e) { if (!e.status) throw e; res.status = e.status; res.retryAfter = e.retryAfter; }
    return res;
  } };
}

test('20 browsers on one NAT: 20/20 bootstrap and 120/120 batches; excess, cookie churn and expiry are bounded', async () => {
  const f = fixture();
  try {
    const browsers = await Promise.all(Array.from({ length: 20 }, () => f.call('session', 'nat')));
    assert.ok(browsers.every(r => r.status === 200));
    assert.equal((await f.call('session', 'nat')).status, 429);
    const results = [];
    for (let round = 0; round < 6; round++) results.push(...await Promise.all(browsers.map(r => f.call('playtest', 'nat', r.cookie, batch()))));
    assert.equal(results.filter(r => r.status === 200).length, 120);
    assert.equal((await f.call('playtest', 'nat', browsers[0].cookie, batch())).status, 429);
    f.advance(60_000);
    for (let i = 0; i < 10; i++) assert.equal((await f.call('playtest', `rotated-ip-${i}`, browsers[0].cookie, batch())).status, 200);
    assert.equal((await f.call('playtest', 'fresh-ip', browsers[0].cookie, batch())).status, 429);
    f.advance(29 * 60_000);
    assert.equal((await f.call('playtest', 'nat', browsers[0].cookie, batch())).status, 401);
    assert.equal((await f.call('session', 'nat', browsers[0].cookie)).status, 200);
  } finally { f.database.close(); }
});

test('global budgets hold across address/cookie resets through a full session lifetime', async () => {
  const f = fixture();
  try {
    let first;
    for (let i = 0; i < 200; i++) { const r = await f.call('session', `ip:${i}`); assert.equal(r.status, 200); first ||= r; }
    assert.equal((await f.call('session', 'new-ip')).status, 429);
    for (let i = 0; i < 600; i++) assert.equal((await f.call('playtest', `ip:${i}`, undefined, batch())).status, 401);
    assert.equal((await f.call('playtest', 'another-ip', first.cookie, batch())).status, 429);
    // 200/minute * 30-minute TTL means at most 6000 live sessions under this policy.
    // The independent 10,000 cap remains defense in depth if budgets change later.
    for (let minute = 1; minute <= 30; minute++) {
      f.advance(60_000);
      for (let i = 0; i < 200; i++) assert.equal((await f.call('session', `ip:${i}`)).status, 200);
    }
    assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM owners').get().n, 0);
  } finally { f.database.close(); }
});

test('one IP already denied by its limit cannot consume other IPs global allowance', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < PUBLIC_BUDGETS.issuanceGlobal + 10; i++) {
      assert.equal((await f.call('session', 'flood')).status, i < PUBLIC_BUDGETS.issuanceIp ? 200 : 429);
    }
    const other = await f.call('session', 'other');
    assert.equal(other.status, 200, 'another IP can still bootstrap after denied issuance flood');
    for (let i = 0; i < PUBLIC_BUDGETS.telemetryGlobal + 10; i++) {
      assert.equal((await f.call('playtest', 'flood', undefined, batch())).status, i < PUBLIC_BUDGETS.telemetryIp ? 401 : 429);
    }
    assert.equal((await f.call('playtest', 'other', other.cookie, batch())).status, 200,
      'another IP can still upload after denied unauthenticated telemetry flood');
  } finally { f.database.close(); }
});

test('public retention cannot evict existing staff observations, and expires after 30 days', () => {
  const db = openDatabase(':memory:'); let time = Date.now();
  try {
    const staff = createPlaytestStore(db.db, { now: () => time });
    const publicStore = createPlaytestStore(db.db, { now: () => time, maxEvents: 20, publicOnly: true });
    staff.ingest(batch());
    for (let i = 0; i < 21; i++) publicStore.ingest(batch());
    assert.equal(publicStore.read().summary.events, 20); assert.equal(staff.read().summary.events, 1);
    time += 30 * 86400_000 + 1; publicStore.prune();
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM public_playtest_events').get().n, 0);
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM playtest_events').get().n, 1);
  } finally { db.close(); }
});

test('combined observation cap evicts public rows first, including when staff fills the remaining space', () => {
  const database = openDatabase(':memory:');
  try {
    const staff = createPlaytestStore(database.db), publicStore = createPlaytestStore(database.db, { maxEvents: 20_000, publicOnly: true });
    staff.ingest(batch());
    database.db.exec(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<99998)
      INSERT INTO playtest_events SELECT 'fixture-' || n, session_id, build, mode, type, elapsed_ms, run_id, data, received_at FROM numbers CROSS JOIN (SELECT * FROM playtest_events LIMIT 1)`);
    publicStore.ingest(batch()); publicStore.ingest(batch());
    const count = table => database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    assert.equal(count('playtest_events'), 99_999); assert.equal(count('public_playtest_events'), 1);
    staff.ingest(batch());
    assert.equal(count('playtest_events'), 100_000); assert.equal(count('public_playtest_events'), 0);
    publicStore.ingest(batch());
    assert.equal(count('playtest_events'), 100_000); assert.equal(count('public_playtest_events'), 0);
  } finally { database.close(); }
});


test('staff maintenance expires an existing public table with collection off, without creating one on fresh startup', () => {
  const database = openDatabase(':memory:'); let time = Date.now();
  try {
    const staff = createPlaytestStore(database.db, { now: () => time });
    assert.equal(database.db.prepare("SELECT 1 FROM sqlite_master WHERE name='public_playtest_events'").get(), undefined);
    const publicStore = createPlaytestStore(database.db, { now: () => time, publicOnly: true });
    publicStore.ingest(batch());
    time += 31 * 86400_000;
    staff.ingest(batch());
    staff.prune(); // Same maintenance entry used by the server with collection disabled.
    assert.equal(database.db.prepare('SELECT COUNT(*) AS n FROM public_playtest_events').get().n, 0);
    assert.equal(staff.read().summary.events, 1);
  } finally { database.close(); }
});
