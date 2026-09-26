import { ApiError } from './database.js';
import { RULES } from '../src/event-session.js';

export const PLAYTEST_RETENTION_MS = 30 * 86400_000;
export const PLAYTEST_MAX_EVENTS = 100_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TYPES = new Set(['page_open', 'camera_start', 'camera_ready', 'camera_error', 'control_state', 'phase_change', 'rehearsal_start', 'hold_start', 'hold_cancelled', 'time_to_control', 'drop', 'run_start', 'turn_complete', 'run_complete', 'replay', 'feedback', 'client_error', 'performance', 'save_error']);
const ENUMS = {
  state: ['off', 'loading', 'ready', 'calibrating', 'tracking', 'clenching', 'clasping', 'dropping', 'accepted', 'lost', 'delayed', 'error', 'blocked'],
  phase: ['idle', 'aim', 'anticipate', 'descend', 'grip', 'lift', 'transfer', 'release', 'deliver', 'reveal', 'result'],
  trigger: ['gesture', 'timeout'],
  reason: ['renderer', 'runtime', 'unhandled', 'sync'],
  code: ['permission_denied', 'no_camera', 'camera_busy', 'camera_unavailable', 'tracking_error', 'tracking_init_error', 'worker_error', 'worker_timeout', 'camera_disconnected', 'capture_error', 'renderer_error', 'network_error', 'save_error', 'unknown'],
  category: ['controls', 'unexpected_drop', 'unfair_miss', 'stuck', 'other'],
  cause: ['opened', 'uncertain_reset', 'hand_lost', 'frame_gap', 'blocked', 'stale'],
  outcome: ['supported', 'near', 'slipped', 'crowded', 'blocked', 'bumped', 'platform', 'empty'],
  steering: ['relative', 'absolute'],
  controlMode: ['one-hand', 'two-hand'],
  startGate: ['off', 'loading', 'error', 'delayed', 'blocked', 'show_both', 'show_left', 'show_right', 'return_left', 'return_right', 'open_left', 'open_right', 'hold_left', 'hold_right', 'hold_both', 'ready'],
  prizeId: [null, ...Object.keys(RULES.points)],
};
const NUMBERS = { acquisitionMs: 604800000, durationMs: 604800000, captureAgeMs: 604800000, sampleMs: 604800000, averageFps: 1000, p95FrameMs: 60000, framesOver33ms: 10000000, frames: 10000000, turn: 3, score: 750, total: 750, holdMs: 900, resultHz: 240, visionP50Ms: 60000, visionP95Ms: 60000, captureToReceiptP50Ms: 60000, captureToReceiptP95Ms: 60000, rejectOverAge: 10000000, rejectOutOfOrder: 10000000, rejectHidden: 10000000, rejectInvalid: 10000000 };
const integerFields = new Set(['turn', 'score', 'total', 'holdMs', 'frames', 'framesOver33ms', 'rejectOverAge', 'rejectOutOfOrder', 'rejectHidden', 'rejectInvalid']);
const invalid = () => { throw new ApiError(400, 'Invalid playtest event.'); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
}
function eventData(value, type) {
  if (value === undefined) value = {};
  object(value, [...Object.keys(ENUMS), ...Object.keys(NUMBERS), 'comment']);
  const result = {};
  // Stable key order makes retries independent of the caller's property order.
  for (const key of Object.keys(value).sort()) {
    const field = value[key];
    if ((key === 'category' || key === 'comment') && type !== 'feedback') invalid();
    if ((key === 'controlMode' || key === 'startGate') && type !== 'control_state') invalid();
    if (Object.hasOwn(ENUMS, key)) { if (!ENUMS[key].includes(field)) invalid(); }
    else if (Object.hasOwn(NUMBERS, key)) {
      if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > NUMBERS[key] || (integerFields.has(key) && !Number.isInteger(field))) invalid();
    } else if (typeof field !== 'string' || field.length > 500 || /[\p{Cc}\p{Cf}]/u.test(field.replace(/[\n\r\t]/g, ''))) invalid();
    result[key] = key === 'comment' ? field.trim() : field;
  }
  if (type === 'feedback' && !result.category) invalid();
  if (type === 'hold_cancelled' && !result.cause) invalid();
  return result;
}
function batch(input) {
  object(input, ['sessionId', 'build', 'events']);
  if (typeof input.sessionId !== 'string' || !UUID.test(input.sessionId) || typeof input.build !== 'string' || !/^[a-f0-9]{7,12}$/.test(input.build) || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 20) invalid();
  return input.events.map(event => {
    object(event, ['id', 'type', 'elapsedMs', 'mode', 'runId', 'data']);
    if (typeof event.id !== 'string' || !UUID.test(event.id) || !TYPES.has(event.type) || !['practice', 'event'].includes(event.mode) || typeof event.elapsedMs !== 'number' || !Number.isFinite(event.elapsedMs) || event.elapsedMs < 0 || event.elapsedMs > 604800000 || (event.runId !== undefined && (typeof event.runId !== 'string' || !UUID.test(event.runId)))) invalid();
    const row = { id: event.id, sessionId: input.sessionId, build: input.build, mode: event.mode, type: event.type, elapsedMs: event.elapsedMs, runId: event.runId ?? null, data: eventData(event.data, event.type) };
    if (Buffer.byteLength(JSON.stringify(row)) > 4096) invalid();
    return row;
  });
}

// Independent observational data: no player names, ownership IDs or score writes.
export function createPlaytestStore(db, { now = Date.now, maxEvents = PLAYTEST_MAX_EVENTS, publicOnly = false } = {}) {
  const table = publicOnly ? 'public_playtest_events' : 'playtest_events';
  if (!Number.isInteger(maxEvents) || maxEvents < 20 || maxEvents > PLAYTEST_MAX_EVENTS) throw new Error('Invalid playtest capacity.');
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, build TEXT NOT NULL, mode TEXT NOT NULL,
    type TEXT NOT NULL, elapsed_ms REAL NOT NULL, run_id TEXT, data TEXT NOT NULL, received_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ${publicOnly ? 'public_playtest_received' : 'playtest_received'} ON ${table}(received_at);`);
  const insert = db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?)`);
  const lookup = db.prepare(`SELECT session_id,build,mode,type,elapsed_ms,run_id,data FROM ${table} WHERE id=?`);
  function prune() {
    db.prepare(`DELETE FROM ${table} WHERE received_at<?`).run(new Date(now() - PLAYTEST_RETENTION_MS).toISOString());
    // Keep the newest rows, including deterministic order for one batch's timestamp.
    db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} ORDER BY received_at DESC,rowid DESC LIMIT -1 OFFSET ?)`).run(maxEvents);
    // Public observations use only spare capacity; never evict legacy/staff rows.
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_playtest_events'").get()) {
      const staffCount = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='playtest_events'").get()
        ? db.prepare('SELECT COUNT(*) AS n FROM playtest_events').get().n : 0;
      db.prepare('DELETE FROM public_playtest_events WHERE rowid IN (SELECT rowid FROM public_playtest_events ORDER BY received_at DESC,rowid DESC LIMIT -1 OFFSET ?)')
        .run(Math.max(0, Math.min(20_000, PLAYTEST_MAX_EVENTS - staffCount)));
    }
  }
  function ingest(input) {
    const events = batch(input), timestamp = new Date(now()).toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      prune();
      for (const event of events) {
        const values = [event.sessionId, event.build, event.mode, event.type, event.elapsedMs, event.runId, JSON.stringify(event.data)];
        const previous = lookup.get(event.id);
        if (previous) {
          if (JSON.stringify(Object.values(previous)) !== JSON.stringify(values)) throw new ApiError(409, 'This playtest event already has different data.');
        } else insert.run(event.id, ...values, timestamp);
      }
      prune();
      db.exec('COMMIT');
      return { accepted: [...new Set(events.map(event => event.id))] };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const read = since => { prune(); return readPlaytestReport(db, since, { now, maxEvents, publicOnly }); };
  prune();
  return { ingest, read, prune };
}

export function readPlaytestReport(db, since, { now = Date.now, maxEvents = PLAYTEST_MAX_EVENTS, publicOnly = false } = {}) {
    const table = publicOnly ? 'public_playtest_events' : 'playtest_events';
    if (since === undefined || since === null) since = new Date(now() - 86400_000).toISOString();
    if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(since) || !Number.isFinite(Date.parse(since))) throw new ApiError(400, 'Use an ISO UTC timestamp for since.');
    since = new Date(Date.parse(since)).toISOString();
    since = new Date(Math.max(Date.parse(since), now() - PLAYTEST_RETENTION_MS)).toISOString();
    const counts = db.prepare(`SELECT COUNT(*) AS events,COUNT(DISTINCT session_id) AS sessions,MIN(received_at) AS firstReceivedAt,MAX(received_at) AS lastReceivedAt FROM ${table} WHERE received_at>=?`).get(since);
    // Older clients emitted runtime failures only as control states. Count affected
    // page sessions across both signals, without double-counting newer clients.
    const cameraFailure = "(type='camera_error' OR (type='control_state' AND json_extract(data,'$.state')='error'))";
    const cameraFailureCounts = `COUNT(DISTINCT CASE WHEN ${cameraFailure} THEN session_id END) AS cameraFailureSessions`;
    const cameraFailures = db.prepare(`SELECT ${cameraFailureCounts} FROM ${table} WHERE received_at>=?`).get(since);
    const grouped = column => Object.fromEntries(db.prepare(`SELECT ${column} AS key,COUNT(*) AS count FROM ${table} WHERE received_at>=? GROUP BY ${column}`).all(since).map(row => [row.key, row.count]));
    const feedback = Object.fromEntries(db.prepare(`SELECT json_extract(data,'$.category') AS category,COUNT(*) AS count FROM ${table} WHERE received_at>=? AND type='feedback' GROUP BY category`).all(since).map(row => [row.category, row.count]));
    const builds = db.prepare(`SELECT build,COUNT(*) AS events FROM ${table} WHERE received_at>=? GROUP BY build ORDER BY events DESC,build LIMIT 20`).all(since);
    const typeCounts = [...TYPES].map(type => `SUM(type='${type}') AS "${type}"`).join(',');
    const feedbackCounts = ENUMS.category.map(category => `SUM(type='feedback' AND json_extract(data,'$.category')='${category}') AS feedback_${category}`).join(',');
    const cohorts = db.prepare(`SELECT build,mode,COUNT(*) AS events,COUNT(DISTINCT session_id) AS sessions,
      ${typeCounts},${feedbackCounts},${cameraFailureCounts},AVG(CASE WHEN type='performance' THEN json_extract(data,'$.averageFps') END) AS averageFps,
      MAX(CASE WHEN type='performance' THEN json_extract(data,'$.p95FrameMs') END) AS worstP95FrameMs,
      AVG(CASE WHEN type='performance' THEN json_extract(data,'$.visionP50Ms') END) AS visionP50Ms,
      MAX(CASE WHEN type='performance' THEN json_extract(data,'$.visionP95Ms') END) AS worstVisionP95Ms,
      AVG(CASE WHEN type='performance' THEN json_extract(data,'$.captureToReceiptP50Ms') END) AS captureToReceiptP50Ms,
      MAX(CASE WHEN type='performance' THEN json_extract(data,'$.captureToReceiptP95Ms') END) AS worstCaptureToReceiptP95Ms,
      AVG(CASE WHEN type='time_to_control' THEN json_extract(data,'$.acquisitionMs') END) AS averageAcquisitionMs,
      MAX(CASE WHEN type='time_to_control' THEN json_extract(data,'$.acquisitionMs') END) AS worstAcquisitionMs
      FROM ${table} WHERE received_at>=? GROUP BY build,mode ORDER BY events DESC,build,mode LIMIT 40`).all(since).map(row => ({
        build: row.build, mode: row.mode, events: row.events, sessions: row.sessions,
        runStarts: row.run_start, runCompletes: row.run_complete,
        cameraFailureSessions: row.cameraFailureSessions,
        byType: Object.fromEntries([...TYPES].map(type => [type, row[type]])),
        feedback: Object.fromEntries(ENUMS.category.map(category => [category, row[`feedback_${category}`] || 0])),
        averageFps: row.averageFps, worstP95FrameMs: row.worstP95FrameMs,
        visionP50Ms: row.visionP50Ms, worstVisionP95Ms: row.worstVisionP95Ms,
        captureToReceiptP50Ms: row.captureToReceiptP50Ms, worstCaptureToReceiptP95Ms: row.worstCaptureToReceiptP95Ms,
        averageAcquisitionMs: row.averageAcquisitionMs, worstAcquisitionMs: row.worstAcquisitionMs,
      }));
    const cohortCount = db.prepare(`SELECT COUNT(DISTINCT build || ':' || mode) AS count FROM ${table} WHERE received_at>=?`).get(since).count;
    const rows = db.prepare(`SELECT * FROM ${table} WHERE received_at>=? ORDER BY received_at DESC,rowid DESC LIMIT 500`).all(since);
    const feedbackRows = db.prepare(`SELECT * FROM ${table} WHERE received_at>=? AND type='feedback' ORDER BY received_at DESC,rowid DESC LIMIT 100`).all(since);
    const project = row => ({ id: row.id, sessionId: row.session_id, build: row.build, mode: row.mode, type: row.type, elapsedMs: row.elapsed_ms, ...(row.run_id ? { runId: row.run_id } : {}), data: JSON.parse(row.data), receivedAt: row.received_at });
    return { since, generatedAt: new Date(now()).toISOString(), retentionDays: 30, maxEvents, truncated: counts.events > rows.length,
      feedbackEvents: feedbackRows.reverse().map(project), feedbackTruncated: Object.values(feedback).reduce((sum, count) => sum + count, 0) > feedbackRows.length,
      summary: { ...counts, ...cameraFailures, byType: grouped('type'), byMode: grouped('mode'), feedback, builds, cohorts, cohortsTruncated: cohortCount > cohorts.length },
      events: rows.reverse().map(project) };
  }
