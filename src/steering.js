import { FIELD, clamp } from './arcade-mechanics.js';
import { OneEuroPoint } from './one-euro.js';
import { joystickAxis } from './mechanics.js';

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

// One steering implementation for every control profile: a One Euro filtered
// hand centre measured against a neutral pose. The neutral seeds from the first
// update after a release (or from an explicit acquisition pose), so steering
// always starts at exactly zero. `relative` maps displacement to a velocity;
// `absolute` maps it to a bed target (see above).
export class Steering {
  constructor({ mode = 'relative', filter = new OneEuroPoint() } = {}) { this.mode = mode; this.filter = filter; this.neutral = null; }
  seed(point) { this.neutral = { x: point.x, y: point.y }; }
  release() { this.neutral = null; this.filter.reset(); }
  update(center, now) {
    if (!this.neutral) this.filter.reset();
    const point = this.filter.filter(center, now);
    this.neutral ||= { ...point };
    if (this.mode === 'absolute') {
      const lead = this.filter.predict(ABSOLUTE_LEAD_MS) || point;
      const offset = { x: lead.x - this.neutral.x, y: lead.y - this.neutral.y };
      return { x: clamp(offset.x / ABSOLUTE_RANGE.x, -1, 1), z: clamp(offset.y / ABSOLUTE_RANGE.y, -1, 1), target: absoluteTarget(offset) };
    }
    return { x: joystickAxis(point.x - this.neutral.x), z: joystickAxis(point.y - this.neutral.y) };
  }
}

// Hand menus and the glove cursor share one mapping from the camera frame to the page.
export const MENU_BOX = Object.freeze({ left: .18, width: .64, top: .15, height: .70 });
export function menuScreenPoint(p, width, height) {
  return { x: clamp((p.x - MENU_BOX.left) / MENU_BOX.width, 0, 1) * width, y: clamp((p.y - MENU_BOX.top) / MENU_BOX.height, 0, 1) * height };
}
