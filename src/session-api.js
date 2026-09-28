import { openPublicRunJournal, PUBLIC_JOURNAL, PublicJournalReceiptConflict, permitInput } from './public-run-journal.js';
// Only names and completed turn results enter this client. Camera data never does.
const PREFIX = 'cloud-claw:pending:v2:';
const ACTIVE = 'cloud-claw:active:v2';
const browserStorage = name => ({
  get length() { return globalThis[name].length; }, key: i => globalThis[name].key(i),
  getItem: key => globalThis[name].getItem(key), setItem: (key, value) => globalThis[name].setItem(key, value), removeItem: key => globalThis[name].removeItem(key),
});
export function createSessionApi({ storage = browserStorage('localStorage'), tabStorage = browserStorage('sessionStorage'), fetcher = fetch, onChange = () => {}, onWork, publicPlay = false, now = Date.now, random = Math.random, journalFactory = openPublicRunJournal, prepared = false, verifyAssets = async () => { throw Error('Prepared assets must be verified.'); }, online = () => globalThis.navigator?.onLine !== false } = {}) {
  const prefix = publicPlay ? 'cloud-claw:public:pending:v1:' : PREFIX;
  const activeKey = publicPlay ? 'cloud-claw:public:active:v1' : ACTIVE;
  let journalOpening, journal, journalEntries = [], journalFailure = '', publicStarting = false, lastIntentKey = null, disposed = false;
  const journalReady = async () => {
    journalOpening ||= Promise.resolve().then(() => journalFactory());
    const opening = journalOpening;
    try { journal = await opening; }
    catch (error) {
      // Only a failed open may be retried; keep a successfully acquired owner.
      // Concurrent callers of an older failure must not clear a newer attempt.
      if (journalOpening === opening) journalOpening = null;
      throw error;
    }
    if (disposed) { journal.close(); throw Error('This game page has closed.'); }
    journalEntries = await journal.all();
    return journal;
  };
  const journalPending = entry => !entry.settled && (entry.physical === 'interrupted' || entry.turns.length > entry.acknowledged);
  async function updateJournal(action, receiptKey) {
    try { const result = await action(await journalReady()); journalEntries = await journal.all(); journalFailure = ''; return result; }
    catch (error) {
      if (error instanceof PublicJournalReceiptConflict) { blocked.set(receiptKey, error); journalFailure = ''; }
      else journalFailure = 'Score storage unavailable. Keep this page open and retry saving; closing it risks loss.';
      throw error;
    }
    finally { notify(); }
  }
  let flushing = null, activeId = null, lastError = '', needsLogin = false;
  const unsaved = new Map(), blocked = new Map();
  let failures = 0, retryAt = 0, retryError = null, accessError = null, failureVersion = 0;
  const pendingEntry = entry => entry.turns.length > entry.acknowledged || entry.interrupted;
  const key = (id, part) => `${prefix}${id}:${part}`;
  function read(id, part) {
    const name = key(id, part);
    return JSON.parse(unsaved.get(name) ?? storage.getItem(name) ?? 'null');
  }
  function write(id, part, value) {
    const name = key(id, part), text = JSON.stringify(value);
    unsaved.set(name, text); storage.setItem(name, text); unsaved.delete(name);
  }
  function entries() {
    const ids = new Set([...unsaved.keys()].filter(k => k.endsWith(':run')).map(k => k.slice(prefix.length, -4)));
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(prefix) && name.endsWith(':run')) ids.add(name.slice(prefix.length, -4));
    }
    return [...ids].map(id => ({ run: read(id, 'run'), turns: [1, 2, 3].map(n => read(id, `turn:${n}`)).filter(Boolean),
      acknowledged: [1, 2, 3].filter(n => read(id, `ack:${n}`)).length, interrupted: Boolean(read(id, 'interrupted')) }));
  }
  function state() {
    let pending = 0, canFlush = false;
    try {
      const pendingEntries = entries().filter(pendingEntry);
      pending = pendingEntries.length + journalEntries.filter(journalPending).length;
      canFlush = !accessError && (pendingEntries.some(entry => !blocked.has(entry.run.id)) || journalEntries.some(entry => journalPending(entry) && !blocked.has(entry.requestKey)));
    }
    catch { lastError = 'Pending scores could not be read. Keep this page open and ask the host.'; }
    return { pending, canFlush, blocked: blocked.size, error: journalFailure || (accessError ? lastError : [...blocked.values()].some(error => error instanceof PublicJournalReceiptConflict)
      ? 'A server receipt differs from the retained score. Keep browser data and ask the host for recovery; new scores can still save.' : lastError), needsLogin, retryAt, accessBlocked: Boolean(accessError) };
  }
  function notify() { onChange(state()); }
  function postpone(error) {
    const backoff = Math.min(60000, 2000 * 2 ** Math.min(failures++, 5));
    failureVersion++;
    retryAt = Math.max(retryAt, now() + Math.max(error.retryAfterMs || 0, Math.min(60000, backoff * (.8 + random() * .4))));
    retryError = error;
  }
  async function request(path, data, { timeout = 8000 } = {}) {
    // Every caller, including START/manual/online signals, shares this deadline.
    if (now() < retryAt) throw retryError;
    if (accessError && !['/login', '/host/login', '/session'].includes(path)) throw accessError;
    const startedVersion = failureVersion;
    let response;
    try {
      const controller = new AbortController();
      let timer;
      const operation = (async () => {
        const response = await fetcher(`/api${publicPlay ? '/play' : ''}${path}`, { credentials: 'same-origin', cache: 'no-store', signal: timeout === 1000 ? controller.signal : AbortSignal.timeout(timeout),
          ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
        const result = await response.json().catch(() => {
          if (response.ok) throw new Error('Invalid score service response.');
          return {};
        });
        return { response, result };
      })();
      let result;
      try {
        ({ response, result } = await (timeout !== 1000 ? operation : Promise.race([operation, new Promise((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(Error('Score service timed out.')); }, timeout);
        })])));
      } finally { clearTimeout(timer); }
      if (!response.ok) {
        const error = new Error(result?.error || 'Score service unavailable.'); error.status = response.status; error.code = result?.code;
        const header = response.headers?.get?.('Retry-After');
        const seconds = header?.trim() ? Number(header) : NaN;
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now();
        if (Number.isFinite(delay) && delay > 0) error.retryAfterMs = delay;
        throw error;
      }
      // An older in-flight success cannot cancel a newer throttle/refusal.
      if (startedVersion === failureVersion) { failures = 0; retryAt = 0; retryError = null; }
      if (startedVersion === failureVersion && ['/login', '/host/login', '/session'].includes(path)) { accessError = null; needsLogin = false; lastError = ''; blocked.clear(); notify(); }
      return result;
    } catch (error) {
      if (prepared && (error.status === 401 || error.code && ![429].includes(error.status))) {
        await updateJournal(journal => journal.holdPreparation(`Preparation on hold: ${error.message}`));
      }
      if (error.status === 401) {
        failureVersion++; accessError = error; needsLogin = !publicPlay;
        lastError = publicPlay ? 'Session expired. Keep pending score data and reload.' : 'Sign in again to continue and save pending scores.';
        notify();
      } else if (!error.status || error.status === 429 || error.status >= 500 && !error.code) {
        postpone(error);
      }
      throw error;
    }
  }
  function clear(id) {
    // Remove the run marker first. A late acknowledgement from another tab cannot resurrect a run.
    for (const part of ['run', 'interrupted', ...[1, 2, 3].flatMap(n => [`turn:${n}`, `ack:${n}`])]) {
      storage.removeItem(key(id, part)); unsaved.delete(key(id, part));
    }
    if (activeId === id) { activeId = null; tabStorage.removeItem(activeKey); }
  }
  async function flush() {
    if (flushing) return flushing;
    if (accessError || now() < retryAt) return;
    flushing = Promise.resolve().then(async () => {
      try {
        if (publicPlay && journal) {
          for (const initial of await journal.all()) {
            if (!journalPending(initial) || blocked.has(initial.requestKey)) continue;
            try {
              let entry = initial;
              if (entry.grant && !entry.admitted) entry = await journal.admission(entry.requestKey, await request('/permits/reconcile', permitInput(entry)));
              if (!entry.run) entry = await journal.admission(entry.requestKey, await request(`/intents/${entry.requestKey}`));
              for (const turn of entry.turns.slice(entry.acknowledged)) {
                const saved = await request(`/runs/${entry.run.id}/turns`, { turn: turn.turn, prizeId: turn.prizeId, remainingMs: turn.remainingMs });
                entry = await journal.acknowledge(entry.requestKey, saved);
              }
              if (entry.physical === 'interrupted' && !entry.settled) entry = await journal.acknowledge(entry.requestKey, await request(`/runs/${entry.run.id}/abandon`, {}));
              if (entry.settled && entry.receipt?.status === 'complete') onChange({ saved: entry.receipt });
            } catch (error) {
              if (!(error instanceof PublicJournalReceiptConflict) && ![400, 403, 404, 409].includes(error.status)) throw error;
              blocked.set(initial.requestKey, error);
            }
          }
        }
        for (const initial of entries()) {
          const id = initial.run.id;
          if (blocked.has(id)) continue;
          try {
            for (const n of [1, 2, 3]) {
              if (!read(id, 'run')) break;
              const turn = read(id, `turn:${n}`);
              if (!turn) break;
              if (!read(id, `ack:${n}`)) {
                const saved = await request(`/runs/${id}/turns`, { turn: n, prizeId: turn.prizeId, ...(turn.remainingMs !== undefined ? { remainingMs: turn.remainingMs } : {}) });
                // Each turn and acknowledgement has its own key: no tab rewrites another tab's turn list.
                if (read(id, 'run')) write(id, `ack:${n}`, saved);
              }
            }
            if (!read(id, 'run')) continue;
            const saved = read(id, 'ack:3');
            if (saved) { onChange({ saved }); clear(id); }
            else if (read(id, 'interrupted') && id !== activeId) {
              await request(`/runs/${id}/abandon`, {}); clear(id);
            }
          } catch (error) {
            // A rejected record is retained and isolated, not retried every tick.
            // Later valid runs still drain in order within their own identity.
            if (![400, 403, 404, 409].includes(error.status)) throw error;
            blocked.set(id, error);
          }
        }
        if (!accessError) lastError = blocked.size ? 'An earlier score needs host recovery. Its data is retained; new scores can still save.' : '';
      } catch (error) {
        if (!error.status && retryAt <= now()) postpone(error);
        lastError = accessError ? (publicPlay ? 'Session expired. Keep pending score data and reload.' : 'Sign in again to save pending scores.') : error.status === 403 || error.status === 404 || error.status === 409
          ? `${error.message} Keep this browser’s data and ask the host.` : 'Score waiting to sync. Keep this page open; it will retry.';
      }
    }).finally(async () => { if (journal) { try { journalEntries = await journal.all(); } catch { journalFailure = 'Public score journal cannot be read. Keep browser data.'; } } flushing = null; notify(); });
    return flushing;
  }
  async function checkedPack() {
    const pack = await verifyAssets();
    if (!pack.complete || !pack.controlling || typeof pack.id !== 'string') throw Error('Prepared assets are missing or damaged. Ask the host; keep browser data.');
    return pack.id;
  }
  async function startPrepared(name, attemptKey, controlMode) {
    if (accessError) throw accessError;
    if (publicStarting || activeId) throw Error('Finish the current physical attempt before starting another.');
    publicStarting = true;
    try {
      const packId = await checkedPack();
      if (lastIntentKey) await updateJournal(journal => journal.interrupt(lastIntentKey));
      const entry = await updateJournal(journal => journal.reservePrepared({ name, controlMode, attemptKey, packId, time: now() }));
      lastIntentKey = entry.requestKey;
      let admitted;
      if (online() && now() >= retryAt) {
        try { admitted = await request('/permits/live', permitInput(entry), { timeout: 1000 }); }
        catch (error) {
          if (error.status && error.status !== 429 && !(error.status >= 500 && !error.code)) {
            await updateJournal(journal => journal.holdPreparation(`Preparation on hold: ${error.message}`));
            await updateJournal(journal => journal.interrupt(entry.requestKey)); throw error;
          }
        }
      }
      if (admitted) {
        await updateJournal(journal => journal.admission(entry.requestKey, admitted), entry.requestKey);
        if (admitted.status !== 'active' || admitted.turns.length) throw Error('This physical attempt is already used. Keep pending data.');
      }
      if (disposed) throw Error('The game page closed before admission.');
      activeId = entry.run.id;
      return { ...entry.run, ...(admitted?.event ? { event: admitted.event } : {}) };
    } finally { publicStarting = false; }
  }
  return {
    request, flush, state,
    async preparePermit(poolId) {
      if (!prepared) throw Error('Open the prepared game before preparing permits.');
      const packId = await checkedPack();
      const pool = await request(`/permits/${poolId}`);
      return updateJournal(journal => journal.installPool(pool, packId, now()));
    },
    dispose() { disposed = true; journal?.close(); journalOpening?.then(value => value.close()).catch(() => {}); },
    async recover() {
      const databases = await globalThis.indexedDB?.databases?.();
      if (publicPlay && globalThis.indexedDB && (!databases || databases.some(db => db.name === PUBLIC_JOURNAL))) await journalReady();
    },
    async initialize() {
      if (publicPlay) await journalReady();
      if (prepared) {
        await checkedPack();
        return { role: 'public', station: null, board: { name: 'Prepared station · sync pending', runs: [] } };
      }
      const interruptedId = tabStorage.getItem(activeKey);
      if (interruptedId) {
        if (read(interruptedId, 'run')) write(interruptedId, 'interrupted', true);
        tabStorage.removeItem(activeKey);
      }
      const session = await request('/session', publicPlay ? {} : undefined);
      if (!onWork) await flush();
      return session;
    },
    async start(name, requestKey, controlMode = 'one-hand') {
      if (prepared) return startPrepared(name, requestKey, controlMode);
      if (publicPlay) {
        if (now() < retryAt) throw retryError;
        if (accessError) throw accessError;
        if (publicStarting || activeId) throw Error('Finish the current physical attempt before starting another.');
        publicStarting = true;
        try {
          if (lastIntentKey && lastIntentKey !== requestKey) await updateJournal(journal => journal.interrupt(lastIntentKey));
          const intent = await updateJournal(journal => journal.reserve({ name, requestKey, controlMode }));
          lastIntentKey = requestKey;
          // Once the durable marker exists, every retry is read-only. A lost
          // response or reload can never replay live creation/classification.
          const run = intent.first ? await request('/runs', { name, requestKey, controlMode }) : await request(`/intents/${requestKey}`);
          await updateJournal(journal => journal.admission(requestKey, run), requestKey);
          if (run.status !== 'active' || run.turns.length || intent.record.physical === 'interrupted') throw Error('This physical attempt is already used. Start a new player.');
          activeId = run.id;
          return run;
        } finally { publicStarting = false; }
      }
      storage.setItem('cloud-claw:storage-probe', '1'); storage.removeItem('cloud-claw:storage-probe');
      const run = await request('/runs', { name, requestKey, controlMode });
      if (run.status !== 'active' || run.turns.length) throw new Error('This start request was already used. Enter a new run.');
      write(run.id, 'run', run);
      tabStorage.setItem(activeKey, run.id); activeId = run.id;
      return run;
    },
    queue(run) {
      if (publicPlay) return updateJournal(journal => journal.turns(run)).then(() => { if (run.turns.length === 3) activeId = null; if (onWork) onWork(); else void flush(); });
      if (!read(run.id, 'run')) throw new Error('Run ownership was not saved in this browser.');
      for (const turn of run.turns) {
        try { if (!read(run.id, `turn:${turn.turn}`)) write(run.id, `turn:${turn.turn}`, turn); }
        catch { lastError = 'Browser storage is full. Keep this page open while the score saves.'; }
      }
      notify(); if (onWork) onWork(); else void flush();
    },
    abandon(run) {
      if (publicPlay) return updateJournal(async journal => {
        const entry = (await journal.all()).find(entry => entry.run?.id === run.id);
        if (entry) await journal.interrupt(entry.requestKey);
      }).then(() => { activeId = null; if (onWork) onWork(); else void flush(); });
      if (!read(run.id, 'run')) return;
      activeId = null; tabStorage.removeItem(activeKey);
      try { write(run.id, 'interrupted', true); } catch { lastError = 'Keep this page open while results save.'; }
      if (onWork) onWork(); else void flush();
    },
  };
}
