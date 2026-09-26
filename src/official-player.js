import { createOfficialAdmission } from './official-admission.js';
import { createOfficialSessionApi } from './official-session-api.js';

const browserStorage = name => ({
  get length() { return globalThis[name].length; }, key: i => globalThis[name].key(i),
  getItem: key => globalThis[name].getItem(key), setItem: (key, value) => globalThis[name].setItem(key, value), removeItem: key => globalThis[name].removeItem(key),
});
const SELECTED = 'cloud-claw:official-player:v1';
const HANDOFF = `${SELECTED}:handoff`;
// Coordinates admission and score delivery; the arcade alone owns physics.
// A reconstructed controller can inspect/drain, but can never start a game.
export function createOfficialPlayer({ storage = browserStorage('localStorage'), tabStorage = browserStorage('sessionStorage'), fetcher = fetch, onChange = () => {}, onResult = () => {} } = {}) {
  const admission = createOfficialAdmission({ storage, fetcher });
  let intent = null, active = null, busy = false, ready = false, blocked = false, error = '', result = null, board = null, refreshing = null, handoffPhase = null;
  const api = createOfficialSessionApi({ storage, tabStorage, fetcher: (path, options) => {
    const target = /^\/api\/official\/runs\/([^/]+)/.exec(path)?.[1];
    if (target && target !== intent?.receipt?.id) throw new Error('Attempt capability does not match this page.');
    return fetcher(path, options);
  }, onChange: () => notify() });
  function state() {
    let sync;
    try { sync = api.state(); }
    catch { return { ready: false, busy, handingOff: Boolean(handoffPhase), blocked: true, error: 'Recovery storage unavailable. Keep this page and ask the host.', intent, result, board: null, canActivate: false, pending: null }; }
    return { ready, busy, handingOff: Boolean(handoffPhase), blocked, error: error || (sync.attempts.length ? sync.error : ''), intent, result, board,
      canActivate: ready && !busy && !blocked && !active && intent?.receipt?.status === 'accepted' && !intent.recoveryRequired,
      pending: sync.attempts.reduce((n, row) => n + row.pending, 0) };
  }
  function notify() { onChange(state()); }
  async function request(path, data) {
    let response;
    try { response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) }); }
    catch { throw new Error('Official service unavailable. Keep this page and retry.'); }
    if (!response.ok) { const failure = new Error('Official access unavailable. Keep browser data and ask the host.'); failure.status = response.status; throw failure; }
    return response.json();
  }
  async function exclusive(action) {
    if (!ready || busy) throw new Error('Please wait for the current operation.');
    busy = true; error = ''; notify();
    try { await refreshing; return await action(); } catch (failure) { error = failure.message; throw failure; }
    finally { busy = false; notify(); }
  }
  function refresh(internal = false) {
    if (busy && !internal) return refreshing || Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = Promise.resolve().then(async () => {
      if (handoffPhase || !intent?.receipt) return;
      let receipt = await request('/api/official/session');
      if (receipt.id !== intent.receipt.id) { blocked = true; board = result = null; throw new Error('Another attempt owns this browser capability. Keep data and ask the host.'); }
      await api.flush();
      receipt = await request(`/api/official/runs/${receipt.id}`);
      if (['void', 'expired', 'interrupted'].includes(receipt.status)) blocked = true;
      if (active && receipt.status !== 'active' && receipt.status !== 'complete') blocked = true;
      if (receipt.status === 'complete') {
        const saved = await request(`/api/official/runs/${receipt.id}/best`);
        if (saved.attempt.id !== receipt.id) throw new Error('Result does not match this attempt.');
        result = saved; onResult(saved);
      }
      board = await request('/api/official/board');
      error = blocked ? `Attempt ${receipt.status}. Keep browser data and ask the host.` : '';
    }).catch(failure => { error = failure.message; board = null; if ([401, 403, 404].includes(failure.status)) { blocked = true; result = null; } })
      .finally(() => { refreshing = null; notify(); });
    return refreshing;
  }
  return {
    state, refresh,
    async initialize() {
      try {
        const selected = tabStorage.getItem(SELECTED);
        const ending = JSON.parse(tabStorage.getItem(HANDOFF) || 'null');
        if (ending) {
          if (!['cleanup', 'logout'].includes(ending.phase) || typeof ending.key !== 'string' || (selected && selected !== ending.key)) throw new Error('Invalid handoff');
          handoffPhase = ending; blocked = true; ready = true;
          error = 'Sign-out pending. Finish sign-out before the next player.';
          notify(); return;
        }
        if (selected) intent = admission.read(selected);
        if (intent?.receipt) await api.initialize();
        await refresh();
        ready = true;
      } catch { error = 'Recovery storage unavailable. Keep browser data and ask the host.'; }
      notify();
    },
    // Recovery choices contain no participant name or bearer secret.
    recoveries: () => admission.list().map(row => ({ requestKey: row.requestKey, status: row.receipt?.status || 'pending' })),
    redeem(code, recoveryKey = '') {
      return exclusive(async () => {
        if (handoffPhase || active || result) throw new Error('Finish this attempt and sign out before another ticket.');
        if (!intent) {
          intent = recoveryKey ? admission.read(recoveryKey) : await admission.prepare(code);
          // Tab selection is durable before the first consuming request too.
          tabStorage.setItem(SELECTED, intent.requestKey);
          if (tabStorage.getItem(SELECTED) !== intent.requestKey) throw new Error('Recovery storage unavailable.');
        }
        // Always recheck on retry: storage refusal must never be bypassed.
        tabStorage.setItem(SELECTED, intent.requestKey);
        if (tabStorage.getItem(SELECTED) !== intent.requestKey) throw new Error('Recovery storage unavailable.');
        intent = await admission.redeem(intent.requestKey, code);
        if (intent.recoveryRequired) await api.initialize();
        await refresh(true);
        return intent;
      });
    },
    activate() {
      return exclusive(async () => {
        if (blocked || active || !intent?.receipt || intent.recoveryRequired) throw new Error('This attempt cannot restart. Ask the host.');
        const issued = await api.activate(intent.receipt, intent.nonce);
        if (issued.id !== intent.receipt.id) throw new Error('Activation does not match this attempt.');
        active = issued.id;
        // The existing presentation session uses boardId, not eventId.
        return { ...issued, boardId: issued.eventId };
      });
    },
    queue(run) {
      if (run.id !== active || blocked) throw new Error('Official attempt is no longer playable. Keep data and ask the host.');
      return api.queue(run).then(() => refresh());
    },
    async interrupt() {
      blocked = true; notify();
      if (active) await api.interrupt(active);
      await refresh();
    },
    // Handoff is intentionally only available after acknowledged completion.
    // Unfinished/terminal cases remain with the host; no destructive reset.
    handoff() {
      return exclusive(async () => {
        function savePhase(phase) {
          const text = JSON.stringify(phase); tabStorage.setItem(HANDOFF, text);
          if (tabStorage.getItem(HANDOFF) !== text) throw new Error('Sign-out storage unavailable. Keep this page.');
          handoffPhase = phase;
        }
        if (!handoffPhase) {
          await refresh(true);
          if (blocked || result?.attempt.status !== 'complete' || api.state().attempts.length)
            throw new Error('Resolve retained attempts with the host before changing players.');
          savePhase({ key: intent.requestKey, phase: 'cleanup' });
        }
        if (handoffPhase.phase === 'cleanup') {
          if (admission.list().some(row => row.requestKey === handoffPhase.key)) await admission.acknowledge(handoffPhase.key);
          savePhase({ ...handoffPhase, phase: 'logout' });
        }
        // Both logouts are retriable after response loss; a 401 is already revoked.
        for (const path of ['/api/official/logout', '/api/logout']) {
          try { await request(path, {}); } catch (failure) { if (failure.status !== 401) throw failure; }
        }
        tabStorage.removeItem(SELECTED);
        tabStorage.removeItem(HANDOFF);
        intent = result = board = null; active = null; blocked = true;
      });
    },
  };
}
