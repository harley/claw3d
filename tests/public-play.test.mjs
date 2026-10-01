import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPilotServer } from '../server/index.js';
import { SPEED_RULES, scoreTurn, turnContext } from '../src/event-session.js';

// Observable contract: public rank authority is isolated from staff and from
// event enrollment. Existing ticket tests do not exercise ticket-free starts.
async function fixture(t, { secure = false, publicPermitPolicy = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'claw-public-'));
  await writeFile(join(dir, 'index.html'), '<head></head>Arcade');
  await writeFile(join(dir, 'privacy.html'), '<h1>Privacy</h1>');
  const origin = 'http://127.0.0.1:4291';
  let time = Date.parse('2026-09-29T12:00:00+07:00');
  const options = { filename: join(dir, 'test.sqlite'), dist: dir, origin, staffCode: 'public-test-staff-secret', hostCode: 'public-host-code', secure, publicTryEnabled: true, publicPermitPolicy, now: () => time };
  let app = await createPilotServer(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.database.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path, { data, cookie, method = data ? 'POST' : 'GET', requestOrigin = origin, headers = {} } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
    method, headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined,
  });
  const cookieOf = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function player() { const r = await request('/api/play/session', { data: {} }); assert.equal(r.status, 200); return cookieOf(r); }
  async function host() {
    const staff = cookieOf(await request('/api/login', { data: { code: 'public-test-staff-secret' } }));
    const host = cookieOf(await request('/api/host/login', { cookie: staff, data: { code: 'public-host-code' } }));
    return host;
  }
  async function enroll() {
    const r = await request('/api/host/station', { cookie: await host(), data: {} }); assert.equal(r.status, 200); return cookieOf(r);
  }
  const start = (cookie, requestKey = randomUUID(), extra = {}) => request('/api/play/runs', { cookie, data: { name: 'Mochi', requestKey, ...extra } });
  async function complete(cookie, id) {
    let saved;
    for (const turn of [1, 2, 3]) { const r = await request(`/api/play/runs/${id}/turns`, { cookie, data: { turn, prizeId: null, remainingMs: 0 } }); assert.equal(r.status, 200); saved = await r.json(); }
    return saved;
  }
  return { get app() { return app; }, request, player, host, enroll, start, complete, cookieOf, get time() { return time; },
    async pause(publicRankedEnabled = false, overrides = {}) {
      await new Promise(resolve => app.server.close(resolve)); app.database.close();
      app = await createPilotServer({ ...options, publicRankedEnabled, ...overrides });
      await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    },
    setTime: value => { time = Date.parse(value); } };
}

test('public names, repeat runs, server ranks and idempotent turns; staff authority stays private', async t => {
  const f = await fixture(t), cookie = await f.player(), other = await f.player();
  const key = randomUUID(), run = await (await f.start(cookie, key)).json();
  assert.equal((await (await f.start(cookie, key)).json()).id, run.id);
  assert.equal((await f.request(`/api/play/runs/${run.id}`, { cookie: other })).status, 404);
  assert.equal((await f.request(`/api/play/runs/${run.id}/turns`, { cookie: other, data: { turn: 1, prizeId: null } })).status, 404);
  for (const path of ['/api/session', '/api/board', '/api/host/export', '/api/host/station']) assert.equal((await f.request(path, { cookie })).status, 401, path);
  assert.equal((await f.request('/api/host/station', { cookie, data: {} })).status, 401);
  assert.equal((await f.request('/api/play/runs', { cookie, requestOrigin: 'https://attacker.invalid', data: { name: 'x', requestKey: randomUUID() } })).status, 403);
  assert.equal((await f.start(cookie, randomUUID(), { name: 'x'.repeat(25) })).status, 400);
  const saved = await f.complete(cookie, run.id);
  assert.equal(saved.rank, 1); assert.equal(saved.total, 0); assert.equal(saved.event, undefined);
  assert.equal((await f.request(`/api/play/runs/${run.id}/turns`, { cookie, data: { turn: 3, prizeId: null, remainingMs: 0 } })).status, 200);
  const second = await (await f.start(cookie)).json(); await f.complete(cookie, second.id);
  const board = await (await f.request('/api/play/board')).json();
  assert.equal(board.runs.length, 2); assert.deepEqual(board.runs.map(r => r.name), ['Mochi', 'Mochi']);
  assert.deepEqual(board.runs.map(r => r.rank), [1, 1]); assert.equal(new Set(board.runs.map(r => r.id)).size, 2);
  assert.deepEqual(Object.keys(board.runs[0]).sort(), ['id', 'name', 'rank', 'total']);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM turns').get().n, 6);
});

test('event enrollment plus server Hanoi date, never client claims; retries keep original classification', async t => {
  const f = await fixture(t), cookie = await f.player();
  const forged = await (await f.start(cookie, randomUUID(), { event: true, date: '2026-09-29', station: true })).json();
  assert.equal(forged.event, undefined);
  const station = await f.enroll(), booth = `${cookie}; ${station}`;
  f.setTime('2026-09-28T23:59:59+07:00');
  const beforeKey = randomUUID(), before = await (await f.start(booth, beforeKey)).json(); assert.equal(before.event, undefined);
  f.setTime('2026-09-29T00:00:00+07:00');
  assert.equal((await (await f.start(booth, beforeKey)).json()).event, undefined);
  const duringKey = randomUUID(), during = await (await f.start(booth, duringKey)).json(); assert.equal(during.event.id, 'hanoi-2026-09-29');
  f.setTime('2026-09-30T00:00:00+07:00');
  assert.equal((await (await f.start(booth, duringKey)).json()).event.id, 'hanoi-2026-09-29');
  const saved = await f.complete(booth, during.id); assert.equal(saved.eventRank, 1);
  assert.equal((await (await f.start(booth)).json()).event, undefined);
  const eventBoard = await (await f.request('/api/play/board?event=hanoi-2026-09-29')).json(); assert.equal(eventBoard.runs.length, 1); assert.equal(eventBoard.totalPlays, 1);
  assert.equal((await f.request('/api/play/board?event=other')).status, 404);
});

test('re-enrollment retires the earlier booth capability; privacy and entry are public', async t => {
  const f = await fixture(t), cookie = await f.player(), first = await f.enroll(), second = await f.enroll();
  assert.equal((await (await f.start(`${cookie}; ${first}`)).json()).event, undefined);
  assert.equal((await (await f.start(`${cookie}; ${second}`)).json()).event.id, 'hanoi-2026-09-29');
  assert.match(await (await f.request('/')).text(), /__PUBLIC_PLAY__=true/);
  for (const method of ['GET', 'HEAD']) assert.equal((await f.request('/privacy', { method })).status, 200);
});

test('pausing new ranked starts preserves request reconciliation and score drain after restart', async t => {
  const f = await fixture(t), cookie = await f.player(), key = randomUUID();
  const run = await (await f.start(cookie, key)).json();
  await f.pause();
  assert.equal((await f.start(cookie)).status, 503);
  assert.equal((await f.request('/api/play/session', { data: {} })).status, 503);
  assert.equal((await (await f.start(cookie, key)).json()).id, run.id);
  const saved = await f.complete(cookie, run.id); assert.equal(saved.rank, 1);
  assert.equal((await (await f.request('/api/play/board')).json()).runs.length, 1);
});

test('bounded board preserves nonzero ties and personal ranks beyond its first 100 rows', async t => {
  const f = await fixture(t), cookie = await f.player(), run = await (await f.start(cookie)).json();
  await f.complete(cookie, run.id);
  const db = f.app.database.db, source = db.prepare('SELECT * FROM runs WHERE id=?').get(run.id);
  const add = db.prepare("INSERT INTO runs (id,owner_id,request_key,board_id,name,rules,status,total,started_at,completed_at) VALUES (?,?,?,?,?,?,'complete',?,?,?)");
  for (let i = 1; i <= 105; i++) add.run(randomUUID(), source.owner_id, randomUUID(), source.board_id, `Player ${i}`, source.rules, i === 105 ? 104 : i, source.started_at, source.completed_at);
  add.run(randomUUID(), source.owner_id, randomUUID(), f.app.database.board().id, 'Staff test', source.rules, 500, source.started_at, source.completed_at);
  const board = await (await f.request('/api/play/board')).json();
  assert.equal(board.runs.length, 100);
  assert.equal(board.totalPlays, 106, 'completed-play count includes rows beyond the top 100 and excludes staff scores');
  const unfinished = await (await f.start(cookie)).json();
  assert.equal((await (await f.request('/api/play/board')).json()).totalPlays, 106, 'unfinished starts do not count as completed plays');
  await f.request(`/api/play/runs/${unfinished.id}/abandon`, { cookie, data: {} });
  assert.equal((await (await f.request('/api/play/board')).json()).totalPlays, 106, 'abandoned starts do not count');
  assert.deepEqual(board.runs.slice(0, 3).map(row => row.rank), [1, 1, 3]);
  assert.equal((await (await f.request(`/api/play/runs/${run.id}`, { cookie })).json()).rank, 106);
});

// Host setup must work without a staff login while preserving the host secret,
// origin, session and station boundaries; the former two-step tests cannot cover it.
test('one host sign-in protects setup, rotates sessions and keeps station enrollment after logout', async t => {
  const { request, app } = await fixture(t);
  const page = await (await request('/staff')).text();
  assert.match(page, /Host setup/);
  assert.doesNotMatch(page, /<canvas|<video|src="\/assets|public-host-code|public-test-staff-secret/);
  assert.equal((await request('/api/host/station')).status, 401);
  assert.equal((await request('/api/host/sign-in', { data: { code: 'public-test-staff-secret' } })).status, 401, 'staff secret cannot grant host access');
  assert.equal((await request('/api/host/sign-in', { requestOrigin: 'https://other.invalid', data: { code: 'public-host-code' } })).status, 403);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  const cookieOf = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const signedIn = await request('/api/host/sign-in', { data: { code: 'public-host-code' } });
  assert.equal(signedIn.status, 200);
  assert.ok(signedIn.headers.getSetCookie().every(value => value.includes('HttpOnly') && value.includes('SameSite=Strict')));
  const first = cookieOf(signedIn);
  assert.equal((await (await request('/api/host/station', { cookie: first })).json()).enrolled, false);
  const second = cookieOf(await request('/api/host/sign-in', { cookie: first, data: { code: 'public-host-code' } }));
  assert.equal((await request('/api/host/station', { cookie: first })).status, 401);
  const enrolled = await request('/api/host/station', { cookie: second, data: {} });
  assert.equal(enrolled.status, 200);
  const station = cookieOf(enrolled);
  assert.equal((await request('/api/logout', { cookie: second, data: {} })).status, 200);
  assert.equal((await request('/api/host/station', { cookie: second })).status, 401);
  const publicSession = await request('/api/play/session', { cookie: station, data: {} });
  assert.equal((await publicSession.json()).station.active, true);
  assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0, 'setup and sign-out do not create scores');
});

test('host sign-in attempts are bounded before issuing any authority', async t => {
  const { request } = await fixture(t, { secure: true });
  for (let n = 0; n < 12; n++) assert.equal((await request('/api/host/sign-in', { data: { code: 'incorrect' }, headers: { 'x-real-ip': `192.0.2.${n + 1}`, 'x-forwarded-for': `192.0.2.${n + 1}` } })).status, 401);
  const throttled = await request('/api/host/sign-in', { data: { code: 'public-host-code' }, headers: { 'x-real-ip': '192.0.2.99', 'x-forwarded-for': '192.0.2.99' } });
  assert.equal(throttled.status, 429);
  assert.ok(throttled.headers.get('retry-after'));
  assert.equal(throttled.headers.get('set-cookie'), null);
});


test('host setup stops offering enrollment after the Hanoi event ends', async t => {
  const f = await fixture(t);
  const signedIn = await f.request('/api/host/sign-in', { data: { code: 'public-host-code' } });
  const cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  f.setTime('2026-09-30T00:00:00+07:00');
  assert.equal((await (await f.request('/api/host/station', { cookie })).json()).ended, true);
  assert.equal((await f.request('/api/host/station', { cookie, data: {} })).status, 409);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM public_stations').get().n, 0);
});

// The public board persists across versions; update future snapshots without
// replacing its identity or recalculating completed/pending run scores.
test('public rule upgrade preserves old results and unfinished runs, bonuses apply only to new dual runs', async t => {
  const f = await fixture(t), cookie = await f.player();
  const initial = await (await f.start(cookie)).json();
  const oldRules = { ...SPEED_RULES, controlVersion: 'camera-dual-raise-v1', controlMode: 'two-hand' };
  f.app.database.db.prepare('UPDATE boards SET rules=? WHERE id=?').run(JSON.stringify({ ...SPEED_RULES, controlVersion: 'camera-fist-hold-550-v2' }), initial.boardId);
  f.app.database.db.prepare('UPDATE runs SET rules=? WHERE id=?').run(JSON.stringify(oldRules), initial.id);
  const pendingKey = randomUUID();
  const pending = await (await f.start(cookie, pendingKey, { controlMode: 'two-hand' })).json();
  const turn = (id, n, prizeId, remainingMs = 0) => f.request(`/api/play/runs/${id}/turns`, { cookie, data: { turn: n, prizeId, remainingMs } });
  await turn(initial.id, 1, 'butter'); await turn(initial.id, 2, null);
  assert.equal((await (await turn(initial.id, 3, null)).json()).total, 100);
  await turn(pending.id, 1, 'sprout');
  await f.pause(true);
  const retry = await (await f.start(cookie, pendingKey, { controlMode: 'two-hand' })).json();
  assert.equal(retry.rules.version, SPEED_RULES.version);
  await turn(pending.id, 2, 'butter');
  assert.equal((await (await turn(pending.id, 3, null)).json()).total, 300);
  const next = await (await f.start(cookie, randomUUID(), { controlMode: 'two-hand' })).json();
  assert.equal(next.boardId, initial.boardId);
  assert.equal(next.rules.twoHandBonus, 25);
  assert.equal((await (await turn(next.id, 1, 'butter', 7500)).json()).turns[0].score, 150);
  assert.equal((await (await turn(next.id, 1, 'butter', 7500)).json()).turns.length, 1);
  await turn(next.id, 2, 'sprout');
  assert.equal((await (await turn(next.id, 3, null, 15000)).json()).total, 375);
  const board = await (await f.request('/api/play/board')).json();
  assert.equal(board.id, initial.boardId);
  assert.deepEqual(board.runs.map(r => r.total), [375, 300, 100]);
});

test('public result rename is owner-only, repeatable and preserves the ranked receipt', async t => {
  const f = await fixture(t), cookie = await f.player(), other = await f.player();
  const run = await (await f.start(cookie)).json();
  const rename = (name, owner = cookie) => f.request(`/api/play/runs/${run.id}/name`, { cookie: owner, data: { name } });
  assert.equal((await rename('Linh')).status, 409);
  const saved = await f.complete(cookie, run.id);
  assert.equal((await rename('Other', other)).status, 404);
  assert.equal((await rename('')).status, 400);
  for (let retry = 0; retry < 2; retry++) assert.deepEqual(await (await rename(' Linh ')).json(), { ...saved, name: 'Linh' });
  const board = await (await f.request('/api/play/board')).json();
  assert.deepEqual(board.runs, [{ id: run.id, name: 'Linh', total: saved.total, rank: saved.rank }]);
});

test('read-only start receipt lookup is owner scoped and never creates or reclassifies admission', async t => {
  const f = await fixture(t), owner = await f.player(), other = await f.player(), key = randomUUID();
  const path = `/api/play/intents/${key}`;
  assert.equal((await f.request(path, { cookie: owner })).status, 404);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
  const admitted = await (await f.start(owner, key)).json();
  const station = await f.enroll();
  const receipt = await (await f.request(path, { cookie: `${owner}; ${station}` })).json();
  assert.equal(receipt.id, admitted.id); assert.equal(receipt.event, undefined);
  assert.equal((await f.request(path, { cookie: other })).status, 404);
  await f.pause();
  assert.equal((await f.request(path, { cookie: owner })).status, 200);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1);
});

// Permit tests exercise real HTTP/auth and SQLite transaction boundaries. The
// existing public cases do not reserve identities or freeze rules before start.
const permitPolicy = { maxSlots: 8, maxRetentionMs: 3 * 86400000 };
async function prepared(t, { count = 4, secure = true, preparationTime } = {}) {
  const f = await fixture(t, { secure, publicPermitPolicy: permitPolicy });
  const player = await f.player(), host = await f.host(), station = await f.enroll();
  if (preparationTime) f.setTime(preparationTime);
  const booth = `${player}; ${station}`, authorized = `${booth}; ${host}`;
  const input = { protocol: 1, requestKey: randomUUID(), count, reconcileBy: f.time + 2 * 86400000 };
  const issue = (data = input, cookie = authorized) => f.request('/api/host/station/permits', { cookie, data });
  const response = await issue(); assert.equal(response.status, 200);
  const pool = await response.json(); assert.equal(pool.ready, true);
  const payload = (index = 0, mode = 'one-hand') => ({ protocol: 1, slotId: pool.slots[index].id, runId: pool.slots[index].runId,
    requestKey: pool.slots[index].requestKey, name: 'Lan', controlMode: mode });
  const register = (source, data = payload(), cookie = booth) => f.request(`/api/play/permits/${source}`, { cookie, data });
  return { ...f, get app() { return f.app; }, get time() { return f.time; }, player, host, station, booth, authorized, input, issue, pool, payload, register };
}

test('permit preparation is bounded, host-only, idempotent and default disabled; reserves no runs', async t => {
  const f = await prepared(t, { count: 8 });
  const retry = await f.issue(); assert.equal(retry.status, 200); assert.deepEqual((await retry.json()).slots, f.pool.slots);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM public_permit_slots').get().n, 8);
  assert.equal((await f.issue({ ...f.input, count: 7 })).status, 409);
  for (const change of [{ count: 9 }, { reconcileBy: f.time - 1 }, { reconcileBy: f.time + 4 * 86400000 }]) {
    assert.equal((await f.issue({ ...f.input, requestKey: randomUUID(), ...change })).status, 400);
  }
  const exhausted = await f.issue({ ...f.input, requestKey: randomUUID(), count: 1 });
  assert.equal(exhausted.status, 409); assert.equal((await exhausted.json()).code, 'capacity_exhausted');
  assert.equal((await f.issue(f.input, f.booth)).status, 401);
  assert.equal((await f.issue(f.input, f.host)).status, 401);
  assert.equal((await f.issue({ ...f.input, protocol: 2 })).status, 409);
  assert.equal((await f.issue({ ...f.input, extra: true })).status, 400);
  assert.equal((await f.request('/api/host/station/permits', { cookie: f.authorized, data: f.input, requestOrigin: 'https://wrong.invalid' })).status, 403);
  assert.equal((await f.issue({ ...f.input, name: 'x'.repeat(5000) })).status, 413);
  assert.equal((await f.start(f.booth, f.payload().requestKey)).status, 409, 'legacy route cannot steal a reserved identity');
  const bypass = await f.start(f.player); assert.equal(bypass.status, 409); assert.equal((await bypass.json()).code, 'permit_required');
  const remote = f.cookieOf(await f.request('/api/play/session', { data: {} }));
  assert.equal((await f.start(remote)).status, 201, 'unprepared public admission remains online-only');
  const disabled = await fixture(t), owner = await disabled.player(), host = await disabled.host(), station = await disabled.enroll();
  const refused = await disabled.request('/api/host/station/permits', { cookie: `${owner}; ${host}; ${station}`, data: f.input });
  assert.equal(refused.status, 403); assert.equal((await refused.json()).code, 'permits_disabled');
});

// Prepared live admissions must retain the same usage contract as ordinary
// starts; replay/reconciliation must not reclassify an already admitted run.
test('prepared live usage is atomic and retry-stable; deferred device evidence stays unknown', async t => {
  const f = await prepared(t), db = f.app.database.db;
  const live = await f.request('/api/play/permits/live', { cookie: f.booth, data: f.payload(), headers: { 'user-agent': 'iPhone Mobile' } });
  assert.equal(live.status, 200);
  const usage = () => db.prepare('SELECT * FROM run_usage WHERE run_id=?').get(f.payload().runId);
  const original = usage();
  assert.equal(original.device_class, 'phone');
  assert.equal((await f.register('reconcile')).status, 200);
  assert.deepEqual(usage(), original);
  assert.equal((await f.register('reconcile', f.payload(1))).status, 200);
  assert.equal((await f.register('live', f.payload(1))).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM run_usage').get().n, 1);
});

test('preparation renews same valid owner through deadline and refuses expired/replaced ownership', async t => {
  const f = await prepared(t);
  const db = f.app.database.db, original = db.prepare('SELECT * FROM public_players').get();
  db.prepare('UPDATE public_players SET expires=? WHERE owner_id=?').run(f.time + 1000, original.owner_id);
  const renewed = await f.issue(); const receipt = await renewed.json();
  assert.equal(receipt.ownerExpires, f.input.reconcileBy + 1000);
  assert.equal(f.cookieOf(renewed), f.player);
  assert.match(renewed.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=172801; Secure/);
  assert.equal(db.prepare('SELECT owner_id FROM public_players').get().owner_id, original.owner_id);
  const verified = await (await f.request(`/api/play/permits/${f.pool.id}`, { cookie: f.booth })).json();
  assert.equal(verified.ready, true); assert.equal(verified.ownerExpires, receipt.ownerExpires);
  f.setTime('2026-09-30T12:00:00+07:00');
  assert.equal((await f.register('reconcile')).status, 200, 'renewed owner drains after old expiry and event midnight');
  db.prepare('UPDATE public_players SET expires=?').run(f.time - 1);
  const expired = await f.issue(); assert.equal(expired.status, 401); assert.equal((await expired.json()).code, 'owner_expired');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_players').get().n, 1, 'preparation never silently bootstraps an owner');
  const replacement = await f.request('/api/play/session', { data: {} });
  assert.equal((await f.register('reconcile', f.payload(), f.cookieOf(replacement))).status, 403);
});

test('live/deferred registration shares immutable identity and event association in either race order', async t => {
  const f = await prepared(t, { preparationTime: '2026-09-28T12:00:00+07:00' });
  f.setTime('2026-09-29T12:00:00+07:00');
  const live = await (await f.register('live')).json(); assert.equal(live.id, f.payload().runId); assert.ok(live.event);
  // A lost live response is recovered by reconciliation; crossing midnight
  // cannot strip the original association or cause another physical identity.
  f.setTime('2026-09-30T00:00:00+07:00');
  const recovered = await (await f.register('reconcile')).json(); assert.equal(recovered.id, live.id); assert.ok(recovered.event);
  f.setTime('2026-09-29T12:00:00+07:00');
  const deferred = await (await f.register('reconcile', f.payload(1))).json(); assert.equal(deferred.event, undefined);
  const lateLive = await (await f.register('live', f.payload(1))).json(); assert.equal(lateLive.id, deferred.id); assert.equal(lateLive.event, undefined);
  for (const source of ['live', 'reconcile']) {
    assert.equal((await f.register(source, { ...f.payload(), name: 'Changed' })).status, 409);
    assert.equal((await f.register(source, { ...f.payload(), controlMode: 'two-hand' })).status, 409);
    assert.equal((await f.register(source, { ...f.payload(), runId: randomUUID() })).status, 409);
  }
  const race = await Promise.all(['live', 'reconcile'].map(source => f.register(source, f.payload(2))));
  const receipts = await Promise.all(race.map(r => r.json()));
  assert.equal(receipts[0].id, receipts[1].id); assert.deepEqual(receipts[0].event, receipts[1].event);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 3);
  await f.complete(f.booth, live.id);
  await f.request(`/api/play/runs/${live.id}/name`, { cookie: f.booth, data: { name: 'Display edit' } });
  assert.equal((await (await f.register('reconcile')).json()).name, 'Display edit', 'display name edits never replace the immutable start binding');
});

test('frozen mode rules survive later board changes; three ordered turns and abandonment consume slots', async t => {
  const f = await prepared(t);
  f.app.database.db.prepare('UPDATE boards SET rules=? WHERE id=?').run(JSON.stringify({ ...f.pool.rules, points: { ...f.pool.rules.points, butter: 1 } }), f.pool.boardId);
  const admitted = await (await f.register('reconcile', f.payload(0, 'two-hand'))).json();
  assert.deepEqual(admitted.rules.points, f.pool.rules.points); assert.equal(admitted.rules.controlMode, 'two-hand');
  const turns = [ { turn: 1, prizeId: 'butter', remainingMs: 15000 }, { turn: 2, prizeId: null, remainingMs: 0 }, { turn: 3, prizeId: 'sprout', remainingMs: 1 } ];
  const post = data => f.request(`/api/play/runs/${admitted.id}/turns`, { cookie: f.booth, data });
  assert.equal((await post(turns[1])).status, 409);
  let saved;
  for (const turn of turns) { const r = await post(turn); assert.equal(r.status, 200); saved = await r.json(); }
  const expected = turns.map((turn, i) => scoreTurn(admitted.rules, turnContext(turns.slice(0, i), turn.prizeId, turn.remainingMs)));
  assert.deepEqual(saved.turns.map(turn => turn.score), expected); assert.equal(saved.total, expected.reduce((a,b) => a+b,0));
  assert.equal((await post(turns[2])).status, 200); assert.equal((await post({ ...turns[2], prizeId: null })).status, 409);
  assert.equal((await post({ turn: 4, prizeId: null })).status, 400);
  const interrupted = await (await f.register('live', f.payload(1))).json();
  await f.request(`/api/play/runs/${interrupted.id}/abandon`, { cookie: f.booth, data: {} });
  assert.equal((await (await f.register('reconcile', f.payload(1))).json()).status, 'abandoned');
  const pool = await (await f.request(`/api/play/permits/${f.pool.id}`, { cookie: f.booth })).json();
  assert.equal(pool.slots.filter(slot => slot.admissionSource).length, 2);
});

test('pause/revocation preserve receipt and bounded deferred drainage but refuse new live authority', async t => {
  const f = await prepared(t);
  await f.register('live');
  const revoke = await f.request('/api/host/station/revoke', { cookie: f.authorized, data: {} }); assert.equal(revoke.status, 200);
  const denied = await f.register('live', f.payload(1)); assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'station_revoked');
  assert.equal((await f.issue({ ...f.input, requestKey: randomUUID(), count: 1 })).status, 403);
  assert.equal((await (await f.issue()).json()).ready, false, 'old receipt never re-enables revoked slots');
  assert.equal((await f.register('reconcile', f.payload(1))).status, 200);
  assert.equal((await (await f.register('reconcile')).json()).event.id, 'hanoi-2026-09-29');
  await f.pause();
  const paused = await f.register('live', f.payload(2)); assert.equal(paused.status, 503); assert.equal((await paused.json()).code, 'admission_paused');
  assert.equal((await f.register('reconcile', f.payload(2))).status, 200);
  assert.equal((await f.register('live')).status, 200, 'existing identity is only a receipt');
  await f.pause(true, { publicPermitPolicy: null });
  const disabled = await f.register('live', f.payload(3)); assert.equal(disabled.status, 403); assert.equal((await disabled.json()).code, 'permits_disabled');
  assert.equal((await f.register('reconcile')).status, 200, 'disabling issuance preserves existing receipts');
  f.setTime('2026-10-01T12:00:01+07:00');
  assert.equal((await f.register('reconcile', f.payload(3))).status, 403);
  assert.equal((await f.register('reconcile')).status, 200, 'admitted results remain accessible after permit deadline');
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM public_permit_slots').get().n, 4);
});

test('forged/remote/protocol refusals and transaction failures never partly bind a slot', async t => {
  const f = await prepared(t);
  const other = f.cookieOf(await f.request('/api/play/session', { data: {} }));
  for (const data of [{ ...f.payload(), slotId: 'forged' }, { ...f.payload(), protocol: 2 }, { ...f.payload(), requestKey: randomUUID() }, { ...f.payload(), event: true }]) assert.ok((await f.register('live', data)).status >= 400);
  assert.equal((await f.register('reconcile', f.payload(), other)).status, 403);
  assert.equal((await f.register('live', f.payload(), f.player)).status, 403, 'no current station cookie');
  const db = f.app.database.db;
  db.exec("CREATE TRIGGER fail_permit_slot BEFORE INSERT ON public_permit_slots BEGIN SELECT RAISE(ABORT, 'injected slot write failure'); END;");
  assert.equal((await f.issue({ ...f.input, requestKey: randomUUID(), count: 1 })).status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_permit_pools').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_permit_slots').get().n, 4);
  db.exec('DROP TRIGGER fail_permit_slot');
  db.exec("CREATE TRIGGER fail_permit_event BEFORE INSERT ON public_run_events BEGIN SELECT RAISE(ABORT, 'injected event write failure'); END;");
  assert.equal((await f.register('live')).status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_permit_slots WHERE admission_source IS NOT NULL').get().n, 0);
  db.exec('DROP TRIGGER fail_permit_event');
  assert.equal((await f.register('reconcile')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1);
});

test('permit requests retain public write budgets, retry guidance and one stored identity', async t => {
  const f = await prepared(t, { count: 1 });
  for (let i = 0; i < 120; i++) assert.equal((await f.register('reconcile')).status, 200);
  const throttled = await f.register('reconcile'); assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get('retry-after'), '60');
  const pool = await (await f.request(`/api/play/permits/${f.pool.id}`, { cookie: f.booth })).json();
  assert.equal(pool.unregisteredSlots, 0); assert.equal(pool.ready, false);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1);
});

test('legacy station enrollment migrates additively; re-enrollment never readies an old pool', async t => {
  const f = await fixture(t, { publicPermitPolicy: permitPolicy });
  const player = await f.player(), host = await f.host(), station = await f.enroll();
  f.app.database.db.exec('DROP TABLE public_station_events; DROP TABLE public_station_generations'); // Prior schema had only active enrollment.
  await f.pause(true);
  const booth = `${player}; ${station}`, authorized = `${booth}; ${host}`;
  const input = { protocol: 1, requestKey: randomUUID(), count: 1, reconcileBy: f.time + 86400000 };
  const pool = await (await f.request('/api/host/station/permits', { cookie: authorized, data: input })).json();
  assert.equal(pool.ready, true);
  const newerStation = await f.enroll();
  const retry = await (await f.request('/api/host/station/permits', { cookie: `${player}; ${newerStation}; ${host}`, data: input })).json();
  assert.equal(retry.ready, false); assert.deepEqual(retry.slots, pool.slots);
  await f.pause(true);
  const preserved = await (await f.request(`/api/play/permits/${pool.id}`, { cookie: `${player}; ${newerStation}` })).json();
  assert.deepEqual(preserved.slots, pool.slots); assert.equal(preserved.ready, false);
  f.app.database.db.exec('DELETE FROM public_stations'); // An older app retired active enrollment without knowing history.
  const status = await (await f.request('/api/host/station', { cookie: `${host}; ${newerStation}` })).json();
  assert.equal(status.enrolled, false, 'retained history never resurrects retired active authority');
  const slot = pool.slots[0];
  const saved = await f.request('/api/play/permits/reconcile', { cookie: player, data: { protocol: 1, slotId: slot.id, runId: slot.runId, requestKey: slot.requestKey, name: 'Old evidence', controlMode: 'one-hand' } });
  assert.equal(saved.status, 200); assert.equal((await saved.json()).event, undefined);
});

// Contact capture owns a new private-data boundary: prior rank tests cannot
// catch leaked contacts, forged ownership, duplicate requests or retention.
test('optional contact requests are owned, private, validated, idempotent and retained for 30 days', async t => {
  const f = await fixture(t), cookie = await f.player(), other = await f.player();
  const run = await (await f.start(cookie)).json();
  const path = `/api/play/runs/${run.id}/contact`;
  const data = { name: 'Private Visitor', contact: 'visitor@example.com', consent: true };
  assert.equal((await f.request(path, { cookie, data })).status, 409);
  await f.complete(cookie, run.id);
  assert.equal((await f.request(path, { cookie: other, data })).status, 404);
  assert.equal((await f.request(path, { data })).status, 401);
  assert.equal((await f.request(path, { cookie, data, requestOrigin: 'https://other.invalid' })).status, 403);
  for (const invalid of [{ consent: false }, { name: '' }, { contact: 'bad' }, { contact: 'x@x.com\nInjected' }, { contact: '1234' }, { name: 'x'.repeat(81) }]) {
    assert.equal((await f.request(path, { cookie, data: { ...data, ...invalid } })).status, 400);
  }
  let saved = await f.request(path, { cookie, data });
  assert.deepEqual(await saved.json(), { saved: true, eligible: false });
  saved = await f.request(path, { cookie, data }); assert.equal(saved.status, 200);
  const db = f.app.database.db;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_contacts').get().n, 1);
  const first = db.prepare('SELECT * FROM public_contacts').get();
  assert.equal(first.purpose, 'result-and-booth-invitation-v1');
  assert.equal((await f.request('/api/host/contacts', { cookie })).status, 401);
  const cookieOf = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const staff = cookieOf(await f.request('/api/login', { data: { code: 'public-test-staff-secret' } }));
  assert.equal((await f.request('/api/host/contacts', { cookie: staff })).status, 403);
  const host = cookieOf(await f.request('/api/host/sign-in', { data: { code: 'public-host-code' } }));
  const exported = await (await f.request('/api/host/contacts', { cookie: host })).json();
  assert.equal(exported.contacts[0].contact, data.contact);
  assert.equal(exported.contacts[0].runId, run.id);
  for (const endpoint of ['/api/play/board', `/api/play/runs/${run.id}`, '/api/play/session']) {
    const response = await f.request(endpoint, { cookie, ...(endpoint.endsWith('session') ? { data: {} } : {}) });
    const text = await response.text();
    assert.ok(!text.includes(data.contact) && !text.includes(data.name), `${endpoint} does not disclose contacts`);
  }
  // Qualification comes from the saved score, never a submitted eligibility flag.
  db.prepare('UPDATE runs SET total=300 WHERE id=?').run(run.id);
  assert.equal((await (await f.request(path, { cookie, data: { ...data, eligible: true } })).json()).eligible, false);
  db.prepare('UPDATE runs SET total=301 WHERE id=?').run(run.id);
  const phone = { ...data, contact: '+84 (90) 123-4567' };
  assert.equal((await (await f.request(path, { cookie, data: phone })).json()).eligible, true);
  assert.equal(db.prepare('SELECT channel FROM public_contacts').get().channel, 'phone');
  assert.equal(db.prepare('SELECT name FROM runs WHERE id=?').get(run.id).name, 'Mochi');
  await f.pause(true);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM public_contacts').get().n, 1, 'survives restart');
  f.setTime('2026-10-30T12:00:00+07:00');
  await f.pause(true);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM public_contacts').get().n, 0, 'startup prunes expired contact details');
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1, 'contact retention preserves scores');
});

// Contract: instrumentation adds one bounded receipt at start, survives retries,
// and is only visible in host exports. Existing rank tests have no device data.
test('usage is captured once on the existing start request and remains private', async t => {
  const f = await fixture(t), cookie = await f.player(), requestKey = randomUUID();
  const response = await f.request('/api/play/runs', { cookie, data: { name: 'Mochi', requestKey }, headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' } });
  assert.equal(response.status, 201);
  const issued = await response.json(); assert.equal(issued.usage, undefined);
  await f.start(cookie, requestKey); // Different UA on retry must not relabel.
  const rows = f.app.database.db.prepare('SELECT * FROM run_usage').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].device_class, 'phone');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['device_class', 'recorded_at', 'run_id']);
  let exported = f.app.database.exportData().boards.find(b => b.usageSource === 'public-web');
  assert.equal(exported.interruptedRuns[0].usage.deviceClass, 'phone');
  await f.complete(cookie, issued.id);
  exported = f.app.database.exportData().boards.find(b => b.usageSource === 'public-web');
  assert.equal(exported.runs[0].usage.deviceClass, 'phone');
  const publicBoard = await (await f.request('/api/play/board')).json();
  assert.equal(publicBoard.runs[0].usage, undefined);
  await f.pause(); // Additive table survives restart; metadata is not recreated.
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM run_usage').get().n, 1);
});

// Contract: reusable schedules never reclassify old admissions. The Hanoi-only
// tests above cannot catch event switching, schedule boundaries or lost creates.
const futureEvent = (extra = {}) => ({ name: 'Next Cloud Day', startsAt: '2026-10-10T02:00:00.000Z', endsAt: '2026-10-10T11:00:00.000Z', timeZone: 'Asia/Ho_Chi_Minh', requestKey: randomUUID(), ...extra });

test('public event creation is host-only, origin-checked, validated and idempotent across restart', async t => {
  const f = await fixture(t), host = await f.host(), input = futureEvent();
  assert.equal((await f.request('/api/host/public-events')).status, 401);
  const staff = f.cookieOf(await f.request('/api/login', { data: { code: 'public-test-staff-secret' } }));
  assert.equal((await f.request('/api/host/public-events', { cookie: staff })).status, 403);
  assert.equal((await f.request('/api/host/public-events', { cookie: staff, data: input })).status, 403);
  assert.equal((await f.request('/api/host/public-events', { cookie: host, data: input, requestOrigin: 'https://wrong.invalid' })).status, 403);
  for (const extra of [{ startsAt: '2026-02-30T02:00:00.000Z' }, { endsAt: input.startsAt }, { endsAt: '2027-01-01T00:00:00.000Z' }, { timeZone: 'Invalid/Zone' }, { requestKey: 'bad' }, { scoring: 10 }, { name: 'bad\u0000name' }]) {
    assert.equal((await f.request('/api/host/public-events', { cookie: host, data: { ...input, ...extra } })).status, 400, JSON.stringify(extra));
  }
  const created = await (await f.request('/api/host/public-events', { cookie: host, data: input })).json();
  assert.equal(created.name, input.name);
  assert.equal((await f.request('/api/host/public-events', { cookie: host, data: { ...input, name: 'Conflicting retry' } })).status, 409);
  await f.pause(true);
  assert.deepEqual(await (await f.request('/api/host/public-events', { cookie: host, data: input })).json(), created);
  const list = await (await f.request('/api/host/public-events', { cookie: host })).json();
  assert.equal(list.events.filter(event => event.id === created.id).length, 1);
  assert.equal(list.events.find(event => event.id === created.id).state, 'scheduled');
  assert.equal((await f.request(`/api/host/public-events/${created.id}/export`, { cookie: staff })).status, 403);
});

test('scheduled enrollment classifies at acceptance, preserves retries after switching and retains global scores', async t => {
  const f = await fixture(t), host = await f.host(), player = await f.player();
  const oldStation = await f.enroll(), oldRun = await (await f.start(`${player}; ${oldStation}`)).json();
  await f.complete(player, oldRun.id);
  const event = await (await f.request('/api/host/public-events', { cookie: host, data: futureEvent() })).json();
  const enroll = await f.request('/api/host/station', { cookie: host, data: { eventId: event.id } });
  const station = f.cookieOf(enroll), booth = `${player}; ${station}`;
  assert.equal((await (await f.start(`${player}; ${oldStation}`)).json()).event, undefined, 'previous computer is retired');
  assert.equal((await (await f.start(booth)).json()).event, undefined, 'pre-event play stays global');
  f.setTime(event.startsAt);
  const key = randomUUID(), run = await (await f.start(booth, key)).json();
  assert.equal(run.event.id, event.id);
  f.setTime(event.endsAt);
  const saved = await f.complete(player, run.id);
  assert.equal(saved.event.id, event.id, 'finishing after end keeps admission classification');
  assert.equal((await (await f.start(booth)).json()).event, undefined, 'end is exclusive');
  assert.equal((await f.request('/api/host/station', { cookie: host, data: { eventId: event.id } })).status, 409);
  const later = await (await f.request('/api/host/public-events', { cookie: host, data: futureEvent({ name: 'Another event', startsAt: '2026-10-11T02:00:00.000Z', endsAt: '2026-10-11T11:00:00.000Z' }) })).json();
  await f.request('/api/host/station', { cookie: host, data: { eventId: later.id } });
  await f.pause(true);
  assert.equal((await (await f.start(player, key)).json()).event.id, event.id, 'retry cannot move a previous run');
  assert.equal((await (await f.request(`/api/play/runs/${oldRun.id}`, { cookie: player })).json()).event.id, 'hanoi-2026-09-29');
  assert.equal((await (await f.request('/api/play/board')).json()).totalPlays, 2);
  assert.equal((await f.request(`/api/play/board?event=${event.id}`)).status, 404, 'no new public event selector');
  const report = await (await f.request(`/api/host/public-events/${event.id}/export`, { cookie: host })).json();
  assert.equal(report.startedPlays, 1); assert.equal(report.completedPlays, 1);
  assert.equal(report.runs[0].id, run.id); assert.equal(report.runs[0].turns.length, 3);
  const text = JSON.stringify(report);
  for (const privateField of ['owner_id', 'request_key', 'cc_station', 'token', 'contact']) assert.ok(!text.includes(privateField), privateField);
});

test('custom event attribution survives repeated migrations and prepared live admission; deferred stays global', async t => {
  const f = await fixture(t, { publicPermitPolicy: permitPolicy }), host = await f.host(), player = await f.player();
  const event = await (await f.request('/api/host/public-events', { cookie: host, data: futureEvent() })).json();
  f.setTime(event.startsAt);
  const station = f.cookieOf(await f.request('/api/host/station', { cookie: host, data: { eventId: event.id } }));
  await f.pause(true); await f.pause(true);
  const state = await (await f.request('/api/host/station', { cookie: `${host}; ${station}` })).json();
  assert.equal(state.event.id, event.id); assert.equal(state.active, true);
  const pool = await (await f.request('/api/host/station/permits', { cookie: `${host}; ${player}; ${station}`, data: { protocol: 1, requestKey: randomUUID(), count: 2, reconcileBy: f.time + 3600000 } })).json();
  for (const [index, source] of ['live', 'reconcile'].entries()) {
    const slot = pool.slots[index];
    const result = await (await f.request(`/api/play/permits/${source}`, { cookie: `${player}; ${station}`, data: { protocol: 1, slotId: slot.id, runId: slot.runId, requestKey: slot.requestKey, name: source, controlMode: 'one-hand' } })).json();
    assert.equal(result.event?.id, source === 'live' ? event.id : undefined);
  }
});
