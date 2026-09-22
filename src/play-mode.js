import { STORAGE_KEY } from './event-session.js';
import { HOLD_LIMITS } from './fist.js';
import { HAND_ACQUIRE_MS, RIGHT_SLAM_MS } from './dual-hand-controls.js';
import { PRESS_MS } from './grab-release.js';

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
  return Object.freeze({
    shared, profile,
    dual: profile === 'dual', grab: profile !== 'hold-drop', cabinet: true,
    holdMs, steering,
    controlMode: profile === 'dual' ? 'two-hand' : 'one-hand',
    storageKey: profile === 'dual' ? `${STORAGE_KEY}:dual-controls` : profile === 'grab-release' ? `${STORAGE_KEY}:cabinet-controls` : STORAGE_KEY,
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
