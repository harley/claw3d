// Owns shared-pilot leaderboard sync: the session API lifecycle, the cached
// board, role, status line and refresh/rotation versioning. All DOM belongs to
// the caller via callbacks; local (non-shared) mode never constructs the API.
import { createSessionApi } from './session-api.js';

export function createSharedBoard({ enabled, getCompletedRun, onSaved, onBoard, onSyncState, onConnectError, publicPlay = false }) {
  let event = false, station = null;
  const readyStatus = () => publicPlay ? station?.active ? 'HANOI · 29 SEP · RANKED' : 'ALL PLAYS · RANKED' : 'SHARED STAFF LEADERBOARD';
  let board = null, role = 'staff', status = 'Connecting to shared leaderboard…';
  let refreshing = null, version = 0, rotating = false;
  const api = enabled ? createSessionApi({ publicPlay, onChange: state => {
    if (state.saved) { onSaved(state.saved); void refresh(); return; }
    status = state.error || (state.pending ? 'Score waiting to sync' : readyStatus());
    if (state.needsLogin) role = 'staff';
    onSyncState(state);
  } }) : null;
  async function refresh() {
    if (!api || rotating) return;
    if (refreshing) return refreshing;
    const current = version;
    refreshing = Promise.resolve().then(async () => {
      try {
        const next = await api.request(event ? '/board?event=hanoi-2026-09-29' : '/board');
        if (current !== version) return;
        board = next;
        const completed = getCompletedRun();
        if (completed) onSaved(await api.request(`/runs/${completed.id}`));
        if (!api.state().pending && !api.state().error) status = readyStatus();
        onBoard();
      } catch (error) { if (current === version) { status = error.status === 401 ? publicPlay ? 'SESSION EXPIRED · RELOAD' : 'SIGN IN TO SYNC' : 'LEADERBOARD OFFLINE · RETRYING'; onBoard(); } }
    }).finally(() => { refreshing = null; });
    return refreshing;
  }
  let initialization = null, initializationError = null, initializationFailures = 0, retryInitializationAt = 0;
  function initialize() {
    if (!initialization && Date.now() < retryInitializationAt) return Promise.reject(initializationError);
    if (!initialization) initialization = api.initialize().then(session => {
      initializationFailures = 0; retryInitializationAt = 0; initializationError = null;
      role = session.role; station = session.station;
      if (!version) board = session.board;
      status = readyStatus(); onBoard();
      return session;
    }).catch(error => {
      initialization = null; initializationError = error;
      const backoff = Math.min(60000, 2000 * 2 ** Math.min(++initializationFailures, 5));
      retryInitializationAt = Date.now() + Math.max(error.retryAfterMs || 0, backoff * (.8 + Math.random() * .4));
      status = 'SCORE SERVICE UNAVAILABLE'; onConnectError(error); throw error;
    });
    return initialization;
  }
  function connect() {
    void initialize().catch(() => {});
    const retry = () => {
      if (publicPlay) void initialize().then(() => { void api.flush(); void refresh(); }).catch(() => {});
      else { void api.flush(); void refresh(); }
    };
    setInterval(retry, 2000);
    window.addEventListener('online', retry);
  }
  // Rotation owns the version bumps so an in-flight refresh can never publish
  // a stale board over the new one.
  async function rotate(name) {
    rotating = true; version++;
    try { board = await api.request('/host/boards', { name }); onBoard(); return board; }
    finally { version++; rotating = false; }
  }
  async function loginStaff(code) { await api.request('/login', { code }); }
  async function loginHost(code) { await api.request('/host/login', { code }); role = 'host'; }
  return {
    connect, refresh, rotate, loginStaff, loginHost,
    async selectEvent(selected) { event = selected; version++; await refreshing; return refresh(); },
    get station() { return station; },
    start: async (name, key, controlMode) => { if (publicPlay) await initialize(); return api.start(name, key, controlMode); },
    queue: run => api.queue(run), abandon: run => api.abandon(run),
    state: () => api.state(), flush: () => api.flush(),
    get board() { return board; }, get role() { return role; }, get status() { return status; }, get rotating() { return rotating; },
  };
}
