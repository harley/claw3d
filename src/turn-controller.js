import { drop, advance, move, moveToward, moveCarousel, aimTarget, homeClaw } from './arcade-mechanics.js';
import { ABSOLUTE_SPEED } from './steering.js';

// The turn lifecycle without the DOM: accepted drops, the aiming clock, the dual
// virtual strike, the hit-stop, and the pause before the next turn. The entry
// module owns run/score state and applies the effects this returns (sounds,
// telemetry, persistence, announcements); nothing here reads or writes the page.
export const HIT_STOP_SECONDS = .08;
export const nextTurnSeconds = caught => caught ? 2.5 : 1.2;
export const FIRST_TURN_PREPARATION_SECONDS = 4;
export const FIRST_TURN_CONTROL_LOSS_GRACE_SECONDS = .7;

export function createTurnState(seconds) {
  return { pendingSlam: null, remaining: seconds, hitStop: 0, nextTurnElapsed: 0, firstTurnPreparationElapsed: null, firstTurnControlReady: false, firstTurnControlLostElapsed: 0, dropRemainingMs: 0, contactFeedback: null };
}
export function beginTurnState(state, seconds) {
  state.nextTurnElapsed = 0; state.firstTurnPreparationElapsed = null; state.firstTurnControlReady = false; state.firstTurnControlLostElapsed = 0; state.dropRemainingMs = 0; state.contactFeedback = null; state.hitStop = 0; state.remaining = seconds;
}
export function beginFirstTurnPreparation(state, seconds) {
  state.pendingSlam = null; state.nextTurnElapsed = 0; state.firstTurnPreparationElapsed = 0; state.firstTurnControlReady = false; state.firstTurnControlLostElapsed = 0; state.dropRemainingMs = 0; state.contactFeedback = null; state.hitStop = 0; state.remaining = seconds;
}

// A drop request during aiming. The aiming time is locked at the request, so a
// dual strike's 360 ms cannot cost speed points. Returns 'dropped', 'slam' or false.
export function requestDrop(game, state, { dual = false, feedback = {} } = {}) {
  if (state.pendingSlam || state.firstTurnPreparationElapsed !== null || game.phase !== 'aim') return false;
  if (dual) { state.pendingSlam = { elapsed: 0, feedback }; state.dropRemainingMs = Math.floor(state.remaining * 1000); return 'slam'; }
  if (!drop(game)) return false;
  state.dropRemainingMs = Math.floor(state.remaining * 1000);
  return 'dropped';
}

// Advance one simulation step. `input` is zeroed in place whenever steering is
// not accepted, so the scene's lean stays honest. Effects, in order:
//  { type: 'aim', toy }            the toy currently under the claw (or null)
//  { type: 'moved' }               the claw actually travelled this step
//  { type: 'tick', remaining }     a whole second passed inside the last five
//  { type: 'drop', trigger }       a drop was accepted ('gesture' | 'timeout')
//  { type: 'nextTurn' }            the announcement finished; begin the next turn
//  { type: 'scorePop', prizeId }   the lift confirmed a catch
//  { type: 'finish' }              the turn reached its result
export function stepTurn(game, state, input, dt, { preparing = false, controlReady = false, reducedMotion = false, slamSeconds = .36 } = {}) {
  const effects = [];
  if (state.firstTurnPreparationElapsed !== null) {
    input.x = input.z = 0;
    if (!preparing) return effects;
    if (!state.firstTurnControlReady) {
      if (!controlReady) return effects;
      state.firstTurnControlReady = true;
      state.firstTurnControlLostElapsed = 0;
    } else if (!controlReady) {
      state.firstTurnControlLostElapsed += dt;
      if (state.firstTurnControlLostElapsed >= FIRST_TURN_CONTROL_LOSS_GRACE_SECONDS) {
        state.firstTurnControlReady = false;
        state.firstTurnControlLostElapsed = 0;
        state.firstTurnPreparationElapsed = 0;
      }
      return effects;
    } else state.firstTurnControlLostElapsed = 0;
    state.firstTurnPreparationElapsed += dt;
    if (state.firstTurnPreparationElapsed >= FIRST_TURN_PREPARATION_SECONDS) {
      state.firstTurnPreparationElapsed = null;
      effects.push({ type: 'nextTurn', initial: true });
    }
    return effects;
  }
  if (state.pendingSlam) {
    input.x = input.z = 0;
    state.pendingSlam.elapsed += dt;
    moveCarousel(game, dt);
    if (state.pendingSlam.elapsed >= slamSeconds) {
      state.contactFeedback = state.pendingSlam.feedback;
      state.pendingSlam = null;
      if (drop(game)) effects.push({ type: 'drop', trigger: 'gesture' });
    }
    return effects;
  }
  if (game.phase === 'aim') {
    const previous = game.position;
    game.position = input.target ? moveToward(game.position, input.target, dt, ABSOLUTE_SPEED) : move(game.position, input, dt);
    moveCarousel(game, dt);
    effects.push({ type: 'aim', toy: aimTarget(game) });
    if (Math.hypot(game.position.x - previous.x, game.position.z - previous.z) > .0001) effects.push({ type: 'moved' });
    const before = Math.ceil(state.remaining);
    state.remaining = Math.max(0, state.remaining - dt);
    if (Math.ceil(state.remaining) < before && state.remaining <= 5) effects.push({ type: 'tick', remaining: state.remaining });
    if (!state.remaining && drop(game)) { state.dropRemainingMs = 0; effects.push({ type: 'drop', trigger: 'timeout' }); }
    return effects;
  }
  input.x = input.z = 0;
  if (game.phase === 'idle') moveCarousel(game, dt);
  if (game.phase === 'result' && preparing) {
    homeClaw(game, dt);
    state.nextTurnElapsed += dt;
    if (state.nextTurnElapsed >= nextTurnSeconds(Boolean(game.plan?.prize))) { effects.push({ type: 'nextTurn' }); return effects; }
  }
  const before = game.phase;
  if (state.hitStop > 0) state.hitStop -= dt;
  advance(game, state.hitStop > 0 ? 0 : dt);
  if (before === 'descend' && game.phase === 'grip' && !reducedMotion) state.hitStop = HIT_STOP_SECONDS;
  if (before !== 'lift' && game.phase === 'lift' && game.plan?.prize) effects.push({ type: 'scorePop', prizeId: game.plan.prize.id });
  if (game.phase === 'result' && before !== 'result') effects.push({ type: 'finish' });
  return effects;
}
