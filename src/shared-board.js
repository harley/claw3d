// Owns shared-pilot leaderboard sync: the session API lifecycle, the cached
// board, role, status line and refresh/rotation versioning. All DOM belongs to
// the caller via callbacks; local (non-shared) mode never constructs the API.
import { createSessionApi } from './session-api.js';

export function createSharedBoard({ enabled, getCompletedRun, onSaved, onBoard, onSyncState, onConnectError }) {
  let board = null, role = 'staff', status = 'Connecting to shared leaderboard…';
  let refreshing = null, version = 0, rotating = false;
  const api = enabled ? createSessionApi({ onChange: state => {
    if (state.saved) { onSaved(state.saved); void refresh(); return; }
    status = state.error || (state.pending ? 'Score waiting to sync' : 'SHARED STAFF LEADERBOARD');
    if (state.needsLogin) role = 'staff';
    onSyncState(state);
  } }) : null;
  async function refresh() {
    if (!api || rotating) return;
    if (refreshing) return refreshing;
    const current = version;
    refreshing = Promise.resolve().then(async () => {
      try {
        const next = await api.request('/board');
        if (current !== version) return;
        board = next;
        const completed = getCompletedRun();
        if (completed) onSaved(await api.request(`/runs/${completed.id}`));
        if (!api.state().pending && !api.state().error) status = 'SHARED STAFF LEADERBOARD';
        onBoard();
      } catch (error) { if (current === version) { status = error.status === 401 ? 'SIGN IN TO SYNC' : 'LEADERBOARD OFFLINE · RETRYING'; onBoard(); } }
    }).finally(() => { refreshing = null; });
    return refreshing;
  }
  function connect() {
    api.initialize().then(session => { role = session.role; if (!version) board = session.board; onBoard(); })
      .catch(error => { status = 'SHARED SERVICE UNAVAILABLE'; onConnectError(error); });
    setInterval(() => { void api.flush(); void refresh(); }, 2000);
    window.addEventListener('online', () => { void api.flush(); void refresh(); });
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
    start: (name, key, controlMode) => api.start(name, key, controlMode),
    queue: run => api.queue(run), abandon: run => api.abandon(run),
    state: () => api.state(), flush: () => api.flush(),
    get board() { return board; }, get role() { return role; }, get status() { return status; }, get rotating() { return rotating; },
  };
}
