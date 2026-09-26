import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicPlaytestClient } from '../src/playtest-client.js';
import { createPilotServer } from '../server/index.js';

const options = { build: 'abcdef1', enabled: true, noticeAcknowledged: true };
const ack = body => ({ ok: true, status: 200, json: async () => ({ accepted: JSON.parse(body).events.map(e => e.id) }) });

test('public opt-in and notice are independent strict gates; rejected activation never buffers or requests', async () => {
  for (const config of [{}, { enabled: true }, { noticeAcknowledged: true }, { enabled: 'true', noticeAcknowledged: true }, { enabled: true, noticeAcknowledged: 'true' }, { ...options, build: 'invalid' }]) {
    let calls = 0;
    const client = createPublicPlaytestClient({ build: 'abcdef1', ...config, fetcher: () => { calls++; } });
    assert.equal((await client.track('page_open').acknowledged).sent, false);
    await client.flush(); assert.equal(calls, 0); assert.equal(client.status().pending, 0);
    client.dispose();
  }
});

test('public session handshake, practice privacy, pacing, bounds and disposal reuse the staff queue contracts', async () => {
  let time = 0; const calls = [];
  const client = createPublicPlaytestClient({ ...options, now: () => time, fetcher: async (url, req) => {
    calls.push({ url, body: req.body, time });
    assert.equal(req.credentials, 'same-origin');
    return url.endsWith('/session') ? { ok: true, status: 200 } : ack(req.body);
  } });
  try {
    for (let i = 0; i < 100; i++) client.track('page_open', { landmarks: [], name: 'secret' });
    const ticket = client.track('feedback', { category: 'controls', comment: 'private', rawError: 'private' }, { mode: 'event', runId: crypto.randomUUID() });
    await client.flush();
    assert.equal(calls.length, 2); assert.equal(calls[0].body, '{}');
    const payload = JSON.parse(calls[1].body);
    assert.equal(payload.events.length, 20); assert.equal(payload.build, options.build); assert.equal(payload.sessionId, client.sessionId);
    assert.deepEqual(payload.events[0].data, { category: 'controls' });
    assert.ok(payload.events.every(e => e.mode === 'practice' && !('runId' in e)));
    assert.equal((await ticket.acknowledged).sent, true);
    for (let i = 0; i < 100; i++) { client.track('page_open'); await client.flush(); }
    assert.equal(client.status().pending, 100); assert.equal(calls.length, 2, 'manual flush cannot bypass pacing');
    time = 9999; await client.flush(); assert.equal(calls.length, 2);
    time = 10000; await client.flush(); assert.equal(calls.length, 3); assert.equal(calls[2].url, '/api/public/playtest');
    const pending = client.track('feedback', { category: 'stuck' }); client.dispose();
    assert.deepEqual(await pending.acknowledged, { sent: false, reason: 'disposed' });
  } finally { client.dispose(); }
});

test('public lost-response, throttling and expired cookies retain exact event IDs with enforced backoff', async () => {
  let time = 0, uploads = 0, sessions = 0; const bodies = [];
  const client = createPublicPlaytestClient({ ...options, now: () => time, fetcher: async (url, req) => {
    if (url.endsWith('/session')) { sessions++; return { ok: true, status: 200 }; }
    bodies.push(req.body); uploads++;
    if (uploads === 1) throw Error('response lost');
    if (uploads === 2) return { ok: false, status: 429, headers: { get: () => '90' } };
    if (uploads === 3) return { ok: false, status: 401 };
    return ack(req.body);
  } });
  try {
    const ticket = client.track('page_open'); await client.flush();
    time = 19999; await client.flush(); assert.equal(uploads, 1);
    time = 20000; await client.flush(); assert.equal(uploads, 2);
    time = 109999; await client.flush(); assert.equal(uploads, 2);
    time = 110000; await client.flush(); assert.equal(uploads, 3);
    time = 190000; await client.flush();
    assert.equal(sessions, 2); assert.equal(uploads, 4); assert.equal(new Set(bodies).size, 1);
    assert.equal((await ticket.acknowledged).sent, true);
  } finally { client.dispose(); }
});

test('disabled server ends collection and disposal during bootstrap cannot start an upload', async () => {
  const unavailable = createPublicPlaytestClient({ ...options, fetcher: async () => ({ ok: false, status: 404 }) });
  const ticket = unavailable.track('page_open'); await unavailable.flush();
  assert.deepEqual(await ticket.acknowledged, { sent: false, reason: 'unavailable' }); assert.equal(unavailable.status().enabled, false);
  let complete, calls = 0;
  const client = createPublicPlaytestClient({ ...options, fetcher: async (_url, req) => {
    calls++; await new Promise(resolve => { complete = resolve; }); assert.equal(req.signal.aborted, true); return { ok: true, status: 200 };
  } });
  const pending = client.track('page_open'); const flushing = client.flush(); await Promise.resolve();
  client.dispose(); complete(); await flushing;
  assert.equal(calls, 1); assert.equal((await pending.acknowledged).sent, false);
});

test('20 public clients fit real HTTP same-NAT budgets with bounded batches and no staff side effects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claw-public-client-')); let time = 0;
  await writeFile(join(dir, 'index.html'), '<head></head>');
  const origin = 'http://127.0.0.1:4218';
  const app = await createPilotServer({ filename: ':memory:', origin, staffCode: 'client-test-staff-secret', hostCode: 'client-test-host', dist: dir, secure: false, publicDiagnosticsEnabled: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const statuses = [], bodies = [], clients = [];
  try {
    for (let i = 0; i < 20; i++) {
      let cookie = '';
      clients.push(createPublicPlaytestClient({ ...options, now: () => time, fetcher: async (path, request) => {
        if (path.endsWith('/playtest')) bodies.push(request.body);
        const res = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { ...request, headers: { ...request.headers, origin, cookie } });
        for (const value of res.headers.getSetCookie()) cookie = value.split(';')[0];
        statuses.push(res.status); return res;
      } }));
    }
    for (let wave = 0; wave < 6; wave++) {
      time = wave * 10000;
      for (const client of clients) for (let i = 0; i < 20; i++) client.track('control_state', { state: 'tracking', durationMs: 10 });
      await Promise.all(clients.map(client => client.flush()));
    }
    assert.equal(statuses.length, 140); assert.ok(statuses.every(s => s === 200));
    assert.equal(bodies.length, 120); assert.ok(bodies.every(body => Buffer.byteLength(body) <= 16384 && JSON.parse(body).events.length <= 20));
    assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM public_playtest_events').get().n, 2400);
    assert.equal(app.database.db.prepare('SELECT COUNT(*) AS n FROM owners').get().n, 0);
    assert.equal(app.database.board().runs.length, 0);
  } finally { clients.forEach(client => client.dispose()); await new Promise(resolve => app.server.close(resolve)); app.database.close(); await rm(dir, { recursive: true, force: true }); }
});

test('slow bootstrap does not compress upload spacing, and dense batches stay below the HTTP byte limit', async () => {
  let time = 0; const bodies = [];
  const client = createPublicPlaytestClient({ ...options, now: () => time, fetcher: async (url, request) => {
    if (url.endsWith('/session')) { time += 7000; return { ok: true, status: 200 }; }
    bodies.push(request.body); return ack(request.body);
  } });
  try {
    const dense = { state: 'tracking', code: 'camera_unavailable', phase: 'anticipate', trigger: 'gesture', reason: 'unhandled', prizeId: 'butter', cause: 'uncertain_reset', outcome: 'platform', steering: 'absolute', controlMode: 'two-hand', startGate: 'show_both' };
    for (const name of ['acquisitionMs','durationMs','captureAgeMs','averageFps','p95FrameMs','framesOver33ms','frames','sampleMs','turn','score','total','holdMs','resultHz','visionP50Ms','visionP95Ms','captureToReceiptP50Ms','captureToReceiptP95Ms','rejectOverAge','rejectOutOfOrder','rejectHidden','rejectInvalid']) dense[name] = 604800000;
    for (const name of ['acquisitionMs','durationMs','captureAgeMs','averageFps','p95FrameMs','sampleMs','resultHz','visionP50Ms','visionP95Ms','captureToReceiptP50Ms','captureToReceiptP95Ms']) dense[name] = 0.12345678901234568;
    for (let i = 0; i < 40; i++) client.track('control_state', dense);
    await client.flush(); assert.ok(Buffer.byteLength(bodies[0]) <= 16000); assert.ok(JSON.parse(bodies[0]).events.length < 20, 'dense payload is split by bytes');
    time = 16999; await client.flush(); assert.equal(bodies.length, 1);
    time = 17000; await client.flush(); assert.equal(bodies.length, 2);
  } finally { client.dispose(); }
});
