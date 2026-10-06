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
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({version,id:'pack',bytes:1000})));
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

// A known server refusal must survive an unrelated asset outage and a journal
// reopen. Readiness-only assertions would miss future offline slot admission.
import { RULES } from '../src/event-session.js';
const grant = () => ({ id:crypto.randomUUID(),protocol:1,boardId:crypto.randomUUID(),generation:crypto.randomUUID(),ready:true,
  rules:{...RULES,controlVersion:'camera-fist-hold-550-v2'},controlModes:['one-hand','two-hand'],reconcileBy:200,ownerExpires:300,
  slots:Array.from({length:2},()=>({id:crypto.randomUUID(),runId:crypto.randomUUID(),requestKey:crypto.randomUUID()})) });
test('known lost or paused authority holds offline admission before manifest failure or worker timeout', async t => {
  for (const refusal of ['lost','paused','missing-pool']) for (const failure of ['manifest','worker']) await t.test(refusal + '/' + failure, async t => {
    const f=journalFixture(), pool=grant(), j=await f.open();
    await j.installPool(pool,'pack',100);
    const retained=await j.reservePrepared({name:'Retained',controlMode:'one-hand',attemptKey:crypto.randomUUID(),packId:'pack',time:150});
    await j.turns({...retained.run,turns:[{turn:1,prizeId:null,remainingMs:0}]});
    await j.interrupt(retained.requestKey);
    const before=await j.snapshot(); j.close();
    t.mock.method(globalThis,'fetch',async()=>failure==='manifest' ? new Response('',{status:503}) : Response.json({version:1,id:'pack',bytes:1000}));
    const realTimeout=globalThis.setTimeout;
    t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>realTimeout(fn,ms===60000 ? 0 : ms,...args));
    const host=createHostPreparation({request:async()=>({ownerValid:refusal!=='lost',pools:refusal==='missing-pool'?[]:[{...pool,ready:refusal!=='paused',unregisteredSlots:2}]}),
      storage:{},journalFactory:f.open,serviceWorker:{getRegistration:async()=>({active:{postMessage(_data,ports){ports[0].close();}}})},storageManager:{},time:()=>150});
    await assert.rejects(host.inspect(),failure==='manifest'?/manifest unavailable/:/verification timed out/);
    const reopened=await f.open();
    await assert.rejects(reopened.reservePrepared({name:'Next',controlMode:'one-hand',attemptKey:crypto.randomUUID(),packId:'pack',time:150}),/ownership unavailable|authority is on hold/);
    const after=await reopened.snapshot();
    assert.deepEqual(after.entries,before.entries); assert.deepEqual(after.pools[0].slots,before.pools[0].slots);
    assert.equal(after.pools[0].reconcileBy,before.pools[0].reconcileBy); assert.ok(after.pools[0].hold); reopened.close();
  });
});

test('explicit preparation requests persistence, reads actual grant and quota, refuses unsafe headroom without changing evidence', async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({version:1,id:'pack',bytes:2000000}));
  for (const outcome of ['granted','denied','unavailable','low','estimate-failed']) await t.test(outcome, async () => {
    const f=journalFixture(), pool=grant(), j=await f.open(); await j.installPool(pool,'old-pack',100); const before=await j.snapshot();j.close();
    const calls=[], requests=[], saved=new Map();
    const manager=outcome==='unavailable'?{}:{
      persist:async()=>{calls.push('persist');return true;}, // Readback, not request return, decides the displayed grant.
      persisted:async()=>{calls.push('persisted');return outcome==='granted';},
      estimate:async()=>{calls.push('estimate');if(outcome==='estimate-failed')throw Error('Unavailable');return {quota:outcome==='low'?1000000:100000000,usage:500000};},
    };
    const host=createHostPreparation({request:async path=>{requests.push(path);return {ownerValid:true,pools:[{...pool,unregisteredSlots:2}],policy:{maxSlots:5,maxRetentionMs:1000}};},
      storage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},journalFactory:f.open,serviceWorker:{getRegistration:async()=>null},storageManager:manager,time:()=>150});
    let state=await host.inspect();assert.ok(!calls.includes('persist'),'passive readiness never requests persistence');
    assert.equal(state.durability.persistent,outcome==='granted'?true:outcome==='unavailable'?null:false);
    assert.equal(state.storageReady,['granted','denied'].includes(outcome));
    assert.equal(state.durability.requiredBytes,2000000+1024*1024+2*64*1024);
    assert.match(state.durability.message,/Clearing browser data or disk loss/);
    if(outcome==='denied')assert.match(state.durability.message,/eviction/);
    if(!state.storageReady){
      await assert.rejects(host.prepare(3,190),/headroom/);
      assert.equal(saved.size,0);assert.ok(requests.every(path=>path.endsWith('/preparation')));
    } else {
      // Invalid operator input still executes the explicit storage checks, then
      // refuses before owner/asset/permit writes.
      await assert.rejects(host.prepare(6,190),/within the configured/);
    }
    if(outcome!=='unavailable') assert.ok(calls.indexOf('persist')<calls.lastIndexOf('persisted') && calls.lastIndexOf('persisted')<calls.lastIndexOf('estimate'));
    const reopened=await f.open();assert.deepEqual(await reopened.snapshot(),before);reopened.close();
  });
});
