import { createHash, createHmac } from 'node:crypto';
import { ApiError } from './database.js';
import { createOfficialEvents } from './official-events.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const UUID = '[a-f0-9-]{36}';
const RUN = new RegExp(`^/api/official/runs/(${UUID})(?:/(activate|interrupt|turns|best))?$`);
const EVENT = new RegExp(`^/api/host/events/(${UUID})/(state|participants|participant-lookup|tickets|export|board)$`);
const TICKET = new RegExp(`^/api/host/event-tickets/(${UUID})/reissue$`);
const RECOVER = new RegExp(`^/api/host/event-runs/(${UUID})/recover$`);
const SESSION_MS = 12 * 3600_000;
const fail = (status, message) => { throw new ApiError(status, message); };

// Every principal is constructed from a validated server session. This staged
// adapter deliberately requires staff login for redemption; public bootstrap,
// anonymous budgets and public assets are separate rollout work.
export function createOfficialHttp({ db, body, json, cookies, cookie, limit, admissionsEnabled }) {
  const events = createOfficialEvents(db);
  db.exec(`CREATE TABLE IF NOT EXISTS official_run_sessions (
    run_id TEXT PRIMARY KEY REFERENCES official_runs(id) ON DELETE CASCADE,
    token TEXT UNIQUE, generation INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS official_session_expiry ON official_run_sessions(expires);`);
  function principal(auth) { return { role: auth.role, ownerId: auth.owner_id }; }
  function host(auth) {
    if (!auth) fail(401, 'Staff sign-in required.');
    if (auth.role !== 'host') fail(403, 'Host access required.');
    return principal(auth);
  }
  function session(req) {
    const token = cookies(req).cc_official;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare(`SELECT s.run_id,r.owner_id,r.event_id FROM official_run_sessions s
      JOIN official_runs r ON r.id=s.run_id WHERE s.token=? AND s.expires>?`).get(hash(token), Date.now());
  }
  function requireSession(req, runId) {
    const s = session(req);
    if (!s) fail(401, 'Official attempt access required.');
    if (runId && s.run_id !== runId) fail(404, 'Run unavailable.');
    // Separate per-run budget from staff/host writes. Unauthenticated inputs
    // cannot allocate limiter keys; forwarding headers never select this key.
    limit(req, { owner_id: `official:${s.run_id}` });
    return s;
  }
  function issueSession(res, ownerToken, run) {
    const expires = run.acceptedAt + SESSION_MS;
    if (expires <= Date.now()) fail(401, 'Attempt access expired. Ask the host.');
    db.exec('BEGIN IMMEDIATE');
    let value;
    try {
      const generation = db.prepare('SELECT generation FROM official_run_sessions WHERE run_id=?').get(run.id)?.generation ?? 0;
      // cc_owner is an existing random 256-bit HttpOnly capability, not a
      // password. Determinism makes concurrent/lost-response retries return the
      // same cookie without storing plaintext or invalidating another response.
      value = createHmac('sha256', ownerToken).update(`official-v1:${run.id}:${generation}`).digest('hex');
      db.prepare(`INSERT INTO official_run_sessions (run_id,token,generation,expires) VALUES (?,?,?,?)
        ON CONFLICT(run_id) DO UPDATE SET token=excluded.token`).run(run.id, hash(value), generation, expires);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.setHeader('Set-Cookie', cookie('cc_official', value, Math.max(0, Math.floor((expires - Date.now()) / 1000)), '/api/official'));
  }
  function logout(req, res) {
    const s = session(req);
    if (s) db.prepare('UPDATE official_run_sessions SET token=NULL,generation=generation+1 WHERE run_id=?').run(s.run_id);
    res.setHeader('Set-Cookie', cookie('cc_official', '', 0, '/api/official'));
  }
  async function input(req, keys, optional = []) {
    const value = await body(req);
    if (Object.keys(value).some(k => !keys.includes(k))) fail(400, 'Unexpected request field.');
    if (keys.some(k => !optional.includes(k) && !Object.hasOwn(value, k))) fail(400, 'Missing request field.');
    for (const key of ['participantId', 'requestKey', 'nonce']) {
      if (Object.hasOwn(value, key) && (typeof value[key] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value[key])))
        fail(400, 'Invalid request identifier.');
    }
    return value;
  }
  function only(req, method) { if (req.method !== method) fail(405, 'Method not allowed.'); }
  function admit() { if (!admissionsEnabled) fail(503, 'Event admissions are paused.'); }
  return {
    pruneSessions() { db.prepare('DELETE FROM official_run_sessions WHERE expires<=?').run(Date.now()); },
    async handle(req, res, path, auth) {
      if (path === '/api/official/redeem') {
        only(req, 'POST');
        if (!auth || !['staff', 'host'].includes(auth.role)) fail(401, 'Staff sign-in required for event testing.');
        const ownerToken = cookies(req).cc_owner;
        if (typeof ownerToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ownerToken) || hash(ownerToken) !== auth.owner_id)
          fail(401, 'Sign in again before redeeming a ticket.');
        limit(req, auth);
        const data = await input(req, ['code', 'requestKey', 'nonce']);
        if (!admissionsEnabled && !db.prepare('SELECT 1 FROM official_runs WHERE owner_id=? AND request_key=?').get(auth.owner_id, data.requestKey)) admit();
        const run = events.redeem(principal(auth), data);
        issueSession(res, ownerToken, run);
        json(res, 200, run); return;
      }
      if (path === '/api/official/logout') {
        only(req, 'POST'); requireSession(req);
        await input(req, []); logout(req, res); json(res, 200, { ok: true }); return;
      }
      if (path === '/api/official/session' || path === '/api/official/board') {
        only(req, 'GET'); const s = requireSession(req);
        const p = { ownerId: s.owner_id };
        const data = path.endsWith('/board') ? events.board(p, s.event_id) : events.getRun(p, s.run_id);
        json(res, 200, data); return;
      }
      const run = RUN.exec(path);
      if (run) {
        only(req, !run[2] || run[2] === 'best' ? 'GET' : 'POST');
        const s = requireSession(req, run[1]), p = { ownerId: s.owner_id };
        let data;
        if (!run[2]) data = events.getRun(p, run[1]);
        else if (run[2] === 'best') data = events.personalBest(p, run[1]);
        else if (run[2] === 'activate') data = events.activate(p, { ...await input(req, ['nonce']), runId: run[1] });
        else if (run[2] === 'interrupt') { await input(req, []); data = events.interrupt(p, run[1]); }
        else data = events.record(p, { ...await input(req, ['turn', 'prizeId', 'remainingMs'], ['remainingMs']), runId: run[1] });
        json(res, 200, data); return;
      }
      // Even a valid official cookie has no authority on host routes.
      const p = host(auth);
      limit(req, auth);
      if (path === '/api/host/events') {
        only(req, 'POST'); json(res, 201, events.createEvent(p, await input(req, ['name', 'requestKey']))); return;
      }
      if (path === '/api/host/events/prune') {
        only(req, 'POST');
        const data = await input(req, ['confirm']);
        if (data.confirm !== 'REMOVE_EXPIRED_EVENT_RECORDS') fail(400, 'Confirm removal of expired event records.');
        json(res, 200, events.prune(p)); return;
      }
      const e = EVENT.exec(path), ticket = TICKET.exec(path), recovery = RECOVER.exec(path);
      if (e) {
        const eventId = e[1], operation = e[2];
        only(req, ['export', 'board'].includes(operation) ? 'GET' : 'POST');
        let data;
        if (operation === 'export') {
          data = events.exportEvent(p, eventId);
          res.setHeader('Content-Disposition', 'attachment; filename="cloud-claw-event.json"');
        } else if (operation === 'board') data = events.board(p, eventId);
        else if (operation === 'state') data = events.setEventState(p, { ...await input(req, ['state', 'requestKey']), eventId });
        else if (operation === 'participants') data = events.createParticipant(p, { ...await input(req, ['name', 'requestKey']), eventId });
        else if (operation === 'participant-lookup') data = events.findParticipant(p, { ...await input(req, ['code']), eventId });
        else { admit(); data = events.issueTicket(p, { ...await input(req, ['participantId', 'requestKey']), eventId }); }
        json(res, 200, data); return;
      }
      if (ticket) {
        only(req, 'POST'); admit(); json(res, 200, events.reissueTicket(p, { ...await input(req, ['requestKey']), ticketId: ticket[1] })); return;
      }
      if (recovery) {
        only(req, 'POST'); admit(); json(res, 200, events.recover(p, { ...await input(req, ['reason', 'requestKey']), runId: recovery[1] })); return;
      }
      fail(404, 'Route not found.');
    },
  };
}

export const isOfficialPath = path => /^\/api\/(official(?:\/|$)|host\/(?:events|event-tickets|event-runs)(?:\/|$))/.test(path);
