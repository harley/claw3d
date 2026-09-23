import { HAND_ACQUIRE_MS, RIGHT_SLAM_MS } from './dual-hand-controls.js';
// Presentation-only HUD: message surface, jackpot cue, meters, chips and
// labels. It reads a per-call view of game state and never mutates it; audio
// and the phase-to-sound mapping are injected.
import { PRESS_MS } from './grab-release.js';
import { cueLeadSeconds } from './play-mode.js';
import { ASSORTMENT, CAROUSEL, carouselCue, carouselRider } from './arcade-mechanics.js';
import { RULES } from './event-session.js';

const elements = new Map();
const $ = id => { if (!elements.has(id)) elements.set(id, document.getElementById(id)); return elements.get(id); };
const setText = (id, value) => { const text = String(value); if ($(id).textContent !== text) $(id).textContent = text; };
const setHidden = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };

const deliveryPhases = new Set(['anticipate', 'descend', 'grip', 'lift', 'transfer', 'release', 'deliver', 'reveal']);
// After a catch the machine pulls back to the shelf, so the next round gets a
// full count-in. After a miss the view never left the claw: name it, then go.
export { nextTurnSeconds } from './turn-controller.js';

export function nextTurnCue(elapsed, round, caught = true) {
  if (!caught) return elapsed < .6 ? 'MISSED' : 'START!';
  if (elapsed < .7) return `ROUND ${round}`;
  if (elapsed < 1.2) return '3';
  if (elapsed < 1.7) return '2';
  if (elapsed < 2.2) return '1';
  return 'START!';
}

export function firstTurnCue(elapsed) {
  if (elapsed < .7) return 'ROUND 1';
  if (elapsed < 1.7) return '3';
  if (elapsed < 2.7) return '2';
  if (elapsed < 3.7) return '1';
  return 'START!';
}

export function playFirstTurnCueTone(audio, cue, allowed = true) {
  if (!allowed) return false;
  const notes = {
    '3': [[659, .12, 0]],
    '2': [[784, .12, 0]],
    '1': [[988, .14, 0]],
    'START!': [[880, .12, 0], [1175, .18, .08]],
  }[cue];
  if (!notes) return false;
  for (const [frequency, duration, delay] of notes) audio.note(frequency, duration, delay, 'sine', frequency, .022);
  return true;
}

export function firstTurnWaitingMessage(feedback = {}, dualEnabled = false) {
  if (dualEnabled) return String(feedback.message || 'SHOW BOTH HANDS').toUpperCase();
  if (feedback.kind === 'calibrating') return 'HOLD STILL';
  if (feedback.kind === 'delayed') return 'TRACKING DELAYED';
  if (feedback.kind === 'error') return 'CAMERA ERROR';
  if (feedback.kind === 'loading') return 'STARTING CAMERA';
  if (feedback.kind === 'clenching' || (feedback.kind === 'ready' && feedback.closed === true) ||
    (feedback.kind === 'tracking' && feedback.handCount === 1 && feedback.open !== true)) return 'OPEN HAND TO READY';
  return 'SHOW ONE HAND';
}

export const TROPHY_ICONS = Object.freeze({ bunny: '🐰', capybara: '🐾', cloud: '☁️', star: '⭐', robot: '🤖' });
// The finale headline reads the run: rank first, then how the three turns went.
export function finaleHeadline(turns, rank, points = {}) {
  const catches = turns.filter(turn => turn.prizeId).length;
  if (rank === 1) return 'TOP OF THE BOARD!';
  if (catches === turns.length && catches > 0) return 'CLEAN SWEEP!';
  if (turns.some(turn => turn.prizeId && (points[turn.prizeId] || 0) >= 200)) return 'JACKPOT RUN!';
  if (catches === 0) return 'THE CLAW WINS THIS ONE';
  return 'RUN COMPLETE';
}
// One short line under MISSED that says what the claw actually met.
export function missCopy(plan, toys = []) {
  const name = id => (toys.find(toy => toy.id === id)?.name || '').toUpperCase();
  switch (plan?.reason) {
    case 'near': return 'SO CLOSE';
    case 'slipped': return `SLIPPED OFF ${name(plan.touched?.id)}`.trim();
    case 'crowded': return `${name(plan.touched?.id)} STUCK BESIDE ${name(plan.blocker)}`.trim();
    case 'blocked': return `BLOCKED BY ${name(plan.blocker)}`.trim();
    case 'bumped': return `BUMPED ${name(plan.touched?.id)}`.trim();
    case 'platform': return 'STAR MOVED ON';
    default: return 'NOTHING THERE';
  }
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
  let lastCue = '', lastStatus = '', lastFirstTurnCue = null;
  function update(view, feedback, modal) {
    const { game, run, completedRun, pendingPlayer, turnNumber, remaining, nextTurnElapsed, firstTurnPreparationElapsed, firstTurnControlReady, paused, frozen, recovering, startingRun, cameraLoading, cameraControls, shared, grabEnabled, dualEnabled, cabinetEnabled, holdMs, sharedStatus, storageError, aligned } = view;
  const phase = game.phase, total = run?.turns.reduce((sum, t) => sum + t.score, 0) || completedRun?.total || 0;
  const turns = run?.rules?.turns ?? completedRun?.rules?.turns ?? RULES.turns;
  const preparingFirstTurn = Boolean(run && firstTurnPreparationElapsed !== null);
  $('arcade').classList.toggle('first-turn-layout', Boolean(run && (preparingFirstTurn || turnNumber === 1)));
  let title = 'READY', hint = '', button = 'Play', kicker = 'CLAW';
  if (recovering) { title = `TURN ${turnNumber} OF ${turns}`; button = cameraLoading ? 'Starting…' : 'CONTINUE'; }
  else if (phase === 'idle' && preparingFirstTurn) {
    kicker = `ROUND 1 OF ${turns}`;
    title = firstTurnControlReady ? firstTurnCue(firstTurnPreparationElapsed) : firstTurnWaitingMessage(feedback, dualEnabled);
    button = '';
  }
  else if (phase === 'aim') { kicker = turnNumber === turns ? 'LAST CLAW!' : `TURN ${turnNumber} OF ${turns}`; title = 'Clench & hold to drop'; hint = ''; button = '';  }
  else if (phase === 'result' && run) { kicker = `ROUND ${turnNumber + 1} OF ${turns}`; title = nextTurnCue(nextTurnElapsed, turnNumber + 1, Boolean(game.plan?.prize)); hint = title === 'MISSED' ? missCopy(game.plan, game.toys) : ''; button = ''; }
  else if (phase in phaseCopy) {
    title = phase === 'lift' && !game.plan?.prize ? 'MISSED' : phaseCopy[phase];
    kicker = `TURN ${turnNumber} OF ${turns}`;
    hint = title === 'MISSED' ? missCopy(game.plan, game.toys) : '';
    button = '';
  }
  phaseSound(phase, modal);
  const initialCue = preparingFirstTurn && firstTurnControlReady ? firstTurnCue(firstTurnPreparationElapsed) : null;
  if (initialCue !== lastFirstTurnCue) {
    playFirstTurnCueTone(audio, initialCue, !paused && !modal && !document.hidden);
    lastFirstTurnCue = initialCue;
  }
  // Attract mode: the idle machine gently pulses its invitation until a hand
  // takes control. CSS disables the pulse under reduced motion.
  $('action-copy').classList.toggle('attract', phase === 'idle' && !run && !paused && !recovering && (!cameraControls?.running || cameraControls.waiting));
  const cue = carouselCue(game.carouselTime, cueLeadSeconds({ dual: dualEnabled, grab: grabEnabled, holdMs }, feedback)), nearPickup = Math.hypot(game.position.x - CAROUSEL.x, game.position.z - (CAROUSEL.z + CAROUSEL.radius)) < .30;
  const gripStage = feedback.grab?.stage;
  const rider = carouselRider(game), starAvailable = Boolean(rider), riderPoints = rider ? (run?.rules || RULES).points[rider.id] : 0;
  const cueVisible = starAvailable && (!grabEnabled || (feedback.profile === 'dual' ? feedback.dropEnabled : gripStage !== 'gripped')) && phase === 'aim' && nearPickup && !paused && !frozen && !document.hidden && !modal && cameraControls?.running && !cameraControls.waiting;
  setHidden($('jackpot-signal'), !cueVisible);
  const cueKey = `${phase}:${cue.lights}:${cue.now}`; if (cueKey !== lastCue) { if (cueVisible && cue.lights) audio.note(cue.now ? 880 : 440 + cue.lights * 110, .09); lastCue = cueKey; }
  // The countdown invites a new hold. Once confirmation is progressing, its
  // expired window must not contradict the central instruction to keep holding.
  const confirming = phase === 'aim' && feedback.controlEnabled && feedback.kind === 'clenching' && feedback.progress > 0;
  const displayKey = `${cueKey}:${Boolean(confirming)}`;
  if ($('jackpot-signal').dataset.cue !== displayKey) {
    $('jackpot-signal').dataset.cue = displayKey;
    $('jackpot-signal').classList.toggle('go', cue.now && phase === 'aim');
    setText('jackpot-cue', dualEnabled && cue.now ? 'RAISE RIGHT HAND' : grabEnabled && confirming ? (gripStage === 'pressing' ? 'PRESS DROP' : 'GRAB JOYSTICK') : confirming ? 'KEEP HOLDING' : ['idle', 'aim'].includes(phase) ? (grabEnabled && cue.now ? 'PRESS DROP' : cue.text) : 'Claw in action');
    [...$('jackpot-lights').children].forEach((light, i) => light.classList.toggle('on', ['idle', 'aim'].includes(phase) && i < cue.lights));
  }
  if (phase === 'aim' && nearPickup && starAvailable) { title = `${rider.name.toUpperCase()} ${riderPoints}`; hint = ''; }
  if (starAvailable) setText('jackpot-title', `★ ${rider.id === CAROUSEL.id ? 'JACKPOT' : rider.name.toUpperCase()} ${riderPoints}`);
  const learning = phase === 'aim' || (!run && !recovering && cameraControls?.running);
  if (learning) {
    if (feedback.kind === 'off') { title = 'CAMERA OFF'; hint = ''; }
    else if (['ready', 'lost'].includes(feedback.kind)) { title = feedback.kind === 'lost' ? 'SHOW ONE HAND' : 'SHOW ONE HAND'; hint = ''; if (feedback.handCount > 1) title = 'ONE HAND ONLY'; }
    else if (feedback.kind === 'delayed') { title = 'TRACKING DELAYED'; hint = ''; }
    else if (feedback.kind === 'calibrating') { title = 'HOLD STILL'; hint = ''; }
    else if (feedback.kind === 'clenching' && feedback.controlEnabled) { title = feedback.progress > 0 ? (phase === 'aim' ? 'Hold to drop' : 'HOLD TO SELECT') : 'OPEN HAND'; hint = ''; }
    else if (feedback.kind === 'tracking') {
      if (phase === 'idle') { title = 'AIM AT PLAY · CLENCH'; hint = ''; }
      else if (!nearPickup) { title = 'Clench & hold to drop'; hint = ''; }
    } else if (feedback.kind === 'error') { title = 'CAMERA ERROR'; hint = ''; }
    else if (feedback.kind === 'loading') { title = 'STARTING CAMERA'; hint = ''; }
  }
  if (grabEnabled && phase === 'aim' && feedback.controlEnabled && ['tracking', 'clenching'].includes(feedback.kind)) {
    title = gripStage === 'gripped' ? 'OPEN TO LET GO' : gripStage === 'pressing' ? 'DROP!'  : gripStage === 'grabbing' ? 'GRABBING' : feedback.closed ? 'OPEN HAND' : feedback.target === 'drop' ? 'PRESS OR SLAM' : 'GRAB JOYSTICK'; hint = '';
  }
  if (feedback.profile === 'dual' && phase === 'aim' && !['delayed', 'off', 'error'].includes(feedback.kind)) {
    title = feedback.message || 'SHOW LEFT HAND OPEN'; hint = '';
  }
  if (startingRun) { title = 'CONNECTING'; hint = ''; }
  const holding = phase === 'aim' && feedback.controlEnabled && feedback.kind === 'clenching';
  const progress = holding ? Math.round(Math.max(0, Math.min(1, feedback.progress || 0)) * 100) : 0;
  $('gesture-meter').setAttribute('aria-label', grabEnabled ? (gripStage === 'pressing' ? 'Press to drop' : 'Grab joystick') : 'Hold to drop');
  setHidden($('gesture-meter'), !holding);
  if ($('gesture-meter').getAttribute('aria-valuenow') !== String(progress)) {
    $('gesture-meter').setAttribute('aria-valuenow', String(progress));
    $('gesture-progress').style.transform = `scaleX(${progress / 100})`;
  }
  setHidden($('control-deck'), cabinetEnabled || !run || phase === 'idle' || phase === 'result');
  $('control-deck').dataset.profile = grabEnabled ? 'grab-release' : 'hold-drop';
  $('control-deck').querySelector('.deck-steer > span').textContent = grabEnabled ? (gripStage === 'gripped' ? 'MOVE FIST' : gripStage === 'releasing' ? 'RELEASE' : 'CLENCH TO GRAB') : 'MOVE HAND';
  const deckSteering = (!grabEnabled || gripStage === 'gripped') && phase === 'aim' && feedback.controlEnabled && feedback.kind === 'tracking';
  const input = deckSteering ? cameraControls?.input : null;
  $('deck-stick').style.transform = `translate(${(input?.x || 0) * 15}px, ${(input?.z || 0) * 11}px)`;
  $('deck-drop').style.setProperty('--hold', progress / 100);
  $('control-deck').dataset.state = deliveryPhases.has(phase) ? 'accepted' : holding ? 'holding' : deckSteering ? 'tracking' : 'waiting';
  setText('deck-state', deliveryPhases.has(phase) ? 'DROP ACCEPTED' : grabEnabled ? (gripStage === 'gripped' ? 'OPEN TO LET GO' : gripStage === 'pressing' ? 'DROP!'  : gripStage === 'grabbing' ? 'GRABBING' : 'GRAB JOYSTICK') : holding ? 'HOLD' : deckSteering ? 'READY' : 'WAITING');
  const control = deliveryPhases.has(phase) ? 'delivery' : holding ? 'holding' : feedback.controlEnabled && feedback.kind === 'tracking' ? 'tracking' : feedback.kind;
  if ($('arcade').dataset.control !== control) $('arcade').dataset.control = control;
  const cameraGuide = feedback.profile === 'dual' && phase === 'aim' && cameraControls?.running && !recovering && !startingRun &&
    !['delayed', 'off', 'error', 'loading'].includes(feedback.kind);
  const cameraLabels = { ready: 'Camera view', calibrating: 'Hand found', tracking: 'Hand found', accepted: 'Drop confirmed', lost: 'Hand out of view', delayed: 'Tracking delayed', clenching: 'Fist found', loading: 'Starting camera', off: 'Camera off', error: 'Check camera' };
  setText('camera-recognition', cameraGuide ? 'LEFT · MOVE     RIGHT · DROP' : cameraLabels[feedback.kind] || 'Camera view');
  if ($('camera-preview').dataset.state !== feedback.kind) $('camera-preview').dataset.state = feedback.kind;
  $('reset').disabled = startingRun;
  setText('timer', String(Math.ceil(remaining)).padStart(2, '0'));
  setText('speed-bonus', `SPEED +${Math.floor((run?.rules.speedBonus ?? 50) * remaining / (run?.rules.seconds || 15))}`);
  $('arcade').classList.toggle('last-claw', Boolean(run && turnNumber === turns)); $('arcade').classList.toggle('urgent', phase === 'aim' && remaining <= 5);
  setText('mode-label', shared ? sharedStatus : storageError ? 'LOCAL PREVIEW · UNSAVED' : `LOCAL · ${dualEnabled ? '2 HANDS' : '1 HAND'}`);
  setHidden($('mode-label'), !$('mode-label').textContent);
  setHidden($('result-open'), !completedRun || startingRun || Boolean(run) || cameraLoading);
  if (!run && !recovering) button = cameraLoading ? 'Starting…' : !shared ? (dualEnabled ? 'PLAY · 2 HANDS' : 'PLAY · 1 HAND') : cameraControls?.running ? 'Play' : 'Start camera';
  for (const [id, selected] of [['mode-one', !dualEnabled], ['mode-two', dualEnabled]]) {
    $(id).setAttribute('aria-pressed', String(selected));
    $(id).disabled = Boolean(run || pendingPlayer || recovering || startingRun || paused || cameraLoading);
    $(id).title = run || recovering ? 'Finish this run before changing controls' : '';
  }
  const cameraRecovery = Boolean(run && !recovering && phase === 'aim' && !cameraControls?.running);
  if (cameraRecovery) {
    button = cameraLoading ? 'Starting…' : 'Restart camera';
  }
  if (paused) { title = 'PAUSED'; hint = ''; button = shared ? 'HOST CONTROLS' : cameraLoading ? 'Starting…' : 'RESUME'; }
  const timed = !paused && deliveryPhases.has(phase);
  // Teach once per run. Keep the live-region text, but let the machine lead
  // after the first drop; recovery and deliberate hold feedback always return.
  const steering = (!grabEnabled || gripStage === 'gripped') && phase === 'aim' && Boolean(run) && !recovering && !startingRun &&
    cameraControls?.running && feedback.controlEnabled && feedback.kind === 'tracking';
  const rightReady = feedback.profile !== 'dual' || (feedback.hands?.right?.ready && feedback.hands.right.grab?.armed);
  // Two-hand acquisition belongs in the webcam windows. Keep its full live
  // instruction for assistive tech; camera failures and pause stay visible.
  $('action-copy').classList.toggle('quiet', Boolean(!paused && (cameraGuide || (steering && rightReady && (run.turns.length > 0 || cueVisible)))));
  $('action-copy').classList.toggle('gesture-guide', Boolean(steering && !nearPickup));
  // A miss keeps one message surface from the empty lift through the next-turn cue.
  presentMessage(title, hint, `${title === 'MISSED' ? 'missed' : ['anticipate', 'descend'].includes(phase) ? 'drop' : phase}:${turnNumber}:${title}:${hint}`, timed ? 1600 : 0);
  if ($('arcade').dataset.phase !== phase) $('arcade').dataset.phase = phase;
  const signature = [title, hint, button, kicker, total, run?.name, pendingPlayer?.name, completedRun?.id, paused].join('');
  if (signature === lastStatus) return; lastStatus = signature;
  $('player-name').textContent = run?.name || pendingPlayer?.name || completedRun?.name || 'PLAYER'; $('score').textContent = String(total).padStart(3, '0'); $('turn').textContent = run ? `${preparingFirstTurn ? 1 : turnNumber} / ${turns}` : `— / ${turns}`;
  $('phase-label').textContent = kicker; $('button-text').textContent = button;
  $('play').hidden = Boolean(startingRun || (run && !recovering && !cameraRecovery && !paused));
  $('play').disabled = cameraLoading;
  $('turn-chips').replaceChildren();
  for (let i = 0; i < turns; i++) {
    const turn = run?.turns[i] || completedRun?.turns[i], toy = ASSORTMENT.find(toy => toy.id === turn?.prizeId);
    const chip = document.createElement('span'); chip.className = `turn-chip ${turn?.score ? 'scored' : ''}`;
    chip.textContent = turn ? turn.score ? `+${turn.score}` : 'MISS' : '—';
    if (cabinetEnabled && toy) {
      chip.dataset.prize = toy.id; chip.title = `Turn ${i + 1}: ${toy.name}, ${turn.score} points`;
      chip.setAttribute('role', 'img'); chip.setAttribute('aria-label', chip.title); chip.replaceChildren();
      for (const [className, text] of [['trophy-icon', TROPHY_ICONS[toy.family]], ['trophy-name', toy.name], ['trophy-score', `+${turn.score}`]]) {
        const part = document.createElement('span'); part.className = className; part.textContent = text; part.setAttribute('aria-hidden', 'true'); chip.append(part);
      }
    }
    $('turn-chips').append(chip);
  }
  }
  return { update, invalidate: () => { lastStatus = ''; } };
}

export { $, setText, setHidden };
