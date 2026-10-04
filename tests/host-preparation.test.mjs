import test from 'node:test';
import assert from 'node:assert/strict';
import { stationReadiness, recoveryExport, createHostPreparation } from '../src/host-preparation.js';
import { journalFixture } from './public-journal-fixture.mjs';
import { PUBLIC_JOURNAL, openPublicRunJournal } from '../src/public-run-journal.js';
const slot = id => ({ id, consumed: false });
const local = { id: 'pool', packId: 'pack', lastSeen: 100, reconcileBy: 200, slots: [slot('a'),slot('b'),slot('c')] };
const remote = { ...local, ready: true, slots: local.slots.map(slot => ({ ...slot, admissionSource: slot.id === 'a' ? 'live' : null })) };
const input = () => ({ server: { ownerValid: true, pools: [structuredClone(remote)] }, snapshot: { pools: [structuredClone(local)], entries: [] }, assets: { id: 'pack', complete: true }, expectedId: 'pack', time: 150 });
test('host readiness subtracts the union of server, local and unsynced consumption; compatible authority and assets are required', () => {
  let x = input(); x.snapshot.entries.push({ settled: false, grant: { poolId: 'pool', slotId: 'b' } }); x.snapshot.pools[0].slots[1].consumed = true;
  let state = stationReadiness(x); assert.equal(state.remaining, 1); assert.equal(state.pending, 1); assert.equal(state.ready, true);
  x.snapshot.pools[0].slots[2].consumed = true; assert.equal(stationReadiness(x).ready, false);
  for (const mutate of [x => x.server.ownerValid = false, x => x.server.pools = [], x => x.assets.complete = false, x => x.expectedId = 'new', x => x.time = 200, x => x.time = 99, x => x.snapshot.pools[0].hold = 'Revoked', x => x.server.pools[0].ready = false, x => x.server.pools[0].slots[0].runId = 'changed']) {
    x = input(); mutate(x); assert.equal(stationReadiness(x).ready, false);
  }
});
test('unknown-version recovery is read-only, secret-free and retains data; game lock blocks export', async () => {
  const f = journalFixture(), r = f.indexedDB.open(PUBLIC_JOURNAL, 9);
  r.onupgradeneeded = () => { r.result.createObjectStore('intents',{keyPath:'requestKey'}); r.result.createObjectStore('pools',{keyPath:'id'}); };
  const db = await new Promise(resolve => { r.onsuccess = () => resolve(r.result); });
  await new Promise(resolve => { const tx = db.transaction(['intents','pools'],'readwrite'); tx.objectStore('intents').put({ requestKey:'request', version:99, name:'Lan', cookie:'secret', cameraFrame:'secret', grant:{slotId:'secret',packId:'pack'}, turns:[{turn:1,prizeId:null,score:0,remainingMs:0,landmarks:'secret'}] }); tx.objectStore('pools').put({id:'pool',slots:[{id:'secret',consumed:true}]}); tx.oncomplete=resolve; }); db.close();
  await assert.rejects(openPublicRunJournal(f), error => error.name === 'VersionError');
  const result = await recoveryExport(f); assert.equal(result.databaseVersion, 9); assert.equal(result.results[0].name,'Lan'); assert.equal(result.results[0].turns.length,1); assert.doesNotMatch(JSON.stringify(result), /secret|cookie|cameraFrame|landmarks|slotId/);
  const opened = f.indexedDB.open(PUBLIC_JOURNAL,9); const again = await new Promise(resolve => { opened.onsuccess=()=>resolve(opened.result); });
  const saved = await new Promise(resolve => { const req=again.transaction('intents').objectStore('intents').get('request'); req.onsuccess=()=>resolve(req.result); }); assert.equal(saved.cookie,'secret'); again.close();
  await f.locks.request(PUBLIC_JOURNAL+':physical',{},async () => { await assert.rejects(recoveryExport(f),/Close the game/); });
});

test('invalid fresh preparation and unknown pack versions refuse before ownership or issuance', async t => {
  let version = 1;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({version,id:'pack'})));
  const saved = new Map(), requests = [];
  const host = createHostPreparation({
    storage: {getItem:key => saved.get(key) || null, setItem:(key,value)=>saved.set(key,value), removeItem:key=>saved.delete(key)},
    serviceWorker: {getRegistration:async()=>null}, time:()=>100,
    request: async path => {requests.push(path); return {ownerValid:false,pools:[],policy:{maxSlots:5,maxRetentionMs:1000}};},
    journalFactory: async()=>({probe:async()=>{}, snapshot:async()=>({entries:[],pools:[]}),close(){}}),
  });
  await assert.rejects(host.prepare(6,200),/within the configured/);
  await assert.rejects(host.prepare(3,50),/future deadline/);
  assert.equal(saved.size,0); assert.ok(requests.every(path=>path.endsWith('/preparation')));
  version = 99; await assert.rejects(host.inspect(),/Unknown asset pack version/);
});
