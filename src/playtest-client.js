import { RULES } from './event-session.js';

const TYPES = new Set(['page_open', 'camera_start', 'camera_ready', 'camera_error', 'control_state', 'phase_change', 'rehearsal_start', 'hold_start', 'hold_cancelled', 'time_to_control', 'drop', 'run_start', 'turn_complete', 'run_complete', 'replay', 'feedback', 'client_error', 'performance', 'save_error']);
const PRIZES = new Set(Object.keys(RULES.points));
// 'clasping'/'dropping' stay in the SERVER enum for retained old-client rows;
// this client no longer emits them.
const STATES = new Set(['off', 'loading', 'ready', 'calibrating', 'tracking', 'clenching', 'accepted', 'lost', 'delayed', 'error', 'blocked']);
const PHASES = new Set(['idle', 'aim', 'anticipate', 'descend', 'grip', 'lift', 'transfer', 'release', 'deliver', 'reveal', 'result']);
const TRIGGERS = new Set(['gesture', 'timeout']);
const REASONS = new Set(['renderer', 'runtime', 'unhandled', 'sync']);
const CODES = new Set(['permission_denied', 'no_camera', 'camera_busy', 'camera_unavailable', 'tracking_error', 'tracking_init_error', 'worker_error', 'worker_timeout', 'camera_disconnected', 'capture_error', 'renderer_error', 'network_error', 'save_error', 'unknown']);
const CATEGORIES = new Set(['controls', 'unexpected_drop', 'unfair_miss', 'stuck', 'other']);
const CAUSES = new Set(['opened', 'uncertain_reset', 'hand_lost', 'frame_gap', 'blocked', 'stale']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEK = 604800000;
const METRICS = {
  acquisitionMs: WEEK, durationMs: WEEK, captureAgeMs: WEEK, averageFps: 1000,
  p95FrameMs: 60000, framesOver33ms: 10000000, frames: 10000000, sampleMs: WEEK,
  turn: 3, score: 600, total: 600,
  resultHz: 240, visionP50Ms: 60000, visionP95Ms: 60000,
  rejectOverAge: 10000000, rejectOutOfOrder: 10000000, rejectHidden: 10000000, rejectInvalid: 10000000,
};
const INTEGERS = new Set(['turn', 'score', 'total', 'frames', 'framesOver33ms', 'rejectOverAge', 'rejectOutOfOrder', 'rejectHidden', 'rejectInvalid']);

function cleanData(type, source) {
  const data = {};
  if (STATES.has(source.state)) data.state = source.state;
  if (CODES.has(source.code)) data.code = source.code;
  if (PHASES.has(source.phase)) data.phase = source.phase;
  if (TRIGGERS.has(source.trigger)) data.trigger = source.trigger;
  if (REASONS.has(source.reason)) data.reason = source.reason;
  if (source.prizeId === null || PRIZES.has(source.prizeId)) data.prizeId = source.prizeId;
  if (CAUSES.has(source.cause)) data.cause = source.cause;
  // A cause-less cancellation would 400 the whole batch server-side.
  if (type === 'hold_cancelled' && !data.cause) return null;
  for (const [key, max] of Object.entries(METRICS)) {
    if (typeof source[key] !== 'number' || !Number.isFinite(source[key])) continue;
    const value = Math.min(max, Math.max(0, source[key]));
    data[key] = INTEGERS.has(key) ? Math.round(value) : value;
  }
  if (type === 'feedback') {
    if (!CATEGORIES.has(source.category)) return null;
    data.category = source.category;
    if (typeof source.comment === 'string') data.comment = source.comment
      .replace(/[\p{Cc}\p{Cf}]/gu, character => /[\n\r\t]/.test(character) ? character : '').trim().slice(0, 500);
  }
  return data;
}

// Page-scoped diagnostics only. Never persist camera data or borrow score storage.
export function createPlaytestClient({ build, enabled = false, fetcher = globalThis.fetch, onStatus = () => {} }) {
  const sessionId = crypto.randomUUID(), started = performance.now();
  const active = enabled && /^[0-9a-f]{7,12}$/.test(build);
  const queue = [];
  let timer = null, request = null, flushing = null, disposed = false, failures = 0;
  const status = () => ({ enabled: Boolean(active && !disposed), pending: queue.length, retrying: failures > 0 });
  const notify = () => { try { onStatus(status()); } catch { /* Diagnostics must not interrupt play. */ } };
  const schedule = delay => {
    if (disposed || !active || timer || !queue.length) return;
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
    timer.unref?.();
  };
  const unsent = reason => ({ id: null, acknowledged: Promise.resolve({ sent: false, reason }) });

  function track(type, data = {}, context = {}) {
    if (!active || disposed) return unsent(disposed ? 'disposed' : 'disabled');
    if (!TYPES.has(type) || !data || typeof data !== 'object') return unsent('invalid_event');
    const cleaned = cleanData(type, data);
    if (!cleaned) return unsent('invalid_feedback');
    if (queue.length >= 100) {
      const noisy = queue.findIndex(entry => entry.event.type !== 'feedback');
      // Feedback already awaiting acknowledgement is never silently evicted.
      if (noisy < 0) return unsent('queue_full');
      queue.splice(noisy, 1)[0].resolve({ sent: false, reason: 'dropped' });
    }
    const event = {
      id: crypto.randomUUID(), type, elapsedMs: Math.min(WEEK, Math.max(0, Math.round(performance.now() - started))),
      mode: context.mode === 'event' ? 'event' : 'practice',
      ...(UUID.test(context.runId || '') ? { runId: context.runId.toLowerCase() } : {}), data: cleaned,
    };
    let resolve;
    const acknowledged = new Promise(done => { resolve = done; });
    queue.push({ event, resolve });
    notify();
    if (type === 'feedback') void flush();
    else schedule(1500);
    return { id: event.id, acknowledged };
  }

  function flush() {
    if (flushing) return flushing;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!active || disposed || !queue.length) return Promise.resolve({ ...status(), sent: 0 });
    // A single in-flight batch and stable IDs make uncertain responses retryable.
    const batch = [...queue.filter(entry => entry.event.type === 'feedback'), ...queue.filter(entry => entry.event.type !== 'feedback')].slice(0, 20);
    flushing = Promise.resolve().then(async () => {
      if (disposed) return { ...status(), sent: 0 };
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 8000);
      timeout.unref?.();
      let sent = 0;
      try {
        const response = await fetcher('/api/playtest', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, signal: request.signal,
          body: JSON.stringify({ sessionId, build, events: batch.map(entry => entry.event) }),
        });
        if ([400, 409, 413, 415].includes(response.status)) {
          for (const entry of batch) {
            const index = queue.indexOf(entry);
            if (index >= 0) { queue.splice(index, 1); entry.resolve({ sent: false, reason: 'rejected' }); }
          }
          failures = 0;
          return { ...status(), sent: 0 };
        }
        if (!response.ok) throw new Error('unavailable');
        const result = await response.json();
        if (!Array.isArray(result.accepted)) throw new Error('invalid_acknowledgement');
        const ids = new Set(result.accepted);
        for (const entry of batch) {
          if (!ids.has(entry.event.id)) continue;
          const index = queue.indexOf(entry);
          if (index >= 0) { queue.splice(index, 1); entry.resolve({ sent: true }); sent++; }
        }
        failures = sent ? 0 : failures + 1;
      } catch {
        failures++;
      } finally {
        clearTimeout(timeout); request = null;
      }
      return { ...status(), sent };
    }).finally(() => {
      flushing = null;
      notify();
      schedule(failures ? Math.min(30000, 1500 * 2 ** Math.min(failures, 5)) : 250);
    });
    return flushing;
  }

  function dispose() {
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = null; request?.abort();
    for (const entry of queue.splice(0)) entry.resolve({ sent: false, reason: 'disposed' });
    notify();
  }
  return { sessionId, track, flush, status, dispose };
}
