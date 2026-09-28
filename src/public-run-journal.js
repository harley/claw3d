import { scoreTurn, turnContext, RULES, SPEED_RULES, CAROUSEL_RULES } from './event-session.js';

export class PublicJournalReceiptConflict extends Error {}

export const PUBLIC_JOURNAL = 'cloud-claw:public-journal:v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const same = (a, b) => canonical(a) === canonical(b);
const inputOf = ({ name, requestKey, controlMode }) => ({ name, requestKey, controlMode });
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
function validate(record) {
  if (record.version !== 1 || typeof record.liveAttempted !== 'boolean' || !record.liveAttempted || typeof record.settled !== 'boolean' || !uuid(record.requestKey) || !['reserved', 'playing', 'interrupted', 'complete'].includes(record.physical)
    || !Array.isArray(record.turns) || record.turns.length > 3 || !Number.isInteger(record.acknowledged) || record.acknowledged < 0 || record.acknowledged > record.turns.length
    || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 24 || !['one-hand', 'two-hand'].includes(record.controlMode)) throw Error('Public journal is incompatible or damaged. Keep browser data and ask the host.');
  if (record.grant && (!uuid(record.grant.poolId) || typeof record.grant.slotId !== 'string' || typeof record.grant.packId !== 'string' || !record.grant.packId || !uuid(record.attemptKey) || typeof record.admitted !== 'boolean' || !record.run)) throw Error('Prepared intent is damaged. Keep browser data.');
  if (record.run) {
    const rules = record.run.rules;
    const { controlMode, controlVersion, ...frozen } = rules || {};
    if (!uuid(record.run.id) || ![RULES, SPEED_RULES, CAROUSEL_RULES].some(known => same(known, frozen))
      || controlMode && controlMode !== record.controlMode || controlVersion && controlVersion !== (record.controlMode === 'two-hand' ? 'camera-dual-raise-v1' : 'camera-fist-hold-550-v2')) throw Error('Unsupported saved scoring rules. Keep browser data.');
    for (let i = 0; i < record.turns.length; i++) {
      const turn = record.turns[i];
      if (turn.turn !== i + 1 || turn.score !== scoreTurn(rules, turnContext(record.turns.slice(0, i), turn.prizeId, turn.remainingMs))) throw Error('Saved turn is damaged. Keep browser data.');
    }
  } else if (record.turns.length) throw Error('Saved turns have no admission receipt.');
  return record;
}

function validatePool(pool) {
  if (!pool || pool.protocol !== 1 || !uuid(pool.id) || !uuid(pool.boardId) || typeof pool.packId !== 'string'
    || !Number.isSafeInteger(pool.reconcileBy) || !Number.isSafeInteger(pool.ownerExpires) || pool.ownerExpires <= pool.reconcileBy
    || !Number.isSafeInteger(pool.lastSeen) || !pool.packId || pool.hold !== undefined && typeof pool.hold !== 'string' || !Array.isArray(pool.slots)
    || !pool.slots.length || pool.slots.length > 1000 || !same(pool.controlModes, ['one-hand', 'two-hand'])
    || !same(pool.rules, { ...RULES, controlVersion: 'camera-fist-hold-550-v2' })
    || ['id', 'runId', 'requestKey'].some(key => new Set(pool.slots.map(slot => slot[key])).size !== pool.slots.length)
    || pool.slots.some(slot => typeof slot.id !== 'string' || !slot.id || !uuid(slot.runId) || !uuid(slot.requestKey) || slot.consumed !== undefined && typeof slot.consumed !== 'boolean')) throw Error('Prepared permits are incompatible. Keep browser data and ask the host.');
  return pool;
}
export const permitInput = entry => ({ protocol: 1, slotId: entry.grant.slotId, runId: entry.run.id,
  requestKey: entry.requestKey, name: entry.name, controlMode: entry.controlMode });

// This lock covers the whole physical page lifetime, not just an individual
// write. A second tab cannot call startup recovery on a still-playing owner.
export async function openPublicRunJournal({ indexedDB = globalThis.indexedDB, locks = globalThis.navigator?.locks, name = PUBLIC_JOURNAL } = {}) {
  if (!indexedDB || !locks?.request) throw Error('Durable storage and browser locking are required for scored play.');
  let release, db, closed = false;
  await new Promise((resolve, reject) => {
    locks.request(PUBLIC_JOURNAL + ':physical', { ifAvailable: true }, lock => {
      if (!lock) { reject(Error('Another tab owns scored play. Close it before starting here.')); return; }
      const held = new Promise(done => { release = done; });
      resolve(); return held;
    }).catch(reject);
  });
  const close = () => { closed = true; db?.close(); release?.(); };
  try {
    db = await new Promise((resolve, reject) => {
      const opening = indexedDB.open(name, 2);
      let refused = false;
      opening.onblocked = () => { refused = true; reject(Error('Journal upgrade is blocked. Close other game tabs; keep browser data.')); };
      opening.onerror = () => reject(opening.error);
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains('intents')) opening.result.createObjectStore('intents', { keyPath: 'requestKey' });
        if (!opening.result.objectStoreNames.contains('pools')) opening.result.createObjectStore('pools', { keyPath: 'id' });
      };
      opening.onsuccess = () => { if (refused) opening.result.close(); else resolve(opening.result); };
    });
    db.onversionchange = close;
    function transaction(action, mode = 'readwrite') {
      if (closed) return Promise.reject(Error('Public journal closed. Reload before scored play.'));
      return new Promise((resolve, reject) => {
        let value, failure;
        const tx = db.transaction(['intents', 'pools'], mode, { durability: 'strict' });
        tx.oncomplete = () => resolve(value); // Request success is not durable commit.
        tx.onabort = () => reject(failure || tx.error || Error('Public journal write aborted.'));
        Promise.resolve().then(() => action(tx.objectStore('intents'), tx.objectStore('pools'))).then(result => { value = result; }).catch(error => { failure = error; try { tx.abort(); } catch { reject(error); } });
      });
    }
    const all = () => transaction(async store => (await request(store.getAll())).map(validate), 'readonly');
    // No sessionStorage pointer is required after browser restart. Never replay
    // old physics, and never invent the turns missing from an interrupted run.
    await transaction(async store => {
      for (const record of await request(store.getAll())) {
        validate(record);
        if (!['complete', 'interrupted'].includes(record.physical)) { record.physical = 'interrupted'; store.put(record); }
      }
    });
    async function change(key, apply) {
      return transaction(async store => {
        const record = validate(await request(store.get(key)) || {});
        await apply(record); validate(record); store.put(record); return structuredClone(record);
      });
    }
    return {
      close, all,
      async installPool(input, packId, time = Date.now()) {
        const pool = validatePool({ ...structuredClone(input), packId, lastSeen: time });
        if (!input.ready || pool.reconcileBy <= time) throw Error('Host preparation is not ready. Keep pending data.');
        return transaction(async (_store, pools) => {
          const previous = await request(pools.get(pool.id));
          if (previous) {
            validatePool(previous);
            if (!same(previous.slots.map(({ id, runId, requestKey }) => ({ id, runId, requestKey })), pool.slots.map(({ id, runId, requestKey }) => ({ id, runId, requestKey })))) throw Error('Prepared slot identity changed.');
            for (const key of ['boardId', 'rules', 'generation', 'reconcileBy', 'controlModes']) if (!same(previous[key], pool[key])) throw Error('Prepared permit identity changed.');
          }
          pool.slots = pool.slots.map(slot => ({ ...slot, consumed: Boolean(slot.admissionSource || previous?.slots.find(old => old.id === slot.id)?.consumed) }));
          pool.hold = ''; pools.put(pool); return pool;
        });
      },
      holdPreparation: reason => transaction(async (_store, pools) => {
        for (const pool of await request(pools.getAll())) { validatePool(pool); pool.hold = reason; pools.put(pool); }
      }),
      async reservePrepared({ name, controlMode, attemptKey, packId, time = Date.now() }) {
        return transaction(async (store, pools) => {
          const entries = (await request(store.getAll())).map(validate);
          if (entries.some(entry => entry.attemptKey === attemptKey)) throw Error('This physical attempt was already reserved. Start a new player; keep pending data.');
          const prepared = (await request(pools.getAll())).map(validatePool).reverse();
          const pool = prepared.find(pool => pool.packId === packId && !pool.hold && pool.reconcileBy > time && pool.lastSeen <= time && pool.slots.some(slot => !slot.consumed));
          if (!pool) throw Error(prepared.find(pool => pool.hold)?.hold || 'No usable prepared starts. Ask the host to check capacity, deadline, clock and build. Keep browser data.');
          const slot = pool.slots.find(slot => !slot.consumed);
          const rules = { ...pool.rules, controlMode, controlVersion: controlMode === 'two-hand' ? 'camera-dual-raise-v1' : pool.rules.controlVersion };
          const run = { id: slot.runId, boardId: pool.boardId, name, rules, status: 'active', turns: [], prepared: true };
          const record = validate({ name, controlMode, requestKey: slot.requestKey, attemptKey, version: 1, physical: 'playing', liveAttempted: true,
            turns: [], acknowledged: 0, settled: false, admitted: false, grant: { slotId: slot.id, poolId: pool.id, packId }, run });
          slot.consumed = true; pool.lastSeen = time;
          pools.put(pool); store.add(record); return structuredClone(record);
        });
      },
      async reserve(input) {
        const value = inputOf(input);
        return transaction(async store => {
          for (const entry of await request(store.getAll())) validate(entry);
          const previous = await request(store.get(value.requestKey));
          if (previous) {
            validate(previous);
            if (!same(inputOf(previous), value) || previous.physical === 'interrupted') throw Error('This start identity is already used. Start a new player.');
            return { record: previous, first: false };
          }
          const record = validate({ ...value, version: 1, physical: 'reserved', liveAttempted: true, turns: [], acknowledged: 0, settled: false });
          store.add(record); return { record, first: true };
        });
      },
      admission: (key, run) => change(key, record => {
        if (!run || typeof run !== 'object') throw new PublicJournalReceiptConflict('Invalid admission receipt.');
        if (record.run && (record.run.id !== run.id || !same(record.run.rules, run.rules))) throw new PublicJournalReceiptConflict('Admission receipt changed identity or rules.');
        if (run.name !== record.name || run.rules?.controlMode && run.rules.controlMode !== record.controlMode) throw new PublicJournalReceiptConflict('Admission receipt conflicts with saved input.');
        // Classify invalid server identity/rules separately from damaged local data
        // (change() validates the existing record before applying any receipt).
        try { validate({ ...record, run }); }
        catch (error) { throw new PublicJournalReceiptConflict(error.message); }
        record.run ||= structuredClone(run);
        record.admitted = true; record.admissionReceipt = structuredClone(run);
        if (record.physical === 'reserved') record.physical = 'playing';
      }),
      async turns(run) {
        const record = (await all()).find(record => record.run?.id === run.id);
        if (!record) throw Error('Run ownership was not saved in this browser.');
        return change(record.requestKey, record => {
          if (record.physical === 'interrupted') throw Error('Interrupted attempts cannot resume physical play.');
          for (let i = 0; i < run.turns.length; i++) {
            const input = run.turns[i];
            const turn = { turn: input.turn, prizeId: input.prizeId, remainingMs: input.remainingMs ?? 0,
              score: scoreTurn(record.run.rules, turnContext(run.turns.slice(0, i), input.prizeId, input.remainingMs)) };
            if (record.turns[i] && !same(record.turns[i], turn)) throw Error('Saved turn cannot be changed.');
            record.turns[i] ||= turn;
          }
          if (record.turns.length === 3) record.physical = 'complete';
        });
      },
      acknowledge: (key, receipt) => change(key, record => {
        if (!receipt || receipt.id !== record.run?.id || !Array.isArray(receipt.turns)) throw new PublicJournalReceiptConflict('Invalid score receipt.');
        for (let i = 0; i < receipt.turns.length; i++) {
          const local = record.turns[i], remote = receipt.turns[i];
          if (!local || !remote || local.turn !== remote.turn || local.prizeId !== remote.prizeId || local.remainingMs !== (remote.remainingMs ?? 0) || local.score !== remote.score) throw new PublicJournalReceiptConflict('Server score differs from the retained local result.');
        }
        if (!same(receipt.rules, record.run.rules) || receipt.status === 'complete' && receipt.total !== record.turns.reduce((sum, turn) => sum + turn.score, 0)) throw new PublicJournalReceiptConflict('Server receipt differs from frozen scoring rules or total.');
        record.acknowledged = Math.max(record.acknowledged, receipt.turns.length);
        if (!record.receipt || receipt.turns.length > record.receipt.turns.length || receipt.turns.length === record.receipt.turns.length && (record.receipt.status === 'active' || receipt.status === 'complete')) record.receipt = structuredClone(receipt);
        if (receipt.status === 'complete' && record.acknowledged === 3 || receipt.status === 'abandoned' && record.physical === 'interrupted' && record.acknowledged === record.turns.length) record.settled = true;
        // Retain payloads and receipts. Cleanup/export policy is host-owned.
      }),
      interrupt: key => change(key, record => { if (record.physical !== 'complete') record.physical = 'interrupted'; }),
    };
  } catch (error) { close(); throw error; }
}
