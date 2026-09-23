import { HAND_ZONES, handInZone, handOffset, inHandRange } from './hand-workspace.js';
import { GrabRelease } from './grab-release.js';
import { Steering } from './steering.js';


export const HAND_ACQUIRE_MS = 300;
export const LEFT_GRIP_GRACE_MS = 200;
export const RIGHT_RAISE_DISTANCE = .06;
export const RIGHT_SLAM_MS = 360;
// Enter the right workspace open, or raise an already acquired open hand.
// Recognition commits once; the virtual hand supplies the physical strike.
class RightRaise {
  constructor() { this.reset(); }
  reset() { this.stage = 'seeking'; this.armed = false; this.progress = 0; this.baseline = null; }
  read() { return { stage: this.stage, armed: this.armed, progress: this.progress, fired: false }; }
  update(valid, { acquired, y }) {
    if (this.stage === 'fired') return this.read();
    if (!valid) { this.reset(); this.baseline = y ?? null; return this.read(); }
    this.baseline = Math.max(this.baseline ?? y, y);
    const raised = Boolean(acquired || this.baseline - y >= RIGHT_RAISE_DISTANCE);
    this.armed = true; this.stage = raised ? 'fired' : 'armed';
    return { ...this.read(), fired: raised };
  }
}

const MAX_STEP = .18, SEPARATION = .065;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inLeftGripZone = point => point.x >= .02 && point.x <= HAND_ZONES.left.maxX && point.y >= .02 && point.y <= .98;
const role = () => ({ owner: null, origin: null, observed: null, candidate: null, lastSeen: null, interrupted: false, gesture: new GrabRelease(), steer: new Steering() });
const clear = state => { state.owner = state.origin = state.observed = state.candidate = state.lastSeen = null; state.interrupted = false; state.gesture.reset(); state.steer.release(); };

// A camera-controller helper: the scene supplies targets, mechanics accepts drops.
// Each role has independent ownership and gesture evidence; neither can inherit
// the other role's closed hand or confirmation time.
export class DualHandControls {
  constructor() { this.reset(); }
  reset() { this.left = role(); this.right = role(); this.right.gesture = new RightRaise(); this.last = null; }

  track(state, name, hands, now) {
    if (state.interrupted && now - state.lastSeen > LEFT_GRIP_GRACE_MS) clear(state);
    // Preserve only an established grip through a short detection dropout.
    // Never steer or accept a drop without fresh, confident evidence.
    const roleHands = hands.filter(hand => hand.physicalHand === name);
    const candidates = roleHands.filter(hand => hand.handednessScore >= .75);
    const hand = roleHands.length === 1 && candidates.length === 1 ? candidates[0] : null;
    if (!hand && name === 'left' && state.owner && state.gesture.stage === 'gripped' &&
      now - state.lastSeen <= LEFT_GRIP_GRACE_MS &&
      (hands.length === 0 || (roleHands.length <= 1 && hands.filter(hand => hand.physicalHand === 'right').length <= 1 && hands.every(hand =>
        hand.physicalHand === 'right' ? handInZone(hand.center, 'right') :
          hand.physicalHand === 'left' && distance(hand.center, state.owner) <= MAX_STEP && inLeftGripZone(hand.center))))) {
      state.interrupted = true;
      return { hand: null, ready: false, recovering: true };
    }
    if (!hand || (state.owner && distance(hand.center, state.owner) > MAX_STEP)) {
      clear(state); return { hand: null, ready: false };
    }
    const offset = handOffset(hand.center, state.origin);
    // Once held, the stick is mechanically attached. The local range controls
    // steering sensitivity, not ownership. Keep the centre gap and camera edge
    // guards, but allow comfortable overshoot without dropping the grip.
    const stickyGrip = name === 'left' && state.owner && state.gesture.stage === 'gripped' &&
      inLeftGripZone(hand.center);
    if (!stickyGrip && (!handInZone(hand.center, name) || (state.owner && !inHandRange(offset)))) {
      clear(state);
      return { hand, ready: false, outside: true };
    }
    state.interrupted = false;
    state.lastSeen = now;
    state.observed = { ...hand.center };
    if (state.owner) { state.owner = { ...hand.center }; return { hand, ready: true }; }
    if (!hand.fist.open || hand.fist.closed) {
      state.candidate = null; return { hand, ready: false };
    }
    if (!state.candidate || distance(hand.center, state.candidate.center) > .08) state.candidate = { center: { ...hand.center }, at: now };
    if (now - state.candidate.at >= HAND_ACQUIRE_MS) {
      state.owner = { ...hand.center }; state.origin = { ...hand.center }; state.candidate = null;
      return { hand, ready: true, acquired: true };
    }
    return { hand, ready: false };
  }

  update(hands, now, getTarget) {
    if (this.last !== null && (now - this.last > 300 || now < this.last)) this.reset();
    this.last = now;
    const duplicateRole = ['left', 'right'].some(name => hands.filter(hand => hand.physicalHand === name).length > 1);
    const ambiguous = hands.length > 2 || duplicateRole || (hands.length === 2 && distance(hands[0].center, hands[1].center) < SEPARATION) ||
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
    const leftWasInterrupted = this.left.interrupted;
    const left = this.track(this.left, 'left', hands, now);
    const right = this.track(this.right, 'right', hands, now);
    const leftRecovered = leftWasInterrupted && left.ready;
    if (left.recovering && !right.ready) this.right.candidate = null;
    const leftTarget = left.ready ? getTarget(left.hand.center, 'left', this.left.origin) : {};
    const grip = left.recovering ? this.left.gesture.read() : this.left.gesture.update({ ...(left.hand?.fist || {}), visible: left.ready, overTarget: Boolean(leftTarget.overTarget) }, now);
    const leftClear = left.ready && left.hand.fist.open !== left.hand.fist.closed;
    const dropEnabled = Boolean(leftClear && grip.steering);
    const rightTarget = right.ready ? getTarget(right.hand.center, 'right', this.right.origin) : {};
    const rightClear = right.ready && right.hand.fist.open && !right.hand.fist.closed;
    // Re-enable DROP from a fresh right-hand baseline on the first confident
    // left sample; a raise begun while left control was unavailable cannot fire.
    const press = this.right.gesture.update(!leftRecovered && dropEnabled && rightClear,
      { acquired: leftRecovered ? false : right.acquired, y: right.ready ? right.hand.center.y : undefined });
    let input = { x: 0, z: 0 };
    if (grip.grabbed) this.left.steer.release();
    if (grip.steering && leftClear && !press.fired) input = this.left.steer.update(left.hand.center, now);
    else this.left.steer.release();
    const view = (observation, gesture, target, state) => ({
      workspace: observation.hand ? handOffset(observation.hand.center, state.origin) : null,
      outside: Boolean(observation.outside),
      kind: observation.ready ? gesture.stage === 'grabbing' ? 'clenching' : 'tracking' : 'calibrating',
      pointer: observation.hand ? { ...observation.hand.center } : null,
      ready: observation.ready, open: Boolean(observation.hand?.fist.open), closed: Boolean(observation.hand?.fist.closed),
      grab: gesture, progress: gesture.progress,
      target: target.overDrop ? 'drop' : target.overTarget ? 'stick' : '',
    });
    const leftView = view(left, grip, leftTarget, this.left), rightView = view(right, press, rightTarget, this.right);
    const kind = left.outside ? 'lost' : !left.ready ? left.hand ? 'calibrating' : 'lost' : !leftClear ? 'lost' :
      grip.stage === 'grabbing' ? 'clenching' : 'tracking';
    return { kind, input, hands: { left: leftView, right: rightView }, fired: press.fired, dropEnabled,
      // Aggregate fields preserve the existing HUD/scene feedback contract.
      grab: grip,
      progress: grip.progress,
      pointer: leftView.pointer, target: rightView.target, closed: leftView.closed,
      message: left.recovering ? 'HOLD LEFT HAND STEADY' : left.outside ? 'RETURN LEFT HAND TO ITS AREA' : !leftClear ? 'SHOW LEFT HAND OPEN' : !grip.steering ? 'LEFT HAND · GRAB JOYSTICK' : right.outside ? 'RETURN RIGHT HAND TO ITS AREA' : 'RAISE RIGHT HAND OPEN' };
  }
}
