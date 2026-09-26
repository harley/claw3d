import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/database.js';
import { createPlaytestStore, PLAYTEST_RETENTION_MS } from '../server/playtest.js';
import { createPilotServer } from '../server/index.js';
import { createPlaytestClient } from '../src/playtest-client.js';
import { playtestReport } from '../server/playtest-report.js';

const event = (type = 'page_open', data = {}) => ({ id: randomUUID(), type, mode: 'practice', elapsedMs: 123, data });
const batch = (...events) => ({ sessionId: randomUUID(), build: 'a8d0a24', events });
const reject = (fn, status = 400) => assert.throws(fn, error => error.status === status);

test('read-only public report is opt-in, separates cohorts and never interprets missing collection as zero usage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claw-public-report-')), filename = join(dir, 'observations.sqlite');
  // Observation-only fixture proves reports do not need authentication tables.
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL');
  const cli = (...args) => spawnSync(process.execPath, ['server/playtest-report.js', ...args], { encoding: 'utf8' });
  const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
  try {
    const staff = createPlaytestStore(db);
    staff.ingest({ ...batch(event('feedback', { category: 'controls', comment: 'staff-only feedback' })), build: 'aaaaaaa' });
    assert.throws(() => playtestReport(filename, undefined, { publicOnly: true }), /Public observations unavailable.*not evidence of zero usage/);
    const missing = cli(filename, '--public');
    assert.notEqual(missing.status, 0); assert.equal(missing.stdout, '');
    assert.match(missing.stderr, /Public observations unavailable/);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='public_playtest_events'").get(), undefined);

    let time = Date.now() - 60_000;
    const publicStore = createPlaytestStore(db, { now: () => time, publicOnly: true, maxEvents: 20_000 });
    const empty = playtestReport(filename, undefined, { publicOnly: true });
    assert.equal(empty.summary.events, 0); assert.equal(empty.collectionStatus, 'unknown');
    assert.match(empty.collectionNote, /Empty results are not evidence of zero usage/);
    const older = { ...batch(event()), build: 'bbbbbbb' };
    publicStore.ingest(older);
    time += 30_000;
    const newer = { ...batch(event('feedback', { category: 'stuck' })), build: 'ccccccc' };
    publicStore.ingest(newer);
    // The reader excludes expired observations without pruning stored data.
    db.prepare('UPDATE public_playtest_events SET received_at=? WHERE id=?').run(new Date(time - PLAYTEST_RETENTION_MS - 1).toISOString(), older.events[0].id);
    const before = await Promise.all([digest(filename), digest(`${filename}-wal`)]);
    const report = playtestReport(filename, undefined, { publicOnly: true });
    assert.equal(report.cohort, 'public'); assert.equal(report.collectionStatus, 'unknown');
    assert.equal(report.maxEvents, 20_000);
    assert.deepEqual(report.events.map(row => row.id), [newer.events[0].id]);
    assert.deepEqual(report.summary.cohorts.map(row => row.build), ['ccccccc']);
    assert.ok(!JSON.stringify(report).includes('staff-only feedback'));
    const defaultReport = playtestReport(filename);
    assert.equal(defaultReport.cohort, undefined, 'legacy API shape is unchanged');
    assert.deepEqual(defaultReport.summary.cohorts.map(row => row.build), ['aaaaaaa']);
    assert.equal(defaultReport.maxEvents, 100_000);
    const publicCli = cli(filename, '--public'), staffCli = cli(filename);
    assert.equal(publicCli.status, 0, publicCli.stderr); assert.equal(staffCli.status, 0, staffCli.stderr);
    assert.deepEqual(JSON.parse(publicCli.stdout).events, report.events);
    assert.deepEqual(JSON.parse(staffCli.stdout).events, defaultReport.events);
    const filtered = cli(filename, new Date(time + 1).toISOString(), '--public');
    assert.equal(filtered.status, 0, filtered.stderr); assert.equal(JSON.parse(filtered.stdout).summary.events, 0);
    for (const args of [[filename, '--staff'], [filename, '--public', '--public'], ['--public', filename], [filename, '--public', 'extra']]) {
      const invalid = cli(...args); assert.notEqual(invalid.status, 0); assert.equal(invalid.stdout, ''); assert.match(invalid.stderr, /Usage:/);
    }
    assert.throws(() => playtestReport(filename, undefined, { publicOnly: 'true' }), /must be a boolean/);
    assert.deepEqual(await Promise.all([digest(filename), digest(`${filename}-wal`)]), before, 'reporting does not change database or WAL bytes');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM public_playtest_events').get().n, 2, 'expired row remains stored');
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('playtest batches are private, bounded, atomically validated and idempotent across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claw-playtest-')), filename = join(dir, 'pilot.sqlite');
  let database = openDatabase(filename), store = createPlaytestStore(database.db);
  try {
    const input = batch(event('feedback', { category: 'controls', comment: 'Hard to steer', phase: 'aim', turn: 0 }), event('drop', { trigger: 'gesture', phase: 'aim', turn: 0 }));
    const result = store.ingest(input);
    assert.deepEqual(result.accepted, input.events.map(e => e.id));
    assert.deepEqual(store.ingest(input), result);
    assert.equal(store.read().summary.events, 2);
    assert.deepEqual(store.read().summary.byMode, { practice: 2 });
    assert.deepEqual(store.read().summary.feedback, { controls: 1 });
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 0, 'practice telemetry must never create leaderboard runs');
    database.close(); database = openDatabase(filename); store = createPlaytestStore(database.db);
    assert.deepEqual(store.ingest(input), result);
    const reordered = structuredClone(input);
    reordered.events[0].data = { turn: 0, phase: 'aim', comment: 'Hard to steer', category: 'controls' };
    assert.deepEqual(store.ingest(reordered), result, 'property order does not break exact retries');
    reject(() => store.ingest({ ...input, events: [event(), { ...input.events[0], data: { category: 'stuck' } }] }), 409);
    assert.equal(store.read().summary.events, 2, 'conflict rolls back the whole batch');
    assert.equal(store.read().events[0].data.comment, 'Hard to steer');
    assert.deepEqual(playtestReport(filename).events, store.read().events, 'read-only daily report reads persisted observations');
    assert.ok(!JSON.stringify(store.read()).match(/owner_id|token|cookie|password|name/));
    for (const bad of [
      null, [], {}, { ...input, events: [] }, { ...input, events: Array.from({ length: 21 }, () => event()) },
      { ...input, sessionId: 'not-a-uuid' }, { ...input, build: 'uncommitted' }, { ...input, name: 'Secret' },
      { ...input, events: [event(), { ...event(), elapsedMs: -1 }] },
      { ...input, events: [{ ...event(), mode: 'ranked' }] }, { ...input, events: [{ ...event(), runId: 'private name' }] },
      { ...input, events: [event('landmarks')] }, { ...input, events: [event('feedback')] },
      { ...input, events: [event('feedback', { category: 'other', comment: 'x'.repeat(501) })] },
      { ...input, events: [event('feedback', { category: 'other', comment: '\u0000' })] },
      { ...input, events: [event('client_error', { stack: 'secret stack' })] },
      { ...input, events: [event('client_error', { code: 'raw error message' })] },
      { ...input, events: [event('performance', { averageFps: 1001 })] },
      { ...input, events: [event('performance', { frames: 1.1 })] },
      { ...input, events: [event('drop', { turn: 4 })] },
      { ...input, events: [event('camera_ready', { category: 'controls' })] },
      { ...input, events: [event('page_open', null)] },
    ]) reject(() => store.ingest(bad));
    assert.equal(store.read().summary.events, 2, 'no malformed batch partially writes');
    for (const since of ['yesterday', '2026-09-09', '2026-99-99T00:00:00Z']) reject(() => store.read(since));
  } finally { database.close(); await rm(dir, { recursive: true, force: true }); }
});

test('playtest retention and hard capacity remove oldest observations without modifying scores', () => {
  const database = openDatabase(':memory:');
  let time = Date.parse('2026-09-09T12:00:00Z');
  const store = createPlaytestStore(database.db, { now: () => time, maxEvents: 20 });
  try {
    const first = batch(...Array.from({ length: 20 }, () => event()));
    store.ingest(first);
    time += 1000;
    const newer = batch(event('performance', { averageFps: 59.9, p95FrameMs: 30, frames: 500, framesOver33ms: 2 }));
    store.ingest(newer);
    const report = store.read('2026-09-09T00:00:00Z');
    assert.equal(report.summary.events, 20); assert.equal(report.events.at(-1).id, newer.events[0].id);
    assert.ok(!report.events.some(e => e.id === first.events[0].id), 'oldest row is evicted at hard cap');
    time += PLAYTEST_RETENTION_MS;
    store.prune();
    assert.equal(store.read('2026-09-09T00:00:00Z').summary.events, 1, 'newer boundary observation is retained');
    time += 1; store.prune();
    assert.equal(store.read().summary.events, 0);
    assert.equal(database.exportData().boards.length, 1); assert.equal(database.board().runs.length, 0);
  } finally { database.close(); }
});

test('host report returns bounded events and complete count summaries', () => {
  const database = openDatabase(':memory:'), store = createPlaytestStore(database.db);
  try {
    const feedback = event('feedback', { category: 'controls', comment: 'Steering was unclear' });
    store.ingest(batch(feedback));
    for (let i = 0; i < 26; i++) store.ingest(batch(...Array.from({ length: 20 }, () => event('control_state', { state: 'tracking', phase: 'aim' }))));
    const report = store.read();
    assert.equal(report.events.length, 500); assert.equal(report.summary.events, 521);
    assert.equal(report.summary.sessions, 27); assert.equal(report.truncated, true);
    assert.deepEqual(report.summary.byType, { control_state: 520, feedback: 1 });
    assert.ok(!report.events.some(row => row.id === feedback.id));
    assert.equal(report.feedbackEvents[0].id, feedback.id, 'noise cannot bury separately listed feedback');
    assert.equal(report.feedbackTruncated, false);
    assert.equal(report.summary.cohorts[0].byType.control_state, 520);
    assert.equal(report.summary.cohorts[0].sessions, 27);
    assert.equal(report.summary.cohorts[0].mode, 'practice');
  } finally { database.close(); }
});

test('playtest API requires staff origin and host report access; telemetry limits do not block scoring', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claw-playtest-http-'));
  await writeFile(join(dir, 'index.html'), '<head></head>');
  const origin = 'http://127.0.0.1:4209', staffCode = 'test-staff-code-with-entropy', hostCode = 'test-host-code-with-entropy';
  const app = await createPilotServer({ filename: ':memory:', origin, staffCode, hostCode, dist: dir, secure: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  function client() {
    const jar = new Map();
    return async (path, data, headers = {}) => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), origin, 'content-type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
      for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); jar.set(key, value); }
      return { status: response.status, data: await response.json(), cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') };
    };
  }
  try {
    const request = client(), input = batch(event('feedback', { category: 'stuck', comment: 'The claw stopped.' }));
    assert.equal((await request('/api/playtest', input)).status, 401);
    assert.equal((await request('/api/host/playtest')).status, 401);
    await request('/api/login', { code: staffCode });
    assert.equal((await request('/api/playtest', input, { origin: 'https://elsewhere.example' })).status, 403);
    assert.equal((await request('/api/playtest', input, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await request('/api/playtest', { ...input, padding: 'x'.repeat(65536) })).status, 413);
    const saved = await request('/api/playtest', input); assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.accepted, [input.events[0].id]);
    const comment = 'Khó điều khiển 🙂', unicode = batch(event('feedback', { category: 'controls', comment }));
    const encoded = Buffer.from(JSON.stringify(unicode)), split = encoded.indexOf(Buffer.from('🙂')) + 1;
    const splitResult = await new Promise((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port: app.server.address().port, path: '/api/playtest', method: 'POST', headers: { origin, cookie: saved.cookie, 'content-type': 'application/json' } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject); req.write(encoded.subarray(0, split));
      setTimeout(() => req.end(encoded.subarray(split)), 10);
    });
    assert.equal(splitResult.status, 200);
    assert.equal(app.playtest.read().events.find(row => row.id === unicode.events[0].id).data.comment, comment, 'UTF-8 split across chunks stays intact');
    assert.equal((await request('/api/host/playtest')).status, 403);
    await request('/api/host/login', { code: hostCode });
    const report = await request('/api/host/playtest'); assert.equal(report.status, 200); assert.equal(report.data.events[0].data.comment, 'The claw stopped.');
    assert.equal((await request('/api/host/playtest?since=bad')).status, 400);
    assert.equal((await request('/api/board')).data.runs.length, 0);
    const limited = client(); await limited('/api/login', { code: staffCode });
    for (let i = 0; i < 60; i++) assert.equal((await limited('/api/playtest', input)).status, 200);
    assert.equal((await limited('/api/playtest', input)).status, 429);
    assert.equal((await limited('/api/runs', { name: 'Still plays', requestKey: randomUUID() })).status, 201);
    app.database.db.prepare('UPDATE sessions SET expires=0').run();
    assert.equal((await request('/api/host/playtest')).status, 401);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test('camera failure sessions include old control errors and deduplicate new error events', () => {
  const database = openDatabase(':memory:'), store = createPlaytestStore(database.db);
  try {
    const legacy = batch(event('control_state', { state: 'error', phase: 'aim' }));
    const modern = batch(event('camera_error', { code: 'worker_timeout', phase: 'aim' }), event('control_state', { state: 'error', phase: 'aim' }));
    store.ingest(legacy); store.ingest(modern); store.ingest(modern);
    for (let i = 0; i < 26; i++) store.ingest(batch(...Array.from({ length: 20 }, () => event())));
    const report = store.read();
    assert.equal(report.summary.cameraFailureSessions, 2);
    assert.equal(report.summary.cohorts[0].cameraFailureSessions, 2);
    assert.equal(report.summary.byType.camera_error, 1);
    assert.ok(report.truncated);
    assert.ok(!report.events.some(e => e.type === 'camera_error'), 'complete failure count survives event truncation');
  } finally { database.close(); }
});

test('gesture funnel and vision telemetry are allowlisted, bounded and aggregated', () => {
  const database = openDatabase(':memory:');
  const store = createPlaytestStore(database.db);
  try {
    const good = batch(
      event('hold_start', { phase: 'aim' }),
      event('hold_cancelled', { phase: 'aim', cause: 'uncertain_reset' }),
      event('time_to_control', { acquisitionMs: 4200 }),
      event('turn_complete', { turn: 1, score: 0, prizeId: null, outcome: 'near' }),
      event('run_start', { holdMs: 300, steering: 'absolute' }),
      event('performance', { averageFps: 60, p95FrameMs: 17, frames: 1800, framesOver33ms: 0,
        resultHz: 19.7, visionP50Ms: 9.8, visionP95Ms: 21.6, captureToReceiptP50Ms: 20, captureToReceiptP95Ms: 800,
        rejectOverAge: 1, rejectOutOfOrder: 0, rejectHidden: 0, rejectInvalid: 0 }),
      event('performance', { resultHz: 0, captureToReceiptP50Ms: 900, captureToReceiptP95Ms: 900, rejectOverAge: 1 }),
    );
    assert.deepEqual(store.ingest(good).accepted, good.events.map(e => e.id));
    for (const bad of [
      batch(event('hold_cancelled', { phase: 'aim' })),
      batch(event('hold_cancelled', { phase: 'aim', cause: 'network glitch' })),
      batch(event('turn_complete', { turn: 1, score: 0, prizeId: null, outcome: 'gremlins' })),
      batch(event('run_start', { holdMs: 901 })),
      batch(event('run_start', { steering: 'sideways' })),
      batch(event('performance', { resultHz: 241 })),
      batch(event('performance', { visionP95Ms: 60001 })),
      batch(event('performance', { captureToReceiptP95Ms: 60001 })),
      batch(event('performance', { rejectOverAge: 1.5 })),
      batch(event('time_to_control', { acquisitionMs: -1 })),
    ]) reject(() => store.ingest(bad));
    const cohort = store.read().summary.cohorts[0];
    assert.equal(cohort.byType.hold_start, 1);
    assert.equal(cohort.byType.hold_cancelled, 1);
    assert.equal(cohort.visionP50Ms, 9.8);
    assert.equal(cohort.worstVisionP95Ms, 21.6);
    assert.equal(cohort.captureToReceiptP50Ms, 460);
    assert.equal(cohort.worstCaptureToReceiptP95Ms, 900);
    assert.equal(cohort.averageAcquisitionMs, 4200);
    assert.equal(cohort.worstAcquisitionMs, 4200);
    const historical = { ...batch(event('performance', { visionP50Ms: 10, visionP95Ms: 25 })), build: 'bbbbbbb' };
    store.ingest(historical);
    const oldCohort = store.read().summary.cohorts.find(row => row.build === 'bbbbbbb');
    assert.equal(oldCohort.visionP50Ms, 10);
    assert.equal(oldCohort.captureToReceiptP50Ms, null, 'older build is not silently mixed into new delay metric');
    assert.equal(oldCohort.worstCaptureToReceiptP95Ms, null);
  } finally { database.close(); }
});


test('readiness reasons survive client sanitization and server storage without hand data', async () => {
  const database = openDatabase(':memory:'), store = createPlaytestStore(database.db);
  const client = createPlaytestClient({ build: '123abcd', enabled: true, fetcher: async (_url, options) => {
    const result = store.ingest(JSON.parse(options.body));
    return { ok: true, json: async () => result };
  } });
  try {
    for (const startGate of ['show_both', 'show_left', 'show_right', 'open_left', 'open_right', 'hold_left', 'hold_right', 'return_left', 'return_right', 'hold_both', 'off', 'loading', 'error', 'delayed', 'blocked', 'ready']) {
      client.track('control_state', { phase: 'idle', state: 'tracking', controlMode: 'two-hand', startGate,
        hands: { left: { x: .3 } }, landmarks: [1, 2], message: 'private' });
    }
    await client.flush();
    const rows = store.read().events;
    assert.equal(rows.length, 16);
    assert.deepEqual(rows[2].data, { controlMode: 'two-hand', phase: 'idle', startGate: 'show_right', state: 'tracking' });
    assert.ok(rows.every(row => Object.keys(row.data).length === 4));
    reject(() => store.ingest(batch(event('control_state', { startGate: 'arbitrary text' }))));
    reject(() => store.ingest(batch(event('control_state', { controlMode: 'invalid' }))));
    reject(() => store.ingest(batch(event('drop', { startGate: 'ready' }))));
    assert.equal(database.board().runs.length, 0);
  } finally { client.dispose(); database.close(); }
});
