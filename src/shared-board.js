// Owns shared-pilot leaderboard sync: the session API lifecycle, the cached
// board, role, status line and refresh/rotation versioning. All DOM belongs to
// the caller via callbacks; local (non-shared) mode never constructs the API.
import { createSessionApi } from './session-api.js';
import { createScoreSync } from './score-sync.js';

export function createSharedBoard({ enabled, getCompletedRun, onSaved, onBoard, onSyncState, onConnectError, publicPlay = false, prepared = false, verifyAssets, journalFactory, isPlaying = () => false }) {
  let station = null;
  const readyStatus = () => prepared ? 'PREPARED STATION · LOCAL SCORES' : publicPlay ? 'ALL PLAYS · RANKED' : 'SHARED STAFF LEADERBOARD';
  let board = null, role = 'staff', status = 'Connecting to shared leaderboard…';
  let sync;
  let refreshing = null, version = 0, rotating = false, renaming = false;
  const api = enabled ? createSessionApi({ publicPlay, prepared, verifyAssets, journalFactory, onWork: () => sync?.wake(), onChange: state => {
    if (state.saved) { onSaved(state.saved); sync?.wake(true); return; }
    status = state.error || (state.pending ? 'Score waiting to sync' : readyStatus());
    if (state.needsLogin) role = 'staff';
    onSyncState(state);
  } }) : null;
  async function readBoard() {
    if (!api || rotating || renaming) return;
    if (refreshing) return refreshing;
    const current = version;
    refreshing = Promise.resolve().then(async () => {
      try {
        const next = await api.request('/board');
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
  let initialization = null;
  function initialize() {
    if (!initialization) initialization = api.initialize().then(session => {
      role = session.role; station = session.station;
      if (!version) board = session.board;
      status = readyStatus(); onBoard();
      sync?.recovered();
      return session;
    }).catch(error => {
      initialization = null;
      status = 'SCORE SERVICE UNAVAILABLE'; onConnectError(error); throw error;
    });
    return initialization;
  }
  if (api) sync = createScoreSync({ api, initialize, refresh: readBoard,
    canRefresh: () => !globalThis.document?.hidden && !isPlaying() });
  const refresh = () => sync?.refresh();
  const connect = () => sync?.start();
  // Rotation owns the version bumps so an in-flight refresh can never publish
  // a stale board over the new one.
  async function rotate(name) {
    rotating = true; version++;
    try { board = await api.request('/host/boards', { name }); onBoard(); return board; }
    finally { version++; rotating = false; }
  }
  async function loginStaff(code) { await api.request('/login', { code }); sync.recovered(); }
  async function loginHost(code) { await api.request('/host/login', { code }); role = 'host'; sync.recovered(); }
  return {
    connect, refresh, dispose: () => { sync?.dispose(); api?.dispose(); }, rotate, loginStaff, loginHost,
    async rename(id, name) {
      renaming = true;
      try {
        // Drain earlier reads and score writes before publishing a new name.
        await refreshing;
        await api.flush();
        const saved = await api.request(`/runs/${id}/name`, { name });
        onSaved(saved);
        if (board) board.runs = board.runs.map(run => run.id === id ? { ...run, name: saved.name } : run);
        onBoard();
        return saved;
      } finally { renaming = false; }
    },
    get station() { return station; },
    start: async (name, key, controlMode) => { if (publicPlay) await initialize(); return api.start(name, key, controlMode); },
    queue: run => api.queue(run), abandon: run => api.abandon(run),
    preparePermit: id => api.preparePermit(id),
    state: () => api.state(), flush: () => api.flush(),
    get board() { return board; }, get role() { return role; }, get status() { return status; }, get rotating() { return rotating; },
  };
}
