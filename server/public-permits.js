import { isDeepStrictEqual } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { ApiError, label } from './database.js';
import { deviceClass } from './usage.js';
import { RULES } from '../src/event-session.js';

export const PERMIT_PROTOCOL = 1;
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const fail = (status, code, message) => { throw new ApiError(status, message, code); };
function fields(input, keys) {
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => !keys.includes(key))) fail(400, 'invalid_permit', 'Invalid permit fields.');
  if (input.protocol !== PERMIT_PROTOCOL) fail(409, 'unsupported_protocol', 'This permit protocol is not supported. Keep pending data.');
}

// Server-only policy is deliberately absent by default. Operator-selected
// capacity/deadline and host UI are prerequisites to later enablement.
export function createPublicPermits({ database, boardId, policy, now, owner, generation, renewOwner, ownerExpires, activeEvent, startsEnabled }) {
  const { db, transaction } = database;
  if (policy && (!Number.isInteger(policy.maxSlots) || policy.maxSlots < 1 || policy.maxSlots > 1000
    || !Number.isInteger(policy.maxRetentionMs) || policy.maxRetentionMs < 1000 || policy.maxRetentionMs > 7 * 86400000)) throw Error('Invalid public permit policy.');
  db.exec(`CREATE TABLE IF NOT EXISTS public_permit_pools (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), request_key TEXT NOT NULL,
    generation TEXT NOT NULL, board_id TEXT NOT NULL REFERENCES boards(id), rules TEXT NOT NULL,
    protocol INTEGER NOT NULL, capacity INTEGER NOT NULL, reconcile_by INTEGER NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(owner_id,request_key));
    CREATE TABLE IF NOT EXISTS public_permit_slots (
    id TEXT PRIMARY KEY, pool_id TEXT NOT NULL REFERENCES public_permit_pools(id), run_id TEXT NOT NULL UNIQUE,
    request_key TEXT NOT NULL UNIQUE, start_name TEXT, control_mode TEXT, admission_source TEXT, registered_at INTEGER);
    CREATE INDEX IF NOT EXISTS public_permit_generation ON public_permit_pools(generation,reconcile_by);
    CREATE INDEX IF NOT EXISTS public_permit_pool_slots ON public_permit_slots(pool_id);`);
  function receipt(req, pool) {
    const slots = db.prepare('SELECT id,run_id AS runId,request_key AS requestKey,admission_source AS admissionSource FROM public_permit_slots WHERE pool_id=? ORDER BY rowid').all(pool.id);
    const expires = ownerExpires(req), unregisteredSlots = slots.filter(slot => !slot.admissionSource).length;
    return { id: pool.id, protocol: pool.protocol, generation: pool.generation, boardId: pool.board_id,
      rules: JSON.parse(pool.rules), controlModes: ['one-hand', 'two-hand'], capacity: pool.capacity, reconcileBy: pool.reconcile_by,
      slots, unregisteredSlots, ownerExpires: expires,
      ready: unregisteredSlots > 0 && expires > pool.reconcile_by && pool.reconcile_by > now()
        && generation(req)?.generation === pool.generation && startsEnabled && Boolean(policy) };
  }
  function get(req, id) {
    const player = owner(req);
    const pool = db.prepare('SELECT * FROM public_permit_pools WHERE id=? AND owner_id=?').get(id, player);
    if (!pool) fail(404, 'permit_unavailable', 'Permit pool is unavailable for this owner.');
    return receipt(req, pool);
  }
  function issue(req, res, input) {
    fields(input, ['requestKey', 'count', 'reconcileBy', 'protocol']);
    if (!uuid(input.requestKey) || !Number.isInteger(input.count) || input.count < 1 || !Number.isSafeInteger(input.reconcileBy)) fail(400, 'invalid_permit', 'Choose a valid capacity, deadline and request identity.');
    const player = owner(req);
    const pool = transaction(() => {
      const previous = db.prepare('SELECT * FROM public_permit_pools WHERE owner_id=? AND request_key=?').get(player, input.requestKey);
      if (previous) {
        if (previous.capacity !== input.count || previous.reconcile_by !== input.reconcileBy || previous.protocol !== input.protocol) fail(409, 'permit_conflict', 'Preparation identity already has different inputs.');
        return previous; // Receipt only, even after pause/revocation; no new slots.
      }
      if (!startsEnabled) fail(503, 'admission_paused', 'New public plays are paused.');
      if (!policy) fail(403, 'permits_disabled', 'Station permit policy is not enabled.');
      const station = generation(req);
      if (!station) fail(403, 'station_revoked', 'Current station enrollment is required.');
      if (input.count > policy.maxSlots || input.reconcileBy <= now() || input.reconcileBy > now() + policy.maxRetentionMs) fail(400, 'invalid_permit', 'Capacity or deadline exceeds station policy.');
      const outstanding = db.prepare('SELECT COALESCE(SUM(capacity),0) AS n FROM public_permit_pools WHERE generation=? AND reconcile_by>?').get(station.generation, now()).n;
      if (outstanding + input.count > policy.maxSlots) fail(409, 'capacity_exhausted', 'Station capacity is exhausted until its declared window ends.');
      const rules = JSON.parse(db.prepare('SELECT rules FROM boards WHERE id=?').get(boardId).rules);
      const { controlVersion, ...scoring } = rules;
      if (!isDeepStrictEqual(scoring, RULES) || controlVersion !== 'camera-fist-hold-550-v2') fail(409, 'unsupported_rules', 'Current scoring rules cannot prepare this protocol.');
      const pool = { id: randomUUID(), owner_id: player, request_key: input.requestKey, generation: station.generation,
        board_id: boardId, rules: JSON.stringify(rules), protocol: PERMIT_PROTOCOL, capacity: input.count, reconcile_by: input.reconcileBy, created_at: now() };
      db.prepare('INSERT INTO public_permit_pools VALUES (?,?,?,?,?,?,?,?,?,?)').run(...Object.values(pool));
      for (let i = 0; i < input.count; i++) db.prepare('INSERT INTO public_permit_slots (id,pool_id,run_id,request_key) VALUES (?,?,?,?)').run(randomBytes(32).toString('base64url'), pool.id, randomUUID(), randomUUID());
      return pool;
    });
    // No new owner/token: credential and cookie are extended together. A lost
    // response can repeat this renewal using the same still-valid credential.
    renewOwner(req, res, pool.reconcile_by);
    return receipt(req, pool);
  }
  function register(req, input, source) {
    fields(input, ['slotId', 'runId', 'requestKey', 'name', 'controlMode', 'protocol']);
    if (typeof input.slotId !== 'string' || input.slotId.length > 64 || !uuid(input.runId) || !uuid(input.requestKey)
      || !['one-hand', 'two-hand'].includes(input.controlMode)) fail(400, 'invalid_permit', 'Invalid reserved admission.');
    const name = label(input.name), player = owner(req);
    return transaction(() => {
      const slot = db.prepare(`SELECT s.*,p.owner_id,p.generation,p.board_id,p.rules,p.protocol,p.reconcile_by
        FROM public_permit_slots s JOIN public_permit_pools p ON p.id=s.pool_id WHERE s.id=? AND p.owner_id=?`).get(input.slotId, player);
      if (!slot) fail(403, 'permit_unavailable', 'Permit is unavailable for this owner. Keep pending data.');
      if (slot.run_id !== input.runId || slot.request_key !== input.requestKey || slot.protocol !== input.protocol) fail(409, 'permit_conflict', 'Reserved admission identity differs.');
      if (slot.admission_source) {
        if (slot.start_name !== name || slot.control_mode !== input.controlMode) fail(409, 'permit_conflict', 'Reserved admission already has different inputs.');
        return database.getRun(slot.run_id, player); // Never mutate classification or renamed display label.
      }
      if (slot.reconcile_by <= now()) fail(403, 'permit_expired', 'Permit reconciliation deadline passed. Keep pending data.');
      if (source === 'live') {
        if (!startsEnabled) fail(503, 'admission_paused', 'New public plays are paused.');
        if (!policy) fail(403, 'permits_disabled', 'New permit admission is disabled.');
        if (generation(req)?.generation !== slot.generation) fail(403, 'station_revoked', 'This station generation cannot start new play.');
      }
      // Deferred registration remains available after pause/re-enrollment to
      // drain bounded, previously issued slots, without claiming event status.
      const rules = { ...JSON.parse(slot.rules), controlMode: input.controlMode };
      if (input.controlMode === 'two-hand') rules.controlVersion = 'camera-dual-raise-v1';
      const existing = db.prepare('SELECT id FROM runs WHERE id=? OR (owner_id=? AND request_key=?)').get(slot.run_id, player, slot.request_key);
      if (existing) fail(409, 'permit_conflict', 'Reserved identity already belongs to another admission.');
      db.prepare('INSERT INTO runs (id,owner_id,request_key,board_id,name,rules,started_at) VALUES (?,?,?,?,?,?,?)')
        .run(slot.run_id, player, slot.request_key, slot.board_id, name, JSON.stringify(rules), new Date(now()).toISOString());
      if (source === 'live') db.prepare('INSERT INTO run_usage (run_id,device_class,recorded_at) VALUES (?,?,?)')
        .run(slot.run_id, deviceClass(req.headers['user-agent']), new Date(now()).toISOString());
      db.prepare('UPDATE public_permit_slots SET start_name=?,control_mode=?,admission_source=?,registered_at=? WHERE id=?')
        .run(name, input.controlMode, source, now(), slot.id);
      const event = source === 'live' && activeEvent(req);
      if (event) db.prepare('INSERT INTO public_run_events VALUES (?,?)').run(slot.run_id, event.id);
      return database.getRun(slot.run_id, player);
    });
  }
  function reserved(player, requestKey) {
    return db.prepare('SELECT 1 FROM public_permit_slots s JOIN public_permit_pools p ON p.id=s.pool_id WHERE p.owner_id=? AND s.request_key=?').get(player, typeof requestKey === 'string' ? requestKey : '');
  }
  const preparedOwner = player => Boolean(db.prepare('SELECT 1 FROM public_permit_pools WHERE owner_id=? AND reconcile_by>? LIMIT 1').get(player, now()));
  function status(req) {
    let player;
    try { player = owner(req); } catch { return { ownerValid: false, pools: [], policy: policy || null }; }
    return { ownerValid: true, policy: policy || null, pools: db.prepare('SELECT * FROM public_permit_pools WHERE owner_id=? ORDER BY created_at').all(player).map(pool => receipt(req, pool)) };
  }
  return { issue, get, register, reserved, preparedOwner, status };
}
