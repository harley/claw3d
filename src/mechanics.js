export const FIELD = { minX: -1.27, maxX: 1.27, minZ: -.86, maxZ: .84 };
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const ease = t => { const v = clamp(t, 0, 1); return v * v * (3 - 2 * v); };

export function moveClaw(position, input, seconds, speed = 1.1, bounds = FIELD) {
  return {
    x: clamp(position.x + clamp(input.x, -1, 1) * speed * seconds, bounds.minX, bounds.maxX),
    z: clamp(position.z + clamp(input.z, -1, 1) * speed * seconds, bounds.minZ, bounds.maxZ),
  };
}

// Arcade-assisted grasp: an eligible prize must fit beneath the open claw.
// Once captured it stays attached. There is no random release or hidden win roll.
export function findCatch(position, prizes) {
  return prizes.filter(p => !p.claimed)
    .map(prize => ({ prize, distance: Math.hypot(position.x - prize.x, position.z - prize.z) }))
    .filter(({ prize, distance }) => distance <= prize.catchRadius)
    .sort((a, b) => a.distance - b.distance)[0]?.prize ?? null;
}

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
