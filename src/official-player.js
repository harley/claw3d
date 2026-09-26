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
export function createOfficialPlayer({ storage = browserStorage('localStorage'), tabStorage = browserStorage('sessionStorage'), fetcher = fetch, onChange = () => {}, onResult = () => {}, publicScope = false, locks = globalThis.navigator?.locks } = {}) {
  const endingStorage = publicScope ? storage : tabStorage;
  const admission = createOfficialAdmission({ storage, fetcher: scopedFetch, publicScope });
  let intent = null, active = null, busy = false, ready = false, blocked = false, error = '', result = null, board = null, refreshing = null, handoffPhase = null, terminalReceipt = null;
  const api = createOfficialSessionApi({ storage, tabStorage, fetcher: (path, options) => {
    const target = /^\/api\/official\/runs\/([^/]+)/.exec(path)?.[1];
    if (target && target !== intent?.receipt?.id) throw new Error('Attempt capability does not match this page.');
    return scopedFetch(path, options);
  }, onChange: () => notify() });
  function scopedFetch(path, options) {
    if (!publicScope || !path.startsWith('/api/official/')) return fetcher(path, options);
    if (path === '/api/official/redeem') return fetcher('/api/official/public/redeem', options);
    const id = handoffPhase?.runId || intent?.receipt?.id;
    if (!id) throw new Error('Attempt capability unavailable.');
    const run = /^\/api\/official\/runs\/([^/]+)(.*)$/.exec(path);
    if (run && run[1] !== id) throw new Error('Attempt capability does not match this page.');
    const operation = run ? run[2] : '/' + path.slice('/api/official/'.length);
    return fetcher(`/api/official/public/runs/${id}${operation}`, options);
  }
  function locked(action) {
    if (!publicScope) return action();
    if (!locks?.request) throw new Error('This browser cannot safely share official attempts. Use Try or ask the host.');
    return locks.request('cloud-claw:public-official-transition:v1', action);
  }
  function readHandoff() {
    const value = JSON.parse(endingStorage.getItem(HANDOFF) || 'null');
    if (value && (!['cleanup', 'logout'].includes(value.phase) || typeof value.key !== 'string' ||
      (publicScope && (!/^[a-f0-9-]{36}$/.test(value.runId) || !/^[a-f0-9-]{36}$/.test(value.nonce) || !['complete', 'void', 'expired'].includes(value.terminalReason))))) throw new Error('Invalid handoff');
    return value;
  }
  function remove(store, key) {
    store.removeItem(key); if (store.getItem(key) !== null) throw new Error('Recovery storage unavailable. Keep this page.');
  }
  function state() {
    let sync;
    try { sync = api.state(); }
    catch { return { ready: false, busy, handingOff: Boolean(handoffPhase), blocked: true, error: 'Recovery storage unavailable. Keep this page and ask the host.', intent, result, board: null, canActivate: false, pending: null }; }
    return { ready, busy, handingOff: Boolean(handoffPhase), blocked, error: error || (sync.attempts.length ? sync.error : ''), intent, result, board,
      canActivate: ready && !busy && !blocked && !active && intent?.receipt?.status === 'accepted' && !intent.recoveryRequired,
      canHandoff: Boolean(handoffPhase || terminalReceipt),
      pending: sync.attempts.reduce((n, row) => n + row.pending, 0) };
  }
  function notify() { onChange(state()); }
  async function request(path, data) {
    let response;
    try { response = await scopedFetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) }); }
    catch { throw new Error('Official service unavailable. Keep this page and retry.'); }
    if (!response.ok) { const failure = new Error('Official access unavailable. Keep browser data and ask the host.'); failure.status = response.status; throw failure; }
    return response.json();
  }
  async function exclusive(action) {
    if (!ready || busy) throw new Error('Please wait for the current operation.');
    busy = true; error = ''; notify();
    try { await refreshing; return await locked(action); } catch (failure) { error = failure.message; throw failure; }
    finally { busy = false; notify(); }
  }
  function refresh(internal = false) {
    if (busy && !internal) return refreshing || Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = Promise.resolve().then(async () => {
      terminalReceipt = null;
      if (handoffPhase || !intent?.receipt) return;
      let receipt = await request('/api/official/session');
      if (receipt.id !== intent.receipt.id) { blocked = true; board = result = null; throw new Error('Another attempt owns this browser capability. Keep data and ask the host.'); }
      await api.flush();
      receipt = await request(`/api/official/runs/${receipt.id}`);
      if (receipt.id !== intent.receipt.id) throw new Error('Attempt receipt mismatch.');
      if (['complete', 'void', 'expired'].includes(receipt.status)) terminalReceipt = receipt;
      if (['void', 'expired', 'interrupted'].includes(receipt.status)) blocked = true;
      if (active && receipt.status !== 'active' && receipt.status !== 'complete') blocked = true;
      if (receipt.status === 'complete') {
        const saved = await request(`/api/official/runs/${receipt.id}/best`);
        if (saved.attempt.id !== receipt.id) throw new Error('Result does not match this attempt.');
        result = saved; onResult(saved);
      }
      board = await request('/api/official/board');
      error = terminalReceipt && receipt.status !== 'complete' ? `Attempt ${receipt.status}. Finish to hand over this station.` : blocked ? `Attempt ${receipt.status}. Keep browser data and ask the host.` : '';
    }).catch(failure => { error = failure.message; board = null; if ([401, 403, 404].includes(failure.status)) { blocked = true; result = null; } })
      .finally(() => { refreshing = null; notify(); });
    return refreshing;
  }
  return {
    state, refresh,
    async initialize() {
      try { await locked(async () => {
        const selected = tabStorage.getItem(SELECTED);
        const ending = readHandoff();
        if (ending) {
          if (!publicScope && selected && selected !== ending.key) throw new Error('Invalid handoff');
          handoffPhase = ending; blocked = true; ready = true;
          error = 'Sign-out pending. Finish sign-out before the next player.';
          notify(); return;
        }
        if (selected) intent = admission.read(selected);
        if (intent && intent.publicScope !== publicScope) throw new Error('Attempt scope mismatch');
        if (intent?.receipt) await api.initialize();
        await refresh();
        ready = true;
      }); } catch { error = 'Recovery storage unavailable. Keep browser data and ask the host.'; }
      notify();
    },
    // Recovery choices contain no participant name or bearer secret.
    recoveries: () => admission.list().filter(row => row.publicScope === publicScope).map(row => ({ requestKey: row.requestKey, status: row.receipt?.status || 'pending' })),
    redeem(code, recoveryKey = '') {
      return exclusive(async () => {
        if (publicScope) {
          handoffPhase = readHandoff();
          const unresolved = admission.list().filter(row => row.submitted && row.requestKey !== (intent?.requestKey || recoveryKey));
          if (unresolved.length) throw new Error('Another attempt needs recovery before a new ticket.');
        }
        if (handoffPhase || active || result) throw new Error('Finish this attempt and sign out before another ticket.');
        if (!intent) {
          intent = recoveryKey ? admission.read(recoveryKey) : await admission.prepare(code);
          if (intent.publicScope !== publicScope) { intent = null; throw new Error('Attempt scope mismatch.'); }
          // Tab selection is durable before the first consuming request too.
          tabStorage.setItem(SELECTED, intent.requestKey);
          if (tabStorage.getItem(SELECTED) !== intent.requestKey) throw new Error('Recovery storage unavailable.');
        }
        // Always recheck on retry: storage refusal must never be bypassed.
        tabStorage.setItem(SELECTED, intent.requestKey);
        if (tabStorage.getItem(SELECTED) !== intent.requestKey) throw new Error('Recovery storage unavailable.');
        try { intent = await admission.redeem(intent.requestKey, code); }
        catch (failure) {
          if (failure.neverAdmitted && !admission.list().some(row => row.requestKey === intent.requestKey)) { remove(tabStorage, SELECTED); intent = null; }
          throw failure;
        }
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
    // Fresh server truth authorizes cleanup; persisted phases make it retriable.
    handoff() {
      return exclusive(async () => {
        if (publicScope) handoffPhase = readHandoff();
        function savePhase(phase) {
          const text = JSON.stringify(phase); endingStorage.setItem(HANDOFF, text);
          if (endingStorage.getItem(HANDOFF) !== text) throw new Error('Sign-out storage unavailable. Keep this page.');
          handoffPhase = phase;
        }
        if (!handoffPhase) {
          await refresh(true);
          if (!terminalReceipt || terminalReceipt.id !== intent?.receipt?.id)
            throw new Error('Resolve retained attempts with the host before changing players.');
          savePhase({ key: intent.requestKey, runId: terminalReceipt.id, nonce: intent.nonce, terminalReason: terminalReceipt.status, phase: 'cleanup' });
        }
        if (handoffPhase.phase === 'cleanup') {
          // Revalidate even on reload. A missing/expired capability is not proof.
          const admissionRecord = admission.list().find(row => row.requestKey === handoffPhase.key);
          if (publicScope && admissionRecord && (admissionRecord.nonce !== handoffPhase.nonce || admissionRecord.receipt?.id !== handoffPhase.runId)) throw new Error('Handoff does not match this admission. Keep browser data.');
          const receipt = await request('/api/official/session');
          const endingRun = handoffPhase.runId || (!publicScope && admission.read(handoffPhase.key).receipt?.id);
          if (receipt.id !== endingRun || !['complete', 'void', 'expired'].includes(receipt.status)) throw new Error('Terminal receipt unavailable. Keep browser data.');
          await api.flush();
          const retained = api.state().attempts.find(row => row.id === receipt.id);
          if (retained) {
            if (!['void', 'expired'].includes(receipt.status)) throw new Error('Completed turns must sync before clearing.');
            api.acknowledge(receipt.id);
          }
          if (admission.list().some(row => row.requestKey === handoffPhase.key)) await admission.acknowledge(handoffPhase.key);
          savePhase({ ...handoffPhase, phase: 'logout' });
        }
        for (const path of publicScope ? ['/api/official/logout'] : ['/api/official/logout', '/api/logout']) {
          try { await request(path, publicScope ? { nonce: handoffPhase.nonce } : {}); } catch (failure) { if (failure.status !== 401) throw failure; }
        }
        remove(tabStorage, SELECTED);
        remove(endingStorage, HANDOFF);
        handoffPhase = terminalReceipt = intent = result = board = null; active = null; blocked = true;
      });
    },
  };
}
