import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { RULES, scoreTurn, turnContext } from '../src/event-session.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function label(value, max = 24) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new ApiError(400, `Enter a name between 1 and ${max} characters.`);
  }
  return value.trim();
}
const now = () => new Date().toISOString();
const PILOT_RULES = { ...RULES, controlVersion: 'camera-fist-hold-550-v2' };
export function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, rules TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS owners (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), role TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES owners(id), request_key TEXT NOT NULL,
      board_id TEXT NOT NULL REFERENCES boards(id), name TEXT NOT NULL, rules TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', total INTEGER, started_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE(owner_id, request_key));
    CREATE TABLE IF NOT EXISTS turns (
      run_id TEXT NOT NULL REFERENCES runs(id), turn INTEGER NOT NULL CHECK(turn BETWEEN 1 AND 3),
      prize_id TEXT, score INTEGER NOT NULL, PRIMARY KEY(run_id, turn));
    CREATE INDEX IF NOT EXISTS runs_board ON runs(board_id, status);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
  if (!db.prepare('PRAGMA table_info(turns)').all().some(column => column.name === 'remaining_ms')) db.exec('ALTER TABLE turns ADD COLUMN remaining_ms INTEGER NOT NULL DEFAULT 0');
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function rotate(name) {
    return transaction(() => {
      const id = randomUUID();
      db.prepare('INSERT INTO boards VALUES (?, ?, ?, ?)').run(id, label(name, 60), now(), JSON.stringify(PILOT_RULES));
      db.prepare("INSERT INTO settings VALUES ('current', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);
      return board(id);
    });
  }
  function currentId() { return db.prepare("SELECT value FROM settings WHERE key='current'").get()?.value; }
  function runData(row, turns) {
    return { id: row.id, name: row.name, boardId: row.board_id, rules: JSON.parse(row.rules), status: row.status,
      practice: false, startedAt: row.started_at, completedAt: row.completed_at, total: row.total,
      turns: turns ?? db.prepare('SELECT turn, prize_id AS prizeId, score, remaining_ms AS remainingMs FROM turns WHERE run_id=? ORDER BY turn').all(row.id) };
  }
  function boardMetadata(id = currentId()) {
    const row = db.prepare('SELECT * FROM boards WHERE id=?').get(id);
    if (!row) throw new ApiError(404, 'Leaderboard not found.');
    return { id, name: row.name, createdAt: row.created_at, rules: JSON.parse(row.rules) };
  }
  function board(id = currentId()) {
    const metadata = boardMetadata(id), turnsByRun = new Map();
    for (const { runId, ...turn } of db.prepare("SELECT t.run_id AS runId, t.turn, t.prize_id AS prizeId, t.score, t.remaining_ms AS remainingMs FROM turns t JOIN runs r ON r.id=t.run_id WHERE r.board_id=? AND r.status='complete' ORDER BY t.turn").all(id)) {
      if (!turnsByRun.has(runId)) turnsByRun.set(runId, []);
      turnsByRun.get(runId).push(turn);
    }
    const rows = db.prepare("SELECT *, RANK() OVER (ORDER BY total DESC) AS rank FROM runs WHERE board_id=? AND status='complete' ORDER BY total DESC, completed_at, id").all(id);
    return { ...metadata, runs: rows.map(row => ({ ...runData(row, turnsByRun.get(row.id) || []), rank: row.rank })) };
  }
  function owned(id, owner) {
    const row = db.prepare('SELECT * FROM runs WHERE id=? AND owner_id=?').get(id, owner);
    if (!row) throw new ApiError(404, 'Run not found for this browser.');
    return row;
  }
  function getRun(id, owner) {
    const result = runData(owned(id, owner));
    if (result.status === 'complete') result.rank = db.prepare("SELECT COUNT(*) + 1 AS rank FROM runs WHERE board_id=? AND status='complete' AND total>?").get(result.boardId, result.total).rank;
    return result;
  }
  function createRun(owner, input) {
    const name = label(input.name), controlMode = input.controlMode ?? 'one-hand';
    if (!['one-hand', 'two-hand'].includes(controlMode)) throw new ApiError(400, 'Invalid control mode.');
    if (typeof input.requestKey !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestKey)) throw new ApiError(400, 'Invalid run request.');
    return transaction(() => {
      const previous = db.prepare('SELECT * FROM runs WHERE owner_id=? AND request_key=?').get(owner, input.requestKey);
      if (previous) {
        if (previous.name !== name) throw new ApiError(409, 'This run request already has another name.');
        if ((JSON.parse(previous.rules).controlMode ?? 'one-hand') !== controlMode) throw new ApiError(409, 'This run request already has another control mode.');
        return runData(previous);
      }
      const id = randomUUID(), activeBoard = boardMetadata();
      db.prepare('INSERT INTO runs (id,owner_id,request_key,board_id,name,rules,started_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, owner, input.requestKey, activeBoard.id, name, JSON.stringify({ ...activeBoard.rules, ...(input.controlMode === undefined ? {} : { controlMode }), controlVersion: controlMode === 'two-hand' ? 'camera-dual-raise-v1' : activeBoard.rules.controlVersion }), now());
      return runData(owned(id, owner));
    });
  }
  function record(id, owner, input) {
    return transaction(() => {
      const row = owned(id, owner), run = runData(row), { turn, prizeId } = input;
      if (!Number.isInteger(turn) || turn < 1 || turn > run.rules.turns || (prizeId !== null && (typeof prizeId !== 'string' || !Object.hasOwn(run.rules.points, prizeId)))) throw new ApiError(400, 'Invalid turn or prize.');
      const remainingMs = input.remainingMs ?? 0;
      let score;
      // The run already carries its recorded turns; earlier ones are the scoring context.
      try { score = scoreTurn(run.rules, turnContext(run.turns.filter(item => item.turn < turn), prizeId, remainingMs)); } catch { throw new ApiError(400, 'Invalid aiming time.'); }
      const previous = run.turns.find(item => item.turn === turn);
      if (previous) {
        if (previous.prizeId !== prizeId || previous.remainingMs !== remainingMs) throw new ApiError(409, 'This turn already has a different result.');
        return getRun(id, owner);
      }
      // Abandonment stops new gameplay; already completed client turns can still drain from its outbox.
      if (turn !== run.turns.length + 1) throw new ApiError(409, 'Save the earlier turn first.');
      db.prepare('INSERT INTO turns (run_id,turn,prize_id,score,remaining_ms) VALUES (?,?,?,?,?)').run(id, turn, prizeId, score, remainingMs);
      if (turn === run.rules.turns) db.prepare("UPDATE runs SET status='complete', total=(SELECT SUM(score) FROM turns WHERE run_id=?), completed_at=? WHERE id=?").run(id, now(), id);
      return getRun(id, owner);
    });
  }
  function abandon(id, owner) {
    owned(id, owner);
    db.prepare("UPDATE runs SET status='abandoned' WHERE id=? AND status='active'").run(id);
    return getRun(id, owner);
  }
  function exportData() {
    return { version: 1, exportedAt: now(), current: currentId(), boards: db.prepare('SELECT id FROM boards ORDER BY created_at').all().map(({ id }) => {
      const result = board(id);
      result.interruptedRuns = db.prepare("SELECT * FROM runs WHERE board_id=? AND status!='complete'").all(id).map(row => runData(row));
      return result;
    }) };
  }
  if (!currentId()) rotate('Cloud Claw · Staff pilot');
  if (JSON.stringify(boardMetadata().rules) !== JSON.stringify(PILOT_RULES)) rotate('Cloud Claw · Updated rules');
  return { db, board, createRun, getRun, record, abandon, rotate, exportData, close: () => db.close() };
}
