import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from './database.js';
import { createPublicPermits } from './public-permits.js';
import { createBudget } from './request-budget.js';
import { RULES, SPEED_RULES } from '../src/event-session.js';

export const HANOI_EVENT = { id: 'hanoi-2026-09-29', name: 'Hanoi · 29 Sep 2026', date: '2026-09-29', timeZone: 'Asia/Ho_Chi_Minh' };
const EVENT_END = Date.parse('2026-09-30T00:00:00+07:00');
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const age = 90 * 86400;
const dateInHanoi = new Intl.DateTimeFormat('en-CA', { timeZone: HANOI_EVENT.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

// Public score authority never shares the staff cookie, owner, board or outbox.
export function createPublicPlay({ database, body, json, cookies, cookie, clientAddress, startsEnabled, permitPolicy = null, now = Date.now }) {
  const { db } = database;
  db.exec(`CREATE TABLE IF NOT EXISTS public_players (
    token TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS public_stations (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS public_run_events (
      run_id TEXT PRIMARY KEY REFERENCES runs(id), event_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS public_station_generations (
      generation TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, revoked_at INTEGER);
    CREATE INDEX IF NOT EXISTS public_event_runs ON public_run_events(event_id,run_id);`);
  // Add history without replacing existing enrollment or touching old results.
  for (const row of db.prepare('SELECT * FROM public_stations').all()) {
    db.prepare('INSERT OR IGNORE INTO public_station_generations VALUES (?,?,?,NULL)').run(randomUUID(), row.token, row.expires);
  }
  let boardId = db.prepare("SELECT value FROM settings WHERE key='public-board-v1'").get()?.value;
  if (!boardId) {
    boardId = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO boards VALUES (?,?,?,?)').run(boardId, 'All plays', new Date(now()).toISOString(), JSON.stringify({ ...RULES, controlVersion: 'camera-fist-hold-550-v2' }));
      db.prepare("INSERT INTO settings VALUES ('public-board-v1',?)").run(boardId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const boardRules = JSON.parse(db.prepare('SELECT rules FROM boards WHERE id=?').get(boardId).rules);
  if (boardRules.version === SPEED_RULES.version) {
    db.prepare('UPDATE boards SET rules=? WHERE id=?').run(JSON.stringify({ ...boardRules, ...RULES }), boardId);
  }
  const budget = createBudget({ now });
  function owner(req) {
    const value = cookies(req).cc_player;
    const row = typeof value === 'string' && value.length <= 128 && db.prepare('SELECT owner_id FROM public_players WHERE token=? AND expires>?').get(hash(value), now());
    if (!row) throw new ApiError(401, 'Public session expired. Keep pending data; old ownership cannot be replaced for recovery.', 'owner_expired');
    return row.owner_id;
  }
  function generation(req) {
    const value = cookies(req).cc_station;
    return typeof value === 'string' && value.length <= 128 ? db.prepare('SELECT g.* FROM public_station_generations g JOIN public_stations s ON s.token=g.token WHERE g.token=? AND g.expires>? AND g.revoked_at IS NULL').get(hash(value), now()) : null;
  }
  function station(req) { return Boolean(generation(req)); }
  function renewOwner(req, res, deadline) {
    owner(req); // Never renew an expired/replaced token or allocate a new owner.
    const value = cookies(req).cc_player, token = hash(value);
    const expires = Math.max(db.prepare('SELECT expires FROM public_players WHERE token=?').get(token).expires, deadline + 1000);
    db.prepare('UPDATE public_players SET expires=? WHERE token=?').run(expires, token);
    res.setHeader('Set-Cookie', cookie('cc_player', value, Math.ceil((expires - now()) / 1000)));
    return expires;
  }
  function eventToday(req) { return station(req) && dateInHanoi.format(new Date(now())) === HANOI_EVENT.date; }
  function board(event = false) {
    const scope = event ? 'AND EXISTS (SELECT 1 FROM public_run_events e WHERE e.run_id=r.id AND e.event_id=?)' : '';
    const args = event ? [boardId, HANOI_EVENT.id] : [boardId];
    const runs = db.prepare(`SELECT id,name,total,RANK() OVER (ORDER BY total DESC) AS rank FROM runs r
      WHERE board_id=? AND status='complete' ${scope} ORDER BY total DESC,completed_at,id LIMIT 100`).all(...args);
    return { id: event ? HANOI_EVENT.id : boardId, name: event ? HANOI_EVENT.name : 'All plays', runs };
  }
  function result(id, player) {
    const run = database.getRun(id, player);
    if (run.boardId !== boardId) throw new ApiError(404, 'Public run not found.');
    const event = db.prepare('SELECT event_id FROM public_run_events WHERE run_id=?').get(id);
    if (event) {
      run.event = HANOI_EVENT;
      if (run.status === 'complete') run.eventRank = db.prepare(`SELECT COUNT(*)+1 AS rank FROM runs r JOIN public_run_events e ON r.id=e.run_id
        WHERE e.event_id=? AND r.status='complete' AND r.total>?`).get(event.event_id, run.total).rank;
    }
    return run;
  }
  const permits = createPublicPermits({ database, boardId, policy: permitPolicy, now, owner, generation, renewOwner,
    ownerExpires: req => db.prepare('SELECT expires FROM public_players WHERE token=?').get(hash(cookies(req).cc_player)).expires,
    eventToday, eventId: HANOI_EVENT.id, startsEnabled });
  return {
    issuePermits: permits.issue,
    revoke(req) {
      const current = generation(req);
      if (current) database.transaction(() => {
        db.prepare('UPDATE public_station_generations SET revoked_at=? WHERE generation=?').run(now(), current.generation);
        db.prepare('DELETE FROM public_stations WHERE token=?').run(current.token);
      });
      return { enrolled: false };
    },
    stationStatus(req) { return { enrolled: station(req), active: eventToday(req), ended: now() >= EVENT_END, event: HANOI_EVENT }; },
    enroll(req, res) {
      if (now() >= EVENT_END) throw new ApiError(409, 'The Hanoi event has finished. Public play is still open.');
      const value = secret();
      // One booth browser. Re-enrollment replaces the prior capability.
      database.transaction(() => {
        db.prepare('UPDATE public_station_generations SET revoked_at=? WHERE revoked_at IS NULL').run(now());
        db.exec('DELETE FROM public_stations');
        db.prepare('INSERT INTO public_stations VALUES (?,?)').run(hash(value), EVENT_END);
        db.prepare('INSERT INTO public_station_generations VALUES (?,?,?,NULL)').run(randomUUID(), hash(value), EVENT_END);
      });
      res.setHeader('Set-Cookie', cookie('cc_station', value, Math.max(0, Math.floor((EVENT_END - now()) / 1000))));
      return { enrolled: true, event: HANOI_EVENT };
    },
    prune() { budget.prune(); db.prepare('DELETE FROM public_players WHERE expires<=?').run(now()); db.prepare('DELETE FROM public_stations WHERE expires<=?').run(now()); },
    async handle(req, res, path) {
      const ip = clientAddress(req);
      budget.take(`public-read:${ip}`, 600);
      if (path === '/api/play/board' && req.method === 'GET') {
        const event = new URL(req.url, 'http://localhost').searchParams.get('event');
        if (event && event !== HANOI_EVENT.id) throw new ApiError(404, 'Event not found.');
        return json(res, 200, board(Boolean(event)));
      }
      if (path === '/api/play/session' && req.method === 'POST') {
        await body(req); budget.take(`public-session:${ip}`, 30);
        try { owner(req); } catch {
          if (!startsEnabled) throw new ApiError(503, 'New public plays are paused.', 'admission_paused');
          const value = secret(), player = randomUUID();
          db.prepare('INSERT INTO owners VALUES (?)').run(player);
          db.prepare('INSERT INTO public_players VALUES (?,?,?)').run(hash(value), player, now() + age * 1000);
          res.setHeader('Set-Cookie', cookie('cc_player', value, age));
        }
        return json(res, 200, { role: 'public', board: board(), station: this.stationStatus(req) });
      }
      const player = owner(req);
      const poolPath = /^\/api\/play\/permits\/([a-f0-9-]{36})$/.exec(path);
      if (poolPath && req.method === 'GET') return json(res, 200, permits.get(req, poolPath[1]));
      const intent = /^\/api\/play\/intents\/([a-f0-9-]{36})$/.exec(path);
      if (intent && req.method === 'GET') {
        const row = db.prepare('SELECT id FROM runs WHERE owner_id=? AND request_key=? AND board_id=?').get(player, intent[1], boardId);
        if (!row) throw new ApiError(404, 'No admission receipt for this owner and request. Keep the saved intent.');
        return json(res, 200, result(row.id, player));
      }
      const match = /^\/api\/play\/runs\/([a-f0-9-]{36})(?:\/(turns|abandon|name))?$/.exec(path);
      if (match && !match[2] && req.method === 'GET') return json(res, 200, result(match[1], player));
      if (req.method !== 'POST') throw new ApiError(404, 'Route not found.');
      budget.take(`public-write:${player}`, 120);
      const input = await body(req);
      if (path === '/api/play/permits/live' || path === '/api/play/permits/reconcile') {
        const run = permits.register(req, input, path.endsWith('/live') ? 'live' : 'deferred');
        return json(res, 200, result(run.id, player));
      }
      if (path === '/api/play/runs') {
        if (permits.reserved(player, input.requestKey)) throw new ApiError(409, 'Use the reserved admission protocol for this identity.', 'permit_conflict');
        const previous = db.prepare('SELECT id FROM runs WHERE owner_id=? AND request_key=?').get(player, typeof input.requestKey === 'string' ? input.requestKey : '');
        if (!previous && permits.preparedOwner(player)) throw new ApiError(409, 'Use a prepared slot for every station start.', 'permit_required');
        if (!previous && !startsEnabled) throw new ApiError(503, 'New public plays are paused.', 'admission_paused');
        if (!previous) budget.take(`public-start:${ip}`, 60);
        // Event classification shares the run transaction; crash/retry cannot
        // leave an event run unclassified or relabel a pre-midnight start.
        const event = eventToday(req);
        const run = database.createRun(player, input, boardId, id => {
          if (event) db.prepare('INSERT INTO public_run_events VALUES (?,?)').run(id, HANOI_EVENT.id);
        });
        return json(res, 201, result(run.id, player));
      }
      if (match?.[2]) {
        result(match[1], player);
        if (match[2] === 'turns') database.record(match[1], player, input);
        else if (match[2] === 'name') database.rename(match[1], player, input);
        else database.abandon(match[1], player);
        return json(res, 200, result(match[1], player));
      }
      throw new ApiError(404, 'Route not found.');
    },
  };
}
