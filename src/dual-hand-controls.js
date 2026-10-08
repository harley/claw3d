import { HAND_ZONES, handInZone, handOffset, inHandRange, dropOffset } from './hand-workspace.js';
import { GrabRelease } from './grab-release.js';
import { Steering } from './steering.js';


export const HAND_ACQUIRE_MS = 300;
export const LEFT_GRIP_GRACE_MS = 200;
export const RIGHT_SLAM_MS = 360;
// An acquired open palm that arrives on the visible target commits one press.
// A palm brought straight onto the target still presses after acquisition; one
// already resting there when DROP becomes available must leave first.
class RightPalmDrop {
  constructor() { this.reset(); }
  reset() { this.stage = 'seeking'; this.armed = false; this.progress = 0; }
  read() { return { stage: this.stage, armed: this.armed, progress: this.progress, fired: false }; }
  update(valid, { nearDrop, arrived }) {
    if (!valid) { this.reset(); return this.read(); }
    if (!nearDrop) { this.stage = 'armed'; this.armed = true; return this.read(); }
    if (this.stage === 'fired') return this.read();
    if (!arrived) { this.stage = 'resting'; this.armed = false; return this.read(); }
    this.stage = 'fired'; this.armed = false;
    return { ...this.read(), fired: true };
  }
}

// In recorded two-hand play the open right hand rests inside DROP while the left
// grips. Arrival needs the right side seen clear of the target, or out of view
// for a full acquisition, while the grip is held. It reads raw positions, not
// roles, so a relabelled or briefly missed resting palm cannot re-arrive by
// reacquiring; the margin stops edge jitter from counting as leaving.
const ARRIVAL_MARGIN = 1.25;
class DropArrival {
  constructor() { this.seen = null; this.away = false; this.arrived = false; }
  observe(hands, now) {
    const right = hands.filter(hand => hand.center.x > .5);
    if (right.length || this.seen === null) this.seen = now; // unknown history counts from now
    const near = hand => { const offset = dropOffset(hand.center); return Math.hypot(offset.x, offset.y) < ARRIVAL_MARGIN; };
    this.away = !right.some(near) && (right.length > 0 || now - this.seen >= HAND_ACQUIRE_MS);
  }
  update(available) { this.arrived = available && (this.arrived || this.away); return this.arrived; }
}

const MAX_STEP = .18, SEPARATION = .065;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inLeftGripZone = point => point.x >= .02 && point.x <= HAND_ZONES.left.maxX && point.y >= .02 && point.y <= .98;
const role = () => ({ owner: null, origin: null, observed: null, candidate: null, lastSeen: null, reservation: null, interrupted: false, gesture: new GrabRelease(), steer: new Steering() });
const clear = state => { state.owner = state.origin = state.observed = state.candidate = state.lastSeen = null; state.interrupted = false; state.gesture.reset(); state.steer.release(); };

// A camera-controller helper: the scene supplies targets, mechanics accepts drops.
// Each role has independent ownership and gesture evidence; neither can inherit
// the other role's closed hand or confirmation time.
export class DualHandControls {
  constructor() { this.reset(); }
  reset() { this.left = role(); this.right = role(); this.right.gesture = new RightPalmDrop(); this.arrival = new DropArrival(); this.last = null; }
  // A START or turn boundary keeps both roles and the grip, but no steering
  // baseline or DROP evidence carries into the new aiming window.
  neutralize() { this.left.steer.release(); this.right.gesture.reset(); this.arrival.update(false); }

  track(state, name, hands, now) {
    if (state.interrupted && now - state.lastSeen > LEFT_GRIP_GRACE_MS) clear(state);
    // Preserve only an established grip through a short detection dropout.
    // Never steer or accept a drop without fresh, confident evidence.
    const roleHands = hands.filter(hand => hand.physicalHand === name);
    const candidates = roleHands.filter(hand => hand.handednessScore >= .75);
    let hand = roleHands.length === 1 && candidates.length === 1 ? candidates[0] : null;
    // Keep a spatial reservation after a dropout; a distant bystander cannot
    // immediately become the player. This is continuity, not person identity.
    if (hand && name === 'left' && state.reservation && now - state.reservation.at <= 650 &&
      distance(hand.center, state.reservation.center) > MAX_STEP) hand = null;
    if (hand && name === 'left' && !state.owner && (!state.reservation || now - state.reservation.at > 650) &&
      (hand.center.x < .18 || hand.center.y < .20 || hand.center.y > .80)) hand = null;
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
    if (!stickyGrip && (!handInZone(hand.center, name) || (name === 'left' && state.owner && !inHandRange(offset)))) {
      clear(state);
      return { hand, ready: false, outside: true };
    }
    state.interrupted = false;
    state.lastSeen = now;
    if (name === 'left' && state.owner) state.reservation = { center: { ...hand.center }, at: now };
    state.observed = { ...hand.center };
    if (state.owner) { state.owner = { ...hand.center }; return { hand, ready: true }; }
    if (!hand.fist.open || hand.fist.closed) {
      state.candidate = null; return { hand, ready: false };
    }
    if (!state.candidate || distance(hand.center, state.candidate.center) > .08) state.candidate = { center: { ...hand.center }, at: now };
    if (now - state.candidate.at >= HAND_ACQUIRE_MS) {
      state.owner = { ...hand.center }; state.origin = { ...hand.center }; state.candidate = null;
      if (name === 'left') state.reservation = { center: { ...hand.center }, at: now };
      return { hand, ready: true, acquired: true };
    }
    return { hand, ready: false };
  }

  update(hands, now, getTarget, acceptsDrop = true) {
    if (this.last !== null && (now - this.last > 300 || now < this.last)) this.reset();
    this.last = now;
    this.arrival.observe(hands, now);
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
      // Right-side noise must not erase a left grip we can still independently
      // identify. Never relabel that noise: discard it and reacquire the right.
      const heldLeft = this.left.owner && this.left.gesture.stage === 'gripped'
        ? hands.filter(hand => hand.physicalHand === 'left' && hand.handednessScore >= .75 &&
          hand.fist.closed && !hand.fist.open && inLeftGripZone(hand.center) &&
          distance(hand.center, this.left.owner) <= MAX_STEP) : [];
      const keepLeft = hands.length === 2 && heldLeft.length === 1 && hands.every(hand =>
        hand === heldLeft[0] || (handInZone(hand.center, 'right') && distance(hand.center, heldLeft[0].center) >= SEPARATION));
      if (!keepLeft) {
        clear(this.left); clear(this.right);
        return { kind: 'lost', message: 'SEPARATE YOUR HANDS', input: { x: 0, z: 0 }, hands: {}, fired: false };
      }
      clear(this.right);
      hands = heldLeft;
    }
    const leftWasInterrupted = this.left.interrupted;
    const left = this.track(this.left, 'left', hands, now);
    const right = this.track(this.right, 'right', hands, now);
    const leftRecovered = leftWasInterrupted && left.ready;
    if (left.recovering && !right.ready) this.right.candidate = null;
    if (left.acquired) this.left.gesture.armed = true; // stable open acquisition already supplies arming evidence
    const leftTarget = left.ready ? getTarget(left.hand.center, 'left', this.left.origin) : {};
    const grip = left.recovering ? this.left.gesture.read() : this.left.gesture.update({ ...(left.hand?.fist || {}), visible: left.ready, overTarget: left.ready }, now);
    const leftClear = left.ready && left.hand.fist.open !== left.hand.fist.closed;
    const dropEnabled = Boolean(leftClear && grip.steering);
    const rightTarget = right.ready ? getTarget(right.hand.center, 'right', this.right.origin) : {};
    const rightClear = right.ready && right.hand.fist.open && !right.hand.fist.closed;
    // Re-enable DROP from a fresh right-hand baseline on the first confident
    // left sample; an approach begun while left control was unavailable cannot fire.
    // Arrival lasts while the grip is held, including its tolerated uncertain
    // poses and short recovery; releasing or losing the stick clears it.
    const arrived = this.arrival.update(acceptsDrop && Boolean(this.left.owner) && this.left.gesture.stage === 'gripped');
    const press = this.right.gesture.update(acceptsDrop && !leftRecovered && dropEnabled && rightClear,
      { nearDrop: Boolean(rightTarget.nearDrop), arrived });
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
      target: target.nearDrop || target.overDrop ? 'drop' : target.overTarget ? 'stick' : '',
    });
    const leftView = view(left, grip, leftTarget, this.left), rightView = view(right, press, rightTarget, this.right);
    const kind = left.outside ? 'lost' : !left.ready ? left.hand ? 'calibrating' : 'lost' : !leftClear ? 'lost' :
      grip.stage === 'grabbing' ? 'clenching' : 'tracking';
    // Name what the visible hand needs; a pose changing mid-clench keeps its step.
    const leftMessage = left.recovering ? 'HOLD LEFT HAND STEADY' : left.outside ? 'RETURN LEFT HAND TO ITS AREA' :
      !left.hand ? 'SHOW LEFT HAND' : !left.ready ? left.hand.fist.open && !left.hand.fist.closed ? 'HOLD LEFT HAND STILL' : 'OPEN LEFT HAND' :
      grip.stage !== 'gripped' ? 'LEFT HAND · GRAB JOYSTICK' : '';
    return { kind, input, hands: { left: leftView, right: rightView }, fired: press.fired, dropEnabled,
      // Aggregate fields preserve the existing HUD/scene feedback contract.
      grab: grip,
      progress: grip.progress,
      pointer: leftView.pointer, target: rightView.target, closed: leftView.closed,
      message: leftMessage || (right.outside ? 'RETURN RIGHT HAND TO ITS AREA' : press.stage === 'resting' ? 'MOVE RIGHT PALM OFF DROP' : 'OPEN RIGHT PALM TO DROP') };
  }
}
