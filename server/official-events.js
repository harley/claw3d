import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError, label } from './database.js';
import { RULES, scoreTurn, turnContext } from '../src/event-session.js';

export const EVENT_RETENTION_MS = 30 * 86400_000;
export const TICKET_LIFETIME_MS = 86400_000;
export const CLOSE_GRACE_MS = 10 * 60_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (status, message) => { throw new ApiError(status, message); };
const secret = type => `${type}-${randomBytes(16).toString('hex').toUpperCase()}`;
function secretHash(value, type) {
  if (typeof value !== 'string' || !new RegExp(`^${type}-[A-Fa-f0-9]{32}$`).test(value)) fail(400, 'Invalid code.');
  return hash(value.toUpperCase());
}

// Domain boundary only: callers supply a server-authenticated principal, never
// a role/owner from JSON. No HTTP route or production startup imports this yet.
// Separate tables keep legacy ranking, outboxes and rollback readers unchanged.
export function createOfficialEvents(db, { now = Date.now } = {}) {
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('Official events require foreign keys.');
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS official_schema (version INTEGER PRIMARY KEY CHECK(version>0))');
    const versions = db.prepare('SELECT version FROM official_schema').all();
    if (versions.some(row => row.version !== 1)) throw new Error('Unsupported official event schema.');
    db.exec(`
      CREATE TABLE IF NOT EXISTS official_events (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('draft','open','closed')),
        rules TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER, retain_until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS official_participants (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES official_events(id) ON DELETE CASCADE,
        name TEXT NOT NULL, qr_hash TEXT NOT NULL UNIQUE, UNIQUE(event_id,id));
      CREATE TABLE IF NOT EXISTS official_tickets (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES official_events(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK(state IN ('issued','redeemed','revoked')),
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        FOREIGN KEY(event_id,participant_id) REFERENCES official_participants(event_id,id), UNIQUE(event_id,participant_id,id));
      CREATE TABLE IF NOT EXISTS official_runs (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES official_events(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL, ticket_id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL, request_key TEXT NOT NULL, nonce_hash TEXT NOT NULL,
        rules TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('accepted','active','interrupted','complete','void')),
        accepted_at INTEGER NOT NULL, completed_at INTEGER, total INTEGER,
        FOREIGN KEY(event_id,participant_id,ticket_id) REFERENCES official_tickets(event_id,participant_id,id),
        UNIQUE(owner_id,request_key));
      CREATE TABLE IF NOT EXISTS official_turns (
        run_id TEXT NOT NULL REFERENCES official_runs(id) ON DELETE CASCADE,
        turn INTEGER NOT NULL CHECK(turn BETWEEN 1 AND 3), prize_id TEXT, remaining_ms INTEGER NOT NULL,
        score INTEGER NOT NULL, PRIMARY KEY(run_id,turn));
      CREATE TABLE IF NOT EXISTS official_actions (
        host_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        event_id TEXT NOT NULL REFERENCES official_events(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, target_id TEXT, result TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(host_id,request_key));
      CREATE INDEX IF NOT EXISTS official_best ON official_runs(event_id,state,participant_id,total DESC);
      CREATE INDEX IF NOT EXISTS official_owners ON official_runs(owner_id,event_id);
      CREATE INDEX IF NOT EXISTS official_retention ON official_events(retain_until);
      INSERT OR IGNORE INTO official_schema VALUES (1);
    `);
  });
  function host(auth) {
    if (auth?.role !== 'host' || typeof auth.ownerId !== 'string' || !auth.ownerId) fail(403, 'Host access required.');
    return auth.ownerId;
  }
  function owner(auth) {
    if (typeof auth?.ownerId !== 'string' || !auth.ownerId) fail(401, 'Run access required.');
    return auth.ownerId;
  }
  function event(id) {
    const row = db.prepare('SELECT * FROM official_events WHERE id=?').get(id);
    if (!row || row.retain_until <= now()) fail(404, 'Event unavailable.');
    return row;
  }
  function openEvent(id) {
    const row = event(id);
    if (row.state !== 'open') fail(409, 'Event is not open.');
    return row;
  }
  function participant(eventId, id) {
    const row = db.prepare('SELECT * FROM official_participants WHERE event_id=? AND id=?').get(eventId, id);
    if (!row) fail(404, 'Participant unavailable.');
    return row;
  }
  function action(auth, requestKey, kind, payload, fn) {
    const hostId = host(auth);
    if (!uuid(requestKey)) fail(400, 'Invalid request key.');
    const fingerprint = hash(JSON.stringify([kind, payload]));
    return transaction(() => {
      const previous = db.prepare('SELECT * FROM official_actions WHERE host_id=? AND request_key=?').get(hostId, requestKey);
      if (previous) {
        event(previous.event_id);
        if (previous.fingerprint !== fingerprint) fail(409, 'Request key already used.');
        // Bearer codes are returned once; response-loss recovery explicitly
        // revokes/reissues the unused ticket, rather than minting on retry.
        return { ...JSON.parse(previous.result), replayed: true };
      }
      const { result, eventId, targetId = null, code } = fn();
      db.prepare('INSERT INTO official_actions (host_id,request_key,fingerprint,event_id,kind,target_id,result,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(hostId, requestKey, fingerprint, eventId, kind, targetId, JSON.stringify(result), now());
      return { ...result, ...(code ? { code } : {}), replayed: false };
    });
  }
  function ticket(eventId, participantId) {
    const e = openEvent(eventId); participant(eventId, participantId);
    const id = randomUUID(), code = secret('T'), expiresAt = Math.min(now() + TICKET_LIFETIME_MS, e.retain_until);
    db.prepare('INSERT INTO official_tickets (id,event_id,participant_id,code_hash,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, eventId, participantId, hash(code), 'issued', now(), expiresAt);
    return { result: { ticketId: id, participantId, eventId, expiresAt }, code, eventId, targetId: id };
  }
  function runRow(id) {
    const row = db.prepare('SELECT * FROM official_runs WHERE id=?').get(id);
    if (!row) fail(404, 'Run unavailable.');
    event(row.event_id);
    return row;
  }
  function owned(auth, id) {
    const ownerId = owner(auth), row = runRow(id);
    if (row.owner_id !== ownerId) fail(404, 'Run unavailable.');
    return row;
  }
  function status(row) {
    const e = event(row.event_id);
    if (!['complete', 'void'].includes(row.state) && e.closed_at !== null && now() >= e.closed_at + CLOSE_GRACE_MS) return 'expired';
    return row.state;
  }
  function turns(id) {
    return db.prepare('SELECT turn,prize_id AS prizeId,remaining_ms AS remainingMs,score FROM official_turns WHERE run_id=? ORDER BY turn').all(id);
  }
  function result(row) {
    return { id: row.id, eventId: row.event_id, name: participant(row.event_id, row.participant_id).name,
      rules: JSON.parse(row.rules), status: status(row), turns: turns(row.id), total: row.total,
      acceptedAt: row.accepted_at, completedAt: row.completed_at };
  }
  const bestQuery = `WITH chosen AS (
    SELECT r.*, ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY total DESC,completed_at,id) AS choice
    FROM official_runs r WHERE event_id=? AND state='complete'
  ), ranked AS (
    SELECT participant_id,id,total,RANK() OVER (ORDER BY total DESC) AS rank FROM chosen WHERE choice=1
  ) SELECT p.name,r.total,r.rank,r.participant_id,r.id FROM ranked r JOIN official_participants p ON p.id=r.participant_id`;
  function requireBoardAccess(auth, eventId) {
    event(eventId);
    if (auth?.role === 'host') { host(auth); return; }
    if (!db.prepare('SELECT 1 FROM official_runs WHERE owner_id=? AND event_id=? LIMIT 1').get(owner(auth), eventId)) fail(403, 'Event admission required.');
  }
  return {
    createEvent(auth, { name, requestKey }) {
      name = label(name, 60);
      return action(auth, requestKey, 'create_event', { name }, () => {
        const id = randomUUID(), createdAt = now();
        const rules = { ...RULES, controlMode: 'one-hand', controlVersion: 'camera-fist-hold-550-v2' };
        db.prepare('INSERT INTO official_events (id,name,state,rules,created_at,closed_at,retain_until) VALUES (?,?,?,?,?,?,?)')
          .run(id, name, 'draft', JSON.stringify(rules), createdAt, null, createdAt + EVENT_RETENTION_MS);
        return { result: { eventId: id }, eventId: id };
      });
    },
    setEventState(auth, { eventId, state, requestKey }) {
      if (!['open', 'closed'].includes(state)) fail(400, 'Invalid event state.');
      return action(auth, requestKey, 'event_state', { eventId, state }, () => {
        const e = event(eventId);
        if (e.state === 'closed' && state !== 'closed') fail(409, 'Closed events cannot reopen.');
        // Repeated close never extends the grace period.
        db.prepare('UPDATE official_events SET state=?,closed_at=? WHERE id=?')
          .run(state, state === 'closed' ? e.closed_at ?? now() : null, eventId);
        return { result: { eventId, state }, eventId };
      });
    },
    createParticipant(auth, { eventId, name, requestKey }) {
      name = label(name);
      return action(auth, requestKey, 'participant', { eventId, name }, () => {
        openEvent(eventId);
        const id = randomUUID(), code = secret('P');
        db.prepare('INSERT INTO official_participants (id,event_id,name,qr_hash) VALUES (?,?,?,?)').run(id, eventId, name, hash(code));
        return { result: { participantId: id, eventId, name }, code, eventId, targetId: id };
      });
    },
    findParticipant(auth, { eventId, code }) {
      host(auth); event(eventId);
      const p = db.prepare('SELECT id,name FROM official_participants WHERE event_id=? AND qr_hash=?').get(eventId, secretHash(code, 'P'));
      if (!p) fail(404, 'Participant unavailable.');
      return { participantId: p.id, name: p.name };
    },
    issueTicket(auth, { eventId, participantId, requestKey }) {
      return action(auth, requestKey, 'issue_ticket', { eventId, participantId }, () => ticket(eventId, participantId));
    },
    reissueTicket(auth, { ticketId, requestKey }) {
      return action(auth, requestKey, 'reissue_ticket', { ticketId }, () => {
        const previous = db.prepare('SELECT * FROM official_tickets WHERE id=?').get(ticketId);
        if (!previous) fail(404, 'Ticket unavailable.');
        openEvent(previous.event_id);
        if (previous.state !== 'issued') fail(409, 'Ticket is already used or revoked.');
        db.prepare("UPDATE official_tickets SET state='revoked' WHERE id=?").run(ticketId);
        return ticket(previous.event_id, previous.participant_id);
      });
    },
    redeem(auth, { code, requestKey, nonce }) {
      const ownerId = owner(auth), codeHash = secretHash(code, 'T');
      if (!uuid(requestKey) || !uuid(nonce)) fail(400, 'Invalid admission request.');
      return transaction(() => {
        const previous = db.prepare('SELECT * FROM official_runs WHERE owner_id=? AND request_key=?').get(ownerId, requestKey);
        const t = db.prepare('SELECT * FROM official_tickets WHERE code_hash=?').get(codeHash);
        if (previous) {
          if (previous.ticket_id !== t?.id || previous.nonce_hash !== hash(nonce)) fail(409, 'Request key already used.');
          return result(previous);
        }
        if (!t || t.state !== 'issued' || t.expires_at <= now()) fail(409, 'Ticket unavailable.');
        const e = openEvent(t.event_id), id = randomUUID();
        db.prepare(`INSERT INTO official_runs
          (id,event_id,participant_id,ticket_id,owner_id,request_key,nonce_hash,rules,state,accepted_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, e.id, t.participant_id, t.id, ownerId, requestKey, hash(nonce), e.rules, 'accepted', now());
        db.prepare("UPDATE official_tickets SET state='redeemed' WHERE id=? AND state='issued'").run(t.id);
        return result(runRow(id));
      });
    },
    activate(auth, { runId, nonce }) {
      return transaction(() => {
        const row = owned(auth, runId);
        if (!uuid(nonce) || row.nonce_hash !== hash(nonce)) fail(409, 'Attempt belongs to another page.');
        if (!['accepted', 'active'].includes(status(row))) fail(409, 'Attempt cannot restart.');
        db.prepare("UPDATE official_runs SET state='active' WHERE id=?").run(runId);
        return result(runRow(runId));
      });
    },
    interrupt(auth, runId) {
      return transaction(() => {
        const row = owned(auth, runId);
        if (['accepted', 'active'].includes(status(row))) db.prepare("UPDATE official_runs SET state='interrupted' WHERE id=?").run(runId);
        return result(runRow(runId));
      });
    },
    record(auth, { runId, turn, prizeId, remainingMs = 0 }) {
      return transaction(() => {
        const row = owned(auth, runId), state = status(row), rules = JSON.parse(row.rules), previous = turns(runId);
        if (['void', 'expired', 'accepted'].includes(state)) fail(409, 'Attempt cannot accept scores.');
        if (!Number.isInteger(turn) || turn < 1 || turn > 3 || (prizeId !== null && typeof prizeId !== 'string')) fail(400, 'Invalid turn.');
        let score;
        try { score = scoreTurn(rules, turnContext(previous.filter(t => t.turn < turn), prizeId, remainingMs)); }
        catch { fail(400, 'Invalid turn result.'); }
        const saved = previous.find(t => t.turn === turn);
        if (saved) {
          if (saved.prizeId !== prizeId || saved.remainingMs !== remainingMs) fail(409, 'Conflicting turn result.');
          return result(row);
        }
        if (turn !== previous.length + 1) fail(409, 'Save earlier turn first.');
        db.prepare('INSERT INTO official_turns (run_id,turn,prize_id,remaining_ms,score) VALUES (?,?,?,?,?)').run(runId, turn, prizeId, remainingMs, score);
        if (turn === 3) db.prepare("UPDATE official_runs SET state='complete',total=?,completed_at=? WHERE id=?")
          .run(previous.reduce((sum, t) => sum + t.score, score), now(), runId);
        return result(runRow(runId));
      });
    },
    recover(auth, { runId, reason, requestKey }) {
      if (!['camera_failure', 'connection_failure', 'browser_failure'].includes(reason)) fail(400, 'Select a technical failure.');
      return action(auth, requestKey, 'recover', { runId, reason }, () => {
        const row = runRow(runId); openEvent(row.event_id);
        if (!['accepted', 'active', 'interrupted'].includes(status(row))) fail(409, 'Only unfinished attempts can be replaced.');
        db.prepare("UPDATE official_runs SET state='void' WHERE id=?").run(runId);
        db.prepare("UPDATE official_tickets SET state='revoked' WHERE id=?").run(row.ticket_id);
        const replacement = ticket(row.event_id, row.participant_id);
        replacement.result.replacesRunId = runId;
        replacement.result.reason = reason;
        replacement.targetId = runId;
        return replacement;
      });
    },
    getRun(auth, runId) { return result(owned(auth, runId)); },
    board(auth, eventId) {
      requireBoardAccess(auth, eventId);
      return db.prepare(`${bestQuery} ORDER BY rank,r.id LIMIT 50`).all(eventId)
        .map(({ name, total, rank }) => ({ name, total, rank }));
    },
    personalBest(auth, runId) {
      const row = owned(auth, runId);
      const best = db.prepare(`${bestQuery} WHERE r.participant_id=?`).get(row.event_id, row.participant_id);
      return { attempt: result(row), best: best ? { total: best.total, rank: best.rank } : null };
    },
    exportEvent(auth, eventId) {
      host(auth); const e = event(eventId);
      return { version: 1, event: { id: e.id, name: e.name, state: e.state, retainUntil: e.retain_until },
        participants: db.prepare('SELECT id,name FROM official_participants WHERE event_id=?').all(eventId),
        runs: db.prepare('SELECT * FROM official_runs WHERE event_id=? ORDER BY accepted_at,id').all(eventId)
          .map(row => ({ ...result(row), participantId: row.participant_id })),
        actions: db.prepare('SELECT kind,target_id AS targetId,created_at AS createdAt,result FROM official_actions WHERE event_id=? ORDER BY created_at').all(eventId)
          .map(row => ({ ...row, result: JSON.parse(row.result) })) };
    },
    // Opt-in host maintenance, never invoked at import/startup. Cascades touch
    // only this new domain; legacy scores/sessions and backups are untouched.
    prune(auth) {
      host(auth);
      return transaction(() => ({ removedEvents: db.prepare('DELETE FROM official_events WHERE retain_until<=?').run(now()).changes }));
    },
  };
}
