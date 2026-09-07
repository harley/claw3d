import './arcade.css';
import { ArcadeScene } from './arcade-scene.js';
import { createGame, begin, drop, advance, move, planGrab, clawPose, PHASES, BED, CAROUSEL, carouselCue, moveCarousel, aimTarget } from './arcade-mechanics.js';
import { RULES, STORAGE_KEY, newStore, loadStore, currentBoard, startRun, recordTurn, leaderboard, rotateBoard } from './event-session.js';

const $ = id => document.getElementById(id);
let game = createGame({ carousel: true }), scene, previous = 0, stopped = false, frozen = false;
let cameraControls, cameraLoading = false;
let celebrationTimer;
let lastCue = '';
let lastStatus = '', aligned = null, paused = false;
let store, storageError = '', storageBlocked = false;
try { store = loadStore(localStorage); } catch (error) { store = newStore(); storageError = error.message; storageBlocked = true; }
game.position = { x: -1.12, z: .66 };
let run = store.active, completedRun = null, turnNumber = run ? run.turns.length + 1 : 0, remaining = RULES.seconds;
let recovering = Boolean(run), sound = false, audioContext;
const frames = [], errors = [];
let nextTurnElapsed = 0;
const tags = game.toys.map(toy => {
  const element = document.createElement('span'); element.className = 'prize-tag'; element.dataset.points = RULES.points[toy.id]; element.textContent = RULES.points[toy.id]; $('prize-tags').append(element); return { toy, element };
});
function persist() {
  if (storageBlocked) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); storageError = ''; }
  catch { storageError = 'Storage unavailable. Results are in memory only. Export before closing.'; }
  $('storage-status').textContent = storageError || store.notice || 'Scores saved on this browser.';
}
function renderBoard() {
  const board = currentBoard(store); $('board-name').textContent = board.name; $('leaders').replaceChildren();
  const leaders = leaderboard(board); $('board-empty').hidden = leaders.length > 0;
  for (const row of leaders.slice(0, 5)) {
    const li = document.createElement('li'); li.classList.toggle('current', row.id === completedRun?.id);
    for (const [tag, value] of [['span', String(row.rank).padStart(2, '0')], ['strong', row.name], ['b', row.total]]) { const el = document.createElement(tag); el.textContent = value; li.append(el); }
    $('leaders').append(li);
  }
  const official = board.runs.filter(r => !r.practice), turns = official.flatMap(r => r.turns);
  $('operator-stats').textContent = `${official.length} completed · ${turns.length ? Math.round(turns.filter(t => t.score).length / turns.length * 100) : 0}% catch rate · ${store.boards.length} sessions stored`;
  $('storage-status').textContent = storageError || store.notice || 'Scores saved on this browser.';
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
const phaseCopy = { anticipate: 'LOCKED IN', descend: 'GOING DOWN', grip: 'HOLD YOUR BREATH', lift: 'HOLD ON…', transfer: 'BRING IT HOME', release: 'SPECIAL DELIVERY', deliver: 'HERE IT COMES', reveal: 'NICE CATCH!' };
function updateUI() {
  const phase = game.phase, total = run?.turns.reduce((sum, t) => sum + t.score, 0) || completedRun?.total || 0;
  let title = 'BEAT THE HIGH SCORE', hint = '3 turns · up to 600 points', button = 'PLAY', kicker = 'CLOUD CLAW';
  if (recovering) { title = 'PLAYER INTERRUPTED'; hint = 'Ask your host to resume this turn.'; button = 'OPERATOR'; }
  else if (phase === 'aim') { kicker = turnNumber === 3 ? 'LAST CLAW!' : `TURN ${turnNumber} OF 3`; title = aligned ? `${aligned.name.toUpperCase()} · ${RULES.points[aligned.id]} PTS` : 'PICK YOUR TARGET'; hint = 'Clasp both hands and hold to drop'; button = '';  }
  else if (phase === 'result') { const points = run?.turns.at(-1)?.score || 0; kicker = `TURN ${turnNumber} COMPLETE`; title = points ? `+${points} · GREAT CATCH!` : 'JUST MISSED'; hint = 'Next turn starting…'; button = '';  }
  else if (phaseCopy[phase]) { title = phaseCopy[phase]; kicker = `TURN ${turnNumber} OF 3`; hint = 'Hands down · watch the claw'; button = '';  }
  const cue = carouselCue(game.carouselTime), nearPickup = Math.hypot(game.position.x - CAROUSEL.x, game.position.z - (CAROUSEL.z + CAROUSEL.radius)) < .30;
  const cueKey = `${phase}:${cue.lights}:${cue.now}`; if (cueKey !== lastCue) { if (phase === 'aim' && cue.lights) note(cue.now ? 880 : 440 + cue.lights * 110, .09); lastCue = cueKey; }
  $('jackpot-signal').classList.toggle('go', cue.now && phase === 'aim');
  $('jackpot-cue').textContent = ['idle', 'aim'].includes(phase) ? cue.text : 'CLAW IN ACTION';
  [...$('jackpot-lights').children].forEach((light, i) => light.classList.toggle('on', ['idle', 'aim'].includes(phase) && i < cue.lights));
  if (phase === 'aim' && nearPickup) { title = 'JACKPOT · 200 PTS'; hint = aligned?.id === CAROUSEL.id ? 'CLASP & HOLD' : 'Gold ring · wait for green'; }
  $('timer').textContent = String(Math.ceil(remaining)).padStart(2, '0');
  $('arcade').classList.toggle('last-claw', Boolean(run && turnNumber === 3)); $('arcade').classList.toggle('urgent', phase === 'aim' && remaining <= 5);
  $('mode-label').textContent = storageError ? 'UNSAVED · OPEN OPERATOR' : run?.practice ? 'PRACTICE · NOT RANKED' : '3 CLAWS. MAKE THEM COUNT.';
  if (!run && !recovering) button = cameraLoading ? 'STARTING…' : cameraControls?.running ? 'PLAY' : 'START CAMERA';
  const signature = JSON.stringify([title, hint, button, kicker, total, run?.name, completedRun?.id, paused]);
  if (signature === lastStatus) return; lastStatus = signature;
  $('player-name').textContent = run?.name || completedRun?.name || 'PLAYER ONE?'; $('score').textContent = String(total).padStart(3, '0'); $('turn').textContent = run ? `${turnNumber} / 3` : '— / 3';
  $('phase-label').textContent = kicker; $('status').textContent = title; $('hint').textContent = hint; $('button-text').textContent = button;
  $('play').hidden = Boolean(run && !recovering);
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
  if (!run) return;
  const outcome = recordTurn(store, turnNumber, game.plan?.prize?.id || null); if (!outcome) return;
  persist(); const points = outcome.run.turns.at(-1).score;
  if (points) { burst(outcome.run.turns.at(-1).prizeId === CAROUSEL.id ? `JACKPOT +${points}` : `+${points}`); [523, 659, 784, 1047].forEach((f, i) => note(f, .18, i * .11)); } else note(165, .25, 0, 'triangle');
  if (outcome.completed) {
    completedRun = outcome.run; run = null; renderBoard();
    $('final-name').textContent = completedRun.name.toUpperCase(); $('final-score').textContent = String(completedRun.total).padStart(3, '0');
    const rank = leaderboard(currentBoard(store)).find(r => r.id === completedRun.id)?.rank;
    $('final-kicker').textContent = completedRun.practice ? 'PRACTICE COMPLETE' : rank === 1 ? 'TOP OF THE BOARD!' : 'RUN COMPLETE';
    $('final-rank').textContent = completedRun.practice ? 'Practice · unranked' : `RANK #${rank}`;
    $('final-turns').replaceChildren();
    for (const turn of completedRun.turns) { const chip = document.createElement('span'); chip.className = 'turn-chip scored'; chip.textContent = `+${turn.score}`; const name = document.createElement('small'); name.textContent = game.toys.find(t => t.id === turn.prizeId)?.name || 'Miss'; chip.append(name); $('final-turns').append(chip); }
    $('final').showModal(); $('next-player').focus();
    if (!scene.reducedMotion) { const total = completedRun.total, start = performance.now(); const count = time => { if (!$('final').open) return; const progress = Math.min(1, (time - start) / 850); $('final-score').textContent = String(Math.round(total * (1 - (1 - progress) ** 3))).padStart(3, '0'); if (progress < 1) requestAnimationFrame(count); }; requestAnimationFrame(count); }
  }
}
function play() {
  if (!scene || stopped || frozen || paused || document.querySelector('dialog[open]')) return;
  if (recovering) return openOperator();
  if (!run) { if (!cameraControls?.running) return startCamera(true); return openRegistration(); }
  updateUI();
}
function gestureDrop() {
  if (!run || game.phase !== 'aim' || paused || frozen || stopped || document.hidden || document.querySelector('dialog[open]')) return;
  if (drop(game)) note(220, .2);
  updateUI();
}
function fail(message, error) { stopped = true; cameraControls?.stop(); clearTimeout(window.__arcadeBootTimer); errors.push(String(error || message)); $('loading').hidden = true; $('error').hidden = false; $('error-message').textContent = message; console.error('Cloud Claw:', error || message); }
function openOperator() { renderBoard(); $('operator').showModal(); $('pause').textContent = recovering ? 'RESUME INTERRUPTED TURN' : paused ? 'RESUME GAME' : 'PAUSE GAME'; }
document.addEventListener('visibilitychange', () => { previous = 0; });
$('player-form').addEventListener('submit', event => { event.preventDefault(); if (!scene || stopped || !cameraControls?.running) return;
  run = startRun(store, $('name').value, $('practice').checked || storageBlocked); completedRun = null; persist(); $('registration').close(); $('scene').focus(); beginTurn(); });
$('register-cancel').addEventListener('click', () => $('registration').close());
$('next-player').addEventListener('click', () => { $('final').close(); completedRun = null; freshGame(); updateUI(); play(); });
$('final').addEventListener('cancel', event => event.preventDefault());
$('play').addEventListener('click', () => { $('scene').focus(); play(); });
$('operator-open').addEventListener('click', openOperator);
$('pause').addEventListener('click', () => { if (recovering) { beginTurn(); paused = false; } else paused = !paused; $('operator').close(); $('scene').focus(); });
$('reset').addEventListener('click', () => { if (store.active) { store.active.abortedAt = new Date().toISOString(); store.active = null; } run = null; completedRun = null; recovering = paused = frozen = false; persist(); freshGame(); $('operator').close(); updateUI(); });
$('new-board').addEventListener('click', () => { try { rotateBoard(store, $('session-name').value); persist(); completedRun = null; renderBoard(); $('operator-message').textContent = 'New leaderboard started. Previous results are preserved.'; } catch (error) { $('operator-message').textContent = error.message; } });
$('export').addEventListener('click', () => { let data = JSON.stringify(store, null, 2); if (storageBlocked) { try { data = localStorage.getItem(STORAGE_KEY) || data; } catch { /* In-memory export remains available. */ } } const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `cloud-claw-sessions-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('quality').addEventListener('click', () => { if (!scene) return; scene.setQuality(!scene.lowQuality); $('quality').textContent = `QUALITY: ${scene.lowQuality ? 'SIMPLE' : 'FULL'}`; });
$('sound').addEventListener('click', () => { sound = !sound; $('sound').textContent = sound ? 'SOUND ON' : 'SOUND OFF'; $('sound').setAttribute('aria-pressed', String(sound)); note(523); });
$('fullscreen').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('hint').textContent = 'Use your browser’s fullscreen command.'; } });
$('camera-open').addEventListener('click', () => $('camera-setup').showModal());
async function startCamera(registerAfter = false) {
  if (cameraLoading) return;
  cameraLoading = true; $('camera-toggle').disabled = true; $('camera-status').textContent = 'Starting camera…';
  updateUI();
  try {
    if (!cameraControls) {
      const { createCameraControls } = await import('./camera-controls.js');
      cameraControls = await createCameraControls({ video: $('camera-video'), overlay: $('camera-overlay'), select: $('camera-select'),
        canControl: () => Boolean(run && game.phase === 'aim' && !paused && !frozen && !stopped && !document.hidden && !document.querySelector('dialog[open]')),
        onDrop: gestureDrop,
        onChange: state => {
          $('camera-status').textContent = state.message;
          $('hand-status').textContent = state.message;
          $('camera-progress').style.width = `${Math.round((state.progress || 0) * 100)}%`;
          const active = cameraControls?.running || state.kind === 'tracking';
          $('camera-preview').hidden = !active;
          $('camera-open').textContent = active ? 'CAMERA ✓' : 'CAMERA';
          $('camera-toggle').textContent = active ? 'STOP CAMERA' : 'START CAMERA';
        },
      });
    }
    await cameraControls.start();
    if (cameraControls.running) { $('camera-setup').close(); if (registerAfter) openRegistration(); }
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
  if (!document.hidden) { frames.push(raw * 1000); if (frames.length > 1800) frames.shift(); }
  const aiming = game.phase === 'aim', modal = Boolean(document.querySelector('dialog[open]'));
  const cameraWaiting = aiming && (!cameraControls?.running || cameraControls.waiting);
  // Only explicit operator pause stops a drop already in flight.
  const blocked = paused || (aiming && (cameraWaiting || modal || document.hidden));
  $('pause-banner').hidden = !paused;
  $('pause-banner').textContent = 'PAUSED BY HOST';
  $('hand-status').hidden = !aiming;
  if (cameraWaiting && !cameraControls?.running) $('hand-status').textContent = 'Start the camera to continue';
  const input = { ...cameraControls?.input || { x: 0, z: 0 } };
  if (!frozen && !blocked && !document.hidden) {
    if (aiming) { game.position = move(game.position, input, dt); moveCarousel(game, dt); aligned = aimTarget(game);
      const before = Math.ceil(remaining); remaining = Math.max(0, remaining - dt); if (Math.ceil(remaining) < before && remaining <= 5) note(remaining < 1 ? 220 : 440, .08); if (!remaining) drop(game);
    } else {
      input.x = input.z = 0;
      if (game.phase === 'idle') moveCarousel(game, dt);
      if (game.phase === 'result' && run && !recovering && !modal) { nextTurnElapsed += dt; if (nextTurnElapsed >= 2) beginTurn(); }
      const before = game.phase; advance(game, dt); if (game.phase === 'result' && before !== 'result') finishTurn();
    }
  } else input.x = input.z = 0;
  try {
    updateUI(); scene.update(game, blocked ? 0 : dt, time / 1000, input, aligned); if (frozen) scene.inspect(new URLSearchParams(location.search).get('inspect'));
    const showTags = ['idle', 'aim'].includes(game.phase);
    for (const { toy, element } of tags) { element.hidden = !showTags; if (!showTags) continue; const current = game.toys.find(t => t.id === toy.id); if (!current) { element.hidden = true; continue; } const point = scene.screenPoint(current.x, BED + (current.elevation || 0) + .08, current.z); element.style.left = `${point.x}px`; element.style.top = `${point.y}px`; element.classList.toggle('targeted', aligned?.id === toy.id); }
  } catch (error) { fail('The game stopped unexpectedly. Reload to recover this player.', error); return; }
  requestAnimationFrame(frame);
}

// Read-only development diagnostics.
function snapshot(includeBounds = false) {
  const sorted = [...frames].sort((a, b) => a - b), average = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
  return { phase: game.phase, elapsed: game.elapsed, position: { ...game.position }, rounds: game.rounds, event: { run, remaining, turn: turnNumber, paused, board: currentBoard(store), complete: completedRun, storageError, handCamera: { running: cameraControls?.running || false, waiting: cameraControls?.waiting || false }, carouselTime: game.carouselTime, cue: carouselCue(game.carouselTime) }, aligned: aligned?.id || null, caught: game.plan?.prize?.id || null, contacts: game.plan?.contacts || null, claw: clawPose(game), stop: game.plan?.stop || null, collection: [...game.collection], reducedMotion: scene?.reducedMotion, camera: scene?.camera.position.toArray(), lowQuality: scene?.lowQuality, errors: [...errors], render: { calls: scene?.renderer.info.render.calls, triangles: scene?.renderer.info.render.triangles }, performance: { frames: frames.length, averageFps: +(1000 / average).toFixed(1), p95FrameMs: sorted[Math.floor(sorted.length * .95)], framesOver33ms: frames.filter(t => t > 33.4).length }, toys: game.toys.map(toy => ({ id: toy.id, family: toy.family, claimed: toy.claimed, position: scene?.toys.get(toy.id).position.toArray(), scale: scene?.toys.get(toy.id).scale.toArray(), bounds: includeBounds ? scene?.toyBounds(toy.id) : undefined })) };
}

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
