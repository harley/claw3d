// Shared physical pose and finger profile for the suspended steel claw.
// Rendering, swept contacts and grasp judgement all use these transforms.
export const SUSPENSION_Y = 4.21;
export const CABLE_ATTACH_Y = .09;
export const STEEL_FINGER_DEPTH = .98;
export const CLAW_FINGER_ANGLES = [Math.PI / 6, Math.PI * 5 / 6, Math.PI * 3 / 2];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function rotateClaw(point, rotation = { x: 0, z: 0 }, inverse = false) {
  const cx = Math.cos(rotation.x), sx = Math.sin(rotation.x), cz = Math.cos(rotation.z), sz = Math.sin(rotation.z);
  if (inverse) {
    const y = point.y * cx + point.z * sx, z = -point.y * sx + point.z * cx;
    return { x: point.x * cz + y * sz, y: -point.x * sz + y * cz, z };
  }
  const x = point.x * cz - point.y * sz, y = point.x * sz + point.y * cz;
  return { x, y: y * cx - point.z * sx, z: y * sx + point.z * cx };
}
export function clawWorldPoint(pose, local) {
  const p = rotateClaw(local, pose.rotation);
  return { x: pose.x + p.x, y: pose.y + p.y, z: pose.z + p.z };
}

// Keep the same tip reach throughout closing. The curved strip bows outward
// above the tip; its width tapers to a point rather than a rubber contact pad.
export function steelFingerPoint(radius, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * .11 + 3 * u * u * t * (.26 + radius * .45) + 3 * u * t * t * (.12 + radius * .72) + t ** 3 * radius,
    y: u ** 3 * -.34 + 3 * u * u * t * -.46 + 3 * u * t * t * -.77 - t ** 3 * STEEL_FINGER_DEPTH,
    z: 0,
  };
}
export const steelFingerWidth = t => .027 * (1 - t) ** .6 + .0005;
export function steelFingerSamples(radius) {
  return Array.from({ length: 17 }, (_, i) => steelFingerPoint(radius, i / 16));
}
export function createSuspension() {
  return { x: 0, z: 0, vx: 0, vz: 0, bob: 0, bobVelocity: 0, previous: null, velocity: { x: 0, y: 0, z: 0 } };
}
export function stepSuspension(state, carriage, dt, { constrained = false, loaded = false } = {}) {
  if (dt <= 0) return;
  if (!state.previous) state.previous = { ...carriage };
  const velocity = {}, impulse = {};
  for (const axis of ['x', 'y', 'z']) {
    velocity[axis] = (carriage[axis] - state.previous[axis]) / dt;
    impulse[axis] = clamp(velocity[axis] - state.velocity[axis], -2.4, 2.4);
  }
  state.previous = { ...carriage }; state.velocity = velocity;
  if (constrained) { state.vx = state.vz = state.bobVelocity = 0; return; }
  const length = SUSPENSION_Y - carriage.y + .38;
  const damping = (loaded ? 5 : 2.8) - 2 * velocity.y / length;
  const limit = carriage.y > 3.9 ? .14 : .28;
  // A change of carriage velocity transfers momentum once. Clamping acceleration
  // per render frame made the same stop much stronger at low frame rates.
  state.vx -= impulse.x / length * Math.cos(state.x);
  state.vz -= impulse.z / length * Math.cos(state.z);
  state.bobVelocity -= impulse.y * .24;
  for (let left = Math.min(dt, .1); left > 1e-9;) {
    const h = Math.min(left, 1 / 180); left -= h;
    for (const axis of ['x', 'z']) {
      const v = axis === 'x' ? 'vx' : 'vz';
      state[v] += (-9.81 / length * Math.sin(state[axis]) - damping * state[v]) * h;
      state[axis] += state[v] * h;
      if (Math.abs(state[axis]) > limit) { state[axis] = clamp(state[axis], -limit, limit); state[v] *= .5; }
    }
    state.bobVelocity += (-170 * state.bob - 10 * state.bobVelocity) * h;
    state.bob = clamp(state.bob + state.bobVelocity * h, -.035, .035);
  }
  // Cabinet stops act on the whole finger envelope, not just the carriage.
  // Neutral fingers fit at every travel limit; shorten a swing into a wall.
  const inside = () => {
    const pose = suspendedPose(carriage, state);
    return CLAW_FINGER_ANGLES.every(angle => [.25, .5, .75, 1].every(t => {
      const p = steelFingerPoint(.41, t), w = clawWorldPoint(pose, { x: Math.cos(angle) * p.x, y: p.y, z: Math.sin(angle) * p.x });
      return w.x >= -1.61 && w.x <= 1.61 && w.z >= -1.10 && w.z <= 1.14;
    }));
  };
  if (!inside()) {
    for (let i = 0; i < 12 && !inside(); i++) { state.x *= .5; state.z *= .5; }
    state.vx = state.vz = 0;
  }
}
export function suspendedPose(carriage, state) {
  const rotation = { x: -state.z, z: state.x };
  const length = Math.max(.04, SUSPENSION_Y - carriage.y - CABLE_ATTACH_Y - state.bob);
  const offset = rotateClaw({ x: 0, y: -length - CABLE_ATTACH_Y, z: 0 }, rotation);
  return { ...carriage, x: carriage.x + offset.x, y: SUSPENSION_Y + offset.y, z: carriage.z + offset.z, rotation, carriage: { x: carriage.x, y: carriage.y, z: carriage.z } };
}

// Slice a toy's actual supporting ellipsoid in the claw's tilted tip plane.
// A horizontal catch envelope at the carriage would award invisible catches.
export function clawSupportSlice(pose, toy, shape, bed) {
  const center = rotateClaw({ x: toy.x - pose.x, y: bed + (toy.elevation || 0) + (shape.cy - (toy.groundOffset || 0)) * toy.scale - pose.y, z: toy.z - pose.z }, pose.rotation, true);
  const c = Math.cos(toy.yaw), s = Math.sin(toy.yaw);
  const axes = [{ x: c, y: 0, z: -s }, { x: 0, y: 1, z: 0 }, { x: s, y: 0, z: c }].map(a => rotateClaw(a, pose.rotation, true));
  const weights = [shape.rx, shape.ry, shape.rz].map(r => 1 / (r * toy.scale) ** 2);
  const entry = (a, b) => axes.reduce((sum, axis, i) => sum + axis[a] * axis[b] * weights[i], 0);
  const xx = entry('x', 'x'), xz = entry('x', 'z'), zz = entry('z', 'z'), dy = -STEEL_FINGER_DEPTH - center.y;
  const bx = entry('x', 'y') * dy, bz = entry('z', 'y') * dy, det = xx * zz - xz * xz;
  const ox = (zz * bx - xz * bz) / det, oz = (xx * bz - xz * bx) / det;
  const factor = 1 - entry('y', 'y') * dy * dy + bx * ox + bz * oz;
  if (factor <= 0) return null;
  return { x: center.x - ox, z: center.z - oz, y: -STEEL_FINGER_DEPTH, xx: xx / factor, xz: xz / factor, zz: zz / factor, radius: Math.sqrt(factor / Math.min(xx, zz)) };
}
