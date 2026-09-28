import test from 'node:test';
import assert from 'node:assert/strict';
import { journalFixture } from './public-journal-fixture.mjs';
import { openPublicRunJournal, PUBLIC_JOURNAL } from '../src/public-run-journal.js';
import { RULES } from '../src/event-session.js';
const intent = () => ({ name: 'Lan', requestKey: crypto.randomUUID(), controlMode: 'one-hand' });
const run = input => ({ id: crypto.randomUUID(), name: input.name, rules: { ...RULES, controlMode: input.controlMode, controlVersion: input.controlMode === 'two-hand' ? 'camera-dual-raise-v1' : 'camera-fist-hold-550-v2' }, boardId: 'public', status: 'active', turns: [] });
const turn = n => ({ turn: n, prizeId: null, remainingMs: 0, score: 0 });

test('durable identity, restart discovery without sessionStorage and exactly three immutable turns', async () => {
  const f = journalFixture(); let journal = await f.open();
  const input = intent(), issued = run(input);
  assert.equal((await journal.reserve(input)).first, true);
  assert.equal((await journal.reserve(input)).first, false);
  await assert.rejects(journal.reserve({ ...input, name: 'Changed' }), /already used/);
  await assert.rejects(journal.admission(input.requestKey, { ...issued, rules: { ...issued.rules, controlVersion: 'unknown-version' } }), /Unsupported/);
  await journal.admission(input.requestKey, issued);
  await journal.turns({ ...issued, turns: [turn(1), turn(2)] });
  await assert.rejects(journal.turns({ ...issued, turns: [turn(2)] }));
  journal.close(); await Promise.resolve(); journal = await f.open();
  const [saved] = await journal.all();
  assert.equal(saved.physical, 'interrupted'); assert.equal(saved.turns.length, 2);
  await assert.rejects(journal.reserve(input), /already used/);
  await assert.rejects(journal.turns({ ...issued, turns: [turn(1), turn(2), turn(3)] }), /cannot resume/);
  const next = intent(), completed = run(next);
  await journal.reserve(next); await journal.admission(next.requestKey, completed);
  await journal.turns({ ...completed, turns: [turn(1), turn(2), turn(3)] });
  await assert.rejects(journal.turns({ ...completed, turns: [turn(1), turn(2), turn(3), turn(4)] }));
  journal.close(); await Promise.resolve(); journal = await f.open();
  assert.equal((await journal.all())[0].turns.length + (await journal.all())[1].turns.length, 5);
  assert.equal((await journal.all()).find(r => r.requestKey === next.requestKey).physical, 'complete');
  journal.close();
});

test('one origin owner; late acknowledgements never erase later turns; receipts survive restart', async () => {
  const f = journalFixture(), journal = await f.open();
  await assert.rejects(f.open(), /Another tab/);
  const input = intent(), issued = run(input);
  await journal.reserve(input); await journal.admission(input.requestKey, issued);
  await journal.turns({ ...issued, turns: [turn(1), turn(2)] });
  await journal.acknowledge(input.requestKey, { ...issued, turns: [turn(1)] });
  assert.equal((await journal.all())[0].turns.length, 2);
  await journal.turns({ ...issued, turns: [turn(1), turn(2), turn(3)] });
  const receipt = { ...issued, status: 'complete', turns: [turn(1), turn(2), turn(3)], total: 0, rank: 1 };
  await journal.acknowledge(input.requestKey, receipt);
  await journal.acknowledge(input.requestKey, { ...issued, turns: [turn(1)] });
  journal.close(); await Promise.resolve(); const reopened = await f.open();
  const [saved] = await reopened.all();
  assert.equal(saved.settled, true); assert.equal(saved.acknowledged, 3); assert.deepEqual(saved.receipt, receipt);
  assert.equal(saved.turns.length, 3); reopened.close();
});

test('transaction abort after request success never reports a saved turn; original bytes remain', async () => {
  const f = journalFixture(), journal = await f.open(), input = intent(), issued = run(input);
  await journal.reserve(input); await journal.admission(input.requestKey, issued);
  const opening = f.indexedDB.open(PUBLIC_JOURNAL, 1);
  const db = await new Promise(resolve => { opening.onsuccess = () => resolve(opening.result); });
  const proto = Object.getPrototypeOf(db.transaction('intents').objectStore('intents'));
  const original = proto.put;
  proto.put = function(...args) { const req = original.apply(this, args); req.addEventListener('success', () => this.transaction.abort()); return req; };
  try { await assert.rejects(journal.turns({ ...issued, turns: [turn(1)] }), /abort/i); }
  finally { proto.put = original; db.close(); }
  assert.equal((await journal.all())[0].turns.length, 0);
  await journal.turns({ ...issued, turns: [turn(1)] });
  assert.equal((await journal.all())[0].turns.length, 1); journal.close();
});

test('missing storage/locks and unknown record versions refuse admission without deleting evidence', async () => {
  await assert.rejects(openPublicRunJournal({ indexedDB: null, locks: null }), /required/);
  const f = journalFixture(), journal = await f.open(), input = intent();
  await journal.reserve(input); journal.close(); await Promise.resolve();
  const opening = f.indexedDB.open(PUBLIC_JOURNAL, 1);
  const db = await new Promise(resolve => { opening.onsuccess = () => resolve(opening.result); });
  await new Promise(resolve => { const tx = db.transaction('intents', 'readwrite'); tx.objectStore('intents').put({ ...input, version: 999 }); tx.oncomplete = resolve; });
  db.close(); await assert.rejects(f.open(), /incompatible/);
  const read = f.indexedDB.open(PUBLIC_JOURNAL, 1);
  const preserved = await new Promise(resolve => { read.onsuccess = () => { const get = read.result.transaction('intents').objectStore('intents').get(input.requestKey); get.onsuccess = () => { resolve(get.result); read.result.close(); }; }; });
  assert.equal(preserved.version, 999);
});

test('quota failure rolls back an intent before any live request; unknown database version is preserved', async () => {
  const f = journalFixture(), journal = await f.open();
  const opening = f.indexedDB.open(PUBLIC_JOURNAL, 1);
  const db = await new Promise(resolve => { opening.onsuccess = () => resolve(opening.result); });
  const proto = Object.getPrototypeOf(db.transaction('intents').objectStore('intents')), original = proto.add;
  proto.add = () => { throw new DOMException('Synthetic quota refusal', 'QuotaExceededError'); };
  try { await assert.rejects(journal.reserve(intent()), /quota/i); }
  finally { proto.add = original; db.close(); }
  assert.deepEqual(await journal.all(), []); journal.close(); await Promise.resolve();
  const future = f.indexedDB.open(PUBLIC_JOURNAL, 2);
  await new Promise(resolve => { future.onsuccess = () => { future.result.close(); resolve(); }; });
  await assert.rejects(f.open(), { name: 'VersionError' });
});

test('blocked opening rejects promptly and releases its physical lock', async () => {
  const f = journalFixture();
  const indexedDB = { open() { const pending = {}; queueMicrotask(() => pending.onblocked()); return pending; } };
  await assert.rejects(openPublicRunJournal({ indexedDB, locks: f.locks }), /blocked/);
  await Promise.resolve(); const journal = await f.open(); journal.close();
});
