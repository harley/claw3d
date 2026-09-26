import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openDatabase } from '../server/database.js';
import { backup } from '../server/backup.js';
import { createOfficialEvents, CLOSE_GRACE_MS, EVENT_RETENTION_MS, TICKET_LIFETIME_MS } from '../server/official-events.js';

const host = { role: 'host', ownerId: 'authenticated-host' };
const player = { role: 'anonymous', ownerId: 'admitted-browser' };
const key = () => randomUUID();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'official-events-')), filename = join(dir, 'pilot.sqlite');
  const database = openDatabase(filename);
  let time = Date.UTC(2026, 8, 26);
  const events = createOfficialEvents(database.db, { now: () => time });
  t.after(() => { database.close(); rmSync(dir, { recursive: true, force: true }); });
  const { eventId } = events.createEvent(host, { name: 'Booth', requestKey: key() });
  events.setEventState(host, { eventId, state: 'open', requestKey: key() });
  const p = events.createParticipant(host, { eventId, name: 'Jade', requestKey: key() });
  function admit(participantId = p.participantId, auth = player) {
    const ticket = events.issueTicket(host, { eventId, participantId, requestKey: key() });
    const input = { code: ticket.code, requestKey: key(), nonce: key() };
    const run = events.redeem(auth, input);
    events.activate(auth, { runId: run.id, nonce: input.nonce });
    return { ticket, input, run };
  }
  return { database, events, eventId, p, admit, dir, filename, get time() { return time; }, advance: ms => { time += ms; } };
}
const rejects = (fn, status) => assert.throws(fn, error => error.status === status);
function complete(events, id, prizeId = 'butter', auth = player) {
  let result;
  for (const turn of [1, 2, 3]) result = events.record(auth, { runId: id, turn, prizeId });
  return result;
}
async function race(f, operations) {
  const gate = new SharedArrayBuffer(4), workers = [];
  try {
    const entries = operations.map(({ method, args }) => {
      const worker = new Worker(new URL('./fixtures/official-worker.mjs', import.meta.url), {
        workerData: { filename: f.filename, time: f.time, gate, method, args },
      });
      workers.push(worker);
      let readyResolve, readyReject, doneResolve, doneReject;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
      // Handle early errors on both promises before awaiting either.
      done.catch(() => {});
      worker.on('error', error => { readyReject(error); doneReject(error); });
      worker.on('message', message => message.ready ? readyResolve() : doneResolve(message));
      return { ready, done };
    });
    await Promise.all(entries.map(e => e.ready));
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
    return await Promise.all(entries.map(e => e.done));
  } finally { await Promise.all(workers.map(w => w.terminate())); }
}

// Existing legacy tests cannot catch official admission or recovery bugs:
// these contracts live in the new transactional domain, without UI scaffolding.
test('single-use admission is atomic across 20 independent SQLite connections', async t => {
  const f = fixture(t), { events, eventId, p } = f;
  const ticket = events.issueTicket(host, { eventId, participantId: p.participantId, requestKey: key() });
  const requests = Array.from({ length: 20 }, (_, i) => ({ auth: { ownerId: `browser-${i}` }, input: { code: ticket.code, requestKey: key(), nonce: key() } }));
  const outcomes = await race(f, requests.map(({ auth, input }) => ({ method: 'redeem', args: [auth, input] })));
  assert.equal(outcomes.filter(o => o.result).length, 1);
  assert.ok(outcomes.filter(o => o.error).every(o => o.error.status === 409));
  assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
  const winner = outcomes.findIndex(o => o.result), request = requests[winner];
  assert.deepEqual(events.redeem(request.auth, request.input), outcomes[winner].result);
  rejects(() => events.redeem(request.auth, { ...request.input, nonce: key() }), 409);
  const reopened = openDatabase(f.filename);
  try {
    const restarted = createOfficialEvents(reopened.db, { now: () => f.time });
    assert.deepEqual(restarted.redeem(request.auth, request.input), outcomes[winner].result);
  } finally { reopened.close(); }
});

test('response loss and concurrent exact retries share one durable run and activation', async t => {
  const f = fixture(t), { ticket, input, run } = f.admit();
  const results = await race(f, Array.from({ length: 8 }, () => ({ method: 'redeem', args: [player, input] })));
  assert.ok(results.every(r => r.result.id === run.id));
  rejects(() => f.events.redeem(player, { ...input, requestKey: key() }), 409);
  rejects(() => f.events.activate(player, { runId: run.id, nonce: key() }), 409);
  assert.equal(f.events.activate(player, { runId: run.id, nonce: input.nonce }).id, run.id);
  f.events.interrupt(player, run.id);
  rejects(() => f.events.activate(player, { runId: run.id, nonce: input.nonce }), 409);
  assert.equal(complete(f.events, run.id).status, 'complete', 'completed outbox may drain after interruption');
  assert.equal(f.events.redeem(player, input).status, 'complete');
  assert.equal(f.database.db.prepare('SELECT state FROM official_tickets WHERE id=?').get(ticket.ticketId).state, 'redeemed');
});

test('failed redemption rolls back both admission and ticket consumption', t => {
  const f = fixture(t), ticket = f.events.issueTicket(host, { eventId: f.eventId, participantId: f.p.participantId, requestKey: key() });
  f.database.db.exec("CREATE TRIGGER reject_consumption BEFORE UPDATE ON official_tickets BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  const input = { code: ticket.code, requestKey: key(), nonce: key() };
  assert.throws(() => f.events.redeem(player, input), /injected failure/);
  assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 0);
  assert.equal(f.database.db.prepare('SELECT state FROM official_tickets').get().state, 'issued');
  f.database.db.exec('DROP TRIGGER reject_consumption');
  assert.equal(f.events.redeem(player, input).status, 'accepted');
});

test('host actions retry safely without storing bearer codes; reissue revokes only unused tickets', t => {
  const f = fixture(t), request = { eventId: f.eventId, participantId: f.p.participantId, requestKey: key() };
  const issued = f.events.issueTicket(host, request), repeated = f.events.issueTicket(host, request);
  assert.equal(repeated.ticketId, issued.ticketId); assert.equal(repeated.code, undefined);
  assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 1);
  rejects(() => f.events.issueTicket(host, { ...request, participantId: key() }), 409);
  const replacement = f.events.reissueTicket(host, { ticketId: issued.ticketId, requestKey: key() });
  rejects(() => f.events.redeem(player, { code: issued.code, requestKey: key(), nonce: key() }), 409);
  f.events.redeem(player, { code: replacement.code, requestKey: key(), nonce: key() });
  rejects(() => f.events.reissueTicket(host, { ticketId: replacement.ticketId, requestKey: key() }), 409);
  const persisted = JSON.stringify(f.database.db.prepare('SELECT * FROM official_actions').all());
  assert.ok(!persisted.includes(issued.code)); assert.ok(!persisted.includes(replacement.code)); assert.ok(!persisted.includes(f.p.code));
  assert.equal(f.events.findParticipant(host, { eventId: f.eventId, code: f.p.code }).participantId, f.p.participantId);
  rejects(() => f.events.redeem(player, { code: f.p.code, requestKey: key(), nonce: key() }), 400);
});

test('exactly three ordered turns, immutable retries, owner isolation and frozen score rules', t => {
  const f = fixture(t), { run } = f.admit();
  const input = { runId: run.id, turn: 1, prizeId: 'sprout', remainingMs: 15000 };
  rejects(() => f.events.record({ ownerId: 'other' }, input), 404);
  rejects(() => f.events.getRun({ ownerId: 'other' }, run.id), 404);
  rejects(() => f.events.record(player, { ...input, turn: 2 }), 409);
  for (const prizeId of ['unknown', '__proto__', {}, undefined]) rejects(() => f.events.record(player, { ...input, prizeId }), 400);
  rejects(() => f.events.record(player, { ...input, remainingMs: 15001 }), 400);
  assert.equal(f.events.record(player, input).turns[0].score, 250);
  assert.equal(f.events.record(player, input).turns.length, 1);
  rejects(() => f.events.record(player, { ...input, remainingMs: 0 }), 409);
  f.database.rotate('Legacy rotation');
  f.events.record(player, { runId: run.id, turn: 2, prizeId: null });
  const saved = f.events.record(player, { runId: run.id, turn: 3, prizeId: 'butter' });
  assert.equal(saved.total, 350); assert.equal(saved.turns.length, 3);
  assert.deepEqual(saved.rules, run.rules);
  rejects(() => f.events.record(player, { runId: run.id, turn: 4, prizeId: null }), 400);
  rejects(() => f.events.recover(host, { runId: run.id, reason: 'camera_failure', requestKey: key() }), 409);
});

test('best-per-participant uses opaque identity, ties, zeros and a bounded secret-free projection', t => {
  const f = fixture(t), { events, eventId } = f;
  for (const prize of ['butter', null, 'sprout']) complete(events, f.admit().run.id, prize);
  const other = events.createParticipant(host, { eventId, name: 'Jade', requestKey: key() });
  const otherRun = f.admit(other.participantId).run;
  complete(events, otherRun.id, 'sprout');
  assert.deepEqual(events.board(player, eventId), [{ name: 'Jade', total: 600, rank: 1 }, { name: 'Jade', total: 600, rank: 1 }]);
  assert.deepEqual(events.personalBest(player, otherRun.id).best, { total: 600, rank: 1 });
  for (let i = 0; i < 51; i++) {
    const p = events.createParticipant(host, { eventId, name: `Player ${i}`, requestKey: key() });
    complete(events, f.admit(p.participantId).run.id, null);
  }
  assert.equal(events.board(player, eventId).length, 50);
  assert.equal(events.board(player, eventId)[2].rank, 3);
  const all = events.exportEvent(host, eventId);
  assert.equal(all.runs.length, 55, 'export keeps lower and zero attempts, not just best/top 50');
  const exported = JSON.stringify(all);
  for (const forbidden of ['qr_hash', 'code_hash', 'nonce_hash', 'owner_id', 'authenticated-host', f.p.code]) assert.ok(!exported.includes(forbidden));
});

test('host-only methods and event board require independent authorization', t => {
  const f = fixture(t), { events, eventId, p } = f;
  const operations = [
    a => events.createEvent(a, { name: 'Other', requestKey: key() }),
    a => events.setEventState(a, { eventId, state: 'closed', requestKey: key() }),
    a => events.createParticipant(a, { eventId, name: 'Other', requestKey: key() }),
    a => events.findParticipant(a, { eventId, code: p.code }),
    a => events.issueTicket(a, { eventId, participantId: p.participantId, requestKey: key() }),
    a => events.reissueTicket(a, { ticketId: key(), requestKey: key() }),
    a => events.recover(a, { runId: key(), reason: 'camera_failure', requestKey: key() }),
    a => events.exportEvent(a, eventId), a => events.prune(a),
  ];
  for (const auth of [null, player, { role: 'staff', ownerId: 'staff' }]) for (const operation of operations) rejects(() => operation(auth), 403);
  rejects(() => events.board(null, eventId), 401);
  rejects(() => events.board(player, eventId), 403);
  f.admit(); assert.deepEqual(events.board(player, eventId), []);
  rejects(() => events.board({ ownerId: 'someone-else' }, eventId), 403);
  const second = events.createEvent(host, { name: 'Other', requestKey: key() });
  events.setEventState(host, { ...second, state: 'open', requestKey: key() });
  rejects(() => events.issueTicket(host, { ...second, participantId: p.participantId, requestKey: key() }), 404);
  rejects(() => events.createParticipant(host, { eventId, name: 'Bad\nlabel', requestKey: key() }), 400);
});

test('recovery vs completion and duplicate recovery commit only one possible outcome', async t => {
  const f = fixture(t), { events } = f, { run } = f.admit();
  for (const turn of [1, 2]) events.record(player, { runId: run.id, turn, prizeId: 'butter' });
  const recovery = { runId: run.id, reason: 'camera_failure', requestKey: key() };
  const outcomes = await race(f, [
    { method: 'record', args: [player, { runId: run.id, turn: 3, prizeId: 'butter' }] },
    { method: 'recover', args: [host, recovery] },
    { method: 'recover', args: [host, recovery] },
  ]);
  const state = events.getRun(player, run.id).status;
  assert.ok(['complete', 'void'].includes(state));
  if (state === 'complete') {
    assert.equal(outcomes[0].result.total, 300);
    assert.ok(outcomes.slice(1).every(o => o.error.status === 409));
    assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 1);
  } else {
    assert.equal(outcomes[0].error.status, 409);
    assert.equal(outcomes[1].result.ticketId, outcomes[2].result.ticketId);
    assert.equal(f.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 2);
    rejects(() => events.record(player, { runId: run.id, turn: 1, prizeId: 'butter' }), 409);
    assert.deepEqual(events.board(player, f.eventId), []);
  }
});

test('voided attempt never revives; replacement retains participant and best score', t => {
  const f = fixture(t), { events, eventId } = f;
  complete(events, f.admit().run.id);
  const { run, input } = f.admit();
  events.record(player, { runId: run.id, turn: 1, prizeId: 'sprout' });
  const recovery = { runId: run.id, reason: 'browser_failure', requestKey: key() };
  const replacement = events.recover(host, recovery);
  assert.equal(events.recover(host, recovery).ticketId, replacement.ticketId);
  rejects(() => events.recover(host, { ...recovery, requestKey: key() }), 409);
  assert.equal(events.redeem(player, input).status, 'void');
  rejects(() => events.activate(player, { runId: run.id, nonce: input.nonce }), 409);
  rejects(() => events.record(player, { runId: run.id, turn: 2, prizeId: 'sprout' }), 409);
  const nonce = key(), newRun = events.redeem(player, { code: replacement.code, nonce, requestKey: key() });
  events.activate(player, { runId: newRun.id, nonce }); complete(events, newRun.id, 'sprout');
  assert.deepEqual(events.board(player, eventId), [{ name: 'Jade', total: 600, rank: 1 }]);
});

test('recovery failure rolls back the void and revocation with no orphan replacement', t => {
  const f = fixture(t), { run, ticket } = f.admit();
  f.database.db.exec("CREATE TRIGGER reject_replacement BEFORE INSERT ON official_tickets BEGIN SELECT RAISE(ABORT,'replacement failure'); END");
  const recovery = { runId: run.id, reason: 'camera_failure', requestKey: key() };
  assert.throws(() => f.events.recover(host, recovery), /replacement failure/);
  assert.equal(f.events.getRun(player, run.id).status, 'active');
  assert.equal(f.database.db.prepare('SELECT state FROM official_tickets WHERE id=?').get(ticket.ticketId).state, 'redeemed');
  f.database.db.exec('DROP TRIGGER reject_replacement');
  assert.equal(f.events.recover(host, recovery).replacesRunId, run.id);
});

test('closing concurrently with the third result keeps the admitted result valid', async t => {
  const f = fixture(t), { run } = f.admit();
  for (const turn of [1, 2]) f.events.record(player, { runId: run.id, turn, prizeId: null });
  const outcomes = await race(f, [
    { method: 'setEventState', args: [host, { eventId: f.eventId, state: 'closed', requestKey: key() }] },
    { method: 'record', args: [player, { runId: run.id, turn: 3, prizeId: 'butter' }] },
  ]);
  assert.equal(outcomes[0].result.state, 'closed');
  assert.equal(outcomes[1].result.status, 'complete');
  assert.equal(outcomes[1].result.total, 100);
});

test('close blocks grants and recovery, permits completion only inside ten-minute grace', t => {
  const f = fixture(t), { events, eventId, p } = f, a = f.admit(), b = f.admit();
  const unused = events.issueTicket(host, { eventId, participantId: p.participantId, requestKey: key() });
  events.setEventState(host, { eventId, state: 'closed', requestKey: key() });
  rejects(() => events.issueTicket(host, { eventId, participantId: p.participantId, requestKey: key() }), 409);
  rejects(() => events.redeem(player, { code: unused.code, requestKey: key(), nonce: key() }), 409);
  rejects(() => events.recover(host, { runId: a.run.id, reason: 'connection_failure', requestKey: key() }), 409);
  rejects(() => events.setEventState(host, { eventId, state: 'open', requestKey: key() }), 409);
  f.advance(CLOSE_GRACE_MS - 1);
  assert.equal(complete(events, a.run.id).status, 'complete');
  events.setEventState(host, { eventId, state: 'closed', requestKey: key() });
  f.advance(1);
  assert.equal(events.getRun(player, b.run.id).status, 'expired');
  rejects(() => events.record(player, { runId: b.run.id, turn: 1, prizeId: null }), 409);
  assert.equal(events.record(player, { runId: a.run.id, turn: 3, prizeId: 'butter' }).status, 'complete');
  assert.equal(events.exportEvent(host, eventId).runs.length, 2);
});

test('ticket expiry is exclusive at 24h; close/redemption and close/recovery serialize', async t => {
  const f = fixture(t), { events, eventId, p } = f;
  const unused = events.issueTicket(host, { eventId, participantId: p.participantId, requestKey: key() });
  f.advance(TICKET_LIFETIME_MS);
  rejects(() => events.redeem(player, { code: unused.code, requestKey: key(), nonce: key() }), 409);
  const { run } = f.admit(), ticket = events.issueTicket(host, { eventId, participantId: p.participantId, requestKey: key() });
  const outcomes = await race(f, [
    { method: 'setEventState', args: [host, { eventId, state: 'closed', requestKey: key() }] },
    { method: 'redeem', args: [player, { code: ticket.code, requestKey: key(), nonce: key() }] },
    { method: 'recover', args: [host, { runId: run.id, reason: 'camera_failure', requestKey: key() }] },
  ]);
  assert.equal(outcomes[0].result.state, 'closed');
  for (const outcome of outcomes.slice(1)) assert.ok(outcome.result || outcome.error.status === 409);
  assert.equal(events.getRun(player, run.id).status, outcomes[2].result ? 'void' : 'active');
  rejects(() => events.issueTicket(host, { eventId, participantId: p.participantId, requestKey: key() }), 409);
});

test('additive migration, compatible legacy rollback, backup restore and prospective retention preserve legacy data', t => {
  const f = fixture(t), { database, events, eventId } = f;
  database.db.prepare('INSERT INTO owners VALUES (?)').run('legacy');
  const completed = database.createRun('legacy', { name: 'Legacy', requestKey: key() });
  for (const turn of [1, 2, 3]) database.record(completed.id, 'legacy', { turn, prizeId: 'butter' });
  const pending = database.createRun('legacy', { name: 'Pending', requestKey: key() });
  database.record(pending.id, 'legacy', { turn: 1, prizeId: null });
  const before = database.exportData(); delete before.exportedAt;
  complete(events, f.admit().run.id, 'sprout');
  createOfficialEvents(database.db, { now: () => f.time });
  const after = database.exportData(); delete after.exportedAt;
  assert.deepEqual(after, before, 'new official records never enter legacy projection');
  const snapshot = join(f.dir, 'snapshot.sqlite'); backup(f.filename, snapshot);
  const restored = openDatabase(snapshot); // unchanged legacy reader is the rollback binary's data contract
  try {
    assert.equal(restored.board().runs.length, 1);
    assert.equal(restored.getRun(pending.id, 'legacy').turns.length, 1);
    restored.abandon(pending.id, 'legacy');
    for (const turn of [2, 3]) restored.record(pending.id, 'legacy', { turn, prizeId: null });
    assert.equal(restored.getRun(pending.id, 'legacy').status, 'complete');
    assert.equal(createOfficialEvents(restored.db, { now: () => f.time }).board(player, eventId)[0].total, 600);
  } finally { restored.close(); }
  f.advance(EVENT_RETENTION_MS - 1); assert.equal(events.prune(host).removedEvents, 0);
  f.advance(1); rejects(() => events.exportEvent(host, eventId), 404);
  assert.equal(events.prune(host).removedEvents, 1);
  for (const table of ['official_events', 'official_participants', 'official_tickets', 'official_runs', 'official_turns', 'official_actions'])
    assert.equal(database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  const retained = database.exportData(); delete retained.exportedAt;
  assert.deepEqual(retained, before);
  database.db.exec('UPDATE official_schema SET version=2');
  assert.throws(() => createOfficialEvents(database.db), /Unsupported official event schema/);
});
