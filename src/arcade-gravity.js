// Approximate volume-weighted centres of the authored body/head/feet shapes.
// The grasp envelope's belly centre is too low for head-heavy rabbits/robots.
export const MASS_CENTRE_Y = { bunny: .42, capybara: .35, cloud: .31, star: .35, robot: .44 };

// A planar support hull keeps gravity tied to the toy's actual silhouette.
// Height is potential energy per unit mass (apart from the shared g factor).
export function supportHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = values => {
    const hull = [];
    for (const p of values) { while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop(); hull.push(p); }
    return hull;
  };
  return [...half(sorted).slice(0, -1), ...half(sorted.reverse()).slice(0, -1)];
}

export function supportAt(profile, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  let point = profile.hull[0], bottom = Infinity;
  for (const p of profile.hull) {
    const y = p.y * c - p.x * s;
    if (y < bottom) { bottom = y; point = p; }
  }
  return { point, height: profile.cy * c - bottom };
}

export function gravityStep(profile, state, dt) {
  const angle = state.angle, velocity = state.velocity || 0;
  const current = supportAt(profile, angle), epsilon = .004;
  const lower = supportAt(profile, angle - epsilon).height, upper = supportAt(profile, angle + epsilon).height;
  if (Math.abs(velocity) < .08 && current.height <= Math.min(lower, upper) + 1e-7) return { angle, velocity: 0, shift: 0, sleeping: true };
  const acceleration = -9.81 * (upper - lower) / (2 * epsilon * profile.inertia);
  const speed = Math.max(-4.5, Math.min(4.5, (velocity + acceleration * dt) * Math.exp(-profile.damping * dt)));
  const next = angle + speed * dt;
  // Roll around the supporting point instead of rotating through the floor.
  const p = current.point;
  const shift = p.x * (Math.cos(angle) - Math.cos(next)) + p.y * (Math.sin(angle) - Math.sin(next));
  return { angle: next, velocity: speed, shift, sleeping: false };
}

export function hangingStep(state, dt) {
  const velocity = ((state.velocity || 0) - 24 * Math.sin(state.angle) * dt) * Math.exp(-7 * dt);
  const angle = state.angle + velocity * dt;
  return Math.abs(angle) < .002 && Math.abs(velocity) < .02 ? { angle: 0, velocity: 0 } : { angle, velocity };
}
