// Presentation-only HUD: message surface, jackpot cue, meters, chips and
// labels. It reads a per-call view of game state and never mutates it; audio
// and the phase-to-sound mapping are injected.
import { CAROUSEL, carouselCue } from './arcade-mechanics.js';

const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, document.getElementById(id)); return elements.get(id); };
const setText = (id, value) => { const text = String(value); if ($(id).textContent !== text) $(id).textContent = text; };
const setHidden = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };

const deliveryPhases = new Set(['anticipate', 'descend', 'grip', 'lift', 'transfer', 'release', 'deliver', 'reveal']);
export const NEXT_TURN_SECONDS = 3.7;

export function nextTurnCue(elapsed, round) {
  if (elapsed < .9) return `ROUND ${round}`;
  if (elapsed < 1.6) return '3';
  if (elapsed < 2.3) return '2';
  if (elapsed < 3) return '1';
  return 'START!';
}

// One announcement surface; delivery messages expire without changing game timing.
const phaseCopy = { anticipate: 'DROP!', descend: 'DROP!', grip: '', lift: 'GOT IT!', transfer: '', release: '', deliver: '', reveal: '' };
let messageKey = '', messageUntil = 0;
function presentMessage(title, hint, key, duration = 0) {
  if (key !== messageKey) {
    messageKey = key; messageUntil = duration ? performance.now() + duration : 0;
    setText('status', title); setText('hint', hint);
    $('action-copy').classList.remove('strike');
    if (duration && title) { void $('action-copy').offsetWidth; $('action-copy').classList.add('strike'); }
  }
  // Opacity preserves the live region; timed announcements stay available to assistive tech.
  $('action-copy').classList.toggle('expired', Boolean(messageUntil && performance.now() >= messageUntil));
}

export function createHud({ audio, phaseSound }) {
  let lastCue = '', lastStatus = '';
  function update(view, feedback, modal) {
    const { game, run, completedRun, pendingPlayer, turnNumber, remaining, nextTurnElapsed, paused, frozen, recovering, startingRun, cameraLoading, cameraControls, shared, sharedStatus, storageError, aligned } = view;
  const phase = game.phase, total = run?.turns.reduce((sum, t) => sum + t.score, 0) || completedRun?.total || 0;
  let title = 'READY', hint = '', button = 'Play', kicker = 'CLOUD CLAW';
  if (recovering) { title = 'RUN INTERRUPTED'; hint = 'Ask your host to resume.'; button = 'OPERATOR'; }
  else if (phase === 'aim') { kicker = turnNumber === 3 ? 'LAST CLAW!' : `TURN ${turnNumber} OF 3`; title = 'Clench & hold to drop'; hint = ''; button = '';  }
  else if (phase === 'result' && run) { kicker = `ROUND ${turnNumber + 1} OF 3`; title = nextTurnCue(nextTurnElapsed, turnNumber + 1); hint = ''; button = ''; }
  else if (phase in phaseCopy) {
    title = phase === 'lift' && !game.plan?.prize ? 'MISSED' : phaseCopy[phase];
    kicker = `TURN ${turnNumber} OF 3`;
    hint = '';
    button = '';
  }
  if (phase === 'transfer' && !game.plan?.prize) { title = 'MISSED'; hint = ''; }
  phaseSound(phase, modal);
  // Attract mode: the idle machine gently pulses its invitation until a hand
  // takes control. CSS disables the pulse under reduced motion.
  $('action-copy').classList.toggle('attract', phase === 'idle' && !paused && !recovering && (!cameraControls?.running || cameraControls.waiting));
  const cue = carouselCue(game.carouselTime), nearPickup = Math.hypot(game.position.x - CAROUSEL.x, game.position.z - (CAROUSEL.z + CAROUSEL.radius)) < .30;
  const cueVisible = phase === 'aim' && nearPickup && !paused && !frozen && !document.hidden && !modal && cameraControls?.running && !cameraControls.waiting;
  setHidden($('jackpot-signal'), !cueVisible);
  const cueKey = `${phase}:${cue.lights}:${cue.now}`; if (cueKey !== lastCue) { if (cueVisible && cue.lights) audio.note(cue.now ? 880 : 440 + cue.lights * 110, .09); lastCue = cueKey; }
  // The countdown invites a new hold. Once confirmation is progressing, its
  // expired window must not contradict the central instruction to keep holding.
  const confirming = phase === 'aim' && feedback.controlEnabled && feedback.kind === 'clenching' && feedback.progress > 0;
  const displayKey = `${cueKey}:${Boolean(confirming)}`;
  if ($('jackpot-signal').dataset.cue !== displayKey) {
    $('jackpot-signal').dataset.cue = displayKey;
    $('jackpot-signal').classList.toggle('go', cue.now && phase === 'aim');
    setText('jackpot-cue', confirming ? 'KEEP HOLDING' : ['idle', 'aim'].includes(phase) ? cue.text : 'Claw in action');
    [...$('jackpot-lights').children].forEach((light, i) => light.classList.toggle('on', ['idle', 'aim'].includes(phase) && i < cue.lights));
  }
  if (phase === 'aim' && nearPickup) { title = 'STAR 200'; hint = ''; }
  const learning = phase === 'aim' || (!run && !recovering && cameraControls?.running);
  if (learning) {
    if (feedback.kind === 'off') { title = 'CAMERA OFF'; hint = 'Open Camera to continue.'; }
    else if (['ready', 'lost'].includes(feedback.kind)) { title = feedback.kind === 'lost' ? 'SHOW ONE HAND' : 'SHOW ONE HAND'; hint = ''; if (feedback.handCount > 1) title = 'ONE HAND ONLY'; }
    else if (feedback.kind === 'delayed') { title = 'TRACKING DELAYED'; hint = ''; }
    else if (feedback.kind === 'calibrating') { title = 'HOLD STILL'; hint = ''; }
    else if (feedback.kind === 'clenching' && feedback.controlEnabled) { title = feedback.progress > 0 ? (phase === 'aim' ? 'Hold to drop' : 'HOLD TO SELECT') : 'OPEN HAND'; hint = feedback.progress > 0 ? '' : feedback.message || 'Open your hand first.'; }
    else if (feedback.kind === 'tracking') {
      if (phase === 'idle') { title = 'AIM AT PLAY · CLENCH'; hint = ''; }
      else if (!nearPickup) { title = 'Clench & hold to drop'; hint = ''; }
    } else if (feedback.kind === 'error') { title = 'CAMERA ERROR'; hint = ''; }
    else if (feedback.kind === 'loading') { title = 'STARTING CAMERA'; hint = ''; }
  }
  if (startingRun) { title = 'CONNECTING'; hint = ''; }
  const holding = phase === 'aim' && feedback.controlEnabled && feedback.kind === 'clenching';
  const progress = holding ? Math.round(Math.max(0, Math.min(1, feedback.progress || 0)) * 100) : 0;
  setHidden($('gesture-meter'), !holding);
  if ($('gesture-meter').getAttribute('aria-valuenow') !== String(progress)) {
    $('gesture-meter').setAttribute('aria-valuenow', String(progress));
    $('gesture-progress').style.transform = `scaleX(${progress / 100})`;
  }
  const control = deliveryPhases.has(phase) ? 'delivery' : holding ? 'holding' : feedback.controlEnabled && feedback.kind === 'tracking' ? 'tracking' : feedback.kind;
  if ($('arcade').dataset.control !== control) $('arcade').dataset.control = control;
  const cameraLabels = { ready: 'Camera view', calibrating: 'Hand found', tracking: 'Hand found', accepted: 'Drop confirmed', lost: 'Hand out of view', delayed: 'Tracking delayed', clenching: 'Fist found', loading: 'Starting camera', off: 'Camera off', error: 'Check camera' };
  setText('camera-recognition', cameraLabels[feedback.kind] || 'Camera view');
  if ($('camera-preview').dataset.state !== feedback.kind) $('camera-preview').dataset.state = feedback.kind;
  $('reset').disabled = startingRun;
  setText('timer', String(Math.ceil(remaining)).padStart(2, '0'));
  setText('speed-bonus', `SPEED +${Math.floor((run?.rules.speedBonus ?? 50) * remaining / (run?.rules.seconds || 15))}`);
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
  const timed = deliveryPhases.has(phase) && !(phase === 'transfer' && !game.plan?.prize);
  // Teach once per run. Keep the live-region text, but let the machine lead
  // after the first drop; recovery and deliberate hold feedback always return.
  const steering = phase === 'aim' && Boolean(run) && !recovering && !startingRun &&
    cameraControls?.running && feedback.controlEnabled && feedback.kind === 'tracking';
  $('action-copy').classList.toggle('quiet', Boolean(steering && (run.turns.length > 0 || cueVisible)));
  $('action-copy').classList.toggle('gesture-guide', Boolean(steering && !nearPickup));
  presentMessage(title, hint, `${['anticipate', 'descend'].includes(phase) ? 'drop' : phase}:${turnNumber}:${title}:${hint}`, timed ? 1600 : 0);
  if ($('arcade').dataset.phase !== phase) $('arcade').dataset.phase = phase;
  const signature = [title, hint, button, kicker, total, run?.name, pendingPlayer?.name, completedRun?.id, paused].join('');
  if (signature === lastStatus) return; lastStatus = signature;
  $('player-name').textContent = run?.name || pendingPlayer?.name || completedRun?.name || 'PLAYER'; $('score').textContent = String(total).padStart(3, '0'); $('turn').textContent = run ? `${turnNumber} / 3` : '— / 3';
  $('phase-label').textContent = kicker; $('button-text').textContent = button;
  $('play').hidden = Boolean(startingRun || (run && !recovering && !cameraRecovery));
  $('play').disabled = paused || cameraLoading;
  $('turn-chips').replaceChildren();
  for (let i = 0; i < 3; i++) { const turn = run?.turns[i] || completedRun?.turns[i]; const chip = document.createElement('span'); chip.className = `turn-chip ${turn?.score ? 'scored' : ''}`; chip.textContent = turn ? turn.score ? `+${turn.score}` : 'MISS' : '—'; $('turn-chips').append(chip); }
  }
  return { update, invalidate: () => { lastStatus = ''; } };
}

export { $, setText, setHidden };
