import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError, label } from './database.js';
import { createPublicPermits } from './public-permits.js';
import { createBudget } from './request-budget.js';
import { deviceClass } from './usage.js';
import { RULES, SPEED_RULES } from '../src/event-session.js';
import { createPublicEvents, HANOI_EVENT } from './public-events.js';

export { HANOI_EVENT };
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const age = 90 * 86400;
const CONTACT_RETENTION_MS = 30 * 86400_000;
const CONTACT_PURPOSE = 'result-and-booth-invitation-v1';

// Public score authority never shares the staff cookie, owner, board or outbox.
export function createPublicPlay({ database, body, json, cookies, cookie, clientAddress, startsEnabled, permitPolicy = null, now = Date.now }) {
  const { db } = database;
  db.exec(`CREATE TABLE IF NOT EXISTS public_players (
    token TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS public_contacts (
      run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, name TEXT NOT NULL, contact TEXT NOT NULL,
      channel TEXT NOT NULL, purpose TEXT NOT NULL, created_at INTEGER NOT NULL);
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
  const events = createPublicEvents({ database, now });
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
  function renewOwner(req, res, deadline) {
    owner(req); // Never renew an expired/replaced token or allocate a new owner.
    const value = cookies(req).cc_player, token = hash(value);
    const expires = Math.max(db.prepare('SELECT expires FROM public_players WHERE token=?').get(token).expires, deadline + 1000);
    db.prepare('UPDATE public_players SET expires=? WHERE token=?').run(expires, token);
    res.setHeader('Set-Cookie', cookie('cc_player', value, Math.ceil((expires - now()) / 1000)));
    return expires;
  }
  function activeEvent(req) {
    const event = events.forGeneration(generation(req)?.generation);
    return event && events.active(event) ? event : null;
  }
  function board(event = false) {
    const scope = event ? 'AND EXISTS (SELECT 1 FROM public_run_events e WHERE e.run_id=r.id AND e.event_id=?)' : '';
    const args = event ? [boardId, HANOI_EVENT.id] : [boardId];
    const runs = db.prepare(`SELECT id,name,total,RANK() OVER (ORDER BY total DESC) AS rank FROM runs r
      WHERE board_id=? AND status='complete' ${scope} ORDER BY total DESC,completed_at,id LIMIT 100`).all(...args);
    const { totalPlays } = db.prepare(`SELECT COUNT(*) AS totalPlays FROM runs r
      WHERE board_id=? AND status='complete' ${scope}`).get(...args);
    return { id: event ? HANOI_EVENT.id : boardId, name: event ? HANOI_EVENT.name : 'All plays', totalPlays, runs };
  }
  function result(id, player) {
    const run = database.getRun(id, player);
    if (run.boardId !== boardId) throw new ApiError(404, 'Public run not found.');
    const event = db.prepare('SELECT event_id FROM public_run_events WHERE run_id=?').get(id);
    if (event) {
      run.event = events.get(event.event_id);
      if (run.status === 'complete') run.eventRank = db.prepare(`SELECT COUNT(*)+1 AS rank FROM runs r JOIN public_run_events e ON r.id=e.run_id
        WHERE e.event_id=? AND r.status='complete' AND r.total>?`).get(event.event_id, run.total).rank;
    }
    return run;
  }
  function pruneContacts() {
    db.prepare('DELETE FROM public_contacts WHERE created_at<=?').run(now() - CONTACT_RETENTION_MS);
  }
  pruneContacts();
  const permits = createPublicPermits({ database, boardId, policy: permitPolicy, now, owner, generation, renewOwner,
    ownerExpires: req => db.prepare('SELECT expires FROM public_players WHERE token=?').get(hash(cookies(req).cc_player)).expires,
    activeEvent, startsEnabled });
  return {
    events,
    issuePermits: permits.issue,
    preparationStatus: permits.status,
    prepareOwner(req, res) {
      // Host-only explicit fresh preparation. Never replace expired ownership.
      if (cookies(req).cc_player) { owner(req); return { ownerValid: true }; }
      if (!startsEnabled || !permitPolicy) throw new ApiError(403, 'Prepared starts are disabled.', 'permits_disabled');
      const value = secret(), player = randomUUID();
      database.transaction(() => {
        db.prepare('INSERT INTO owners VALUES (?)').run(player);
        db.prepare('INSERT INTO public_players VALUES (?,?,?)').run(hash(value), player, now() + age * 1000);
      });
      res.setHeader('Set-Cookie', cookie('cc_player', value, age));
      return { ownerValid: true };
    },
    revoke(req) {
      const current = generation(req);
      if (current) database.transaction(() => {
        db.prepare('UPDATE public_station_generations SET revoked_at=? WHERE generation=?').run(now(), current.generation);
        db.prepare('DELETE FROM public_stations WHERE token=?').run(current.token);
      });
      return { enrolled: false };
    },
    exportContacts() {
      pruneContacts();
      return { purpose: CONTACT_PURPOSE, exportedAt: new Date(now()).toISOString(), contacts: db.prepare(`
        SELECT c.run_id AS runId,c.name,c.contact,c.channel,c.purpose,c.created_at AS submittedAt,
          r.total AS score,r.name AS nickname,r.completed_at AS completedAt,
          e.event_id AS eventId,(r.total>300) AS eligible
        FROM public_contacts c JOIN runs r ON r.id=c.run_id
        LEFT JOIN public_run_events e ON e.run_id=r.id ORDER BY c.created_at,c.run_id`).all() };
    },
    stationStatus(req, { publicView = false } = {}) {
      const current = generation(req);
      if (!current && publicView) return { enrolled: false, active: false, ended: false, event: null };
      const event = events.forGeneration(current?.generation) ?? events.defaultEvent();
      return { enrolled: Boolean(current), active: Boolean(current && events.active(event)), ended: events.ended(event), event };
    },
    enroll(req, res, input = {}) {
      if (!input || Array.isArray(input) || Object.keys(input).some(key => key !== 'eventId')) throw new ApiError(400, 'Choose an event for this computer.');
      // Empty legacy requests can only enroll their original Hanoi event.
      // A stale host tab must never select a newly created event implicitly.
      const event = events.get(input.eventId === undefined ? HANOI_EVENT.id : input.eventId);
      const eventEnd = Date.parse(event.endsAt);
      if (events.ended(event)) throw new ApiError(409, 'This event has finished. Public play is still open.');
      const value = secret();
      // One booth browser. Re-enrollment replaces the prior capability.
      database.transaction(() => {
        db.prepare('UPDATE public_station_generations SET revoked_at=? WHERE revoked_at IS NULL').run(now());
        db.exec('DELETE FROM public_stations');
        const generationId = randomUUID();
        db.prepare('INSERT INTO public_stations VALUES (?,?)').run(hash(value), eventEnd);
        db.prepare('INSERT INTO public_station_generations VALUES (?,?,?,NULL)').run(generationId, hash(value), eventEnd);
        db.prepare('INSERT INTO public_station_events VALUES (?,?)').run(generationId, event.id);
      });
      res.setHeader('Set-Cookie', cookie('cc_station', value, Math.max(0, Math.ceil((eventEnd - now()) / 1000))));
      return { enrolled: true, event };
    },
    prune() { pruneContacts(); budget.prune(); db.prepare('DELETE FROM public_players WHERE expires<=?').run(now()); db.prepare('DELETE FROM public_stations WHERE expires<=?').run(now()); },
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
        return json(res, 200, { role: 'public', board: board(), station: this.stationStatus(req, { publicView: true }) });
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
      const match = /^\/api\/play\/runs\/([a-f0-9-]{36})(?:\/(turns|abandon|name|contact))?$/.exec(path);
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
        const event = activeEvent(req);
        const run = database.createRun(player, input, boardId, id => {
          if (event) db.prepare('INSERT INTO public_run_events VALUES (?,?)').run(id, event.id);
          db.prepare('INSERT INTO run_usage (run_id, device_class, recorded_at) VALUES (?,?,?)').run(id, deviceClass(req.headers['user-agent']), new Date(now()).toISOString());
        });
        return json(res, 201, result(run.id, player));
      }
      if (match?.[2]) {
        const saved = result(match[1], player);
        if (match[2] === 'contact') {
          budget.take(`public-contact:${player}`, 20);
          if (saved.status !== 'complete') throw new ApiError(409, 'Wait for your completed score to save, then retry.');
          if (input.consent !== true) throw new ApiError(400, 'Confirm that CoderPush may contact you about your result and a booth invitation.');
          const name = label(input.name, 80);
          const contact = typeof input.contact === 'string' ? input.contact.trim() : '';
          const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
          const phone = /^\+?[0-9][0-9 ()-]*$/.test(contact) && contact.replace(/\D/g, '').length >= 8 && contact.replace(/\D/g, '').length <= 15;
          if (!contact || contact.length > 254 || /[\p{Cc}\p{Cf}]/u.test(contact) || !(email || phone)) throw new ApiError(400, 'Enter a valid email or phone number, including country code for phone.');
          pruneContacts();
          db.prepare(`INSERT INTO public_contacts VALUES (?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET
            name=excluded.name,contact=excluded.contact,channel=excluded.channel,purpose=excluded.purpose`)
            .run(saved.id, name, contact, email ? 'email' : 'phone', CONTACT_PURPOSE, now());
          return json(res, 200, { saved: true, eligible: saved.total > 300 });
        }
        if (match[2] === 'turns') database.record(match[1], player, input);
        else if (match[2] === 'name') database.rename(match[1], player, input);
        else database.abandon(match[1], player);
        return json(res, 200, result(match[1], player));
      }
      throw new ApiError(404, 'Route not found.');
    },
  };
}
