import './arcade.css';
import { createSessionApi } from './session-api.js';
const shared = globalThis.__SHARED_PILOT__ === true;
import { ArcadeScene } from './arcade-scene.js';
import { createGame, begin, drop, advance, move, planGrab, clawPose, PHASES, BED, CAROUSEL, carouselCue, moveCarousel, aimTarget } from './arcade-mechanics.js';
import { RULES, STORAGE_KEY, newStore, loadStore, currentBoard, startRun, recordTurn, leaderboard, rotateBoard } from './event-session.js';

const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, document.getElementById(id)); return elements.get(id); };
const setText = (id, value) => { const text = String(value); if ($(id).textContent !== text) $(id).textContent = text; };
$('build-info').textContent = `BUILD ${__BUILD_INFO__.commit}${__BUILD_INFO__.dirty ? ' · uncommitted changes' : ''} · ${__BUILD_INFO__.branch}`;
let game = createGame({ carousel: true }), scene, previous = 0, stopped = false, frozen = false;
let cameraControls, cameraLoading = false;
let rehearsal = null, pendingPlayer = null, startingRun = false;
let sharedBoard = null, sharedRole = 'staff', sharedStatus = 'Connecting to shared leaderboard…';
let sharedApi, boardRefresh = null, boardVersion = 0, rotatingBoard = false;
const practiceMarker = { x: -.65, z: .50 };
let celebrationTimer;
let lastCue = '';
let lastStatus = '', aligned = null, paused = false;
let store, storageError = '', storageBlocked = false;
try { store = shared ? newStore() : loadStore(localStorage); } catch (error) { store = newStore(); storageError = error.message; storageBlocked = true; }
game.position = { x: -1.12, z: .66 };
let run = store.active, completedRun = null, turnNumber = run ? run.turns.length + 1 : 0, remaining = RULES.seconds;
let recovering = Boolean(run), sound = false, audioContext;
const frames = [], errors = [];
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
function note(frequency, duration = .12, delay = 0, type = 'square') {
  if (!sound) return;
  try { audioContext ??= new AudioContext(); audioContext.resume().catch(() => {});
    const t = audioContext.currentTime + delay, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, t); gain.gain.setValueAtTime(.025, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(t); oscillator.stop(t + duration);
  } catch { sound = false; $('sound').textContent = 'SOUND OFF'; $('sound').setAttribute('aria-pressed', 'false'); }
}
function burst(text) { $('celebration').textContent = text; $('celebration').classList.remove('pop'); void $('celebration').offsetWidth; $('celebration').classList.add('pop'); clearTimeout(celebrationTimer); celebrationTimer = setTimeout(() => $('celebration').classList.remove('pop'), 1800); }
const phaseCopy = { anticipate: 'Drop locked in', descend: 'Here we go…', grip: 'Got it?', lift: 'Hold on…', transfer: 'Coming your way', release: 'Special delivery', deliver: 'Coming your way', reveal: 'Nice catch!' };
function updateUI(feedback = cameraControls?.feedback || { kind: cameraLoading ? 'loading' : 'off' }) {
  const phase = game.phase, total = run?.turns.reduce((sum, t) => sum + t.score, 0) || completedRun?.total || 0;
  let title = 'Your hands. Your high score.', hint = 'Three turns. Make them count.', button = 'Play', kicker = 'CLOUD CLAW';
  if (recovering) { title = 'Let’s get you back in'; hint = 'Ask your host to resume.'; button = 'OPERATOR'; }
  else if (phase === 'aim') { kicker = turnNumber === 3 ? 'LAST CLAW!' : `TURN ${turnNumber} OF 3`; title = 'Move your hand'; hint = 'Hands apart, then together to drop.'; button = '';  }
  else if (phase === 'result') { const points = run?.turns.at(-1)?.score || 0; kicker = `TURN ${turnNumber} COMPLETE`; title = points ? `+${points} · Nice catch!` : 'So close!'; hint = 'Next turn starting…'; button = '';  }
  else if (phaseCopy[phase]) { title = phaseCopy[phase]; kicker = `TURN ${turnNumber} OF 3`; hint = 'Hands down. Watch the claw.'; button = '';  }
  const cue = carouselCue(game.carouselTime), nearPickup = Math.hypot(game.position.x - CAROUSEL.x, game.position.z - (CAROUSEL.z + CAROUSEL.radius)) < .30;
  const cueKey = `${phase}:${cue.lights}:${cue.now}`; if (cueKey !== lastCue) { if (phase === 'aim' && cue.lights) note(cue.now ? 880 : 440 + cue.lights * 110, .09); lastCue = cueKey; }
  if ($('jackpot-signal').dataset.cue !== cueKey) {
    $('jackpot-signal').dataset.cue = cueKey;
    $('jackpot-signal').classList.toggle('go', cue.now && phase === 'aim');
    setText('jackpot-cue', ['idle', 'aim'].includes(phase) ? cue.text : 'Claw in action');
    [...$('jackpot-lights').children].forEach((light, i) => light.classList.toggle('on', ['idle', 'aim'].includes(phase) && i < cue.lights));
  }
  $('jackpot-signal').hidden = phase !== 'aim' || Boolean(rehearsal) || !nearPickup;
  if (phase === 'aim' && !rehearsal && nearPickup) { title = 'Go for the star'; hint = aligned?.id === CAROUSEL.id ? 'Bring hands together and hold.' : 'Gold ring. Wait for green.'; }
  if (rehearsal) {
    kicker = 'PRACTICE · NO SCORE';
    title = rehearsal === 'delivery' ? phaseCopy[phase] || 'Watch the claw' : rehearsal === 'complete' ? 'You’ve got it' : 'Move your hand';
    hint = rehearsal === 'delivery' ? 'Hands down. Watch the claw.' : rehearsal === 'complete' ? 'Your three turns start next.' : 'Try the ring, or drop anywhere.';
    button = '';
  }
  const learning = phase === 'aim' || (!run && !recovering && !rehearsal && cameraControls?.running);
  if (learning) {
    if (feedback.kind === 'off') { title = 'Let’s see your hand'; hint = 'Open Camera to continue.'; }
    else if (['ready', 'lost'].includes(feedback.kind)) { title = feedback.kind === 'lost' ? 'Bring your hand back' : 'Show one open hand'; hint = feedback.handCount > 1 ? 'Lower one hand to begin.' : 'Hold it still in the camera.'; }
    else if (feedback.kind === 'calibrating') { title = 'Hand found'; hint = 'Hold still for a moment.'; }
    else if (['clasping', 'dropping'].includes(feedback.kind) && feedback.controlEnabled) { title = feedback.progress > 0 ? 'Hold to drop' : 'Ready for a drop?'; hint = feedback.message || 'Hands apart, then together. Keep a small gap.'; }
    else if (feedback.kind === 'tracking') {
      if (phase === 'idle') { title = 'You’re ready'; hint = 'Press Play for a quick practice.'; }
      else if (!nearPickup || rehearsal) { title = 'Move your hand'; hint = rehearsal === 'steer' ? 'Try the ring, or bring hands together to drop.' : 'Hands apart, then together to drop.'; }
    } else if (feedback.kind === 'error') { title = 'Let’s check the camera'; hint = 'Open Camera to try again.'; }
    else if (feedback.kind === 'loading') { title = 'Waking up the camera…'; hint = 'Allow camera access to play.'; }
  }
  if (startingRun) { title = 'Getting your run ready'; hint = 'Connecting to the leaderboard…'; }
  const holding = phase === 'aim' && feedback.controlEnabled && ['clasping', 'dropping'].includes(feedback.kind);
  const progress = holding ? Math.round(Math.max(0, Math.min(1, feedback.progress || 0)) * 100) : 0;
  $('gesture-meter').hidden = !holding;
  if ($('gesture-meter').getAttribute('aria-valuenow') !== String(progress)) {
    $('gesture-meter').setAttribute('aria-valuenow', String(progress));
    $('gesture-progress').style.transform = `scaleX(${progress / 100})`;
  }
  const control = deliveryPhases.has(phase) ? 'delivery' : holding ? 'holding' : feedback.controlEnabled && feedback.kind === 'tracking' ? 'tracking' : feedback.kind;
  if ($('arcade').dataset.control !== control) $('arcade').dataset.control = control;
  const cameraLabels = { ready: 'Camera view', calibrating: 'Hand found', tracking: 'Hand found', accepted: 'Drop confirmed', lost: 'Hand out of view', clasping: 'Hands found', dropping: 'Hands found', loading: 'Starting camera', off: 'Camera off', error: 'Check camera' };
  setText('camera-recognition', cameraLabels[feedback.kind] || 'Camera view');
  if ($('camera-preview').dataset.state !== feedback.kind) $('camera-preview').dataset.state = feedback.kind;
  $('rehearsal-exit').hidden = !rehearsal;
  $('rehearsal-exit').disabled = startingRun || rehearsal === 'delivery';
  $('reset').disabled = startingRun;
  setText('timer', String(Math.ceil(remaining)).padStart(2, '0'));
  $('arcade').classList.toggle('last-claw', Boolean(run && turnNumber === 3)); $('arcade').classList.toggle('urgent', phase === 'aim' && remaining <= 5);
  setText('mode-label', shared ? (run?.practice ? 'PRACTICE · NOT RANKED' : sharedStatus) : storageError ? 'UNSAVED · OPEN OPERATOR' : run?.practice ? 'PRACTICE · NOT RANKED' : '');
  $('mode-label').hidden = !$('mode-label').textContent;
  if (!run && !recovering && !rehearsal) button = cameraLoading ? 'Starting…' : cameraControls?.running ? 'Play' : 'Start camera';
  const signature = JSON.stringify([title, hint, button, kicker, total, run?.name, pendingPlayer?.name, completedRun?.id, paused]);
  if (signature === lastStatus) return; lastStatus = signature;
  $('player-name').textContent = run?.name || pendingPlayer?.name || completedRun?.name || 'Your turn?'; $('score').textContent = String(total).padStart(3, '0'); $('turn').textContent = run ? `${turnNumber} / 3` : '— / 3';
  $('phase-label').textContent = kicker; $('status').textContent = title; $('hint').textContent = hint; $('button-text').textContent = button;
  $('play').hidden = Boolean(rehearsal || (run && !recovering));
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
function openRegistration() { if (stopped || !scene) return; $('name').value = ''; $('registration').showModal(); $('name').focus(); }
function finishTurn() {
  if (rehearsal) {
    if (rehearsal === 'delivery') { rehearsal = 'complete'; nextTurnElapsed = 0; }
    return;
  }
  if (!run) return;
  const outcome = recordTurn(store, turnNumber, game.plan?.prize?.id || null); if (!outcome) return;
  persist();
  if (shared && !outcome.run.practice) sharedApi.queue(outcome.run);
  const points = outcome.run.turns.at(-1).score;
  if (points) { burst(outcome.run.turns.at(-1).prizeId === CAROUSEL.id ? `JACKPOT +${points}` : `+${points}`); [523, 659, 784, 1047].forEach((f, i) => note(f, .18, i * .11)); } else note(165, .25, 0, 'triangle');
  if (outcome.completed) {
    completedRun = outcome.run; run = null; renderBoard();
    $('final-name').textContent = completedRun.name.toUpperCase(); $('final-score').textContent = String(completedRun.total).padStart(3, '0');
    const rank = shared ? undefined : leaderboard(currentBoard(store)).find(r => r.id === completedRun.id)?.rank;
    $('final-kicker').textContent = completedRun.practice ? 'PRACTICE COMPLETE' : rank === 1 ? 'TOP OF THE BOARD!' : 'RUN COMPLETE';
    $('final-rank').textContent = completedRun.practice ? 'Practice · unranked' : shared ? 'Score waiting to sync' : `RANK #${rank}`;
    $('final-turns').replaceChildren();
    for (const turn of completedRun.turns) { const chip = document.createElement('span'); chip.className = 'turn-chip scored'; chip.textContent = `+${turn.score}`; const name = document.createElement('small'); name.textContent = game.toys.find(t => t.id === turn.prizeId)?.name || 'Miss'; chip.append(name); $('final-turns').append(chip); }
    $('final').showModal(); $('next-player').focus();
    if (!scene.reducedMotion) { const total = completedRun.total, start = performance.now(); const count = time => { if (!$('final').open) return; const progress = Math.min(1, (time - start) / 850); $('final-score').textContent = String(Math.round(total * (1 - (1 - progress) ** 3))).padStart(3, '0'); if (progress < 1) requestAnimationFrame(count); }; requestAnimationFrame(count); }
  }
}
function play() {
  if (!scene || stopped || frozen || paused || document.querySelector('dialog[open]')) return;
  if (recovering) return openOperator();
  if (!run) { if (!cameraControls?.running) return startCamera(); return openRegistration(); }
  updateUI();
}
async function startScoredRun() {
  if (startingRun || !pendingPlayer || rehearsal !== 'complete') return;
  startingRun = true;
  try {
    if (shared && !pendingPlayer.practice) {
      pendingPlayer.requestKey ??= crypto.randomUUID();
      const issued = await sharedApi.start(pendingPlayer.name, pendingPlayer.requestKey);
      // Presentation accumulates turns under the acknowledged immutable rule snapshot.
      store = { version: 1, current: issued.boardId, boards: [{ id: issued.boardId, name: '', rules: issued.rules, runs: [] }], active: issued };
      run = issued;
    } else run = startRun(store, pendingPlayer.name, pendingPlayer.practice);
    pendingPlayer = null; rehearsal = null; completedRun = null; persist(); beginTurn();
    $('shared-start').close();
  } catch (error) {
    if (shared) {
      $('shared-start-message').textContent = `Ranked start unavailable. ${error.message}`;
      $('shared-start').showModal();
    } else {
      rehearsal = null; freshGame(); $('registration').showModal();
      $('name').setCustomValidity(error.message); $('name').reportValidity();
    }
  } finally { startingRun = false; updateUI(); }
}
function gestureDrop() {
  if ((!run && !rehearsal) || game.phase !== 'aim' || startingRun || paused || frozen || stopped || document.hidden || document.querySelector('dialog[open]')) return false;
  if (!drop(game)) return false;
  if (rehearsal) rehearsal = 'delivery';
  note(220, .2); updateUI();
  return true;
}
function fail(message, error) { stopped = true; cameraControls?.stop(); clearTimeout(window.__arcadeBootTimer); errors.push(String(error || message)); $('loading').hidden = true; $('error').hidden = false; $('error-message').textContent = message; console.error('Cloud Claw:', error || message); }
function openOperator() { if (shared && sharedRole !== 'host') { $('host-access').showModal(); return; } renderBoard(); $('operator').showModal(); $('pause').textContent = recovering ? 'RESUME INTERRUPTED TURN' : paused ? 'RESUME GAME' : 'PAUSE GAME'; }
document.addEventListener('visibilitychange', () => { previous = 0; });
$('player-form').addEventListener('submit', event => { event.preventDefault(); if (!scene || stopped || !cameraControls?.running) return;
  const name = $('name').value.trim();
  if (!name) { $('name').setCustomValidity('Enter a name for the leaderboard.'); $('name').reportValidity(); return; }
  pendingPlayer = { name, practice: $('practice').checked || storageBlocked };
  $('registration').close(); $('scene').focus();
  freshGame(); remaining = RULES.seconds; rehearsal = 'steer'; begin(game); updateUI();
});
$('name').addEventListener('input', () => $('name').setCustomValidity(''));
$('rehearsal-exit').addEventListener('click', () => { if (startingRun || rehearsal === 'delivery') return; rehearsal = null; pendingPlayer = null; freshGame(); updateUI(); });
$('register-cancel').addEventListener('click', () => $('registration').close());
$('next-player').addEventListener('click', () => { $('final').close(); completedRun = null; freshGame(); updateUI(); play(); });
$('final').addEventListener('cancel', event => event.preventDefault());
$('play').addEventListener('click', () => { $('scene').focus(); play(); });
$('operator-open').addEventListener('click', openOperator);
$('pause').addEventListener('click', () => { if (recovering) { beginTurn(); paused = false; } else paused = !paused; $('operator').close(); $('scene').focus(); });
$('reset').addEventListener('click', () => { if (startingRun) return; if (shared && run && !run.practice) sharedApi.abandon(run); if (store.active) { store.active.abortedAt = new Date().toISOString(); store.active = null; } run = null; rehearsal = null; pendingPlayer = null; completedRun = null; recovering = paused = frozen = false; persist(); freshGame(); $('operator').close(); updateUI(); });
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
$('sound').addEventListener('click', () => { sound = !sound; $('sound').textContent = sound ? 'SOUND ON' : 'SOUND OFF'; $('sound').setAttribute('aria-pressed', String(sound)); note(523); });
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('hint').textContent = 'Use your browser’s fullscreen command.'; } });
$('camera-open').addEventListener('click', () => $('camera-setup').showModal());
async function startCamera() {
  if (cameraLoading) return;
  cameraLoading = true; $('camera-toggle').disabled = true; $('camera-status').textContent = 'Starting camera…';
  updateUI();
  try {
    if (!cameraControls) {
      const { createCameraControls } = await import('./camera-controls.js');
      cameraControls = await createCameraControls({ video: $('camera-video'), overlay: $('camera-overlay'), select: $('camera-select'),
        canControl: () => Boolean(!startingRun && (run || rehearsal) && game.phase === 'aim' && !paused && !frozen && !stopped && !document.hidden && !document.querySelector('dialog[open]')),
        onDrop: gestureDrop,
        onChange: state => {
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
    if (cameraControls.running) $('camera-setup').close();
    else $('camera-setup').showModal();
  } catch (error) { $('camera-status').textContent = `Camera unavailable: ${error.message}`; $('camera-setup').showModal(); }
  finally { cameraLoading = false; $('camera-toggle').disabled = false; updateUI(); }
}
$('camera-toggle').addEventListener('click', () => {
  if (cameraControls?.running || cameraControls?.starting) cameraControls.stop();
  else startCamera();
});
$('camera-recenter').addEventListener('click', () => { cameraControls?.reset(); $('camera-setup').close(); });
window.addEventListener('pagehide', () => cameraControls?.stop());
$('scene').addEventListener('webglcontextlost', event => { event.preventDefault(); fail('The renderer stopped. Reload, then ask your host to resume the interrupted turn.'); });
function frame(time) {
  if (stopped) return;
  const raw = previous ? (time - previous) / 1000 : 1 / 60, dt = Math.min(raw, .05); previous = time;
  if (import.meta.env.DEV && !document.hidden) { frames.push(raw * 1000); if (frames.length > 1800) frames.shift(); }
  const aiming = game.phase === 'aim', modal = Boolean(document.querySelector('dialog[open]'));
  const cameraWaiting = aiming && (!cameraControls?.running || cameraControls.waiting);
  // Only explicit operator pause stops a drop already in flight.
  const blocked = paused || (aiming && (cameraWaiting || modal || document.hidden));
  $('pause-banner').hidden = !paused;
  setText('pause-banner', 'Paused by host');
  const input = { ...cameraControls?.input || { x: 0, z: 0 } };
  if (!frozen && !blocked && !document.hidden) {
    if (aiming) { game.position = move(game.position, input, dt); moveCarousel(game, dt); aligned = aimTarget(game);
      if (rehearsal) {
        if (rehearsal === 'steer' && Math.hypot(game.position.x - practiceMarker.x, game.position.z - practiceMarker.z) < .13) { rehearsal = 'drop'; }
      } else {
      const before = Math.ceil(remaining); remaining = Math.max(0, remaining - dt); if (Math.ceil(remaining) < before && remaining <= 5) note(remaining < 1 ? 220 : 440, .08); if (!remaining) drop(game);
      }
    } else {
      input.x = input.z = 0;
      if (game.phase === 'idle') moveCarousel(game, dt);
      if (game.phase === 'result' && run && !recovering && !modal) { nextTurnElapsed += dt; if (nextTurnElapsed >= 2) beginTurn(); }
      if (game.phase === 'result' && rehearsal === 'complete' && !modal && !startingRun) {
        nextTurnElapsed += dt; if (nextTurnElapsed >= 1.5) void startScoredRun();
      }
      const before = game.phase; advance(game, dt); if (game.phase === 'result' && before !== 'result') finishTurn();
    }
  } else input.x = input.z = 0;
  try {
    const feedback = cameraControls?.feedback || { kind: 'off', progress: 0, controlEnabled: false };
    updateUI(feedback);
    if (paused || modal || document.hidden) feedback.kind = 'blocked';
    scene.update(game, blocked ? 0 : dt, time / 1000, input, aligned, feedback); if (frozen) scene.inspect(new URLSearchParams(location.search).get('inspect'));
    $('practice-marker').hidden = rehearsal !== 'steer';
    if (rehearsal === 'steer') { const point = scene.screenPoint(practiceMarker.x, BED + .10, practiceMarker.z); $('practice-marker').style.left = `${point.x}px`; $('practice-marker').style.top = `${point.y}px`; }
    const tagged = game.phase === 'aim' && aligned ? game.toys.find(toy => toy.id === aligned.id) : null;
    const target = tagged ? scene.screenPoint(tagged.x, BED + (tagged.elevation || 0) + .08, tagged.z) : null;
    for (const { toy, element } of tags) {
      element.hidden = !target || aligned.id !== toy.id;
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
  return { phase: game.phase, elapsed: game.elapsed, position: { ...game.position }, rounds: game.rounds, event: { rehearsal, run, remaining, turn: turnNumber, paused, board: shared ? sharedBoard : currentBoard(store), complete: completedRun, storageError, handCamera: { running: cameraControls?.running || false, waiting: cameraControls?.waiting || false, feedback: cameraControls?.feedback, diagnostic: cameraControls?.diagnostic }, carouselTime: game.carouselTime, cue: carouselCue(game.carouselTime) }, aligned: aligned?.id || null, caught: game.plan?.prize?.id || null, contacts: game.plan?.contacts || null, claw: clawPose(game), stop: game.plan?.stop || null, collection: [...game.collection], reducedMotion: scene?.reducedMotion, camera: scene?.camera.position.toArray(), lowQuality: scene?.lowQuality, joystick: { mode: scene?.joystickHand.mode, visible: scene?.joystickHand.root.visible, progress: scene?.joystickHand.progress }, errors: [...errors], render: { calls: scene?.renderer.info.render.calls, triangles: scene?.renderer.info.render.triangles }, performance: { frames: frames.length, averageFps: +(1000 / average).toFixed(1), p95FrameMs: sorted[Math.floor(sorted.length * .95)], framesOver33ms: frames.filter(t => t > 33.4).length }, toys: game.toys.map(toy => ({ id: toy.id, family: toy.family, claimed: toy.claimed, position: scene?.toys.get(toy.id).position.toArray(), scale: scene?.toys.get(toy.id).scale.toArray(), bounds: includeBounds ? scene?.toyBounds(toy.id) : undefined })) };
}

function updateSavedRank(saved) {
  if (completedRun?.id !== saved.id || saved.status !== 'complete' || !Number.isInteger(saved.rank)) return;
  completedRun.rank = saved.rank;
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
      if (completedRun && !completedRun.practice) updateSavedRank(await sharedApi.request(`/runs/${completedRun.id}`));
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
    sharedStatus = state.error || (state.pending ? 'Score waiting to sync' : 'SHARED STAFF LEADERBOARD');
    $('sync-message').textContent = state.error || (state.pending ? 'Score waiting to sync' : '');
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
$('shared-practice').addEventListener('click', () => { pendingPlayer.practice = true; $('shared-start').close(); void startScoredRun(); });
$('shared-back').addEventListener('click', () => { pendingPlayer = rehearsal = null; $('shared-start').close(); freshGame(); updateUI(); });
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
