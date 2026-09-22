// Event rules are immutable within a leaderboard session.
const LEGACY_RULES = Object.freeze({ version: 'cloud-day-v1', turns: 3, seconds: 15,
  // Tiers follow sampled catchable area: broader targets reward less.
  points: Object.freeze({ bonbon: 100, miso: 100, pip: 150, lilac: 150, 'blue-hour': 100, peach: 100, cocoa: 100, sprout: 200, butter: 150, cirrus: 200, otto: 200 }) });
export const CAROUSEL_RULES = Object.freeze({ version: 'cloud-day-carousel-v2', turns: 3, seconds: 15, points: Object.freeze({ bonbon: 100, miso: 100, 'blue-hour': 100, peach: 100, butter: 100, sprout: 200 }) });
export const RULES = Object.freeze({ ...CAROUSEL_RULES, version: 'cloud-day-speed-v3', speedBonus: 50 });
// Score one turn. Accepts the positional form (prizeId, remainingMs) or a context
// { prizeId, remainingMs, turnIndex, previousTurns } so a future rules version can
// reward streaks or tiers from the same call without touching every caller.
// Current rules ignore turnIndex and previousTurns; both forms are golden-tested equal.
export function scoreTurn(rules, prizeId, remainingMs = 0) {
  const context = prizeId !== null && typeof prizeId === 'object' ? prizeId : { prizeId, remainingMs };
  const ms = context.remainingMs ?? 0;
  if (!Number.isInteger(ms) || ms < 0 || ms > rules.seconds * 1000) throw new Error('Invalid aiming time.');
  if (context.prizeId == null) return 0;
  if (!Object.hasOwn(rules.points, context.prizeId)) throw new Error('Unknown prize.');
  return rules.points[context.prizeId] + Math.floor((rules.speedBonus || 0) * ms / (rules.seconds * 1000));
}
// The scoring context for the next turn of a run in progress.
export const turnContext = (turns, prizeId, remainingMs) => ({ prizeId, remainingMs, turnIndex: turns.length, previousTurns: turns });
const supportedRules = rules => [LEGACY_RULES, CAROUSEL_RULES, RULES].some(known => JSON.stringify(known) === JSON.stringify(rules));
export const STORAGE_KEY = 'coderpush:event:v1';
export function newBoard(name = 'AWS Cloud Day · Session 1') {
  return { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), rules: structuredClone(RULES), runs: [] };
}
export function newStore() { const board = newBoard(); return { version: 1, boards: [board], current: board.id, active: null }; }
export function currentBoard(store) { return store.boards.find(board => board.id === store.current); }
export function startRun(store, name, practice = false) {
  if (store.active) throw new Error('Finish or reset the current player first.');
  name = name.trim().slice(0, 24);
  if (!name) throw new Error('Enter a player name.');
  const board = currentBoard(store);
  store.active = { id: crypto.randomUUID(), playerId: crypto.randomUUID(), badgeId: null, name, practice, boardId: board.id, rules: structuredClone(board.rules), startedAt: new Date().toISOString(), turns: [] };
  return store.active;
}
export function recordTurn(store, turn, prizeId, remainingMs = 0) {
  const run = store.active;
  if (!run || turn !== run.turns.length + 1 || turn > run.rules.turns) return null;
  if (prizeId != null && !(prizeId in run.rules.points)) throw new Error('Unknown prize.');
  run.turns.push({ turn, prizeId, remainingMs, score: scoreTurn(run.rules, turnContext(run.turns, prizeId, remainingMs)) });
  if (run.turns.length !== run.rules.turns) return { completed: false, run };
  run.total = run.turns.reduce((sum, row) => sum + row.score, 0); run.completedAt = new Date().toISOString();
  store.boards.find(board => board.id === run.boardId).runs.push(run); store.active = null;
  return { completed: true, run };
}
export function leaderboard(board) {
  const runs = board.runs.filter(run => !run.practice).toSorted((a, b) => b.total - a.total || a.completedAt.localeCompare(b.completedAt));
  return runs.map(run => ({ ...run, rank: runs.findIndex(other => other.total === run.total) + 1 }));
}
export function rotateBoard(store, name) {
  if (store.active) throw new Error('Finish or reset the current player first.');
  const board = newBoard(name.trim() || `AWS Cloud Day · Session ${store.boards.length + 1}`);
  store.boards.push(board); store.current = board.id; return board;
}
export function loadStore(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return newStore();
  const store = JSON.parse(raw);
  if (store.version !== 1 || !Array.isArray(store.boards) || !currentBoard(store)) throw new Error('Saved leaderboard could not be read. Export the stored data before starting again.');
  for (const board of store.boards) {
    if (!Array.isArray(board.runs) || !supportedRules(board.rules)) throw new Error('Unsupported leaderboard rules.');
    for (const run of board.runs) if (typeof run.name !== 'string' || !Number.isFinite(run.total) || !Array.isArray(run.turns) || typeof run.completedAt !== 'string') throw new Error('Saved score is invalid.');
  }
  if (store.active && (typeof store.active.name !== 'string' || typeof store.active.id !== 'string' || !store.boards.some(b => b.id === store.active.boardId) || !Array.isArray(store.active.turns) || store.active.turns.length >= RULES.turns || !supportedRules(store.active.rules))) throw new Error('Saved player could not be recovered.');
  if (store.active) for (const [i, turn] of store.active.turns.entries()) {
    if (turn.turn !== i + 1 || (turn.prizeId !== null && !(turn.prizeId in store.active.rules.points)) || turn.score !== scoreTurn(store.active.rules, turnContext(store.active.turns.slice(0, i), turn.prizeId, turn.remainingMs ?? 0))) throw new Error('Saved turn is invalid.');
  }
  if (currentBoard(store).rules.version !== RULES.version) {
    if (store.active) {
      const oldBoard = store.boards.find(b => b.id === store.active.boardId);
      oldBoard.interruptedRuns ??= [];
      oldBoard.interruptedRuns.push({ ...store.active, interruptedAt: new Date().toISOString(), reason: 'Prototype rules changed' });
      store.active = null;
    }
    rotateBoard(store, 'Cloud Claw · Speed Score');
    store.notice = 'New speed scoring: earlier scores and unfinished runs remain in the export.';
  }
  return store;
}
