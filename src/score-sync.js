// One page-owned scheduler. The API owns cooldowns; no signal can shorten them.
// Score work always precedes optional leaderboard reads. No service-worker replay.
export function createScoreSync({ api, initialize, refresh, canRefresh = () => !document.hidden,
  events = globalThis.window, visibility = globalThis.document, now = Date.now }) {
  let started = false, disposed = false, timer = null, working = null;
  let initialized = !initialize, initializationBlocked = false, boardRequested = true, boardAt = 0;
  let readingBoard = false;
  function schedule() {
    clearTimeout(timer); timer = null;
    if (!started || disposed || working) return;
    const state = api.state();
    if (state.accessBlocked || initializationBlocked) return;
    let due = Infinity;
    if (!initialized || state.canFlush) due = now();
    if (refresh) due = Math.min(due, canRefresh() ? boardRequested ? now() : Math.max(boardAt, now()) : now() + 15000);
    if (Number.isFinite(due)) timer = setTimeout(() => { void sync(); }, Math.min(2147483647, Math.max(0, due - now(), state.retryAt - now())));
  }
  function sync() {
    if (disposed) return Promise.resolve();
    if (working) return working;
    clearTimeout(timer); timer = null;
    working = Promise.resolve().then(async () => {
      if (api.state().accessBlocked || now() < api.state().retryAt || initializationBlocked) return;
      if (!initialized) { await initialize(); initialized = true; }
      if (disposed) return;
      await api.flush();
      if (disposed || api.state().accessBlocked || api.state().canFlush || now() < api.state().retryAt) return;
      if (refresh && canRefresh() && (boardRequested || now() >= boardAt)) {
        boardRequested = false; readingBoard = true;
        try { await refresh(); }
        finally { readingBoard = false; boardAt = now() + 15000; }
      }
    }).catch(() => {
      // Non-transient initialization refusals require explicit access recovery.
      if (!initialized && api.state().retryAt <= now()) initializationBlocked = true;
    }).finally(() => { working = null; schedule(); });
    return working;
  }
  function wake(board = false) {
    if (board && !readingBoard) boardRequested = true;
    // The in-flight drain observes newly queued turns; scheduling on settlement
    // covers work appended after it passed that record, without a second loop.
    schedule();
  }
  const signal = () => wake(true);
  return {
    start() {
      if (started || disposed) return;
      started = true;
      events?.addEventListener('online', signal);
      visibility?.addEventListener('visibilitychange', signal);
      schedule();
    },
    wake,
    async refresh() { boardRequested = true; await sync(); },
    recovered() { initializationBlocked = false; wake(true); },
    dispose() {
      disposed = true; clearTimeout(timer); timer = null;
      events?.removeEventListener('online', signal);
      visibility?.removeEventListener('visibilitychange', signal);
    },
  };
}
