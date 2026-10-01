import { randomUUID } from 'node:crypto';
import { ApiError, label } from './database.js';

// Retained compatibility identity, never a default for a newly created event.
export const HANOI_EVENT = Object.freeze({ id: 'hanoi-2026-09-29', name: 'Hanoi · 29 Sep 2026', date: '2026-09-29', timeZone: 'Asia/Ho_Chi_Minh' });
const LEGACY = { ...HANOI_EVENT, startsAt: '2026-09-28T17:00:00.000Z', endsAt: '2026-09-29T17:00:00.000Z', historical: true };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Public event attribution is separate from official ticket identities and rules.
// Schedules are immutable: retries and retained runs always resolve the same event.
export function createPublicEvents({ database, now }) {
  const { db, transaction } = database;
  db.exec(`CREATE TABLE IF NOT EXISTS public_events (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
    time_zone TEXT NOT NULL, request_key TEXT UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS public_station_events (
    generation TEXT PRIMARY KEY REFERENCES public_station_generations(generation), event_id TEXT NOT NULL REFERENCES public_events(id));`);
  db.prepare('INSERT OR IGNORE INTO public_events VALUES (?,?,?,?,?,NULL,?)')
    .run(LEGACY.id, LEGACY.name, LEGACY.startsAt, LEGACY.endsAt, LEGACY.timeZone, Date.parse(LEGACY.startsAt));
  // Old generations retain their original Hanoi association on every startup.
  db.prepare(`INSERT OR IGNORE INTO public_station_events
    SELECT generation,? FROM public_station_generations`).run(LEGACY.id);

  function get(id) {
    if (typeof id !== 'string' || id.length > 64) throw new ApiError(400, 'Invalid event identity.');
    if (id === LEGACY.id) return LEGACY;
    const row = db.prepare('SELECT * FROM public_events WHERE id=?').get(id);
    if (!row) throw new ApiError(404, 'Event not found.');
    return { id: row.id, name: row.name, startsAt: row.starts_at, endsAt: row.ends_at, timeZone: row.time_zone, historical: false };
  }
  const active = event => now() >= Date.parse(event.startsAt) && now() < Date.parse(event.endsAt);
  const ended = event => now() >= Date.parse(event.endsAt);
  function list() {
    return db.prepare(`SELECT p.id,COUNT(r.id) AS startedPlays,COALESCE(SUM(r.status='complete'),0) AS completedPlays
      FROM public_events p LEFT JOIN public_run_events e ON e.event_id=p.id LEFT JOIN runs r ON r.id=e.run_id
      GROUP BY p.id ORDER BY p.created_at DESC,p.id`).all().map(({ id, ...counts }) => {
      const event = get(id);
      return { ...event, state: ended(event) ? 'ended' : active(event) ? 'active' : 'scheduled', ...counts };
    });
  }
  function defaultEvent() {
    const row = db.prepare('SELECT id FROM public_events WHERE ends_at>? ORDER BY created_at DESC,id LIMIT 1').get(new Date(now()).toISOString());
    return get(row?.id ?? LEGACY.id);
  }
  function forGeneration(generation) {
    const row = generation && db.prepare('SELECT event_id FROM public_station_events WHERE generation=?').get(generation);
    return row ? get(row.event_id) : null;
  }
  function create(input) {
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['name', 'startsAt', 'endsAt', 'timeZone', 'requestKey'].includes(key)) || typeof input.requestKey !== 'string' || !UUID.test(input.requestKey)) throw new ApiError(400, 'Invalid event request.');
    const name = label(input.name, 60);
    const times = [input.startsAt, input.endsAt].map(value => {
      if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ApiError(400, 'Use valid UTC start and end times.');
      const canonical = new Date(value).toISOString();
      if (canonical !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) throw new ApiError(400, 'Use valid calendar dates.');
      return canonical;
    });
    const [startsAt, endsAt] = times;
    if (endsAt <= startsAt || Date.parse(endsAt) - Date.parse(startsAt) > 31 * 86400000) throw new ApiError(400, 'End must follow start, within 31 days.');
    const timeZone = input.timeZone;
    try {
      if (typeof timeZone !== 'string' || timeZone.length > 80) throw Error();
      new Intl.DateTimeFormat('en', { timeZone }).format();
    } catch { throw new ApiError(400, 'Use a valid time zone.'); }
    return transaction(() => {
      const previous = db.prepare('SELECT id FROM public_events WHERE request_key=?').get(input.requestKey);
      if (previous) {
        const event = get(previous.id);
        if (event.name !== name || event.startsAt !== startsAt || event.endsAt !== endsAt || event.timeZone !== timeZone) throw new ApiError(409, 'This request already created a different event. Retry the original details.');
        return event;
      }
      if (Date.parse(endsAt) <= now()) throw new ApiError(400, 'Choose an event that has not ended.');
      const id = randomUUID();
      db.prepare('INSERT INTO public_events VALUES (?,?,?,?,?,?,?)').run(id, name, startsAt, endsAt, timeZone, input.requestKey, now());
      return get(id);
    });
  }
  function exportEvent(id) {
    const event = get(id);
    const runs = db.prepare(`SELECT r.id,r.name,r.status,r.total,r.started_at AS startedAt,r.completed_at AS completedAt,
      r.rules,u.device_class AS deviceClass FROM public_run_events e JOIN runs r ON r.id=e.run_id
      LEFT JOIN run_usage u ON u.run_id=r.id WHERE e.event_id=? ORDER BY r.started_at,r.id`).all(id);
    const turns = db.prepare(`SELECT t.run_id AS runId,t.turn,t.prize_id AS prizeId,t.score,t.remaining_ms AS remainingMs
      FROM turns t JOIN public_run_events e ON e.run_id=t.run_id WHERE e.event_id=? ORDER BY t.run_id,t.turn`).all(id);
    const byRun = new Map();
    for (const { runId, ...turn } of turns) { if (!byRun.has(runId)) byRun.set(runId, []); byRun.get(runId).push(turn); }
    return { event, exportedAt: new Date(now()).toISOString(),
      note: 'Recorded browser associations only; this is not a unique visitor or complete attendance count. Deferred offline starts are not event-associated.',
      startedPlays: runs.length, completedPlays: runs.filter(run => run.status === 'complete').length,
      runs: runs.map(({ rules, ...run }) => ({ ...run, rules: JSON.parse(rules), turns: byRun.get(run.id) ?? [] })) };
  }
  return { get, active, ended, list, defaultEvent, forGeneration, create, exportEvent };
}
