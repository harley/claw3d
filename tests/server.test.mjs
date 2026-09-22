import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPilotServer } from '../server/index.js';
import { openDatabase } from '../server/database.js';

const staffCode = 'test-staff-code-with-entropy', hostCode = 'hosttest';
test('protected shared runs: ownership, ordered idempotency, ties, rotation, reauthentication and restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-claw-server-'));
  await mkdir(join(dir, 'dist')); await writeFile(join(dir, 'dist/index.html'), '<head></head><body>Arcade</body>');
  await writeFile(join(dir, 'dist/asset.js'), '/* protected */');
  const origin = 'http://127.0.0.1:4209';
  let app;
  async function start() {
    app = await createPilotServer({ filename: join(dir, 'pilot.sqlite'), origin, staffCode, hostCode, dist: join(dir, 'dist'), secure: false });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  }
  async function stop() { await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
  function client() {
    const jar = new Map();
    return { jar, async request(path, data, headers = {}) {
      const res = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
        method: data === undefined ? 'GET' : 'POST', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), origin, 'Content-Type': 'application/json', ...headers },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      for (const cookie of res.headers.getSetCookie()) { const [k, v] = cookie.split(';')[0].split('='); jar.set(k, v); }
      return { status: res.status, headers: res.headers, text: await res.text() };
    } };
  }
  const json = result => JSON.parse(result.text);
  await start();
  try {
    const a = client(), b = client(), visitor = client();
    assert.equal((await visitor.request('/api/board')).status, 401);
    assert.equal((await visitor.request('/asset.js')).status, 401);
    assert.match((await visitor.request('/')).text, /Staff pilot/);
    assert.equal((await visitor.request('/api/login', { code: staffCode }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await visitor.request('/api/login', { code: 'wrong' })).status, 401);
    await a.request('/api/login', { code: staffCode }); await b.request('/api/login', { code: staffCode });
    assert.match((await a.request('/')).text, /window.__SHARED_PILOT__=true/);
    assert.equal((await a.request('/asset.js')).status, 200);
    assert.match((await a.request('/api/session')).headers.get('cache-control'), /no-store/);
    assert.equal((await a.request('/api/host/export')).status, 403);
    assert.equal((await a.request('/api/host/boards', { name: 'Bad' })).status, 403);
    for (const name of ['', ' ', 'a'.repeat(25), 'bad\nname', 42]) assert.equal((await a.request('/api/runs', { name, requestKey: randomUUID() })).status, 400);
    const requestKey = randomUUID();
    const [first, duplicate] = await Promise.all([a.request('/api/runs', { name: 'Hà', requestKey }), a.request('/api/runs', { name: 'Hà', requestKey })]);
    const ra = json(first), rb = json(await b.request('/api/runs', { name: 'Hà', requestKey: randomUUID() }));
    assert.equal(ra.id, json(duplicate).id); assert.notEqual(ra.id, rb.id);
    assert.equal((await a.request('/api/runs', { name: 'Other', requestKey })).status, 409);
    assert.equal((await b.request(`/api/runs/${ra.id}`)).status, 404);
    assert.equal((await b.request(`/api/runs/${ra.id}/turns`, { turn: 1, prizeId: 'butter' })).status, 404);
    const send = (client, run, turn, prizeId) => client.request(`/api/runs/${run.id}/turns`, { turn, prizeId });
    assert.equal((await send(a, ra, 2, null)).status, 409);
    for (const prize of ['unknown', '__proto__', 'toString', {}, undefined]) assert.equal((await send(a, ra, 1, prize)).status, 400);
    const duplicates = await Promise.all(Array.from({ length: 5 }, () => send(a, ra, 1, 'sprout')));
    assert.ok(duplicates.every(result => json(result).turns.length === 1));
    assert.equal((await send(a, ra, 1, 'butter')).status, 409);
    await send(b, rb, 1, 'sprout');
    assert.equal((await a.request('/api/host/login', { code: 'wrong' })).status, 403);
    assert.equal((await a.request('/api/host/login', { code: hostCode })).status, 200);
    const rotated = json(await a.request('/api/host/boards', { name: 'Afternoon' }));
    assert.notEqual(rotated.id, ra.boardId);
    for (const turn of [2, 3]) await Promise.all([send(a, ra, turn, 'butter'), send(b, rb, turn, 'butter')]);
    const saved = json(await a.request(`/api/runs/${ra.id}`));
    assert.equal(saved.total, 400); assert.equal(saved.rank, 1); assert.equal(saved.turns.length, 3);
    assert.equal(json(await b.request(`/api/runs/${rb.id}`)).rank, 1);
    assert.equal((await send(a, ra, 4, 'butter')).status, 400);
    assert.equal(json(await a.request('/api/board')).runs.length, 0);
    const exported = json(await a.request('/api/host/export'));
    assert.equal(exported.boards[0].runs.length, 2);
    assert.ok(!JSON.stringify(exported).includes('owner_id')); assert.ok(!JSON.stringify(exported).includes('token'));
    // Expiry preserves the distinct owner cookie; reauth cannot steal the other client's run.
    app.database.db.prepare('UPDATE sessions SET expires=0').run();
    assert.equal((await a.request(`/api/runs/${ra.id}`)).status, 401);
    await a.request('/api/login', { code: staffCode });
    assert.equal(json(await send(a, ra, 3, 'butter')).total, 400);
    assert.equal((await a.request(`/api/runs/${rb.id}`)).status, 404);
    assert.equal((await a.request('/api/host/export')).status, 403);
    const interrupted = json(await a.request('/api/runs', { name: 'Interrupted', requestKey: randomUUID() }));
    await send(a, interrupted, 1, null); await a.request(`/api/runs/${interrupted.id}/abandon`, {});
    assert.equal(json(await a.request(`/api/runs/${interrupted.id}`)).status, 'abandoned');
    assert.equal(json(await send(a, interrupted, 1, null)).turns.length, 1);
    await stop(); await start();
    assert.equal(json(await a.request(`/api/runs/${ra.id}`)).total, 400);
    assert.equal(json(await a.request('/api/board')).id, rotated.id);
    assert.equal((await a.request('/%2e%2e%2fserver/index.js')).status, 404);
    for (let i = 0; i < 13; i++) await visitor.request('/api/login', { code: 'wrong' });
    assert.equal((await visitor.request('/api/login', { code: 'wrong' })).status, 429);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});

test('secure Railway login buckets use validated client addresses and secure cookies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-claw-proxy-'));
  await writeFile(join(dir, 'index.html'), '<head></head>');
  const origin = 'https://pilot.example';
  const app = await createPilotServer({ filename: ':memory:', origin, staffCode, hostCode, dist: dir, secure: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const login = (ip, code = 'wrong', xff = '192.0.2.99') => fetch(`http://127.0.0.1:${app.server.address().port}/api/login`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-real-ip': ip, 'x-forwarded-for': xff }, body: JSON.stringify({ code }),
  });
  try {
    for (let i = 0; i < 12; i++) assert.equal((await login('192.0.2.1')).status, 401);
    assert.equal((await login('192.0.2.1', staffCode, '198.51.100.1')).status, 429);
    const success = await login('192.0.2.2', staffCode); assert.equal(success.status, 200);
    assert.ok(success.headers.getSetCookie().every(cookie => /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie) && /; Secure/.test(cookie)));
    for (let i = 0; i < 12; i++) await login('not-an-ip-' + i);
    assert.equal((await login('another-invalid')).status, 429);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test('large boards preserve competition ties with a constant number of result queries', () => {
  const database = openDatabase(':memory:'), db = database.db, board = database.board();
  db.prepare('INSERT INTO owners VALUES (?)').run('test-owner');
  const insert = db.prepare("INSERT INTO runs (id,owner_id,request_key,board_id,name,rules,status,total,started_at,completed_at) VALUES (?,'test-owner',?,?,?,?,'complete',?,?,?)");
  db.exec('BEGIN');
  for (let i = 0; i < 300; i++) {
    const total = i < 2 ? 600 : 300;
    insert.run(String(i), String(i), board.id, 'Test', JSON.stringify(board.rules), total, 'start', String(i));
    for (const turn of [1, 2, 3]) db.prepare('INSERT INTO turns (run_id,turn,prize_id,score) VALUES (?,?,?,?)').run(String(i), turn, i < 2 ? 'sprout' : 'butter', total / 3);
  }
  db.exec('COMMIT');
  const original = db.prepare.bind(db); let queries = 0;
  db.prepare = (...args) => { queries++; return original(...args); };
  const result = database.board();
  assert.equal(result.runs.length, 300); assert.deepEqual(result.runs.slice(0, 3).map(run => run.rank), [1, 1, 3]);
  assert.ok(result.runs.every(run => run.turns.length === 3)); assert.ok(queries < 10, 'poll must not issue one query per completed run');
  queries = 0; assert.equal(database.getRun('2', 'test-owner').rank, 3); assert.ok(queries < 10);
  database.close();
});


test('fist control upgrade starts one fresh board and preserves old scores and pending turns', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-claw-control-upgrade-'));
  const filename = join(dir, 'pilot.sqlite');
  let database = openDatabase(filename);
  try {
    const oldBoard = database.board();
    const oldRules = { ...oldBoard.rules, controlVersion: 'camera-rehearsal-hold-650-v1' };
    database.db.prepare('UPDATE boards SET rules=? WHERE id=?').run(JSON.stringify(oldRules), oldBoard.id);
    database.db.prepare('INSERT INTO owners VALUES (?)').run('upgrade-owner');
    const completed = database.createRun('upgrade-owner', { name: 'Completed', requestKey: randomUUID() });
    const pending = database.createRun('upgrade-owner', { name: 'Pending', requestKey: randomUUID() });
    for (const turn of [1, 2, 3]) database.record(completed.id, 'upgrade-owner', { turn, prizeId: 'butter' });
    database.record(pending.id, 'upgrade-owner', { turn: 1, prizeId: 'sprout' });
    database.close(); database = openDatabase(filename);
    const current = database.board();
    assert.notEqual(current.id, oldBoard.id);
    assert.equal(current.rules.controlVersion, 'camera-fist-hold-550-v2');
    assert.equal(current.runs.length, 0);
    assert.equal(database.getRun(completed.id, 'upgrade-owner').total, 300);
    for (const turn of [2, 3]) database.record(pending.id, 'upgrade-owner', { turn, prizeId: 'butter' });
    const saved = database.getRun(pending.id, 'upgrade-owner');
    assert.equal(saved.total, 400); assert.equal(saved.boardId, oldBoard.id);
    assert.deepEqual(saved.rules, oldRules);
    const fresh = database.createRun('upgrade-owner', { name: 'Fresh', requestKey: randomUUID() });
    assert.equal(fresh.boardId, current.id); assert.deepEqual(fresh.rules, current.rules);
    assert.equal(database.exportData().boards.find(b => b.id === oldBoard.id).runs.length, 2);
    database.close(); database = openDatabase(filename);
    assert.equal(database.board().id, current.id);
    assert.equal(database.exportData().boards.length, 2);
  } finally { database.close(); await rm(dir, { recursive: true, force: true }); }
});

test('speed score survives old-table migration, duplicate retry and restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cloud-claw-speed-'));
  const filename = join(dir, 'pilot.sqlite');
  let database = openDatabase(filename);
  try {
    database.db.prepare('INSERT INTO owners VALUES (?)').run('speed-owner');
    const oldBoard = database.board();
    const { CAROUSEL_RULES } = await import('../src/event-session.js');
    const oldRules = { ...CAROUSEL_RULES, controlVersion: 'camera-fist-hold-550-v2' };
    database.db.prepare('UPDATE boards SET rules=? WHERE id=?').run(JSON.stringify(oldRules), oldBoard.id);
    const old = database.createRun('speed-owner', { name: 'Old', requestKey: randomUUID() });
    database.record(old.id, 'speed-owner', { turn: 1, prizeId: 'butter' });
    database.db.exec('ALTER TABLE turns DROP COLUMN remaining_ms');
    database.close(); database = openDatabase(filename);
    assert.notEqual(database.board().id, oldBoard.id);
    assert.equal(database.getRun(old.id, 'speed-owner').turns[0].score, 100);
    database.record(old.id, 'speed-owner', { turn: 1, prizeId: 'butter' });
    const fresh = database.createRun('speed-owner', { name: 'Fast', requestKey: randomUUID() });
    const input = { turn: 1, prizeId: 'butter', remainingMs: 7500 };
    assert.equal(database.record(fresh.id, 'speed-owner', input).turns[0].score, 125);
    assert.equal(database.record(fresh.id, 'speed-owner', input).turns.length, 1);
    assert.throws(() => database.record(fresh.id, 'speed-owner', { ...input, remainingMs: 7400 }), error => error.status === 409);
    assert.throws(() => database.record(fresh.id, 'speed-owner', { turn: 2, prizeId: 'sprout', remainingMs: 15001 }), error => error.status === 400);
    database.record(fresh.id, 'speed-owner', { turn: 2, prizeId: null, remainingMs: 15000 });
    database.record(fresh.id, 'speed-owner', { turn: 3, prizeId: 'sprout', remainingMs: 15000 });
    database.close(); database = openDatabase(filename);
    assert.equal(database.getRun(fresh.id, 'speed-owner').total, 375);
    assert.equal(database.getRun(fresh.id, 'speed-owner').turns[0].remainingMs, 7500);
    assert.equal(database.exportData().boards.length, 2);
  } finally { database.close(); await rm(dir, { recursive: true, force: true }); }
});

test('server rejects short or shared staff and host codes', async () => {
  const base = { filename: ':memory:', origin: 'http://localhost', staffCode, hostCode };
  for (const overrides of [{ hostCode: 'short' }, { staffCode: 'short' }, { hostCode: staffCode }]) {
    await assert.rejects(createPilotServer({ ...base, ...overrides }), /distinct host code of at least 8/);
  }
});


test('shared hand mode is validated, immutable on retry, and retained through completion and restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claw-modes-'));
  const filename = join(dir, 'pilot.sqlite');
  let database = openDatabase(filename);
  try {
    database.db.prepare('INSERT INTO owners VALUES (?)').run('mode-owner');
    const input = { name: 'Two hands', requestKey: randomUUID(), controlMode: 'two-hand' };
    const run = database.createRun('mode-owner', input);
    assert.equal(run.rules.controlMode, 'two-hand');
    assert.equal(run.rules.controlVersion, 'camera-dual-raise-v1');
    assert.equal(database.createRun('mode-owner', input).id, run.id);
    assert.throws(() => database.createRun('mode-owner', { ...input, controlMode: 'one-hand' }), e => e.status === 409);
    assert.throws(() => database.createRun('mode-owner', { ...input, controlMode: 'invalid' }), e => e.status === 400);
    assert.equal(database.createRun('mode-owner', { name: 'Legacy client', requestKey: randomUUID() }).rules.controlMode ?? 'one-hand', 'one-hand');
    database.record(run.id, 'mode-owner', { turn: 1, prizeId: 'sprout', remainingMs: 15000 });
    database.close(); database = openDatabase(filename);
    assert.equal(database.getRun(run.id, 'mode-owner').rules.controlMode, 'two-hand');
    database.record(run.id, 'mode-owner', { turn: 2, prizeId: 'peach' });
    const complete = database.record(run.id, 'mode-owner', { turn: 3, prizeId: null });
    assert.equal(complete.total, 350);
    assert.equal(complete.status, 'complete');
    assert.equal(database.board().runs.find(r => r.id === run.id).rules.controlMode, 'two-hand');
  } finally { database.close(); await rm(dir, { recursive: true, force: true }); }
});
