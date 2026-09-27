// Only names and completed turn results enter this client. Camera data never does.
const PREFIX = 'cloud-claw:pending:v2:';
const ACTIVE = 'cloud-claw:active:v2';
const browserStorage = name => ({
  get length() { return globalThis[name].length; }, key: i => globalThis[name].key(i),
  getItem: key => globalThis[name].getItem(key), setItem: (key, value) => globalThis[name].setItem(key, value), removeItem: key => globalThis[name].removeItem(key),
});
export function createSessionApi({ storage = browserStorage('localStorage'), tabStorage = browserStorage('sessionStorage'), fetcher = fetch, onChange = () => {}, publicPlay = false } = {}) {
  const prefix = publicPlay ? 'cloud-claw:public:pending:v1:' : PREFIX;
  const activeKey = publicPlay ? 'cloud-claw:public:active:v1' : ACTIVE;
  let flushing = null, activeId = null, lastError = '', needsLogin = false;
  const unsaved = new Map();
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
    let pending = 0;
    try { pending = entries().filter(entry => entry.turns.length > entry.acknowledged || entry.interrupted).length; }
    catch { lastError = 'Pending scores could not be read. Keep this page open and ask the host.'; }
    return { pending, error: lastError, needsLogin };
  }
  function notify() { onChange(state()); }
  async function request(path, data) {
    const response = await fetcher(`/api${publicPlay ? '/play' : ''}${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    if (response.status === 401) { needsLogin = !publicPlay; lastError = publicPlay ? 'Session expired. Keep pending score data and reload.' : 'Sign in again to continue and save pending scores.'; notify(); }
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'Score service unavailable.'); error.status = response.status;
      const retryAfter = Number(response.headers?.get?.('Retry-After'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
      throw error;
    }
    if (path === '/login' || path === '/session') { needsLogin = false; lastError = ''; notify(); }
    return result;
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
    flushing = Promise.resolve().then(async () => {
      try {
        let inaccessible = false;
        for (const initial of entries()) {
          const id = initial.run.id;
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
            // Lost/expired public cookies cannot recover another owner's run.
            // Retain its journal for the host, but do not block new players.
            if (!publicPlay || error.status !== 404) throw error;
            inaccessible = true;
          }
        }
        if (!needsLogin) lastError = inaccessible ? 'An earlier score belongs to another browser session. Its data is retained; new scores can still save.' : '';
      } catch (error) {
        lastError = needsLogin ? 'Sign in again to save pending scores.' : error.status === 403 || error.status === 404 || error.status === 409
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
      await flush(); return session;
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
      notify(); void flush();
    },
    abandon(run) {
      if (!read(run.id, 'run')) return;
      activeId = null; tabStorage.removeItem(activeKey);
      try { write(run.id, 'interrupted', true); } catch { lastError = 'Keep this page open while results save.'; }
      void flush();
    },
  };
}
