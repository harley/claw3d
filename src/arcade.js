import { HAND_ACQUIRE_MS, RIGHT_SLAM_MS } from './dual-hand-controls.js';
import { HOLD_LIMITS } from './fist.js';
import { ABSOLUTE_SPEED } from './steering.js';
import './arcade.css';
import { createJoystickCursor } from './joystick-cursor.js';
import { PRESS_MS } from './grab-release.js';
import { createHandMenu, generatedName } from './hand-menu.js';
const manualSetup = new URLSearchParams(location.search).get('setup') === 'manual';
import { createSharedBoard } from './shared-board.js';
import { createPlaytestClient } from './playtest-client.js';
import { createArcadeAudio } from './arcade-audio.js';
import { createHud, $, setText, setHidden, nextTurnSeconds } from './arcade-hud.js';
import { createMovementMusic } from './movement-music.js';
import { PerformanceGovernor, PERFORMANCE_WINDOW_MS } from './performance-governor.js';
const shared = globalThis.__SHARED_PILOT__ === true;
const dualEnabled = !shared && new URLSearchParams(location.search).get('controls') === 'dual';
const grabEnabled = dualEnabled || (!shared && new URLSearchParams(location.search).get('controls') === 'grab');
const cabinetEnabled = !shared;
// `?hold=N` (local only) trials a shorter fist hold with decaying credit for the booth A/B; the shared pilot keeps its control version.
const requestedHold = Number(new URLSearchParams(location.search).get('hold'));
const holdMs = !shared && requestedHold >= HOLD_LIMITS.min && requestedHold <= HOLD_LIMITS.max ? Math.round(requestedHold) : undefined;
// `?steer=absolute` (local only): the hand's offset maps straight onto the bed for the booth A/B against joystick steering.
const steering = !shared && new URLSearchParams(location.search).get('steer') === 'absolute' ? 'absolute' : 'relative';
const scoreKey = dualEnabled ? `${STORAGE_KEY}:dual-controls` : grabEnabled ? `${STORAGE_KEY}:cabinet-controls` : STORAGE_KEY;
import { ArcadeScene } from './arcade-scene.js';
import { createGame, begin, drop, advance, move, moveToward, homeClaw, planGrab, clawPose, PHASES, MAX_FRAME_DELTA, BED, CAROUSEL, carouselCue, moveCarousel, aimTarget } from './arcade-mechanics.js';
import { RULES, STORAGE_KEY, newStore, loadStore, currentBoard, startRun, recordTurn, leaderboard, rotateBoard, scoreTurn } from './event-session.js';

$('build-info').textContent = `BUILD ${__BUILD_INFO__.commit}${__BUILD_INFO__.dirty ? ' · uncommitted changes' : ''} · ${__BUILD_INFO__.branch}`;
let game = createGame({ carousel: true }), scene, previous = 0, stopped = false, frozen = false;
let cameraControls, cameraLoading = false;
const handMenu = createHandMenu();
document.body.classList.toggle('machine-controls', cabinetEnabled);
document.body.classList.toggle('dual-controls', cabinetEnabled);
document.body.classList.toggle('two-hand-mode', dualEnabled);
const glove = createJoystickCursor(() => cabinetEnabled ? scene?.controlTargets() : null, () => { if (cabinetEnabled) gestureDrop(); });
let previousMenuMode = '';
function menuMode() {
  if (startingRun || frozen || stopped || document.hidden) return '';
  if ((recovering || paused) && shared) return '';
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  if (dialogs.length) return dialogs.length === 1 && ['registration', 'final'].includes(dialogs[0].id) ? dialogs[0].id : '';
  if ((recovering || paused) && cameraControls?.running) return 'resume';
  return !run && cameraControls?.running ? 'idle' : '';
}
let pendingPlayer = null, startingRun = false;
let scoreAnimation;
let lastSoundPhase = '', lastMovementSound = -Infinity;
let aligned = null, paused = false;
let store, storageError = '', storageBlocked = false;
try { store = shared ? newStore() : loadStore({ getItem: () => localStorage.getItem(scoreKey) }); } catch (error) { store = newStore(); storageError = error.message; storageBlocked = true; }
let run = store.active, completedRun = null, turnNumber = run ? run.turns.length + 1 : 0, remaining = RULES.seconds;
let recovering = Boolean(run);
const frames = [], errors = [];
const playtest = createPlaytestClient({ build: __BUILD_INFO__.commit, enabled: shared });
const track = (type, data = {}, subject = run || pendingPlayer || completedRun) => playtest.track(type, data, { mode: 'event', ...(subject?.id ? { runId: subject.id } : {}) });
track('page_open');
let observedControl = '', observedPhase = '', observedSaveError = false, cameraFailureReported = false;
let performanceFrames = [], performanceVisibleMs = 0, cameraReadyAt = null;
let adaptationFrames = [], adaptationVisibleMs = 0;
let holdSignalTurn = -1, holdSignalCount = 0;
let nextTurnElapsed = 0, dropRemainingMs = 0, pendingSlam = null, contactFeedback = null;
let cueLead = dualEnabled ? (HAND_ACQUIRE_MS + RIGHT_SLAM_MS) / 1000 : grabEnabled ? PRESS_MS / 1000 : holdMs ? holdMs / 1000 : undefined;
const performanceGovernor = new PerformanceGovernor({ onChange: (mode, source) => {
  scene?.setQuality(mode === 'simple');
  cameraControls?.setPerformanceMode(mode);
  if (scene) $('quality').textContent = `QUALITY: ${mode === 'simple' ? 'SIMPLE' : 'FULL'}${source === 'auto' ? ' · AUTO' : ''}`;
} });
const tags = game.toys.map(toy => {
  const element = document.createElement('span'); element.className = 'prize-tag'; element.dataset.points = RULES.points[toy.id]; element.textContent = RULES.points[toy.id]; $('prize-tags').append(element); return { toy, element };
});
function persist() {
  if (shared) return;
  if (storageBlocked) return;
  try { localStorage.setItem(scoreKey, JSON.stringify(store)); storageError = ''; }
  catch { storageError = 'Storage unavailable. Results are in memory only. Export before closing.'; }
  $('storage-status').textContent = shared ? pilot.status : storageError || store.notice || 'Scores saved on this browser.';
}
function renderBoard() {
  const board = shared ? pilot.board || { name: 'Shared staff leaderboard', runs: [] } : currentBoard(store); $('board-name').textContent = board.name; $('leaders').replaceChildren();
  const leaders = shared ? board.runs : leaderboard(board); $('board-empty').hidden = leaders.length > 0;
  for (const row of leaders.slice(0, 5)) {
    const li = document.createElement('li'); li.classList.toggle('current', row.id === completedRun?.id);
    for (const [tag, value] of [['span', String(row.rank).padStart(2, '0')], ['strong', row.name], ['b', row.total]]) { const el = document.createElement(tag); el.textContent = value; li.append(el); }
    $('leaders').append(li);
  }
  const official = board.runs.filter(r => !r.practice), turns = official.flatMap(r => r.turns);
  $('operator-stats').textContent = `${official.length} completed · ${turns.length ? Math.round(turns.filter(t => t.score).length / turns.length * 100) : 0}% catch rate${shared ? '' : ` · ${store.boards.length} sessions stored`}`;
  $('storage-status').textContent = shared ? pilot.status : storageError || store.notice || 'Scores saved on this browser.';
}
const audio = createArcadeAudio({ onChange: syncSoundUI, enabledByDefault: !manualSetup });
const movementMusic = createMovementMusic(audio);
const hud = createHud({ audio, phaseSound });
function updateUI(feedback = cameraControls?.feedback || { kind: cameraLoading ? 'loading' : 'off' }, modal = Boolean(document.querySelector('dialog[open]'))) {
  hud.update({ game, run, completedRun, pendingPlayer, turnNumber, remaining, nextTurnElapsed, paused, frozen, recovering, startingRun, cameraLoading, cameraControls, shared, grabEnabled, dualEnabled, cabinetEnabled, holdMs, sharedStatus: pilot.status, storageError, aligned }, feedback, modal);
}
function syncSoundUI() {
  $('sound').textContent = !audio.enabled ? 'SOUND OFF' : !audio.volume ? 'MUTED' : audio.ready ? 'SOUND ON' : 'TAP FOR SOUND';
  $('sound').setAttribute('aria-pressed', String(audio.enabled));
}
function phaseSound(phase, modal) {
  if (phase === lastSoundPhase) return;
  lastSoundPhase = phase;
  if (paused || document.hidden || modal) return;
  if (phase === 'anticipate') { audio.note(880, .22, 0, 'square', 110); audio.fanfare('drop'); }
  else if (phase === 'descend') [360, 280, 200].forEach((f, i) => audio.note(f, .1, i * .09, 'square', f / 2));
  else if (phase === 'grip') { audio.note(120, .08, 0, 'square', 60); audio.note(180, .08, .09, 'square', 90); }
  else if (phase === 'lift') {
    if (game.plan?.prize) [440, 554, 660].forEach((f, i) => audio.note(f, .13, i * .1, 'square', f * 1.5));
    else { audio.note(240, .16, 0, 'sawtooth', 180); audio.note(160, .2, .13, 'triangle', 65); }
  } else if (phase === 'deliver' && game.plan?.prize) audio.fanfare('shelf');
  else if (phase === 'release' && game.plan?.prize) { audio.note(740, .1, 0, 'sine'); audio.note(980, .14, .1, 'sine'); }
}
function freshGame() { pendingSlam = contactFeedback = null; cameraControls?.reset(); game = createGame({ carousel: true }); scene?.groundToys(game); aligned = null; hud.invalidate(); }
function restoreTrophies() {
  if (shared) return;
  for (const turn of run?.turns || []) {
    const toy = game.toys.find(toy => toy.id === turn.prizeId);
    if (toy && !toy.claimed) { toy.claimed = true; game.collection.push(toy.id); }
  }
}
function beginTurn() {
  nextTurnElapsed = 0; dropRemainingMs = 0; contactFeedback = null;
  if (!shared && run.turns.length && !recovering && game.phase === 'result') {
    cameraControls?.reset(); aligned = null; hud.invalidate();
  } else {
    freshGame();
    restoreTrophies();
  }
  turnNumber = run.turns.length + 1; remaining = run.rules.seconds; begin(game); recovering = false;
  if (turnNumber === 3) { [330, 440, 660].forEach((f, i) => audio.note(f, .16, i * .15)); }
  else { [523, 784].forEach((f, i) => audio.note(f, .12, i * .09)); }
  updateUI();
}
function openRegistration(name = $('name').value) {
  if (stopped || !scene || startingRun) return;
  $('name').setCustomValidity(''); $('name').value = name.trim() || generatedName();
  $('registration').showModal(); $('register-play').focus();
}
function finishTurn() {
  if (!run) return;
  const outcome = recordTurn(store, turnNumber, game.plan?.prize?.id || null, dropRemainingMs); if (!outcome) return;
  persist();
  track('turn_complete', { turn: turnNumber, score: outcome.run.turns.at(-1).score, prizeId: outcome.run.turns.at(-1).prizeId, outcome: game.plan?.reason }, outcome.run);
  if (shared) pilot.queue(outcome.run);
  const points = outcome.run.turns.at(-1).score;
  if (outcome.completed) audio.fanfare('complete');
  else if (points) { [523, 659, 784, 1047].forEach((f, i) => audio.note(f, .18, i * .11)); } else audio.note(165, .25, 0, 'triangle');
  if (outcome.completed) {
    track('run_complete', { score: outcome.run.total }, outcome.run);
    completedRun = outcome.run; run = null; renderBoard();
    $('final-name').textContent = completedRun.name.toUpperCase(); $('final-score').textContent = String(completedRun.total).padStart(3, '0');
    const rank = shared ? undefined : leaderboard(currentBoard(store)).find(r => r.id === completedRun.id)?.rank;
    $('final-kicker').textContent = rank === 1 ? 'TOP OF THE BOARD!' : 'RUN COMPLETE';
    $('final-rank').textContent = shared ? 'Score waiting to sync' : rank ? `LOCAL PREVIEW · RANK #${rank}` : 'LOCAL PREVIEW';
    setText('final-board', `Board: ${completedRun.boardName || store.boards.find(board => board.id === completedRun.boardId)?.name || completedRun.boardId}`);
    $('final-turns').replaceChildren();
    for (const turn of completedRun.turns) { const chip = document.createElement('span'); chip.className = 'turn-chip scored'; chip.textContent = `+${turn.score}`; const name = document.createElement('small'); name.textContent = turn.prizeId ? `${completedRun.rules.points[turn.prizeId]} + ${turn.score - completedRun.rules.points[turn.prizeId]} SPEED` : 'MISS'; chip.append(name); $('final-turns').append(chip); }
    setText('final-sync', shared ? pilot.state().error : storageError);
    $('final').showModal(); $('play-again').focus();
    if (!scene.reducedMotion) { const total = completedRun.total, start = performance.now(); const count = time => { if (!$('final').open) return; const progress = Math.min(1, (time - start) / 850); $('final-score').textContent = String(Math.round(total * (1 - (1 - progress) ** 3))).padStart(3, '0'); if (progress < 1) scoreAnimation = requestAnimationFrame(count); }; scoreAnimation = requestAnimationFrame(count); }
  }
}
async function play() {
  if (!scene || stopped || frozen || cameraLoading || document.querySelector('dialog[open]')) return;
  if (recovering || paused) {
    if (shared) return openOperator();
    const currentRun = run;
    if (recovering && !cameraControls?.running) await startCamera();
    if ((recovering && !cameraControls?.running) || run !== currentRun || stopped || document.querySelector('dialog[open]')) return;
    cameraControls?.reset(); paused = false;
    if (recovering) beginTurn();
    updateUI(); return;
  }
  if (!run) { if (!cameraControls?.running) return startCamera(); return openRegistration(); }
  if (game.phase === 'aim' && !cameraControls?.running) return startCamera();
  updateUI();
}
async function startScoredRun() {
  if (startingRun || !pendingPlayer) return;
  startingRun = true; updateUI();
  try {
    if (shared) {
      pendingPlayer.requestKey ??= crypto.randomUUID();
      const issued = await pilot.start(pendingPlayer.name, pendingPlayer.requestKey);
      // Presentation accumulates turns under the acknowledged immutable rule snapshot.
      store = { version: 1, current: issued.boardId, boards: [{ id: issued.boardId, name: pilot.board?.id === issued.boardId ? pilot.board.name : issued.boardId, rules: issued.rules, runs: [] }], active: issued };
      run = issued;
      run.boardName = store.boards[0].name;
    } else run = startRun(store, pendingPlayer.name);
    track('run_start', { steering, ...(holdMs ? { holdMs } : {}) }, run);
    pendingPlayer = null; completedRun = null; persist(); beginTurn();
    $('shared-start').close();
  } catch (error) {
    if (shared) {
      $('shared-start-message').textContent = `Start unavailable. ${error.message}`;
      $('shared-start').showModal();
    } else {
      freshGame(); $('registration').showModal();
      $('name').setCustomValidity(error.message); $('name').reportValidity();
    }
  } finally { startingRun = false; updateUI(); }
}
function gestureDrop() {
  if (pendingSlam || !run || game.phase !== 'aim' || startingRun || paused || frozen || stopped || document.hidden || document.querySelector('dialog[open]')) return false;
  if (dualEnabled) {
    pendingSlam = { elapsed: 0, feedback: cameraControls?.feedback || {} };
    dropRemainingMs = Math.floor(remaining * 1000);
    return true;
  }
  if (!drop(game)) return false;
  dropRemainingMs = Math.floor(remaining * 1000);
  track('drop', { trigger: 'gesture', phase: game.phase, turn: turnNumber });
  updateUI();
  return true;
}
function fail(message, error) { track('client_error', { reason: 'renderer' }); stopped = true; cameraControls?.stop(); clearTimeout(window.__arcadeBootTimer); errors.push(String(error || message)); $('loading').hidden = true; $('error').hidden = false; $('error-message').textContent = message; console.error('Cloud Claw:', error || message); }
function openOperator() { if (shared && pilot.role !== 'host') { $('host-access').showModal(); return; } renderBoard(); $('operator').showModal(); $('pause').textContent = recovering ? 'RESUME INTERRUPTED TURN' : paused ? 'RESUME GAME' : 'PAUSE GAME'; }
document.addEventListener('visibilitychange', () => { previous = 0; if (document.hidden) audio.silence(); });
$('player-form').addEventListener('submit', event => { event.preventDefault(); if (!scene || stopped || !cameraControls?.running) return;
  if (startingRun || run) return;
  const name = $('name').value.trim() || generatedName();
  if (name.length > 24) { $('name').setCustomValidity('Use at most 24 characters.'); $('name').reportValidity(); return; }
  pendingPlayer = { name };
  $('registration').close(); $('scene').focus();
  void startScoredRun();
});
$('name').addEventListener('input', () => $('name').setCustomValidity(''));
$('register-cancel').addEventListener('click', () => $('registration').close());
async function replay(samePlayer) {
  if (startingRun || run || cameraLoading) return;
  const name = samePlayer ? completedRun?.name || '' : '';
  $('name').value = name;
  track('replay'); $('final').close(); freshGame(); updateUI();
  if (!cameraControls?.running) await startCamera();
  if (cameraControls?.running) openRegistration(name);
}
$('play-again').addEventListener('click', () => { void replay(true); });
$('next-player').addEventListener('click', () => { void replay(false); });
$('result-open').addEventListener('click', () => {
  if (!completedRun || startingRun || run || cameraLoading) return;
  cancelAnimationFrame(scoreAnimation);
  setText('final-score', String(completedRun.total).padStart(3, '0'));
  $('final').showModal(); $('play-again').focus();
});
$('final-leaderboard').addEventListener('click', () => {
  $('final').close(); document.querySelector('.leaderboard').focus();
});
$('final').addEventListener('cancel', event => event.preventDefault());
$('play').addEventListener('click', () => { $('scene').focus(); play(); });
$('play-alternate').addEventListener('click', () => {
  if (shared || run || startingRun || cameraLoading || paused || recovering || document.querySelector('dialog[open]')) return;
  const url = new URL(location.href);
  if (dualEnabled) url.searchParams.delete('controls'); else url.searchParams.set('controls', 'dual');
  url.searchParams.set('start', '1'); location.assign(url);
});
$('operator-open').addEventListener('click', openOperator);
$('pause').addEventListener('click', () => { if (recovering) { beginTurn(); paused = false; } else paused = !paused; $('operator').close(); $('scene').focus(); });
$('reset').addEventListener('click', () => { if (startingRun) return; if (shared && run) pilot.abandon(run); if (store.active) { store.active.abortedAt = new Date().toISOString(); store.active = null; } run = null; pendingPlayer = null; completedRun = null; recovering = paused = frozen = false; persist(); freshGame(); $('operator').close(); updateUI(); });
$('new-board').addEventListener('click', async () => {
  if (shared) {
    if (pilot.rotating) return;
    $('new-board').disabled = true;
    try {
      await pilot.rotate($('session-name').value.trim() || 'Cloud Claw · Staff pilot');
      $('operator-message').textContent = 'New shared board started. Existing runs finish on their original board.';
    } catch (error) { $('operator-message').textContent = error.message; }
    finally { $('new-board').disabled = false; }
    return;
  }
  try { rotateBoard(store, $('session-name').value); persist(); completedRun = null; renderBoard(); $('operator-message').textContent = 'New leaderboard started. Previous results are preserved.'; }
  catch (error) { $('operator-message').textContent = error.message; }
});
$('export').addEventListener('click', () => { if (shared) { window.location.assign('/api/host/export'); return; } let data = JSON.stringify(store, null, 2); if (storageBlocked) { try { data = localStorage.getItem(scoreKey) || data; } catch { /* In-memory export remains available. */ } } const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `cloud-claw-sessions-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('quality').addEventListener('click', () => { if (!scene) return; performanceGovernor.setMode(scene.lowQuality ? 'full' : 'simple', 'operator'); });
$('sound').addEventListener('click', () => { if (audio.enabled && !audio.ready) audio.unlock(); else audio.toggle(); });
document.addEventListener('pointerdown', event => { if (event.target.closest('#sound')) return; audio.unlock(); });
document.addEventListener('keydown', event => { if (!event.target.closest('#sound')) audio.unlock(); });
let feedbackSubmission = null, feedbackContext = null;
function openFeedback() {
  feedbackContext = { phase: game.phase, turn: Math.min(3, turnNumber) };
  if (!feedbackSubmission) setText('feedback-status', shared ? '' : 'Feedback is available on the shared playtest site.');
  $('feedback-send').disabled = !shared;
  $('feedback-dialog').showModal();
}
$('feedback-open').addEventListener('click', openFeedback);
$('final-feedback').addEventListener('click', openFeedback);
$('error-feedback').addEventListener('click', openFeedback);
$('feedback-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!shared) return;
  if (feedbackSubmission) { void playtest.flush(); return; }
  const data = { ...feedbackContext, category: $('feedback-category').value, comment: $('feedback-comment').value.trim() };
  const submission = track('feedback', data);
  feedbackSubmission = submission;
  $('feedback-send').textContent = 'Retry sending';
  $('feedback-category').disabled = $('feedback-comment').disabled = true;
  setText('feedback-status', 'Sending feedback…');
  const waiting = setTimeout(() => { if (feedbackSubmission === submission) setText('feedback-status', 'Not saved yet. Keep this page open; retrying.'); }, 9000);
  const result = await submission.acknowledged;
  clearTimeout(waiting);
  if (feedbackSubmission !== submission) return;
  feedbackSubmission = null;
  $('feedback-category').disabled = $('feedback-comment').disabled = false;
  $('feedback-send').textContent = 'Send feedback';
  setText('feedback-status', result.sent ? 'Thanks. Your feedback is saved.' : 'Feedback was not saved. Please try again.');
  if (result.sent) $('feedback-comment').value = '';
});
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('status').textContent = 'FULLSCREEN UNAVAILABLE'; } });
$('camera-open').addEventListener('click', () => $('camera-setup').showModal());
function reportCameraFailure(code) {
  if (cameraFailureReported) return;
  cameraFailureReported = true;
  track('camera_error', { code, phase: game.phase, turn: turnNumber });
}
async function startCamera() {
  if (cameraLoading) return;
  cameraFailureReported = false;
  track('camera_start');
  cameraLoading = true; $('camera-toggle').disabled = true; $('camera-status').textContent = 'Starting camera…';
  updateUI();
  try {
    if (!cameraControls) {
      const { createCameraControls } = await import('./camera-controls.js');
      cameraControls = await createCameraControls({ video: $('camera-video'), overlay: $('camera-overlay'), select: $('camera-select'), maxHands: dualEnabled ? 2 : 1, holdMs, steering,
        getControlProfile: () => grabEnabled && !menuMode() ? dualEnabled ? 'dual' : 'grab-release' : 'hold-drop',
        getControlTarget: (pointer, role, origin) => glove.targetAt(pointer, role, origin),
        canControl: () => Boolean(menuMode() || (!pendingSlam && !startingRun && run && game.phase === 'aim' && !paused && !frozen && !stopped && !document.hidden && !document.querySelector('dialog[open]'))),
        onDrop: () => menuMode() ? handMenu.confirm(menuMode(), cameraControls.feedback) : gestureDrop(),
        // Bounded so a boundary-trembling hand cannot evict funnel-critical
        // events (drop, turn_complete) from the retry queue.
        onGesture: (name, cause) => {
          if (holdSignalTurn !== turnNumber) { holdSignalTurn = turnNumber; holdSignalCount = 0; }
          if (++holdSignalCount > 20) return;
          track(name, { phase: game.phase, ...(name === 'hold_cancelled' ? { cause } : {}) });
        },
        onChange: state => {
          if (state.kind === 'loading') cameraFailureReported = false;
          if (state.kind === 'error') reportCameraFailure(state.code || 'unknown');
          $('camera-status').textContent = state.message;
          const video = $('camera-video');
          if (video.videoWidth && video.videoHeight) $('camera-preview').style.setProperty('--camera-aspect', `${video.videoWidth} / ${video.videoHeight}`);
          const active = cameraControls?.running || state.kind === 'tracking';
          $('camera-preview').hidden = !active;
          $('camera-open').textContent = active ? 'CAMERA ✓' : 'CAMERA';
          $('camera-toggle').textContent = active ? 'STOP CAMERA' : 'START CAMERA';
        },
      });
    }
    await cameraControls.start();
    if (cameraControls.running) {
      cameraControls.adaptationStats();
      // Camera start rebuilds its capture driver, so reapply the current mode
      // after every first start, restart, or device switch.
      cameraControls.setPerformanceMode(performanceGovernor.mode);
      track('camera_ready'); cameraReadyAt = performance.now(); $('camera-setup').close();
      // Restart the rollup window so pre-camera time never dilutes vision rates.
      performanceFrames = []; performanceVisibleMs = 0;
      adaptationFrames = []; adaptationVisibleMs = 0;
    }
    else { reportCameraFailure('camera_unavailable'); $('camera-setup').showModal(); }
  } catch (error) { reportCameraFailure('camera_unavailable'); $('camera-status').textContent = `Camera unavailable: ${error.message}`; $('camera-setup').showModal(); }
  finally { cameraLoading = false; $('camera-toggle').disabled = false; updateUI(); }
}
$('camera-toggle').addEventListener('click', () => {
  if (cameraControls?.running || cameraControls?.starting) cameraControls.stop();
  else startCamera();
});
$('camera-recenter').addEventListener('click', () => { cameraControls?.reset(); $('camera-setup').close(); });
window.addEventListener('pagehide', () => { cameraControls?.stop(); void playtest.flush(); });
window.addEventListener('error', () => track('client_error', { reason: 'runtime' }));
window.addEventListener('unhandledrejection', () => track('client_error', { reason: 'unhandled' }));
$('scene').addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The renderer stopped. Reload to continue.'); });
function frame(time) {
  if (stopped) return;
  const raw = previous ? (time - previous) / 1000 : 1 / 60, dt = Math.min(raw, MAX_FRAME_DELTA); previous = time;
  if (import.meta.env.DEV && !document.hidden) { frames.push(raw * 1000); if (frames.length > 1800) frames.shift(); }
  // One dialog query per frame; every consumer below shares it.
  const nextMenuMode = menuMode();
  if (nextMenuMode !== previousMenuMode) { cameraControls?.reset(); handMenu.clear(); previousMenuMode = nextMenuMode; }
  handMenu.update(nextMenuMode, cameraControls?.feedback || {});
  const openDialogs = document.querySelectorAll('dialog[open]');
  const aiming = game.phase === 'aim', modal = openDialogs.length > 0;
  const modalBeyondFinal = modal && [...openDialogs].some(dialog => dialog.id !== 'final');
  const cameraWaiting = aiming && !pendingSlam && (!cameraControls?.running || cameraControls.waiting);
  // Only explicit operator pause stops a drop already in flight.
  const blocked = paused || (aiming && !pendingSlam && (cameraWaiting || modal || document.hidden));
  movementMusic?.update(aiming && !pendingSlam && !blocked && !frozen && !document.hidden, dt);
  if (paused || modalBeyondFinal || document.hidden) audio.silence();
  const input = { ...cameraControls?.input || { x: 0, z: 0 } };
  if (!frozen && !blocked && !document.hidden) {
    if (pendingSlam) {
      input.x = input.z = 0;
      pendingSlam.elapsed += dt;
      moveCarousel(game, dt);
      if (pendingSlam.elapsed >= RIGHT_SLAM_MS / 1000) {
        contactFeedback = pendingSlam.feedback;
        pendingSlam = null;
        if (drop(game)) track('drop', { trigger: 'gesture', phase: game.phase, turn: turnNumber });
      }
    } else if (aiming) {
      const oldPosition = game.position;
      game.position = input.target ? moveToward(game.position, input.target, dt, ABSOLUTE_SPEED) : move(game.position, input, dt); moveCarousel(game, dt); aligned = aimTarget(game);
      // Actual movement, not hand presence: stay quiet at rest and at the travel limit.
      if (Math.hypot(game.position.x - oldPosition.x, game.position.z - oldPosition.z) > .0001 && time - lastMovementSound >= 140) {
        lastMovementSound = time;
        audio.note(130, .065, 0, 'triangle', 95, .008);
      }
      const before = Math.ceil(remaining); remaining = Math.max(0, remaining - dt); if (Math.ceil(remaining) < before && remaining <= 5) audio.note(remaining < 1 ? 220 : 440, .08); if (!remaining && drop(game)) { dropRemainingMs = 0; track('drop', { trigger: 'timeout', phase: game.phase, turn: turnNumber }); }
    } else {
      input.x = input.z = 0;
      if (game.phase === 'idle') moveCarousel(game, dt);
      if (game.phase === 'result' && run && !recovering && !modal) { homeClaw(game, dt); nextTurnElapsed += dt; if (nextTurnElapsed >= nextTurnSeconds(Boolean(game.plan?.prize))) beginTurn(); }
      const before = game.phase; advance(game, dt); if (game.phase === 'result' && before !== 'result') finishTurn();
    }
  } else input.x = input.z = 0;
  try {
    const feedback = pendingSlam ? { ...pendingSlam.feedback, profile: 'dual', kind: 'slamming', slamProgress: pendingSlam.elapsed / (RIGHT_SLAM_MS / 1000), progress: 1, controlEnabled: false } : dualEnabled && contactFeedback && game.phase === 'anticipate' ? { ...contactFeedback, profile: 'dual', kind: 'slamming', slamProgress: 1, progress: 1, controlEnabled: false } : cameraControls?.feedback || { kind: 'off', progress: 0, controlEnabled: false };
    if (dualEnabled) cueLead = ((feedback.hands?.right?.ready ? 0 : HAND_ACQUIRE_MS) + RIGHT_SLAM_MS) / 1000;
    updateUI(feedback, modal);
    if (feedback.kind !== observedControl) { observedControl = feedback.kind; track('control_state', { state: feedback.kind, phase: game.phase }); }
    if (cameraReadyAt !== null && feedback.kind === 'tracking') { track('time_to_control', { acquisitionMs: Math.min(604800000, performance.now() - cameraReadyAt) }); cameraReadyAt = null; }
    if (game.phase !== observedPhase) { observedPhase = game.phase; track('phase_change', { phase: game.phase }); }
    if (!document.hidden) {
      performanceFrames.push(raw * 1000); if (performanceFrames.length > 1800) performanceFrames.shift();
      adaptationFrames.push(raw * 1000); if (adaptationFrames.length > 600) adaptationFrames.shift();
      // Rates divide by visible time only; hidden spans neither accrue (frame()
      // resets `previous` on visibilitychange) nor dilute the result rate.
      performanceVisibleMs += raw * 1000;
      adaptationVisibleMs += raw * 1000;
      if (adaptationVisibleMs >= PERFORMANCE_WINDOW_MS) {
        const sorted = [...adaptationFrames].sort((a, b) => a - b);
        const vision = cameraControls?.adaptationStats();
        const rejected = vision ? Object.values(vision.rejected).reduce((sum, count) => sum + count, 0) : 0;
        const averageFps = 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length);
        if (cameraControls?.running) performanceGovernor.observe({ averageFps, resultHz: vision.results / (adaptationVisibleMs / 1000), results: vision.results, rejected });
        adaptationFrames = []; adaptationVisibleMs = 0;
      }
      if (performanceVisibleMs >= 30000) {
        const sorted = [...performanceFrames].sort((a, b) => a - b);
        const vision = cameraControls?.visionStats();
        const rejected = vision ? Object.values(vision.rejected).reduce((sum, count) => sum + count, 0) : 0;
        const averageFps = Math.min(1000, 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length));
        const resultHz = vision ? Math.min(240, +(vision.results / (performanceVisibleMs / 1000)).toFixed(2)) : 0;
        track('performance', { frames: sorted.length, averageFps, p95FrameMs: Math.min(60000, sorted[Math.floor(sorted.length * .95)]), framesOver33ms: sorted.filter(ms => ms > 33.4).length,
          ...(vision?.results || rejected ? {
            resultHz,
            ...(vision.latencyP50Ms !== null ? { visionP50Ms: vision.latencyP50Ms, visionP95Ms: vision.latencyP95Ms } : {}),
            rejectOverAge: vision.rejected['over age'] || 0, rejectOutOfOrder: vision.rejected['out of order'] || 0,
            rejectHidden: vision.rejected['hidden capture'] || 0, rejectInvalid: vision.rejected['invalid capture'] || 0,
          } : {}) });
        performanceFrames = []; performanceVisibleMs = 0;
      }
    }
    const sceneFeedback = paused || modal || document.hidden ? { ...feedback, kind: 'blocked' } : feedback;
    scene.update(game, blocked ? 0 : dt, time / 1000, input, aligned, sceneFeedback, Boolean(cameraControls?.running || cameraControls?.starting), { preparing: Boolean(run && !recovering), nextTurnElapsed, machineControls: cabinetEnabled, cueLead }); if (frozen) scene.inspect(new URLSearchParams(location.search).get('inspect'));
    glove.update(grabEnabled ? feedback : { ...feedback, pointer: null }, cabinetEnabled && (game.phase === 'aim' || (dualEnabled && contactFeedback && game.phase === 'anticipate')) && !paused && !modal && !frozen && !document.hidden, dt);
    const tagged = game.phase === 'aim' && aligned ? game.toys.find(toy => toy.id === aligned.id) : null;
    const target = tagged ? scene.screenPoint(tagged.x, BED + (tagged.elevation || 0) + .08, tagged.z) : null;
    const tagOrigin = target ? $('prize-tags').getBoundingClientRect() : null;
    for (const { toy, element } of tags) {
      setHidden(element, !target || aligned.id !== toy.id);
      if (element.hidden) continue;
      element.style.transform = `translate(${Math.round(target.x - tagOrigin.left)}px, ${Math.round(target.y - tagOrigin.top)}px) translate(-50%, -50%)`;
      element.classList.add('targeted');
      element.textContent = scoreTurn(run?.rules || RULES, toy.id, Math.floor(remaining * 1000));
    }
  } catch (error) { fail('The game stopped unexpectedly. Reload to recover this player.', error); return; }
  requestAnimationFrame(frame);
}

// Read-only development diagnostics.
function snapshot(includeBounds = false) {
  const sorted = [...frames].sort((a, b) => a - b), average = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
  return { phase: game.phase, elapsed: game.elapsed, position: { ...game.position }, rounds: game.rounds, event: { run, remaining, turn: turnNumber, paused, board: shared ? pilot.board : currentBoard(store), complete: completedRun, storageError, handCamera: { running: cameraControls?.running || false, waiting: cameraControls?.waiting || false, feedback: cameraControls?.feedback, diagnostic: cameraControls?.diagnostic }, carouselTime: game.carouselTime, rider: game.rider, pendingSlam: pendingSlam ? { elapsed: pendingSlam.elapsed } : null, controlProfile: dualEnabled ? 'dual' : grabEnabled ? 'grab-release' : 'hold-drop', holdMs: holdMs ?? null, steering, cue: carouselCue(game.carouselTime, cueLead) }, aligned: aligned?.id || null, caught: game.plan?.prize?.id || null, contacts: game.plan?.contacts || null, claw: clawPose(game), stop: game.plan?.stop || null, collection: [...game.collection], reducedMotion: scene?.reducedMotion, camera: scene?.camera.position.toArray(), cameraLook: scene?.currentLook.toArray(), lowQuality: scene?.lowQuality, machineControls: cabinetEnabled ? scene?.controlTargets() : null, joystick: { mode: scene?.joystickHand.mode, visible: scene?.joystickHand.root.visible, progress: scene?.joystickHand.progress }, effects: { clawLean: scene?.claw.rotation.toArray().slice(0, 3), fingerRadius: scene?.fingers[0].pad.position.x + .017, burst: scene?.burst.count ?? 0 }, errors: [...errors], render: { calls: scene?.renderer.info.render.calls, triangles: scene?.renderer.info.render.triangles }, performance: { frames: frames.length, averageFps: +(1000 / average).toFixed(1), p95FrameMs: sorted[Math.floor(sorted.length * .95)], framesOver33ms: frames.filter(t => t > 33.4).length }, toys: game.toys.map(toy => ({ id: toy.id, family: toy.family, claimed: toy.claimed, position: scene?.toys.get(toy.id).position.toArray(), scale: scene?.toys.get(toy.id).scale.toArray(), bounds: includeBounds ? scene?.toyBounds(toy.id) : undefined })) };
}

function updateSavedRank(saved) {
  if (completedRun?.id !== saved.id || saved.status !== 'complete' || !Number.isInteger(saved.rank)) return;
  completedRun.rank = saved.rank;
  setText('final-sync', '');
  $('final-kicker').textContent = saved.rank === 1 ? 'TOP OF THE BOARD!' : 'RUN COMPLETE';
  $('final-rank').textContent = `SAVED · RANK #${saved.rank}`;
}
const pilot = createSharedBoard({
  enabled: shared,
  getCompletedRun: () => completedRun,
  onSaved: updateSavedRank,
  onBoard: renderBoard,
  onSyncState: state => {
    if (state.error && !observedSaveError) track('save_error', { reason: 'sync' });
    observedSaveError = Boolean(state.error);
    $('sync-message').textContent = state.error || (state.pending ? 'Score waiting to sync' : '');
    setText('final-sync', completedRun?.rank ? '' : state.error || '');
    for (const id of ['shared-reauth', 'final-reauth', 'start-reauth', 'host-reauth']) $(id).hidden = !state.needsLogin;
    renderBoard();
  },
  onConnectError: error => { $('sync-message').textContent = error.message; $('shared-reauth').hidden = error.status !== 401; renderBoard(); },
});
if (shared) {
  $('shared-access').hidden = false;
  $('operator-help').textContent = 'Shared scores persist on the pilot server. Existing runs keep their original board when you rotate. Names are display labels; scores are for fun.';
  pilot.connect();
}
for (const id of ['shared-reauth', 'final-reauth', 'start-reauth', 'host-reauth']) $(id).addEventListener('click', () => { $('staff-access').showModal(); });
$('staff-form').addEventListener('submit', async event => {
  event.preventDefault();
  // The dialog closes on login success; queued scores and the board sync after,
  // with the game unblocked (matching the pre-extraction ordering).
  try { await pilot.loginStaff($('staff-code').value); $('staff-code').value = ''; $('staff-access').close(); await pilot.flush(); await pilot.refresh(); }
  catch (error) { $('staff-message').textContent = error.message; }
});
$('host-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await pilot.loginHost($('host-code').value); $('host-code').value = ''; $('host-access').close(); openOperator(); }
  catch (error) { $('host-message').textContent = error.message; }
});
$('shared-retry').addEventListener('click', () => { $('shared-start').close(); void startScoredRun(); });
$('shared-back').addEventListener('click', () => { pendingPlayer = null; $('shared-start').close(); freshGame(); updateUI(); });
$('shared-start').addEventListener('cancel', event => event.preventDefault());

const loadingTimeout = setTimeout(() => fail('The arcade took too long to open. Reload the page to try again.'), 15000);
try {
  await new Promise(resolve => requestAnimationFrame(resolve));
  scene = new ArcadeScene($('scene'), { wideControls: cabinetEnabled && new URLSearchParams(location.search).get('controls') !== 'grab' });
  scene.groundToys(game);
  restoreTrophies();
  persist(); renderBoard();
  scene.update(game, 1 / 60, 0, { x: 0, z: 0 }, null);
  clearTimeout(loadingTimeout); clearTimeout(window.__arcadeBootTimer); document.documentElement.dataset.arcadeReady = 'true'; $('loading').hidden = true;
  if (import.meta.env.DEV) {
    window.__littleCloud = { snapshot };
    const params = new URLSearchParams(location.search), toy = game.toys.find(t => t.id === params.get('inspect'));
    if (toy) { begin(game); game.position = { x: toy.x, z: toy.z }; drop(game); advance(game, PHASES.anticipate + PHASES.descend); game.phase = params.get('phase') || 'grip'; if (!(game.phase in PHASES)) game.phase = 'grip'; game.elapsed = PHASES[game.phase] * .96; frozen = true; }
  }
  requestAnimationFrame(frame);
  syncSoundUI();
  const autoPlay = new URLSearchParams(location.search).get('start') === '1';
  if (autoPlay) { const url = new URL(location.href); url.searchParams.delete('start'); history.replaceState(null, '', url); }
  if ((!manualSetup || autoPlay) && !frozen) {
    audio.unlock();
    void startCamera().then(() => { if (autoPlay && cameraControls?.running && !run && !document.querySelector('dialog[open]')) openRegistration(); });
  }
} catch (error) { clearTimeout(loadingTimeout); fail('The 3D renderer could not start. Try reloading in Chrome or Edge with WebGL enabled. All artwork is generated locally; no additional model downloads are required.', error); }
