import { handInZone, handOffset, inHandRange } from './hand-workspace.js';
import { GrabRelease } from './grab-release.js';
import { OneEuroPoint } from './one-euro.js';
import { joystickAxis } from './mechanics.js';

const ACQUIRE_MS = 300, MAX_STEP = .18, SEPARATION = .065;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const role = () => ({ owner: null, origin: null, observed: null, candidate: null, gesture: new GrabRelease(), filter: new OneEuroPoint(), neutral: null });
const clear = state => { state.owner = state.origin = state.observed = state.candidate = state.neutral = null; state.gesture.reset(); state.filter.reset(); };

// A camera-controller helper: the scene supplies targets, mechanics accepts drops.
// Each role has independent ownership and gesture evidence; neither can inherit
// the other role's closed hand or confirmation time.
export class DualHandControls {
  constructor() { this.reset(); }
  reset() { this.left = role(); this.right = role(); this.last = null; }

  track(state, name, hands, now) {
    const candidates = hands.filter(hand => hand.physicalHand === name && hand.handednessScore >= .75);
    const hand = candidates.length === 1 ? candidates[0] : null;
    if (!hand || (state.owner && distance(hand.center, state.owner) > MAX_STEP)) {
      clear(state); return { hand: null, ready: false };
    }
    const offset = handOffset(hand.center, state.origin);
    if (!handInZone(hand.center, name) || !inHandRange(offset)) {
      const origin = state.origin;
      clear(state); state.origin = origin;
      return { hand, ready: false, outside: true };
    }
    state.observed = { ...hand.center };
    if (state.owner) { state.owner = { ...hand.center }; return { hand, ready: true }; }
    if (!hand.fist.open || hand.fist.closed) {
      state.candidate = null; return { hand, ready: false };
    }
    if (!state.candidate || distance(hand.center, state.candidate.center) > .08) state.candidate = { center: { ...hand.center }, at: now };
    if (now - state.candidate.at >= ACQUIRE_MS) {
      state.owner = { ...hand.center }; state.origin = { ...hand.center }; state.candidate = null;
      return { hand, ready: true };
    }
    return { hand, ready: false };
  }

  update(hands, now, getTarget) {
    if (this.last !== null && (now - this.last > 300 || now < this.last)) this.reset();
    this.last = now;
    const ambiguous = hands.length > 2 || (hands.length === 2 && distance(hands[0].center, hands[1].center) < SEPARATION) ||
      // A detection closer to the other owner's previous position is an
      // ambiguous association, even when its handedness label looks confident.
      (this.left.observed && this.right.observed && hands.some(hand => {
        const own = this[hand.physicalHand]?.observed;
        const other = hand.physicalHand === 'left' ? this.right.observed : this.left.observed;
        return own && distance(hand.center, other) + .025 < distance(hand.center, own);
      }));
    if (ambiguous) {
      clear(this.left); clear(this.right);
      return { kind: 'lost', message: 'SEPARATE YOUR HANDS', input: { x: 0, z: 0 }, hands: {}, fired: false };
    }
    const left = this.track(this.left, 'left', hands, now);
    const right = this.track(this.right, 'right', hands, now);
    const leftTarget = left.ready ? getTarget(left.hand.center, 'left', this.left.origin) : {};
    const grip = this.left.gesture.update({ ...(left.hand?.fist || {}), visible: left.ready, overTarget: Boolean(leftTarget.overTarget) }, now);
    const leftClear = left.ready && left.hand.fist.open !== left.hand.fist.closed;
    const dropEnabled = Boolean(leftClear && grip.steering);
    const rightTarget = right.ready ? getTarget(right.hand.center, 'right', this.right.origin) : {};
    const rightClear = right.ready && right.hand.fist.open !== right.hand.fist.closed;
    if (!dropEnabled || !rightClear) this.right.gesture.reset();
    const press = this.right.gesture.update({ ...(right.hand?.fist || {}), visible: rightClear && dropEnabled,
      overDrop: Boolean(rightTarget.overDrop), aboveDrop: Boolean(rightTarget.aboveDrop), point: right.hand?.center }, now);
    let input = { x: 0, z: 0 };
    if (grip.grabbed) { this.left.neutral = null; this.left.filter.reset(); }
    if (grip.steering && leftClear && !press.fired) {
      const point = this.left.filter.filter(left.hand.center, now);
      this.left.neutral ||= { ...point };
      input = { x: joystickAxis(point.x - this.left.neutral.x), z: joystickAxis(point.y - this.left.neutral.y) };
    } else this.left.neutral = null;
    const view = (observation, gesture, target, state) => ({
      workspace: observation.hand ? handOffset(observation.hand.center, state.origin) : null,
      outside: Boolean(observation.outside),
      kind: observation.ready ? ['grabbing', 'pressing'].includes(gesture.stage) ? 'clenching' : 'tracking' : 'calibrating',
      pointer: observation.hand ? { ...observation.hand.center } : null,
      ready: observation.ready, closed: Boolean(observation.hand?.fist.closed),
      grab: gesture, progress: gesture.progress,
      target: target.overDrop ? 'drop' : target.overTarget ? 'stick' : '',
    });
    const leftView = view(left, grip, leftTarget, this.left), rightView = view(right, press, rightTarget, this.right);
    const kind = left.outside ? 'lost' : !left.ready ? left.hand ? 'calibrating' : 'lost' : !leftClear ? 'lost' :
      press.stage === 'pressing' || grip.stage === 'grabbing' ? 'clenching' : 'tracking';
    return { kind, input, hands: { left: leftView, right: rightView }, fired: press.fired, dropEnabled,
      // Aggregate fields preserve the existing HUD/scene feedback contract.
      grab: press.stage === 'pressing' ? press : grip,
      progress: press.stage === 'pressing' ? press.progress : grip.progress,
      pointer: leftView.pointer, target: rightView.target, closed: leftView.closed,
      message: left.outside ? 'RETURN LEFT HAND TO ITS AREA' : !leftClear ? 'SHOW LEFT HAND OPEN' : !grip.steering ? 'LEFT HAND · GRAB JOYSTICK' : right.outside ? 'RETURN RIGHT HAND TO ITS AREA' : !right.ready || !press.armed ? 'RAISE RIGHT HAND OPEN' : 'RIGHT HAND · PRESS DROP' };
  }
}
