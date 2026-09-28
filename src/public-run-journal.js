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
      const opening = indexedDB.open(name, 1);
      let refused = false;
      opening.onblocked = () => { refused = true; reject(Error('Journal upgrade is blocked. Close other game tabs; keep browser data.')); };
      opening.onerror = () => reject(opening.error);
      opening.onupgradeneeded = () => opening.result.createObjectStore('intents', { keyPath: 'requestKey' });
      opening.onsuccess = () => { if (refused) opening.result.close(); else resolve(opening.result); };
    });
    db.onversionchange = close;
    function transaction(action, mode = 'readwrite') {
      if (closed) return Promise.reject(Error('Public journal closed. Reload before scored play.'));
      return new Promise((resolve, reject) => {
        let value, failure;
        const tx = db.transaction('intents', mode, { durability: 'strict' });
        tx.oncomplete = () => resolve(value); // Request success is not durable commit.
        tx.onabort = () => reject(failure || tx.error || Error('Public journal write aborted.'));
        Promise.resolve().then(() => action(tx.objectStore('intents'))).then(result => { value = result; }).catch(error => { failure = error; try { tx.abort(); } catch { reject(error); } });
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
