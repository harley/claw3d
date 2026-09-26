import { scoreTurn } from './event-session.js';

// Separate from the staff v2 outbox: a staff session never grants this authority.
const PREFIX = 'cloud-claw:official:v1:';
const ACTIVE = `${PREFIX}active`;
const browserStorage = name => ({
  get length() { return globalThis[name].length; }, key: i => globalThis[name].key(i),
  getItem: key => globalThis[name].getItem(key), setItem: (key, value) => globalThis[name].setItem(key, value), removeItem: key => globalThis[name].removeItem(key),
});
const terminal = run => ['void', 'expired'].includes(run.status);

// Admission is separate. activate consumes an already admitted receipt and its
// nonce; only the current page may retry that activation after response loss.
export function createOfficialSessionApi({ storage = browserStorage('localStorage'), tabStorage = browserStorage('sessionStorage'), fetcher = fetch, onChange = () => {} } = {}) {
  let activeId = null, playable = false, starting = null, flushing = null, error = '', needsCapability = false;
  const unsaved = new Map();
  const key = (id, part) => `${PREFIX}${id}:${part}`;
  const read = (id, part) => JSON.parse(unsaved.get(key(id, part)) ?? storage.getItem(key(id, part)) ?? 'null');
  function write(id, part, value) {
    const name = key(id, part), text = JSON.stringify(value);
    unsaved.set(name, text); storage.setItem(name, text); unsaved.delete(name);
  }
  function ids() {
    const names = new Set(unsaved.keys());
    for (let i = 0; i < storage.length; i++) names.add(storage.key(i));
    return [...names].filter(name => name?.startsWith(PREFIX) && name.endsWith(':run')).map(name => name.slice(PREFIX.length, -4));
  }
  function state() {
    return { error, needsCapability, attempts: ids().map(id => ({ id,
      status: read(id, 'terminal')?.status ?? (read(id, 'interrupted') ? 'interrupted' : 'pending'),
      pending: [1, 2, 3].filter(n => read(id, `turn:${n}`) && !read(id, `ack:${n}`)).length })) };
  }
  const notify = () => onChange(state());
  async function request(path, data) {
    const response = await fetcher(`/api/official${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    const result = await response.json();
    if (!response.ok) {
      const failure = new Error(result.error || 'Official attempt unavailable.'); failure.status = response.status; throw failure;
    }
    needsCapability = false;
    return result;
  }
  function failed(failure) {
    needsCapability = failure.status === 401 || needsCapability;
    error = needsCapability ? 'Official attempt access is unavailable. Keep browser data and ask the host.'
      : failure.status >= 400 && failure.status < 500 ? `${failure.message} Keep browser data and ask the host.`
        : 'Official score waiting to sync. Keep this page open and retry.';
  }
  function stop(id) {
    if (activeId === id) { activeId = null; playable = false; }
    if (tabStorage.getItem(ACTIVE) === id) tabStorage.removeItem(ACTIVE);
  }
  function clear(id) {
    // Flush and acknowledgement are serialized. Keep the marker until every
    // removal is confirmed, so storage refusal remains recoverable.
    for (const part of ['interrupted', 'interruptAck', ...[1, 2, 3].flatMap(n => [`turn:${n}`, `ack:${n}`]), 'terminal', 'run']) {
      storage.removeItem(key(id, part));
      if (storage.getItem(key(id, part)) !== null) throw new Error('Attempt storage unavailable. Keep this page.');
      unsaved.delete(key(id, part));
    }
    stop(id);
  }
  function retainTerminal(run) {
    write(run.id, 'terminal', { status: run.status }); stop(run.id);
    error = `Official attempt ${run.status}. Keep browser data for host review.`;
  }
  function flush() {
    if (flushing) return flushing;
    flushing = Promise.resolve().then(async () => {
      try {
        // The HttpOnly cookie identifies exactly one run. Never try other stored
        // attempts using this capability or fall back to a staff endpoint.
        const current = await request('/session'), id = current.id;
        if (!read(id, 'run')) return current;
        if (terminal(current)) { retainTerminal(current); return current; }
        if (current.status === 'complete') { clear(id); onChange({ saved: current }); return current; }
        if (read(id, 'terminal')) return current;
        for (const n of [1, 2, 3]) {
          if (!read(id, 'run')) break;
          const turn = read(id, `turn:${n}`);
          if (!turn) break;
          if (!read(id, `ack:${n}`)) {
            const saved = await request(`/runs/${id}/turns`, turn);
            if (read(id, 'run')) write(id, `ack:${n}`, saved);
          }
        }
        if (!read(id, 'run')) return current;
        const completed = read(id, 'ack:3');
        if (completed?.status === 'complete') { clear(id); onChange({ saved: completed }); }
        else if (read(id, 'interrupted') && activeId !== id) {
          const interrupted = read(id, 'interruptAck') ?? await request(`/runs/${id}/interrupt`, {});
          if (read(id, 'run')) write(id, 'interruptAck', interrupted);
          if (terminal(interrupted)) { retainTerminal(interrupted); return interrupted; }
          // Keep the interrupted receipt for explicit host review/recovery.
        }
        error = '';
        return current;
      } catch (failure) { failed(failure); }
    }).finally(() => { flushing = null; notify(); });
    return flushing;
  }
  return {
    state, flush,
    async initialize() {
      // Mark before networking, including offline reload. A different tab's
      // initialize cannot interrupt the page that owns a live physical attempt.
      const id = tabStorage.getItem(ACTIVE);
      if (id && read(id, 'run')) write(id, 'interrupted', true);
      if (id) stop(id);
      return flush();
    },
    async activate(run, nonce) {
      if (starting) throw new Error('Official activation is already in progress.');
      starting = Promise.resolve().then(async () => {
        const previous = read(run.id, 'run');
        if (playable || run.status !== 'accepted' || run.turns.length || run.rules.turns !== 3 || read(run.id, 'interrupted') || read(run.id, 'terminal') || (previous && activeId !== run.id))
          throw new Error('This attempt cannot restart. Ask the host.');
        if (previous && previous.nonce !== nonce) throw new Error('Attempt belongs to another activation.');
        if (activeId && activeId !== run.id) throw new Error('Finish the current attempt first.');
        // Both stores must work before activation. The nonce is never a staff
        // credential and is kept only until this outbox is acknowledged.
        storage.setItem(`${PREFIX}probe`, '1'); storage.removeItem(`${PREFIX}probe`);
        tabStorage.setItem(ACTIVE, run.id);
        write(run.id, 'run', { id: run.id, rules: run.rules, nonce });
        activeId = run.id;
        try {
          const active = await request(`/runs/${run.id}/activate`, { nonce });
          if (active.status !== 'active' || active.turns.length) throw new Error('This attempt cannot restart. Ask the host.');
          playable = true; error = ''; return active;
        } catch (failure) { failed(failure); throw failure; }
      }).finally(() => { starting = null; notify(); });
      return starting;
    },
    queue(run) {
      const owned = read(run.id, 'run');
      if (!playable || !owned || activeId !== run.id || read(run.id, 'interrupted') || read(run.id, 'terminal')) throw new Error('This page does not own an active official attempt.');
      // Validate the whole snapshot before persisting; caller totals/scores are
      // never sent. The server remains the scoring authority.
      const turns = run.turns.map((row, i) => {
        if (row.turn !== i + 1 || row.turn > 3) throw new Error('Expected three ordered turns.');
        const turn = { turn: row.turn, prizeId: row.prizeId, remainingMs: row.remainingMs ?? 0 };
        scoreTurn(owned.rules, turn.prizeId, turn.remainingMs);
        const old = read(run.id, `turn:${row.turn}`);
        if (old && JSON.stringify(old) !== JSON.stringify(turn)) throw new Error('Completed turn cannot change.');
        return turn;
      });
      for (const turn of turns) {
        try { write(run.id, `turn:${turn.turn}`, turn); }
        catch { error = 'Browser storage is full. Keep this page open while official scores save.'; }
      }
      notify(); return flush();
    },
    interrupt(id) {
      if (activeId !== id) throw new Error('This page does not own this attempt.');
      write(id, 'interrupted', true); stop(id); return flush();
    },
    acknowledge(id) {
      if (!read(id, 'terminal') && !read(id, 'interrupted')) throw new Error('Only reviewed interrupted or terminal attempts can be cleared.');
      if (!read(id, 'terminal') && [1, 2, 3].some(n => read(id, `turn:${n}`) && !read(id, `ack:${n}`))) throw new Error('Completed turns must sync before clearing.');
      if (!read(id, 'terminal') && !read(id, 'interruptAck')) throw new Error('Interruption must sync before clearing.');
      clear(id); notify();
    },
  };
}
