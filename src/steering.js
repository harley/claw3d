import { FIELD, clamp } from './arcade-mechanics.js';

// Absolute steering: the hand's offset from its acquired neutral pose maps
// straight onto the bed, so pointing at a toy is one movement rather than a
// nudge. ABSOLUTE_RANGE is the normalized camera offset that reaches the edge
// of the field; the claw follows the target at ABSOLUTE_SPEED, never faster.
export const ABSOLUTE_RANGE = Object.freeze({ x: .18, y: .20 });
export const ABSOLUTE_SPEED = 2.4;
export const ABSOLUTE_LEAD_MS = 60;

export function absoluteTarget(offset) {
  const halfX = (FIELD.maxX - FIELD.minX) / 2, halfZ = (FIELD.maxZ - FIELD.minZ) / 2;
  const centreX = (FIELD.minX + FIELD.maxX) / 2, centreZ = (FIELD.minZ + FIELD.maxZ) / 2;
  return {
    x: clamp(centreX + offset.x / ABSOLUTE_RANGE.x * halfX, FIELD.minX, FIELD.maxX),
    z: clamp(centreZ + offset.y / ABSOLUTE_RANGE.y * halfZ, FIELD.minZ, FIELD.maxZ),
  };
}
