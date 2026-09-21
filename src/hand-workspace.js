// Camera coordinates are already mirrored. Keep physical workspaces apart,
// then map each hand relative to its own deliberately acquired open position.
export const HAND_ZONES = { left: { minX: .08, maxX: .48 }, right: { minX: .52, maxX: .92 } };
export const HAND_RANGE = { x: .18, y: .20 };
export function handInZone(point, role) {
  const zone = HAND_ZONES[role];
  return point.y >= .12 && point.y <= .88 && point.x >= zone.minX && point.x <= zone.maxX;
}
export function handOffset(point, origin) {
  return origin ? { x: (point.x - origin.x) / HAND_RANGE.x, y: (point.y - origin.y) / HAND_RANGE.y } : { x: 0, y: 0 };
}
export function inHandRange(offset) { return Math.abs(offset.x) <= 1 && Math.abs(offset.y) <= 1; }

// Shared by glove drawing and hit testing: resizing moves the control, never
// the physical neutral. Neither hand can draw into the other's workspace.
export function projectHandWorkspace(offset, role, targets) {
  const control = role === 'left' ? targets.stick : targets.drop;
  const bounds = targets.bounds, middle = (targets.stick.x + targets.drop.x) / 2;
  const minX = role === 'left' ? bounds.left + 36 : middle + 36;
  const maxX = role === 'left' ? middle - 36 : bounds.right - 36;
  const x = Math.max(-1, Math.min(1, offset.x)), y = Math.max(-1, Math.min(1, offset.y));
  const span = control.radius * 2.6;
  return {
    x: control.x + x * Math.max(0, Math.min(span, x < 0 ? control.x - minX : maxX - control.x)),
    y: control.y + y * Math.max(0, Math.min(span, y < 0 ? control.y - bounds.top - 40 : bounds.bottom - control.y - 35)),
  };
}
