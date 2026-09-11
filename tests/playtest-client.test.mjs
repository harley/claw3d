import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaytestClient } from '../src/playtest-client.js';

const build = '123abcd';
const response = accepted => ({ ok: true, json: async () => ({ accepted }) });

test('local preview creates no requests or pending events', async () => {
  let calls = 0;
  const client = createPlaytestClient({ build, enabled: false, fetcher: () => calls++ });
  const ticket = client.track('feedback', { category: 'other', comment: 'Test' });
  assert.deepEqual(await ticket.acknowledged, { sent: false, reason: 'disabled' });
  await client.flush();
  assert.equal(calls, 0);
  assert.equal(client.status().pending, 0);
  client.dispose();
});

test('collector sends allowlisted diagnostics in batches of at most twenty', async () => {
  const batches = [];
  const client = createPlaytestClient({ build, enabled: true, fetcher: async (url, options) => {
    assert.equal(url, '/api/playtest');
    assert.equal(options.credentials, 'same-origin');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body); batches.push(body);
    return response(body.events.map(event => event.id));
  } });
  for (let i = 0; i < 25; i++) client.track('control_state', {
    state: 'lost', durationMs: 20.8, landmarks: [1, 2], name: 'Private', rawError: 'secret', averageFps: Infinity,
  });
  await client.flush();
  assert.equal(batches[0].events.length, 20);
  assert.deepEqual(batches[0].events[0].data, { state: 'lost', durationMs: 20.8 });
  assert.equal(batches[0].sessionId, client.sessionId);
  assert.equal(batches[0].build, build);
  assert.equal(client.status().pending, 5);
  await client.flush();
  assert.equal(client.status().pending, 0);
  client.dispose();
});

test('uncertain requests retry the same IDs and concurrent flushes share a batch', async () => {
  const batches = [];
  let finish;
  const client = createPlaytestClient({ build, enabled: true, fetcher: async (_url, options) => {
    const body = JSON.parse(options.body); batches.push(body);
    if (batches.length === 1) { await new Promise(resolve => { finish = resolve; }); throw new Error('connection lost after save'); }
    return response(body.events.map(event => event.id));
  } });
  const ticket = client.track('page_open');
  const first = client.flush(), concurrent = client.flush();
  assert.equal(first, concurrent);
  await Promise.resolve(); finish(); await first;
  assert.equal(client.status().pending, 1);
  await client.flush();
  assert.deepEqual(batches[1], batches[0]);
  assert.deepEqual(await ticket.acknowledged, { sent: true });
  client.dispose();
});

test('feedback is only acknowledged by its exact ID and is prioritized ahead of noisy events', async () => {
  const batches = [];
  const client = createPlaytestClient({ build, enabled: true, fetcher: async (_url, options) => {
    const body = JSON.parse(options.body); batches.push(body);
    return response(batches.length === 1 ? ['unrelated-id'] : body.events.map(event => event.id));
  } });
  for (let i = 0; i < 25; i++) client.track('control_state', { state: 'tracking' });
  const feedback = client.track('feedback', { category: 'controls', comment: ' x '.repeat(300), name: 'Private' });
  let acknowledged = false;
  feedback.acknowledged.then(result => { acknowledged = result.sent; });
  await client.flush();
  assert.equal(acknowledged, false);
  assert.equal(batches[0].events[0].id, feedback.id);
  assert.equal(batches[0].events[0].data.comment.length, 500);
  assert.equal('name' in batches[0].events[0].data, false);
  await client.flush();
  assert.deepEqual(await feedback.acknowledged, { sent: true });
  client.dispose();
});

test('bounded queue evicts noise, preserves feedback, and disposal settles pending acknowledgements', async () => {
  const client = createPlaytestClient({ build, enabled: true, fetcher: async () => { throw new Error('offline'); } });
  const noisy = client.track('performance', { frames: 1 });
  for (let i = 0; i < 99; i++) client.track('control_state', { state: 'tracking' });
  const feedback = client.track('feedback', { category: 'stuck' });
  assert.equal(client.status().pending, 100);
  assert.deepEqual(await noisy.acknowledged, { sent: false, reason: 'dropped' });
  await client.flush();
  for (let i = 0; i < 100; i++) client.track('control_state', { state: 'lost' });
  assert.equal(client.status().pending, 100);
  client.dispose();
  assert.deepEqual(await feedback.acknowledged, { sent: false, reason: 'disposed' });
  assert.equal(client.status().pending, 0);
});

test('report context survives sanitization while unsupported text and metrics are bounded', async () => {
  let body;
  const client = createPlaytestClient({ build, enabled: true, fetcher: async (_url, options) => {
    body = JSON.parse(options.body);
    return response(body.events.map(event => event.id));
  } });
  const runId = crypto.randomUUID();
  const ticket = client.track('feedback', {
    phase: 'result', trigger: 'gesture', reason: 'sync', prizeId: 'butter',
    turn: 0, score: 600, total: 600, p95FrameMs: 90000,
    category: 'other', comment: 'works\u0000\u200b\nthanks',
    stack: 'private', arbitraryField: 'private',
  }, { mode: 'event', runId: runId.toUpperCase() });
  await client.flush();
  assert.deepEqual(body.events[0].data, {
    phase: 'result', trigger: 'gesture', reason: 'sync', prizeId: 'butter',
    p95FrameMs: 60000, turn: 0, score: 600, total: 600,
    category: 'other', comment: 'works\nthanks',
  });
  assert.equal(body.events[0].mode, 'event');
  assert.equal(body.events[0].runId, runId);
  assert.deepEqual(await ticket.acknowledged, { sent: true });
  client.dispose();
});

test('permanent rejected feedback settles unsent and releases the queue for a corrected report', async () => {
  for (const status of [400, 409, 413, 415]) {
    let rejected = true;
    const client = createPlaytestClient({ build, enabled: true, fetcher: async (_url, options) => {
      if (rejected) return { ok: false, status };
      return response(JSON.parse(options.body).events.map(event => event.id));
    } });
    const ticket = client.track('feedback', { category: 'other' });
    await client.flush();
    assert.deepEqual(await ticket.acknowledged, { sent: false, reason: 'rejected' });
    assert.equal(client.status().pending, 0);
    rejected = false;
    const retry = client.track('feedback', { category: 'controls', state: 'accepted' });
    await client.flush();
    assert.deepEqual(await retry.acknowledged, { sent: true });
    client.dispose();
  }
});

test('expired authentication retains the same feedback for a later sign-in', async () => {
  for (const status of [401, 403]) {
    const batches = [];
    const client = createPlaytestClient({ build, enabled: true, fetcher: async (_url, options) => {
      const body = JSON.parse(options.body); batches.push(body);
      return batches.length === 1 ? { ok: false, status } : response(body.events.map(event => event.id));
    } });
    const ticket = client.track('feedback', { category: 'other' });
    await client.flush();
    assert.equal(client.status().pending, 1);
    await client.flush();
    assert.deepEqual(batches[0], batches[1]);
    assert.deepEqual(await ticket.acknowledged, { sent: true });
    client.dispose();
  }
});

test('gesture funnel and vision rollup fields survive the client allowlist', async () => {
  const batches = [];
  const client = createPlaytestClient({ build, enabled: true, fetcher: async (url, options) => {
    const body = JSON.parse(options.body); batches.push(body);
    return response(body.events.map(event => event.id));
  } });
  client.track('hold_start', { phase: 'aim' });
  client.track('hold_cancelled', { phase: 'aim', cause: 'uncertain_reset' });
  client.track('time_to_control', { acquisitionMs: 4200 });
  client.track('performance', { averageFps: 60, p95FrameMs: 17, frames: 1800, framesOver33ms: 0,
    resultHz: 19.7, visionP50Ms: 9.8, visionP95Ms: 21.6,
    rejectOverAge: 1.4, rejectOutOfOrder: 0, rejectHidden: 0, rejectInvalid: 0 });
  // A cause-less or invalid-cause cancellation must be refused client-side:
  // a malformed event in a batch would 400-reject every co-batched event.
  assert.deepEqual(await client.track('hold_cancelled', { phase: 'aim' }).acknowledged, { sent: false, reason: 'invalid_feedback' });
  assert.deepEqual(await client.track('hold_cancelled', { phase: 'aim', cause: 'network glitch' }).acknowledged, { sent: false, reason: 'invalid_feedback' });
  await client.flush();
  const [holdStart, holdCancelled, acquisition, performance] = batches[0].events;
  assert.deepEqual(holdStart.data, { phase: 'aim' });
  assert.equal(holdStart.type, 'hold_start');
  assert.deepEqual(holdCancelled.data, { phase: 'aim', cause: 'uncertain_reset' });
  assert.deepEqual(acquisition.data, { acquisitionMs: 4200 });
  assert.deepEqual(performance.data, { averageFps: 60, p95FrameMs: 17, frames: 1800, framesOver33ms: 0,
    resultHz: 19.7, visionP50Ms: 9.8, visionP95Ms: 21.6,
    rejectOverAge: 1, rejectOutOfOrder: 0, rejectHidden: 0, rejectInvalid: 0 });
  assert.equal(batches[0].events.length, 4);
  client.dispose();
});
