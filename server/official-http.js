import { createHash, createHmac } from 'node:crypto';
import { ApiError } from './database.js';
import { createOfficialEvents } from './official-events.js';
import { createBudget } from './request-budget.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const PUBLIC_RUN = new RegExp(`^/api/official/public/runs/(${UUID})(?:/(session|board|activate|interrupt|turns|best|logout))?$`);
const PUBLIC_COOKIE = new RegExp(`^cc_official_(${UUID})$`);
const RUN = new RegExp(`^/api/official/runs/(${UUID})(?:/(activate|interrupt|turns|best))?$`);
const EVENT = new RegExp(`^/api/host/events/(${UUID})/(state|participants|participant-lookup|tickets|export|board)$`);
const TICKET = new RegExp(`^/api/host/event-tickets/(${UUID})/reissue$`);
const RECOVER = new RegExp(`^/api/host/event-runs/(${UUID})/recover$`);
const SESSION_MS = 12 * 3600_000;
const fail = (status, message) => { throw new ApiError(status, message); };

// Staff and ticket-scoped public capabilities share the same event operations.
export function createOfficialHttp({ db, body, json, cookies, cookie, limit, admissionsEnabled, publicEnabled = false, clientAddress }) {
  const admissionBudget = createBudget();
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
  function session(req, publicRun) {
    const token = cookies(req)[publicRun ? `cc_official_${publicRun}` : 'cc_official'];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const result = db.prepare(`SELECT s.run_id,r.owner_id,r.event_id,r.request_key,r.nonce_hash FROM official_run_sessions s
      JOIN official_runs r ON r.id=s.run_id WHERE s.token=? AND s.expires>?`).get(hash(token), Date.now());
    return result && (!publicRun || (result.run_id === publicRun && result.owner_id.startsWith('public:'))) ? result : null;
  }
  function requireSession(req, runId, publicScope = false) {
    const s = session(req, publicScope ? runId : undefined);
    if (!s) fail(401, 'Official attempt access required.');
    if (runId && s.run_id !== runId) fail(404, 'Run unavailable.');
    // Separate per-run budget from staff/host writes. Unauthenticated inputs
    // cannot allocate limiter keys; forwarding headers never select this key.
    limit(req, { owner_id: `official:${s.run_id}` });
    return s;
  }
  function issueSession(res, ownerToken, run, publicScope = false) {
    const expires = run.acceptedAt + SESSION_MS;
    if (expires <= Date.now()) fail(401, 'Attempt access expired. Ask the host.');
    db.exec('BEGIN IMMEDIATE');
    let value;
    try {
      const previous = db.prepare('SELECT generation,token FROM official_run_sessions WHERE run_id=?').get(run.id);
      if (publicScope && previous && (previous.generation > 0 || !previous.token)) fail(409, 'This attempt has already been handed off.');
      const generation = previous?.generation ?? 0;
      // cc_owner is an existing random 256-bit HttpOnly capability, not a
      // password. Determinism makes concurrent/lost-response retries return the
      // same cookie without storing plaintext or invalidating another response.
      value = createHmac('sha256', ownerToken).update(`official-v1:${run.id}:${generation}`).digest('hex');
      db.prepare(`INSERT INTO official_run_sessions (run_id,token,generation,expires) VALUES (?,?,?,?)
        ON CONFLICT(run_id) DO UPDATE SET token=excluded.token`).run(run.id, hash(value), generation, expires);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.setHeader('Set-Cookie', cookie(publicScope ? `cc_official_${run.id}` : 'cc_official', value, Math.max(0, Math.floor((expires - Date.now()) / 1000)), '/api/official'));
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
    pruneSessions() { admissionBudget.prune(); db.prepare('DELETE FROM official_run_sessions WHERE expires<=?').run(Date.now()); },
    async handle(req, res, path, auth) {
      const publicScope = path.startsWith('/api/official/public/');
      if (publicScope && !publicEnabled) fail(404, 'Public official play is not enabled.');
      if (path === '/api/official/public/redeem') {
        only(req, 'POST');
        admissionBudget.take(`ip:${clientAddress(req)}`, 60); admissionBudget.take('global', 600);
        const data = await input(req, ['code', 'requestKey', 'nonce']);
        if (typeof data.code !== 'string' || !/^T-[a-f0-9]{32}$/i.test(data.code)) fail(400, 'Invalid ticket code.');
        const secret = createHmac('sha256', data.code.toUpperCase()).update(`public-admission-v1:${data.nonce}`).digest('hex');
        const ownerId = `public:${hash(secret)}`;
        const previous = db.prepare('SELECT id FROM official_runs WHERE owner_id=? AND request_key=?').get(ownerId, data.requestKey);
        // HTTP already bounds header size. Bound parsing and database reads here
        // too; only strict run names and valid tokens can select persisted rows.
        if (Buffer.byteLength(req.headers.cookie || '') > 8192) fail(431, 'Cookie header too large.');
        const names = Object.keys(cookies(req)).filter(name => PUBLIC_COOKIE.test(name));
        if (names.length > 32) fail(431, 'Too many attempt cookies.');
        const attached = [session(req), ...names.map(name => session(req, PUBLIC_COOKIE.exec(name)[1]))].filter(Boolean);
        if (attached.some(s => s.owner_id !== ownerId || s.request_key !== data.requestKey || s.nonce_hash !== hash(data.nonce)))
          fail(409, 'Finish the current attempt before using another ticket.');
        if (!admissionsEnabled && !previous) admit();
        let run;
        try { run = events.redeem({ ownerId }, data); }
        catch (error) {
          // Explicit server proof permits discarding only this never-admitted
          // intent. A timeout or any error without this proof retains it.
          if ([400, 404, 409, 410].includes(error.status) && !db.prepare('SELECT 1 FROM official_runs WHERE owner_id=? AND request_key=?').get(ownerId, data.requestKey)) {
            json(res, error.status, { error: 'Ticket unavailable. Ask the host for a ticket.', neverAdmitted: true, requestKey: data.requestKey }); return;
          }
          throw error;
        }
        issueSession(res, secret, run, true); json(res, 200, run); return;
      }
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
      const run = publicScope ? PUBLIC_RUN.exec(path) : RUN.exec(path);
      if (run) {
        const operation = run[2];
        only(req, !operation || ['best', 'session', 'board'].includes(operation) ? 'GET' : 'POST');
        if (operation === 'logout') {
          // A missing cookie is not retirement proof. Only this read-only,
          // nonce-bound acknowledgement can recover a committed lost response.
          admissionBudget.take(`logout-ip:${clientAddress(req)}`, 60); admissionBudget.take('logout-global', 600);
          const value = await input(req, ['nonce']);
          const retired = db.prepare(`SELECT s.token,s.generation,r.nonce_hash,r.owner_id FROM official_run_sessions s
            JOIN official_runs r ON r.id=s.run_id WHERE s.run_id=?`).get(run[1]);
          const acknowledged = retired?.owner_id.startsWith('public:') && retired.nonce_hash === hash(value.nonce) && retired.token === null && retired.generation > 0;
          if (!acknowledged) {
            const s = requireSession(req, run[1], true);
            if (hash(value.nonce) !== s.nonce_hash) fail(409, 'Attempt belongs to another page.');
            const current = events.getRun({ ownerId: s.owner_id }, run[1]);
            if (!['complete', 'void', 'expired'].includes(current.status)) fail(409, 'Finish this attempt before changing players.');
            db.prepare('UPDATE official_run_sessions SET token=NULL,generation=generation+1 WHERE run_id=?').run(run[1]);
          }
          res.setHeader('Set-Cookie', cookie(`cc_official_${run[1]}`, '', 0, '/api/official'));
          json(res, 200, { retired: true, runId: run[1] }); return;
        }
        const s = requireSession(req, run[1], publicScope), p = { ownerId: s.owner_id };
        let data;
        if (!operation || operation === 'session') data = events.getRun(p, run[1]);
        else if (operation === 'board') data = events.board(p, s.event_id);
        else if (operation === 'best') data = events.personalBest(p, run[1]);
        else if (operation === 'activate') data = events.activate(p, { ...await input(req, ['nonce']), runId: run[1] });
        else if (operation === 'interrupt') { await input(req, []); data = events.interrupt(p, run[1]); }
        else data = events.record(p, { ...await input(req, ['turn', 'prizeId', 'remainingMs'], ['remainingMs']), runId: run[1] });
        json(res, 200, data); return;
      }
      if (publicScope) fail(404, 'Route not found.');
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
