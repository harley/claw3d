import './arcade.css';
import { createSessionApi } from './session-api.js';
import { createPlaytestClient } from './playtest-client.js';
const shared = globalThis.__SHARED_PILOT__ === true;
import { ArcadeScene } from './arcade-scene.js';
import { createGame, begin, drop, advance, move, planGrab, clawPose, PHASES, BED, CAROUSEL, carouselCue, moveCarousel, aimTarget } from './arcade-mechanics.js';
import { RULES, STORAGE_KEY, newStore, loadStore, currentBoard, startRun, recordTurn, leaderboard, rotateBoard } from './event-session.js';

const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, document.getElementById(id)); return elements.get(id); };
const setText = (id, value) => { const text = String(value); if ($(id).textContent !== text) $(id).textContent = text; };
const setHidden = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
$('build-info').textContent = `BUILD ${__BUILD_INFO__.commit}${__BUILD_INFO__.dirty ? ' · uncommitted changes' : ''} · ${__BUILD_INFO__.branch}`;
let game = createGame({ carousel: true }), scene, previous = 0, stopped = false, frozen = false;
let cameraControls, cameraLoading = false;
let pendingPlayer = null, startingRun = false;
let sharedBoard = null, sharedRole = 'staff', sharedStatus = 'Connecting to shared leaderboard…';
let sharedApi, boardRefresh = null, boardVersion = 0, rotatingBoard = false;
let celebrationTimer, scoreAnimation;
let lastCue = '';
let lastStatus = '', aligned = null, paused = false;
let store, storageError = '', storageBlocked = false;
try { store = shared ? newStore() : loadStore(localStorage); } catch (error) { store = newStore(); storageError = error.message; storageBlocked = true; }
game.position = { x: -1.12, z: .66 };
let run = store.active, completedRun = null, turnNumber = run ? run.turns.length + 1 : 0, remaining = RULES.seconds;
let recovering = Boolean(run), sound = false, audioContext, audioMaster, volume = .5, audioActivation = 0;
const activeNotes = new Map();
const frames = [], errors = [];
const playtest = createPlaytestClient({ build: __BUILD_INFO__.commit, enabled: shared });
const track = (type, data = {}, subject = run || pendingPlayer || completedRun) => playtest.track(type, data, { mode: 'event', ...(subject?.id ? { runId: subject.id } : {}) });
track('page_open');
let observedControl = '', observedPhase = '', observedSaveError = false, cameraFailureReported = false;
let performanceFrames = [], performanceSince = 0;
const deliveryPhases = new Set(['anticipate', 'descend', 'grip', 'lift', 'transfer', 'release', 'deliver', 'reveal']);
let nextTurnElapsed = 0;
const tags = game.toys.map(toy => {
  const element = document.createElement('span'); element.className = 'prize-tag'; element.dataset.points = RULES.points[toy.id]; element.textContent = RULES.points[toy.id]; $('prize-tags').append(element); return { toy, element };
});
function persist() {
  if (shared) return;
  if (storageBlocked) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); storageError = ''; }
  catch { storageError = 'Storage unavailable. Results are in memory only. Export before closing.'; }
  $('storage-status').textContent = shared ? sharedStatus : storageError || store.notice || 'Scores saved on this browser.';
}
function renderBoard() {
  const board = shared ? sharedBoard || { name: 'Shared staff leaderboard', runs: [] } : currentBoard(store); $('board-name').textContent = board.name; $('leaders').replaceChildren();
  const leaders = shared ? board.runs : leaderboard(board); $('board-empty').hidden = leaders.length > 0;
  for (const row of leaders.slice(0, 5)) {
    const li = document.createElement('li'); li.classList.toggle('current', row.id === completedRun?.id);
    for (const [tag, value] of [['span', String(row.rank).padStart(2, '0')], ['strong', row.name], ['b', row.total]]) { const el = document.createElement(tag); el.textContent = value; li.append(el); }
    $('leaders').append(li);
  }
  const official = board.runs.filter(r => !r.practice), turns = official.flatMap(r => r.turns);
  $('operator-stats').textContent = `${official.length} completed · ${turns.length ? Math.round(turns.filter(t => t.score).length / turns.length * 100) : 0}% catch rate${shared ? '' : ` · ${store.boards.length} sessions stored`}`;
  $('storage-status').textContent = shared ? sharedStatus : storageError || store.notice || 'Scores saved on this browser.';
}
function updateSound() {
  $('sound').textContent = !sound ? 'SOUND OFF' : volume ? 'SOUND ON' : 'MUTED';
  $('sound').setAttribute('aria-pressed', String(sound));
  if (audioMaster) audioMaster.gain.setValueAtTime(sound ? volume : 0, audioContext.currentTime);
  if (!sound || !volume) {
    for (const [oscillator, gain] of activeNotes) { oscillator.stop(); oscillator.disconnect(); gain.disconnect(); }
    activeNotes.clear();
  }
}
function note(frequency, duration = .12, delay = 0, type = 'square') {
  if (!sound || !volume || !audioMaster) return;
  try {
    const t = audioContext.currentTime + delay, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, t); gain.gain.setValueAtTime(.025, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    oscillator.connect(gain); gain.connect(audioMaster); activeNotes.set(oscillator, gain);
    oscillator.onended = () => { activeNotes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(t); oscillator.stop(t + duration);
  } catch { sound = false; updateSound(); }
}
function burst(text) { $('celebration').textContent = text; $('celebration').classList.remove('pop'); void $('celebration').offsetWidth; $('celebration').classList.add('pop'); clearTimeout(celebrationTimer); celebrationTimer = setTimeout(() => $('celebration').classList.remove('pop'), 1800); }
const phaseCopy = { anticipate: 'Drop locked in', descend: 'Here we go…', grip: 'Got it?', lift: 'Hold on…', transfer: 'Coming your way', release: 'Special delivery', deliver: 'Coming your way', reveal: 'Nice catch!' };
function updateUI(feedback = cameraControls?.feedback || { kind: cameraLoading ? 'loading' : 'off' }) {
  const phase = game.phase, total = run?.turns.reduce((sum, t) => sum + t.score, 0) || completedRun?.total || 0;
  let title = 'Your hands. Your high score.', hint = 'Three turns. Make them count.', button = 'Play', kicker = 'CLOUD CLAW';
  if (recovering) { title = 'Let’s get you back in'; hint = 'Ask your host to resume.'; button = 'OPERATOR'; }
  else if (phase === 'aim') { kicker = turnNumber === 3 ? 'LAST CLAW!' : `TURN ${turnNumber} OF 3`; title = 'Move your hand'; hint = 'Clench your fist and hold to drop.'; button = '';  }
  else if (phase === 'result') { const points = run?.turns.at(-1)?.score || 0; kicker = `TURN ${turnNumber} COMPLETE`; title = points ? `+${points} · Nice catch!` : 'So close!'; hint = 'Next turn starting…'; button = '';  }
  else if (phaseCopy[phase]) { title = phaseCopy[phase]; kicker = `TURN ${turnNumber} OF 3`; hint = 'Hands down. Watch the claw.'; button = '';  }
  const cue = carouselCue(game.carouselTime), nearPickup = Math.hypot(game.position.x - CAROUSEL.x, game.position.z - (CAROUSEL.z + CAROUSEL.radius)) < .30;
  const cueVisible = phase === 'aim' && nearPickup && !paused && !frozen && !document.hidden && !document.querySelector('dialog[open]') && cameraControls?.running && !cameraControls.waiting;
  setHidden($('jackpot-signal'), !cueVisible);
  const cueKey = `${phase}:${cue.lights}:${cue.now}`; if (cueKey !== lastCue) { if (cueVisible && cue.lights) note(cue.now ? 880 : 440 + cue.lights * 110, .09); lastCue = cueKey; }
  if ($('jackpot-signal').dataset.cue !== cueKey) {
    $('jackpot-signal').dataset.cue = cueKey;
    $('jackpot-signal').classList.toggle('go', cue.now && phase === 'aim');
    setText('jackpot-cue', ['idle', 'aim'].includes(phase) ? cue.text : 'Claw in action');
    [...$('jackpot-lights').children].forEach((light, i) => light.classList.toggle('on', ['idle', 'aim'].includes(phase) && i < cue.lights));
  }
  if (phase === 'aim' && nearPickup) { title = 'Go for the star'; hint = aligned?.id === CAROUSEL.id ? 'Clench your fist and hold.' : 'Gold ring. Wait for green.'; }
  const learning = phase === 'aim' || (!run && !recovering && cameraControls?.running);
  if (learning) {
    if (feedback.kind === 'off') { title = 'Let’s see your hand'; hint = 'Open Camera to continue.'; }
    else if (['ready', 'lost'].includes(feedback.kind)) { title = feedback.kind === 'lost' ? 'Bring your hand back' : 'Show one open hand'; hint = feedback.handCount > 1 ? 'Lower one hand to begin.' : 'Hold it still in the camera.'; }
    else if (feedback.kind === 'delayed') { title = 'Tracking is catching up'; hint = 'Keep your hand steady. Close other busy tabs if this continues.'; }
    else if (feedback.kind === 'calibrating') { title = 'Hand found'; hint = 'Hold still for a moment.'; }
    else if (['clenching', 'dropping'].includes(feedback.kind) && feedback.controlEnabled) { title = feedback.progress > 0 ? 'Hold to drop' : 'Ready for a drop?'; hint = feedback.message || 'Clench your fist. Open to cancel.'; }
    else if (feedback.kind === 'tracking') {
      if (phase === 'idle') { title = 'You’re ready'; hint = 'Press Play for your three turns.'; }
      else if (!nearPickup) { title = 'Move your hand'; hint = 'Clench your fist and hold to drop.'; }
    } else if (feedback.kind === 'error') { title = 'Let’s check the camera'; hint = 'Open Camera to try again.'; }
    else if (feedback.kind === 'loading') { title = 'Waking up the camera…'; hint = 'Allow camera access to play.'; }
  }
  if (startingRun) { title = 'Getting your run ready'; hint = 'Connecting to the leaderboard…'; }
  const holding = phase === 'aim' && feedback.controlEnabled && ['clenching', 'dropping'].includes(feedback.kind);
  const progress = holding ? Math.round(Math.max(0, Math.min(1, feedback.progress || 0)) * 100) : 0;
  setHidden($('gesture-meter'), !holding);
  if ($('gesture-meter').getAttribute('aria-valuenow') !== String(progress)) {
    $('gesture-meter').setAttribute('aria-valuenow', String(progress));
    $('gesture-progress').style.transform = `scaleX(${progress / 100})`;
  }
  const control = deliveryPhases.has(phase) ? 'delivery' : holding ? 'holding' : feedback.controlEnabled && feedback.kind === 'tracking' ? 'tracking' : feedback.kind;
  if ($('arcade').dataset.control !== control) $('arcade').dataset.control = control;
  const cameraLabels = { ready: 'Camera view', calibrating: 'Hand found', tracking: 'Hand found', accepted: 'Drop confirmed', lost: 'Hand out of view', delayed: 'Tracking delayed', clenching: 'Fist found', dropping: 'Hands found', loading: 'Starting camera', off: 'Camera off', error: 'Check camera' };
  setText('camera-recognition', cameraLabels[feedback.kind] || 'Camera view');
  if ($('camera-preview').dataset.state !== feedback.kind) $('camera-preview').dataset.state = feedback.kind;
  $('reset').disabled = startingRun;
  setText('timer', String(Math.ceil(remaining)).padStart(2, '0'));
  $('arcade').classList.toggle('last-claw', Boolean(run && turnNumber === 3)); $('arcade').classList.toggle('urgent', phase === 'aim' && remaining <= 5);
  setText('mode-label', shared ? sharedStatus : storageError ? 'LOCAL PREVIEW · UNSAVED' : 'LOCAL PREVIEW');
  setHidden($('mode-label'), !$('mode-label').textContent);
  setHidden($('result-open'), !completedRun || startingRun || Boolean(run) || cameraLoading);
  if (!run && !recovering) button = cameraLoading ? 'Starting…' : cameraControls?.running ? 'Play' : 'Start camera';
  const cameraRecovery = Boolean(run && !recovering && phase === 'aim' && !cameraControls?.running);
  if (cameraRecovery) {
    button = cameraLoading ? 'Starting…' : 'Restart camera';
    if (!cameraLoading) hint = 'Restart camera to continue this turn.';
  }
  const signature = JSON.stringify([title, hint, button, kicker, total, run?.name, pendingPlayer?.name, completedRun?.id, paused]);
  if (signature === lastStatus) return; lastStatus = signature;
  $('player-name').textContent = run?.name || pendingPlayer?.name || completedRun?.name || 'Your turn?'; $('score').textContent = String(total).padStart(3, '0'); $('turn').textContent = run ? `${turnNumber} / 3` : '— / 3';
  $('phase-label').textContent = kicker; $('status').textContent = title; $('hint').textContent = hint; $('button-text').textContent = button;
  $('play').hidden = Boolean(startingRun || (run && !recovering && !cameraRecovery));
  $('play').disabled = paused || cameraLoading;
  $('turn-chips').replaceChildren();
  for (let i = 0; i < 3; i++) { const turn = run?.turns[i] || completedRun?.turns[i]; const chip = document.createElement('span'); chip.className = `turn-chip ${turn?.score ? 'scored' : ''}`; chip.textContent = turn ? turn.score ? `+${turn.score}` : 'MISS' : '—'; $('turn-chips').append(chip); }
}
function freshGame() { cameraControls?.reset(); game = createGame({ carousel: true }); game.position = { x: -1.12, z: .66 }; scene?.groundToys(game); aligned = null; lastStatus = ''; }
function beginTurn() {
  nextTurnElapsed = 0;
  freshGame(); turnNumber = run.turns.length + 1; remaining = run.rules.seconds; begin(game); recovering = false;
  if (turnNumber === 3) { burst('LAST CLAW!'); [330, 440, 660].forEach((f, i) => note(f, .16, i * .15)); }
  else { burst(turnNumber === 1 ? `${run.name.toUpperCase()}, YOU’RE UP!` : `TURN ${turnNumber}`); note(523); }
  updateUI();
}
function openRegistration(name = $('name').value) {
  if (stopped || !scene || startingRun) return;
  $('name').setCustomValidity(''); $('name').value = name;
  $('registration').showModal(); $('name').focus(); $('name').select();
}
function finishTurn() {
  if (!run) return;
  const outcome = recordTurn(store, turnNumber, game.plan?.prize?.id || null); if (!outcome) return;
  persist();
  track('turn_complete', { turn: turnNumber, score: outcome.run.turns.at(-1).score, prizeId: outcome.run.turns.at(-1).prizeId }, outcome.run);
  if (shared) sharedApi.queue(outcome.run);
  const points = outcome.run.turns.at(-1).score;
  if (points) { burst(outcome.run.turns.at(-1).prizeId === CAROUSEL.id ? `JACKPOT +${points}` : `+${points}`); [523, 659, 784, 1047].forEach((f, i) => note(f, .18, i * .11)); } else note(165, .25, 0, 'triangle');
  if (outcome.completed) {
    track('run_complete', { score: outcome.run.total }, outcome.run);
    completedRun = outcome.run; run = null; renderBoard();
    $('final-name').textContent = completedRun.name.toUpperCase(); $('final-score').textContent = String(completedRun.total).padStart(3, '0');
    const rank = shared ? undefined : leaderboard(currentBoard(store)).find(r => r.id === completedRun.id)?.rank;
    $('final-kicker').textContent = rank === 1 ? 'TOP OF THE BOARD!' : 'RUN COMPLETE';
    $('final-rank').textContent = shared ? 'Score waiting to sync' : rank ? `LOCAL PREVIEW · RANK #${rank}` : 'LOCAL PREVIEW';
    setText('final-board', `Board: ${completedRun.boardName || store.boards.find(board => board.id === completedRun.boardId)?.name || completedRun.boardId}`);
    $('final-turns').replaceChildren();
    for (const turn of completedRun.turns) { const chip = document.createElement('span'); chip.className = 'turn-chip scored'; chip.textContent = `+${turn.score}`; const name = document.createElement('small'); name.textContent = game.toys.find(t => t.id === turn.prizeId)?.name || 'Miss'; chip.append(name); $('final-turns').append(chip); }
    setText('final-sync', shared ? sharedApi.state().error : storageError);
    $('final').showModal(); $('play-again').focus();
    if (!scene.reducedMotion) { const total = completedRun.total, start = performance.now(); const count = time => { if (!$('final').open) return; const progress = Math.min(1, (time - start) / 850); $('final-score').textContent = String(Math.round(total * (1 - (1 - progress) ** 3))).padStart(3, '0'); if (progress < 1) scoreAnimation = requestAnimationFrame(count); }; scoreAnimation = requestAnimationFrame(count); }
  }
}
function play() {
  if (!scene || stopped || frozen || paused || document.querySelector('dialog[open]')) return;
  if (recovering) return openOperator();
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
      const issued = await sharedApi.start(pendingPlayer.name, pendingPlayer.requestKey);
      // Presentation accumulates turns under the acknowledged immutable rule snapshot.
      store = { version: 1, current: issued.boardId, boards: [{ id: issued.boardId, name: sharedBoard?.id === issued.boardId ? sharedBoard.name : issued.boardId, rules: issued.rules, runs: [] }], active: issued };
      run = issued;
      run.boardName = store.boards[0].name;
    } else run = startRun(store, pendingPlayer.name);
    track('run_start', {}, run);
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
  if (!run || game.phase !== 'aim' || startingRun || paused || frozen || stopped || document.hidden || document.querySelector('dialog[open]')) return false;
  if (!drop(game)) return false;
  track('drop', { trigger: 'gesture', phase: game.phase, turn: turnNumber });
  note(220, .2); updateUI();
  return true;
}
function fail(message, error) { track('client_error', { reason: 'renderer' }); stopped = true; cameraControls?.stop(); clearTimeout(window.__arcadeBootTimer); errors.push(String(error || message)); $('loading').hidden = true; $('error').hidden = false; $('error-message').textContent = message; console.error('Cloud Claw:', error || message); }
function openOperator() { if (shared && sharedRole !== 'host') { $('host-access').showModal(); return; } renderBoard(); $('operator').showModal(); $('pause').textContent = recovering ? 'RESUME INTERRUPTED TURN' : paused ? 'RESUME GAME' : 'PAUSE GAME'; }
document.addEventListener('visibilitychange', () => { previous = 0; });
$('player-form').addEventListener('submit', event => { event.preventDefault(); if (!scene || stopped || !cameraControls?.running) return;
  if (startingRun || run) return;
  const name = $('name').value.trim() || 'Player';
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
$('operator-open').addEventListener('click', openOperator);
$('pause').addEventListener('click', () => { if (recovering) { beginTurn(); paused = false; } else paused = !paused; $('operator').close(); $('scene').focus(); });
$('reset').addEventListener('click', () => { if (startingRun) return; if (shared && run) sharedApi.abandon(run); if (store.active) { store.active.abortedAt = new Date().toISOString(); store.active = null; } run = null; pendingPlayer = null; completedRun = null; recovering = paused = frozen = false; persist(); freshGame(); $('operator').close(); updateUI(); });
$('new-board').addEventListener('click', async () => {
  if (shared) {
    if (rotatingBoard) return;
    rotatingBoard = true; boardVersion++; $('new-board').disabled = true;
    try {
      sharedBoard = await sharedApi.request('/host/boards', { name: $('session-name').value.trim() || 'Cloud Claw · Staff pilot' });
      renderBoard(); $('operator-message').textContent = 'New shared board started. Existing runs finish on their original board.';
    } catch (error) { $('operator-message').textContent = error.message; }
    finally { boardVersion++; rotatingBoard = false; $('new-board').disabled = false; }
    return;
  }
  try { rotateBoard(store, $('session-name').value); persist(); completedRun = null; renderBoard(); $('operator-message').textContent = 'New leaderboard started. Previous results are preserved.'; }
  catch (error) { $('operator-message').textContent = error.message; }
});
$('export').addEventListener('click', () => { if (shared) { window.location.assign('/api/host/export'); return; } let data = JSON.stringify(store, null, 2); if (storageBlocked) { try { data = localStorage.getItem(STORAGE_KEY) || data; } catch { /* In-memory export remains available. */ } } const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `cloud-claw-sessions-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('quality').addEventListener('click', () => { if (!scene) return; scene.setQuality(!scene.lowQuality); $('quality').textContent = `QUALITY: ${scene.lowQuality ? 'SIMPLE' : 'FULL'}`; });
$('sound').addEventListener('click', () => {
  sound = !sound;
  const activation = ++audioActivation;
  if (sound) {
    try {
      audioContext ??= new AudioContext();
      if (!audioMaster) { audioMaster = audioContext.createGain(); audioMaster.connect(audioContext.destination); }
      audioContext.resume().catch(() => { if (activation === audioActivation) { sound = false; updateSound(); } });
    } catch { sound = false; }
  }
  updateSound(); note(523);
});
$('sound-volume').addEventListener('input', () => {
  volume = Number($('sound-volume').value) / 100;
  $('sound-level').textContent = `${Math.round(volume * 100)}%`;
  updateSound();
});
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
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('hint').textContent = 'Use your browser’s fullscreen command.'; } });
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
      cameraControls = await createCameraControls({ video: $('camera-video'), overlay: $('camera-overlay'), select: $('camera-select'),
        canControl: () => Boolean(!startingRun && run && game.phase === 'aim' && !paused && !frozen && !stopped && !document.hidden && !document.querySelector('dialog[open]')),
        onDrop: gestureDrop,
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
    if (cameraControls.running) { track('camera_ready'); $('camera-setup').close(); }
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
$('scene').addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The renderer stopped. Reload, then ask your host to resume the interrupted turn.'); });
function frame(time) {
  if (stopped) return;
  const raw = previous ? (time - previous) / 1000 : 1 / 60, dt = Math.min(raw, .05); previous = time;
  if (import.meta.env.DEV && !document.hidden) { frames.push(raw * 1000); if (frames.length > 1800) frames.shift(); }
  const aiming = game.phase === 'aim', modal = Boolean(document.querySelector('dialog[open]'));
  const cameraWaiting = aiming && (!cameraControls?.running || cameraControls.waiting);
  // Only explicit operator pause stops a drop already in flight.
  const blocked = paused || (aiming && (cameraWaiting || modal || document.hidden));
  setHidden($('pause-banner'), !paused);
  setText('pause-banner', 'Paused by host');
  const input = { ...cameraControls?.input || { x: 0, z: 0 } };
  if (!frozen && !blocked && !document.hidden) {
    if (aiming) { game.position = move(game.position, input, dt); moveCarousel(game, dt); aligned = aimTarget(game);
      const before = Math.ceil(remaining); remaining = Math.max(0, remaining - dt); if (Math.ceil(remaining) < before && remaining <= 5) note(remaining < 1 ? 220 : 440, .08); if (!remaining && drop(game)) track('drop', { trigger: 'timeout', phase: game.phase, turn: turnNumber });
    } else {
      input.x = input.z = 0;
      if (game.phase === 'idle') moveCarousel(game, dt);
      if (game.phase === 'result' && run && !recovering && !modal) { nextTurnElapsed += dt; if (nextTurnElapsed >= 2) beginTurn(); }
      const before = game.phase; advance(game, dt); if (game.phase === 'result' && before !== 'result') finishTurn();
    }
  } else input.x = input.z = 0;
  try {
    const feedback = cameraControls?.feedback || { kind: 'off', progress: 0, controlEnabled: false };
    updateUI(feedback);
    if (feedback.kind !== observedControl) { observedControl = feedback.kind; track('control_state', { state: feedback.kind, phase: game.phase }); }
    if (game.phase !== observedPhase) { observedPhase = game.phase; track('phase_change', { phase: game.phase }); }
    if (!document.hidden) {
      performanceFrames.push(raw * 1000); if (performanceFrames.length > 1800) performanceFrames.shift();
      if (time - performanceSince >= 30000) {
        const sorted = [...performanceFrames].sort((a, b) => a - b);
        track('performance', { frames: sorted.length, averageFps: Math.min(1000, 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length)), p95FrameMs: Math.min(60000, sorted[Math.floor(sorted.length * .95)]), framesOver33ms: sorted.filter(ms => ms > 33.4).length });
        performanceFrames = []; performanceSince = time;
      }
    }
    if (paused || modal || document.hidden) feedback.kind = 'blocked';
    scene.update(game, blocked ? 0 : dt, time / 1000, input, aligned, feedback, Boolean(cameraControls?.running || cameraControls?.starting)); if (frozen) scene.inspect(new URLSearchParams(location.search).get('inspect'));
    const tagged = game.phase === 'aim' && aligned ? game.toys.find(toy => toy.id === aligned.id) : null;
    const target = tagged ? scene.screenPoint(tagged.x, BED + (tagged.elevation || 0) + .08, tagged.z) : null;
    for (const { toy, element } of tags) {
      setHidden(element, !target || aligned.id !== toy.id);
      if (element.hidden) continue;
      element.style.transform = `translate(${Math.round(target.x)}px, ${Math.round(target.y)}px) translate(-50%, -50%)`;
      element.classList.add('targeted');
    }
  } catch (error) { fail('The game stopped unexpectedly. Reload to recover this player.', error); return; }
  requestAnimationFrame(frame);
}

// Read-only development diagnostics.
function snapshot(includeBounds = false) {
  const sorted = [...frames].sort((a, b) => a - b), average = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
  return { phase: game.phase, elapsed: game.elapsed, position: { ...game.position }, rounds: game.rounds, event: { run, remaining, turn: turnNumber, paused, board: shared ? sharedBoard : currentBoard(store), complete: completedRun, storageError, handCamera: { running: cameraControls?.running || false, waiting: cameraControls?.waiting || false, feedback: cameraControls?.feedback, diagnostic: cameraControls?.diagnostic }, carouselTime: game.carouselTime, cue: carouselCue(game.carouselTime) }, aligned: aligned?.id || null, caught: game.plan?.prize?.id || null, contacts: game.plan?.contacts || null, claw: clawPose(game), stop: game.plan?.stop || null, collection: [...game.collection], reducedMotion: scene?.reducedMotion, camera: scene?.camera.position.toArray(), lowQuality: scene?.lowQuality, joystick: { mode: scene?.joystickHand.mode, visible: scene?.joystickHand.root.visible, progress: scene?.joystickHand.progress }, errors: [...errors], render: { calls: scene?.renderer.info.render.calls, triangles: scene?.renderer.info.render.triangles }, performance: { frames: frames.length, averageFps: +(1000 / average).toFixed(1), p95FrameMs: sorted[Math.floor(sorted.length * .95)], framesOver33ms: frames.filter(t => t > 33.4).length }, toys: game.toys.map(toy => ({ id: toy.id, family: toy.family, claimed: toy.claimed, position: scene?.toys.get(toy.id).position.toArray(), scale: scene?.toys.get(toy.id).scale.toArray(), bounds: includeBounds ? scene?.toyBounds(toy.id) : undefined })) };
}

function updateSavedRank(saved) {
  if (completedRun?.id !== saved.id || saved.status !== 'complete' || !Number.isInteger(saved.rank)) return;
  completedRun.rank = saved.rank;
  setText('final-sync', '');
  $('final-kicker').textContent = saved.rank === 1 ? 'TOP OF THE BOARD!' : 'RUN COMPLETE';
  $('final-rank').textContent = `SAVED · RANK #${saved.rank}`;
}
async function refreshSharedBoard() {
  if (!sharedApi || rotatingBoard) return;
  if (boardRefresh) return boardRefresh;
  const version = boardVersion;
  boardRefresh = Promise.resolve().then(async () => {
    try {
      const board = await sharedApi.request('/board');
      if (version !== boardVersion) return;
      sharedBoard = board;
      if (completedRun) updateSavedRank(await sharedApi.request(`/runs/${completedRun.id}`));
      if (!sharedApi.state().pending && !sharedApi.state().error) sharedStatus = 'SHARED STAFF LEADERBOARD';
      renderBoard();
    } catch (error) { if (version === boardVersion) { sharedStatus = error.status === 401 ? 'SIGN IN TO SYNC' : 'LEADERBOARD OFFLINE · RETRYING'; renderBoard(); } }
  }).finally(() => { boardRefresh = null; });
  return boardRefresh;
}
if (shared) {
  $('shared-access').hidden = false;
  $('operator-help').textContent = 'Shared scores persist on the pilot server. Existing runs keep their original board when you rotate. Names are display labels; scores are for fun.';
  sharedApi = createSessionApi({ onChange: state => {
    if (state.saved) { updateSavedRank(state.saved); void refreshSharedBoard(); return; }
    if (state.error && !observedSaveError) track('save_error', { reason: 'sync' });
    observedSaveError = Boolean(state.error);
    sharedStatus = state.error || (state.pending ? 'Score waiting to sync' : 'SHARED STAFF LEADERBOARD');
    $('sync-message').textContent = state.error || (state.pending ? 'Score waiting to sync' : '');
    setText('final-sync', completedRun?.rank ? '' : state.error || '');
    $('shared-reauth').hidden = !state.needsLogin;
    $('final-reauth').hidden = !state.needsLogin;
    $('start-reauth').hidden = !state.needsLogin;
    $('host-reauth').hidden = !state.needsLogin;
    if (state.needsLogin) sharedRole = 'staff';
    renderBoard();
  } });
  sharedApi.initialize().then(session => { sharedRole = session.role; if (!boardVersion) sharedBoard = session.board; renderBoard(); })
    .catch(error => { sharedStatus = 'SHARED SERVICE UNAVAILABLE'; $('sync-message').textContent = error.message; $('shared-reauth').hidden = error.status !== 401; renderBoard(); });
  setInterval(() => { void sharedApi.flush(); void refreshSharedBoard(); }, 2000);
  window.addEventListener('online', () => { void sharedApi.flush(); void refreshSharedBoard(); });
}
for (const id of ['shared-reauth', 'final-reauth', 'start-reauth', 'host-reauth']) $(id).addEventListener('click', () => { $('staff-access').showModal(); });
$('staff-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await sharedApi.request('/login', { code: $('staff-code').value }); $('staff-code').value = ''; $('staff-access').close(); await sharedApi.flush(); await refreshSharedBoard(); }
  catch (error) { $('staff-message').textContent = error.message; }
});
$('host-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await sharedApi.request('/host/login', { code: $('host-code').value }); $('host-code').value = ''; sharedRole = 'host'; $('host-access').close(); openOperator(); }
  catch (error) { $('host-message').textContent = error.message; }
});
$('shared-retry').addEventListener('click', () => { $('shared-start').close(); void startScoredRun(); });
$('shared-back').addEventListener('click', () => { pendingPlayer = null; $('shared-start').close(); freshGame(); updateUI(); });
$('shared-start').addEventListener('cancel', event => event.preventDefault());

const loadingTimeout = setTimeout(() => fail('The arcade took too long to open. Reload the page to try again.'), 15000);
try {
  await new Promise(resolve => requestAnimationFrame(resolve));
  scene = new ArcadeScene($('scene'));
  scene.groundToys(game);
  persist(); renderBoard();
  scene.update(game, 1 / 60, 0, { x: 0, z: 0 }, null);
  clearTimeout(loadingTimeout); clearTimeout(window.__arcadeBootTimer); document.documentElement.dataset.arcadeReady = 'true'; $('loading').hidden = true;
  if (import.meta.env.DEV) {
    window.__littleCloud = { snapshot };
    const params = new URLSearchParams(location.search), toy = game.toys.find(t => t.id === params.get('inspect'));
    if (toy) { begin(game); game.position = { x: toy.x, z: toy.z }; drop(game); advance(game, PHASES.anticipate + PHASES.descend); game.phase = params.get('phase') || 'grip'; if (!(game.phase in PHASES)) game.phase = 'grip'; game.elapsed = PHASES[game.phase] * .96; frozen = true; }
  }
  requestAnimationFrame(frame);
} catch (error) { clearTimeout(loadingTimeout); fail('The 3D renderer could not start. Try reloading in Chrome or Edge with WebGL enabled. All artwork is generated locally; no additional model downloads are required.', error); }
