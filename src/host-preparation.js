// Loaded by authenticated Host setup, never by the prepared game or camera.
import { openPublicRunJournal, PUBLIC_JOURNAL } from './public-run-journal.js';
import { prepareAssets, assetStatus } from './offline-assets.js';

export function stationReadiness({ server, snapshot, assets, expectedId, time = Date.now() }) {
  const ownershipMatches = server.ownerValid && snapshot.pools.every(local => server.pools.some(remote => remote.id === local.id));
  const pending = snapshot.entries.filter(entry => !entry.settled).length;
  const pools = snapshot.pools.map(local => {
    const remote = server.pools.find(pool => pool.id === local.id);
    const identityMatches = remote && ['boardId', 'rules', 'generation', 'reconcileBy', 'controlModes'].every(key => JSON.stringify(local[key]) === JSON.stringify(remote[key]))
      && JSON.stringify(local.slots.map(({id,runId,requestKey}) => ({id,runId,requestKey}))) === JSON.stringify(remote.slots.map(({id,runId,requestKey}) => ({id,runId,requestKey})));
    const consumed = new Set(snapshot.entries.filter(entry => entry.grant?.poolId === local.id).map(entry => entry.grant.slotId));
    const remaining = remote ? remote.slots.filter(slot => !slot.admissionSource && !consumed.has(slot.id) && !local.slots.find(old => old.id === slot.id)?.consumed).length : 0;
    const ready = Boolean(ownershipMatches && identityMatches && remote?.ready && !local.hold && local.packId === expectedId && assets.complete && assets.id === expectedId && local.lastSeen <= time && local.reconcileBy > time && remaining > 0);
    return { id: local.id, remaining, ready, identityMatches: Boolean(identityMatches), reconcileBy: local.reconcileBy, hold: local.hold, packId: local.packId };
  });
  const ready = pools.some(pool => pool.ready);
  const reason = !server.ownerValid ? 'Original public ownership is unavailable. Keep retained data.'
    : !ownershipMatches ? 'Original permit ownership differs. Keep retained data.'
    : !assets.complete ? 'Assets are not prepared or are damaged. Keep browser data.'
    : assets.id !== expectedId || pools.some(pool => pool.packId !== expectedId) ? 'Active pack differs from the current build. Repair preparation; keep old packs.'
    : !pools.length ? 'No local permit pool. Choose capacity and deadline to prepare.'
    : pools.some(pool => !pool.identityMatches) ? 'Retained permit identity differs. Keep data and export evidence.'
    : pools.find(pool => pool.hold)?.hold || (pools.some(pool => pool.reconcileBy <= time) ? 'Original reconciliation deadline has passed. Keep pending results.'
      : snapshot.pools.some(pool => pool.lastSeen > time) ? 'Browser clock moved backwards. Keep data and check the clock.'
      : !pools.some(pool => pool.remaining > 0) ? 'No unused starts remain. Consumed starts cannot be reused.'
      : 'Station authority is not ready. Check enrollment and server policy.');
  return { ownershipMatches, ready, reason, remaining: pools.filter(pool => pool.ready).reduce((n, pool) => n + pool.remaining, 0), pending, pools,
    hasEvidence: snapshot.entries.length > 0 || snapshot.pools.length > 0 };
}

// Recovery reads raw records, including unknown versions, without migration or
// deletion. A whitelist excludes cookies, slot secrets, frames and arbitrary data.
export async function recoveryExport({ indexedDB = globalThis.indexedDB, locks = navigator.locks } = {}) {
  if (!indexedDB || !locks) throw Error('Browser storage and locking are unavailable. Keep data.');
  return locks.request(PUBLIC_JOURNAL + ':physical', { ifAvailable: true }, async lock => {
    if (!lock) throw Error('Close the game tabs before recovery.');
    const databases = await indexedDB.databases();
    if (!databases.some(db => db.name === PUBLIC_JOURNAL)) return { format: 1, databaseVersion: null, results: [], pools: [] };
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open(PUBLIC_JOURNAL); r.onerror = () => reject(r.error); r.onsuccess = () => resolve(r.result); });
    try {
      const read = name => db.objectStoreNames.contains(name) ? new Promise((resolve, reject) => { const tx = db.transaction(name); const r = tx.objectStore(name).getAll(); tx.oncomplete = () => resolve(r.result); tx.onabort = () => reject(tx.error); }) : [];
      const number = value => Number.isFinite(value) ? value : undefined;
      const text = (value, max = 128) => typeof value === 'string' ? value.slice(0,max) : undefined;
      const record = value => value && typeof value === 'object';
      const entries = (await read('intents')).filter(record), pools = (await read('pools')).filter(record);
      return { format: 1, databaseVersion: db.version, notice: 'Evidence only. Export does not restore ownership or permit authority. Keep original browser data.',
        results: entries.map(entry => ({ version: number(entry.version), name: typeof entry.name === 'string' ? entry.name.slice(0,24) : '', runId: text(entry.run?.id), mode: ['one-hand','two-hand'].includes(entry.controlMode) ? entry.controlMode : undefined,
          physical: text(entry.physical,20), settled: entry.settled === true, acknowledged: number(entry.acknowledged), packId: text(entry.grant?.packId),
          turns: Array.isArray(entry.turns) ? entry.turns.slice(0,3).map(turn => ({ turn: number(turn?.turn), prizeId: turn?.prizeId === null ? null : text(turn?.prizeId,32), remainingMs: number(turn?.remainingMs), score: number(turn?.score) })) : [] })),
        pools: pools.map(pool => ({ protocol: number(pool.protocol), packId: text(pool.packId), capacity: number(pool.capacity), reconcileBy: number(pool.reconcileBy), consumed: Array.isArray(pool.slots) ? pool.slots.filter(slot => slot?.consumed).length : undefined })) };
    } finally { db.close(); }
  });
}

export function createHostPreparation({ request, storage = localStorage, journalFactory = openPublicRunJournal, serviceWorker = navigator.serviceWorker, time = Date.now } = {}) {
  const draftKey = 'cloud-claw:permit-preparation:v1';
  async function journalWork(work) { const journal = await journalFactory(); try { return await work(journal); } finally { journal.close(); } }
  async function inspect() {
    const server = await request('/api/host/station/preparation');
    const manifest = await fetch('/prepared/manifest.json', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(8000) });
    if (!manifest.ok) throw Error('Current asset manifest unavailable. Keep prior packs.');
    const expected = await manifest.json();
    if (expected.version !== 1 || typeof expected.id !== 'string') throw Error('Unknown asset pack version. Keep prior packs and journal data.');
    const registration = await serviceWorker.getRegistration('/prepared/');
    const assets = registration?.active ? await assetStatus(registration.active) : { complete: false };
    return journalWork(async journal => {
      await journal.probe();
      let snapshot = await journal.snapshot();
      if (!server.ownerValid && (snapshot.entries.length || snapshot.pools.length) || snapshot.pools.some(local => !server.pools.some(remote => remote.id === local.id))) {
        await journal.holdPreparation('Original ownership unavailable. Keep browser data and export evidence.'); snapshot = await journal.snapshot();
      } else if (snapshot.pools.some(local => server.pools.some(remote => remote.id === local.id && !remote.ready && remote.unregisteredSlots > 0 && remote.reconcileBy > time()))) {
        await journal.holdPreparation('Station authority is on hold. Ask the host to repair preparation.'); snapshot = await journal.snapshot();
      }
      const readiness = stationReadiness({ server, snapshot, assets, expectedId: expected.id, time: time() });
      return { ...readiness, server, assets, currentBuild: expected.build, waiting: Boolean(registration?.waiting), storageReady: true };
    });
  }
  async function prepare(count, reconcileBy) {
    const initial = await inspect();
    if (!initial.server.policy) throw Error('Prepared starts are disabled. Operator policy must be configured before enablement.');
    if ((!initial.ownershipMatches && initial.hasEvidence) || !initial.server.ownerValid && storage.getItem(draftKey)) throw Error('Original ownership is unavailable. Keep data and export recovery evidence; a new owner cannot recover it.');
    if (!storage.getItem(draftKey) && (!Number.isInteger(count) || count < 1 || count > initial.server.policy.maxSlots || !Number.isSafeInteger(reconcileBy) || reconcileBy <= time() || reconcileBy > time() + initial.server.policy.maxRetentionMs)) throw Error('Choose capacity and a future deadline within the configured station policy.');
    const draft = JSON.parse(storage.getItem(draftKey) || 'null') || { protocol: 1, count, reconcileBy, requestKey: crypto.randomUUID() };
    if (draft.protocol !== 1 || !Number.isInteger(draft.count) || !Number.isSafeInteger(draft.reconcileBy) || typeof draft.requestKey !== 'string') throw Error('Retained preparation is incompatible. Keep its data.');
    storage.setItem(draftKey, JSON.stringify(draft));
    if (storage.getItem(draftKey) !== JSON.stringify(draft)) throw Error('Preparation storage unavailable. No permits requested.');
    if (!initial.server.ownerValid) await request('/api/host/station/owner', {});
    const prepared = await prepareAssets(serviceWorker);
    const registration = await serviceWorker.getRegistration('/prepared/');
    const active = registration?.active ? await assetStatus(registration.active) : { complete: false };
    if (prepared.waiting || !active.complete || active.id !== prepared.prepared.id) throw Error('New assets are waiting. Close every prepared-game tab and retry. Existing packs and results are retained.');
    await journalWork(async journal => {
      await journal.probe();
      let pool;
      try { pool = await request('/api/host/station/permits', draft); }
      catch (error) {
        // These explicit refusals precede issuance. Ambiguous failures retain
        // the original request; only a confirmed rejection permits correction.
        if (error.status === 400 && error.code === 'invalid_permit' || error.status === 409 && error.code === 'capacity_exhausted') storage.removeItem(draftKey);
        throw error;
      }
      const verified = await request('/api/play/permits/' + pool.id);
      await journal.installPool(verified, active.id, time());
    });
    storage.removeItem(draftKey);
    return inspect();
  }
  async function repair() {
    const initial = await inspect();
    if (!initial.ownershipMatches) throw Error('Original ownership unavailable. Export evidence; do not replace ownership.');
    const prepared = await prepareAssets(serviceWorker);
    const registration = await serviceWorker.getRegistration('/prepared/');
    const active = registration?.active ? await assetStatus(registration.active) : { complete: false };
    if (prepared.waiting || !active.complete || active.id !== prepared.prepared.id) throw Error('Close prepared-game tabs before repairing assets. Keep data.');
    const status = await request('/api/host/station/preparation');
    const usable = status.pools.filter(pool => pool.ready && initial.pools.some(local => local.id === pool.id));
    if (!usable.length) throw Error('No existing permit pool has valid unused authority. Keep results for recovery.');
    await journalWork(async journal => { await journal.probe(); for (const pool of usable) await journal.installPool(pool, active.id, time()); });
    return inspect();
  }
  return { inspect, prepare, repair, async export() { await request('/api/host/station/preparation'); return recoveryExport(); } };
}
