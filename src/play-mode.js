import { STORAGE_KEY } from './event-session.js';
import { HOLD_LIMITS } from './fist.js';
import { HAND_ACQUIRE_MS, RIGHT_SLAM_MS } from './dual-hand-controls.js';
import { PRESS_MS } from './grab-release.js';

// Orientation chooses a default only at a safe menu boundary. Explicit manual
// choices, local experiments and official ticket rules keep their own profile.
export function phonePlaySearch(search, { phone = false, landscape = false, locked = false, official = false } = {}) {
  const params = new URLSearchParams(search);
  if (!phone || locked || official || params.get('hands') === 'manual' || params.get('controls') === 'grab') return search;
  params.set('hands', 'auto');
  if (landscape) params.set('controls', 'dual'); else params.delete('controls');
  return `?${params}`;
}

// The effective play mode, resolved once from the page URL and the shared-pilot
// gate. Input profile, presentation, storage namespace and the server's control
// mode label all derive from this one object, so they cannot drift apart.
//  - `dual` (two hands) is a player choice on both local and shared play.
//  - `grab-release` and the `?hold=` / `?steer=` trials are local experiments only.
export function resolvePlayMode(search = '', shared = false) {
  const params = new URLSearchParams(search);
  const controls = params.get('controls');
  const profile = controls === 'dual' ? 'dual' : !shared && controls === 'grab' ? 'grab-release' : 'hold-drop';
  const requestedHold = Number(params.get('hold'));
  const holdMs = !shared && requestedHold >= HOLD_LIMITS.min && requestedHold <= HOLD_LIMITS.max ? Math.round(requestedHold) : undefined;
  const steering = !shared && params.get('steer') === 'absolute' ? 'absolute' : 'relative';
  const pushContact = !shared && params.get('contact') === 'push';
  const storageKey = profile === 'dual' ? `${STORAGE_KEY}:dual-controls` : profile === 'grab-release' ? `${STORAGE_KEY}:cabinet-controls` : STORAGE_KEY;
  return Object.freeze({
    shared, profile, pushContact,
    dual: profile === 'dual', grab: profile !== 'hold-drop', cabinet: true,
    holdMs, steering,
    controlMode: profile === 'dual' ? 'two-hand' : 'one-hand',
    storageKey: pushContact ? `${storageKey}:push-contact` : storageKey,
  });
}

// Seconds between the moment a player must start their drop gesture and the
// moment the drop is accepted, for the jackpot cue, prize tag and scene lights.
// Dual: a right hand not yet acquired still needs its acquisition before the
// 360 ms virtual strike. Undefined means the default fist hold.
export function cueLeadSeconds({ dual = false, grab = false, holdMs } = {}, feedback = {}) {
  if (dual) return ((feedback.hands?.right?.ready ? 0 : HAND_ACQUIRE_MS) + RIGHT_SLAM_MS) / 1000;
  if (grab) return PRESS_MS / 1000;
  return holdMs ? holdMs / 1000 : undefined;
}

// First-turn prep starts only after the selected input profile has a usable,
// confidently acquired controller. Recognition can run during prep, but the
// camera adapter keeps steering and drops disabled until START.
export function firstTurnControlReady(mode, feedback = {}) {
  if (!mode || feedback.profile !== mode.profile) return false;
  if (mode.dual) return dualStartReadiness(feedback) === 'ready';
  if (feedback.kind !== 'tracking' || feedback.handCount !== 1) return false;
  if (mode.grab && feedback.grab?.stage === 'gripped') return true;
  return feedback.open === true && feedback.closed !== true;
}

// The left hand starts the run. The right hand is introduced only after grip.
export function dualStartReadiness(feedback = {}) {
  if (['off', 'loading', 'error', 'delayed', 'blocked'].includes(feedback.kind)) return feedback.kind;
  if (feedback.profile !== 'dual') return 'show_left';
  const left = feedback.hands?.left;
  if (left?.outside) return 'return_left';
  if (!left?.ready && !left?.pointer) return 'show_left';
  if (!left?.ready) return left.closed ? 'open_left' : 'hold_left';
  if (left.open === true && left.closed !== true) return 'ready';
  if (left.closed === true && left.open !== true && ['grabbing', 'gripped'].includes(left.grab?.stage)) return 'ready';
  return 'open_left';
}
