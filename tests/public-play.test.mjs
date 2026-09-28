import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPilotServer } from '../server/index.js';
import { SPEED_RULES } from '../src/event-session.js';

// Observable contract: public rank authority is isolated from staff and from
// event enrollment. Existing ticket tests do not exercise ticket-free starts.
async function fixture(t, { secure = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'claw-public-'));
  await writeFile(join(dir, 'index.html'), '<head></head>Arcade');
  await writeFile(join(dir, 'privacy.html'), '<h1>Privacy</h1>');
  const origin = 'http://127.0.0.1:4291';
  let time = Date.parse('2026-09-29T12:00:00+07:00');
  const options = { filename: join(dir, 'test.sqlite'), dist: dir, origin, staffCode: 'public-test-staff-secret', hostCode: 'public-host-code', secure, publicTryEnabled: true, now: () => time };
  let app = await createPilotServer(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.database.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path, { data, cookie, method = data ? 'POST' : 'GET', requestOrigin = origin, headers = {} } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
    method, headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined,
  });
  const cookieOf = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function player() { const r = await request('/api/play/session', { data: {} }); assert.equal(r.status, 200); return cookieOf(r); }
  async function enroll() {
    const staff = cookieOf(await request('/api/login', { data: { code: 'public-test-staff-secret' } }));
    const host = cookieOf(await request('/api/host/login', { cookie: staff, data: { code: 'public-host-code' } }));
    const r = await request('/api/host/station', { cookie: host, data: {} }); assert.equal(r.status, 200); return cookieOf(r);
  }
  const start = (cookie, requestKey = randomUUID(), extra = {}) => request('/api/play/runs', { cookie, data: { name: 'Mochi', requestKey, ...extra } });
  async function complete(cookie, id) {
    let saved;
    for (const turn of [1, 2, 3]) { const r = await request(`/api/play/runs/${id}/turns`, { cookie, data: { turn, prizeId: null, remainingMs: 0 } }); assert.equal(r.status, 200); saved = await r.json(); }
    return saved;
  }
  return { get app() { return app; }, request, player, enroll, start, complete,
    async pause(publicRankedEnabled = false) {
      await new Promise(resolve => app.server.close(resolve)); app.database.close();
      app = await createPilotServer({ ...options, publicRankedEnabled });
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
  const eventBoard = await (await f.request('/api/play/board?event=hanoi-2026-09-29')).json(); assert.equal(eventBoard.runs.length, 1);
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
  const board = await (await f.request('/api/play/board')).json();
  assert.equal(board.runs.length, 100);
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
