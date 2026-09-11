import { clamp } from './arcade-mechanics.js';

export function pinchRatio(landmarks, aspect = 1) {
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const palm = Math.max(distance(landmarks[5], landmarks[17]), distance(landmarks[0], landmarks[9]));
  return palm > .015 ? distance(landmarks[4], landmarks[8]) / palm : Infinity;
}

export function joystickAxis(displacement, range = .17) {
  if (Math.abs(displacement) < .015) return 0;
  return clamp(displacement / range, -1, 1);
}

// The nearest matching hand keeps control. Losing it never transfers control
// to a different person until the current round is reset.
export function matchHand(hands, anchor, handedness) {
  if (!anchor) return null;
  const candidates = hands.map(hand => ({ hand, distance: Math.hypot(hand.center.x - anchor.x, hand.center.y - anchor.y) }))
    .filter(item => item.hand.handedness === handedness && item.distance < .22)
    .sort((a, b) => a.distance - b.distance);
  // Two plausible hands are ambiguous: pause instead of guessing an owner.
  return candidates.length === 1 ? candidates[0].hand : null;
}
