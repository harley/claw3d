// Only names and completed turn results enter this client. Camera data never does.
const PREFIX = 'cloud-claw:pending:v2:';
const ACTIVE = 'cloud-claw:active:v2';
const browserStorage = name => ({
  get length() { return globalThis[name].length; }, key: i => globalThis[name].key(i),
  getItem: key => globalThis[name].getItem(key), setItem: (key, value) => globalThis[name].setItem(key, value), removeItem: key => globalThis[name].removeItem(key),
});
export function createSessionApi({ storage = browserStorage('localStorage'), tabStorage = browserStorage('sessionStorage'), fetcher = fetch, onChange = () => {}, onWork, publicPlay = false, now = Date.now, random = Math.random } = {}) {
  const prefix = publicPlay ? 'cloud-claw:public:pending:v1:' : PREFIX;
  const activeKey = publicPlay ? 'cloud-claw:public:active:v1' : ACTIVE;
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
      pending = pendingEntries.length;
      canFlush = !accessError && pendingEntries.some(entry => !blocked.has(entry.run.id));
    }
    catch { lastError = 'Pending scores could not be read. Keep this page open and ask the host.'; }
    return { pending, canFlush, blocked: blocked.size, error: lastError, needsLogin, retryAt, accessBlocked: Boolean(accessError) };
  }
  function notify() { onChange(state()); }
  function postpone(error) {
    const backoff = Math.min(60000, 2000 * 2 ** Math.min(failures++, 5));
    failureVersion++;
    retryAt = Math.max(retryAt, now() + Math.max(error.retryAfterMs || 0, Math.min(60000, backoff * (.8 + random() * .4))));
    retryError = error;
  }
  async function request(path, data) {
    // Every caller, including START/manual/online signals, shares this deadline.
    if (now() < retryAt) throw retryError;
    if (accessError && !['/login', '/host/login', '/session'].includes(path)) throw accessError;
    const startedVersion = failureVersion;
    let response;
    try {
      response = await fetcher(`/api${publicPlay ? '/play' : ''}${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
        ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
      const result = await response.json().catch(() => {
        if (response.ok) throw new Error('Invalid score service response.');
        return {};
      });
      if (!response.ok) {
        const error = new Error(result?.error || 'Score service unavailable.'); error.status = response.status;
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
      if (error.status === 401) {
        failureVersion++; accessError = error; needsLogin = !publicPlay;
        lastError = publicPlay ? 'Session expired. Keep pending score data and reload.' : 'Sign in again to continue and save pending scores.';
        notify();
      } else if (!error.status || error.status === 429 || error.status >= 500) {
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
    }).finally(() => { flushing = null; notify(); });
    return flushing;
  }
  return {
    request, flush, state,
    async initialize() {
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
      storage.setItem('cloud-claw:storage-probe', '1'); storage.removeItem('cloud-claw:storage-probe');
      const run = await request('/runs', { name, requestKey, controlMode });
      if (run.status !== 'active' || run.turns.length) throw new Error('This start request was already used. Enter a new run.');
      write(run.id, 'run', run);
      tabStorage.setItem(activeKey, run.id); activeId = run.id;
      return run;
    },
    queue(run) {
      if (!read(run.id, 'run')) throw new Error('Run ownership was not saved in this browser.');
      for (const turn of run.turns) {
        try { if (!read(run.id, `turn:${turn.turn}`)) write(run.id, `turn:${turn.turn}`, turn); }
        catch { lastError = 'Browser storage is full. Keep this page open while the score saves.'; }
      }
      notify(); if (onWork) onWork(); else void flush();
    },
    abandon(run) {
      if (!read(run.id, 'run')) return;
      activeId = null; tabStorage.removeItem(activeKey);
      try { write(run.id, 'interrupted', true); } catch { lastError = 'Keep this page open while results save.'; }
      if (onWork) onWork(); else void flush();
    },
  };
}
