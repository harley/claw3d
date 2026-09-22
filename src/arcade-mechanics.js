import { FIST_HOLD_MS } from './fist.js';
// Original, deterministic arcade grasping. No win rolls or target snapping.
export const BED = 1.66;
export const HIGH = 4.04;
export const FIELD = { minX: -1.18, maxX: 1.18, minZ: -.675, maxZ: .73 };
export const CHUTE = { x: -1.08, z: .66 };
// Every turn that does not continue over a miss begins here, clear of every toy.
export const START = Object.freeze({ x: 0, z: .03 });
export const FINGER_ANGLES = [Math.PI / 6, Math.PI * 5 / 6, Math.PI * 3 / 2];
export const OPEN_RADIUS = .41;
export const FINGER_DEPTH = .98;
// Durations of the committed-drop phases; PHASE_ORDER is the explicit sequence.
export const PHASES = { anticipate: .20, descend: .85, grip: .85, lift: 1.45, transfer: 1.10, release: .45, deliver: 1.60, reveal: .70 };
export const PHASE_ORDER = Object.freeze(['anticipate', 'descend', 'grip', 'lift', 'transfer', 'release', 'deliver', 'reveal']);
// An empty claw lifts briefly, then the turn ends where it is: no shelf run, no return home.
export const MISS_LIFT = .55;
export const phaseSeconds = (game, phase = game.phase) => phase === 'lift' && !game.plan?.prize ? MISS_LIFT : PHASES[phase];
export const MAX_FRAME_DELTA = .10;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };


// One isolated, mechanically predictable challenge. The pickup mark is fixed;
// the cue leads the star by the time needed for the claw to reach contact.
export const CAROUSEL = Object.freeze({ id: 'sprout', x: .80, z: -.04, radius: .26, height: .16, period: 5.6 });
export const EVENT_TOYS = ['bonbon', 'miso', 'blue-hour', 'peach', 'butter', 'sprout'];
// When the rider is caught the next candidate mounts the deck, so the timing
// challenge outlives the star. Points stay the toy's own; no rules change.
export const CAROUSEL_RIDERS = Object.freeze(['sprout', 'peach']);
export const RIDER_TRANSIT = .9;
export const carouselRider = game => game.rider ? game.toys.find(t => t.id === game.rider && !t.claimed) || null : null;
export const CONTACT_DELAY = PHASES.anticipate + PHASES.descend;
export function carouselPose(time) {
  const angle = Math.PI / 2 + time / CAROUSEL.period * Math.PI * 2;
  return { x: CAROUSEL.x + Math.cos(angle) * CAROUSEL.radius, z: CAROUSEL.z + Math.sin(angle) * CAROUSEL.radius, angle };
}
export function carouselCue(time, holdRemaining = FIST_HOLD_MS / 1000) {
  const cue = CAROUSEL.period - CONTACT_DELAY - holdRemaining;
  const delta = ((time - cue + CAROUSEL.period / 2) % CAROUSEL.period + CAROUSEL.period) % CAROUSEL.period - CAROUSEL.period / 2;
  const now = Math.abs(delta) <= .20;
  const lights = now ? 3 : delta < -.20 && delta >= -1.4 ? Math.min(3, Math.floor((delta + 1.4) / .4) + 1) : 0;
  return { now, lights, text: now ? 'CLENCH FIST & HOLD' : lights ? String(4 - lights) : 'WAIT FOR THE LIGHTS' };
}
export function moveCarousel(game, dt) {
  if (!game.carousel || !['idle', 'aim', 'anticipate', 'descend'].includes(game.phase)) return;
  game.carouselTime += dt;
  const toy = carouselRider(game);
  if (!toy) return;
  const pose = carouselPose(game.carouselTime);
  if (toy.transit) {
    // A freshly promoted rider slides from its bed spot onto the moving deck.
    const t = ease((game.carouselTime - toy.transit.start) / RIDER_TRANSIT);
    Object.assign(toy, { x: mix(toy.transit.x, pose.x, t), z: mix(toy.transit.z, pose.z, t), angle: pose.angle, elevation: mix(0, CAROUSEL.height, t) });
    if (t >= 1) delete toy.transit;
  } else Object.assign(toy, pose);
}
// The rider's pose `ahead` seconds from now, for cue and contact prediction.
export function riderAhead(game, ahead) {
  const toy = carouselRider(game);
  if (!toy) return null;
  const pose = carouselPose(game.carouselTime + ahead);
  if (!toy.transit) return { ...toy, ...pose };
  const t = ease((game.carouselTime + ahead - toy.transit.start) / RIDER_TRANSIT);
  return { ...toy, x: mix(toy.transit.x, pose.x, t), z: mix(toy.transit.z, pose.z, t), elevation: mix(0, CAROUSEL.height, t) };
}
function promoteRider(game) {
  const next = CAROUSEL_RIDERS.find(id => game.toys.some(t => t.id === id && !t.claimed));
  game.rider = next || null;
  const toy = carouselRider(game);
  if (toy && toy.id !== CAROUSEL.id) toy.transit = { x: toy.x, z: toy.z, start: game.carouselTime };
}

// Each silhouette is authored with a matching supporting body envelope.
export const ASSORTMENT = [
  { id: 'bonbon', family: 'bunny', name: 'Bonbon', color: '#d797a7', tone: 'Dusty rose · stitched plush', x: -.91, z: -.61, yaw: .17, scale: .94 },
  { id: 'miso', family: 'capybara', name: 'Miso', color: '#bf8956', tone: 'Caramel · sleepy plush', x: -.23, z: -.62, yaw: -.22, scale: .92 },
  { id: 'pip', family: 'robot', name: 'Pip', color: '#efc95d', tone: 'Butter yellow · satin vinyl', x: .47, z: -.62, yaw: -.15, scale: .96 },
  { id: 'lilac', family: 'bunny', name: 'Lilac', color: '#b4a1c5', tone: 'Lavender · stitched plush', x: 1.12, z: -.61, yaw: -.38, scale: .87 },
  { id: 'blue-hour', family: 'cloud', name: 'Blue Hour', color: '#a8cbd9', tone: 'Sky blue · cloud cushion', x: -.84, z: .06, yaw: .20, scale: .92 },
  { id: 'peach', family: 'star', name: 'Peach', color: '#f5ac84', tone: 'Peach soda · glossy candy', x: -.10, z: .06, yaw: .17, scale: 1 },
  { id: 'cocoa', family: 'capybara', name: 'Cocoa', color: '#90684f', tone: 'Cocoa · sleepy plush', x: .57, z: .06, yaw: .30, scale: .94 },
  { id: 'sprout', family: 'star', name: 'Sprout', color: '#b6d770', tone: 'Lime fizz · glossy candy', x: 1.16, z: .56, yaw: -.33, scale: .85 },
  { id: 'butter', family: 'bunny', name: 'Butter', color: '#f2e4c6', tone: 'Vanilla · stitched plush', x: -.38, z: .72, yaw: .14, scale: .96 },
  { id: 'cirrus', family: 'cloud', name: 'Cirrus', color: '#eee7d7', tone: 'Warm ivory · cloud cushion', x: .36, z: .73, yaw: -.10, scale: .88 },
  { id: 'otto', family: 'robot', name: 'Otto', color: '#81b7a8', tone: 'Seafoam · satin vinyl', x: 1.12, z: -.05, yaw: -.26, scale: .86 },
];
export const BODY = {
  bunny: { rx: .245, rz: .22, cy: .31, ry: .29, grip: .24, height: .95 },
  capybara: { rx: .31, rz: .235, cy: .29, ry: .255, grip: .23, height: .66 },
  cloud: { rx: .345, rz: .19, cy: .31, ry: .27, grip: .26, height: .61 },
  star: { rx: .29, rz: .18, cy: .35, ry: .30, grip: .30, height: .77 },
  robot: { rx: .235, rz: .19, cy: .30, ry: .235, grip: .23, height: .86 },
};
export const SHELF_LEVELS = [.64, 1.49, 2.42, 3.46];
const SHELF_PLACES = { miso: [0, 0], cocoa: [0, 1], 'blue-hour': [0, 2], cirrus: [1, 0], peach: [1, 1], sprout: [1, 2], pip: [2, 0], otto: [2, 1], bonbon: [3, 0], butter: [3, 1], lilac: [3, 2] };
export function collectionSlot(id) { const [row, column] = SHELF_PLACES[id]; return { x: -2.92 + (column - 1) * .67, y: SHELF_LEVELS[row], z: .12 }; }

// Drive toward an absolute target at a bounded speed; the field clamp still applies.
export function moveToward(position, target, dt, speed = 2.4) {
  const dx = target.x - position.x, dz = target.z - position.z, distance = Math.hypot(dx, dz);
  if (distance < 1e-9 || dt <= 0) return { x: clamp(position.x, FIELD.minX, FIELD.maxX), z: clamp(position.z, FIELD.minZ, FIELD.maxZ) };
  const step = Math.min(distance, speed * dt);
  return { x: clamp(position.x + dx / distance * step, FIELD.minX, FIELD.maxX), z: clamp(position.z + dz / distance * step, FIELD.minZ, FIELD.maxZ) };
}

export function move(position, input, dt, fine = false) {
  const length = Math.max(1, Math.hypot(input.x, input.z));
  const speed = fine ? .28 : .85;
  return { x: clamp(position.x + input.x / length * dt * speed, FIELD.minX, FIELD.maxX), z: clamp(position.z + input.z / length * dt * speed, FIELD.minZ, FIELD.maxZ) };
}

// Intersect a radial finger with the actual scaled/yawed supporting envelope.
// The outer positive root is the first point touched while closing inward.
function fingerContact(position, toy, angle) {
  const shape = BODY[toy.family], s = toy.scale, yaw = toy.yaw;
  const c = Math.cos(yaw), n = Math.sin(yaw);
  const ox = position.x - toy.x, oz = position.z - toy.z;
  const px = c * ox - n * oz, pz = n * ox + c * oz;
  const dx = Math.cos(angle) * c - Math.sin(angle) * n;
  const dz = Math.cos(angle) * n + Math.sin(angle) * c;
  const factor = Math.sqrt(1 - ((shape.grip - shape.cy) / shape.ry) ** 2);
  const rx = shape.rx * s * factor, rz = shape.rz * s * factor;
  const a = (dx / rx) ** 2 + (dz / rz) ** 2;
  const b = 2 * (px * dx / rx ** 2 + pz * dz / rz ** 2);
  const cc = (px / rx) ** 2 + (pz / rz) ** 2 - 1;
  const discriminant = b * b - 4 * a * cc;
  if (discriminant < 0) return null;
  const radius = (-b + Math.sqrt(discriminant)) / (2 * a);
  return radius > .065 && radius < OPEN_RADIUS - .015 ? radius + .014 : null;
}

export function planGrab(position, toys) {
  const available = toys.filter(t => !t.claimed);
  const nearest = available.map(toy => ({ toy, distance: Math.hypot(toy.x - position.x, toy.z - position.z) })).sort((a, b) => a.distance - b.distance)[0];
  const toy = nearest?.distance < .24 ? nearest.toy : null;
  const contacts = toy ? FINGER_ANGLES.map(angle => fingerContact(position, toy, angle)) : [null, null, null];
  // Require all three supports and a centre of mass inside their triangle.
  const points = contacts.map((r, i) => r == null ? null : { x: position.x + Math.cos(FINGER_ANGLES[i]) * r, z: position.z + Math.sin(FINGER_ANGLES[i]) * r });
  const crosses = toy && points.every(Boolean) ? points.map((a, i) => { const b = points[(i + 1) % 3]; return (b.x - a.x) * (toy.z - a.z) - (b.z - a.z) * (toy.x - a.x); }) : [];
  const supported = crosses.length === 3 && (crosses.every(v => v >= .001) || crosses.every(v => v <= -.001));
  let prize = supported ? toy : null, blocker = null;
  // The lift keeps the original offset; it cannot pass through another body.
  if (prize) { blocker = available.find(other => other !== prize && Math.hypot(other.x - prize.x, other.z - prize.z) < BODY[other.family].rx * other.scale + BODY[prize.family].rx * prize.scale + .025) || null; if (blocker) prize = null; }
  let low = BED + FINGER_DEPTH + .021;
  if (toy) low = BED + (toy.elevation || 0) + (BODY[toy.family].grip - (toy.groundOffset || 0)) * toy.scale + FINGER_DEPTH;
  else {
    // A badly aimed finger touching a neighbour stops above it, then opens.
    for (const other of available) for (const angle of FINGER_ANGLES) {
      const x = position.x + Math.cos(angle) * OPEN_RADIUS, z = position.z + Math.sin(angle) * OPEN_RADIUS;
      if (Math.hypot(x - other.x, z - other.z) < Math.max(BODY[other.family].rx, BODY[other.family].rz) * other.scale + .025) {
        const top = BED + (other.elevation || 0) + BODY[other.family].height * other.scale + FINGER_DEPTH;
        if (top > low) { low = top; blocker = other; }
      }
    }
  }
  // Why the grab did (not) succeed, for the player and for telemetry. Contact
  // sweeps may later downgrade a plan to 'bumped'; they never upgrade one.
  const reason = prize ? 'supported' : toy ? (blocker ? 'crowded' : points.every(Boolean) ? 'near' : 'slipped') : blocker ? 'blocked' : 'empty';
  return { position: { ...position }, low, contacts, radii: contacts.map(r => r ?? .075), prize, touched: toy, blocker: blocker?.id ?? null, reason, offset: prize ? { x: prize.x - position.x, z: prize.z - position.z, y: low - BED - (prize.elevation || 0) } : null, stop: toy ? 'toy' : low > BED + FINGER_DEPTH + .022 ? 'neighbour' : 'bed' };
}
export const MISS_REASONS = Object.freeze(['near', 'slipped', 'crowded', 'blocked', 'bumped', 'platform', 'empty']);

export function createGame({ carousel = false } = {}) { const game = { carousel, carouselTime: 0, phase: 'idle', elapsed: 0, position: { ...START }, plan: null, rounds: 0, collection: [], toys: ASSORTMENT.filter(t => !carousel || EVENT_TOYS.includes(t.id)).map(t => ({ ...t, ...(carousel && t.id === 'peach' ? { x: .20, z: .72, scale: .82 } : {}), elevation: carousel && t.id === CAROUSEL.id ? CAROUSEL.height : 0, claimed: false })), rider: carousel ? CAROUSEL.id : null }; moveCarousel(game, 0); return game; }
// A miss continues over its drop; a catch or a fresh run starts at the bed centre.
export function begin(game) { if (!['idle', 'result'].includes(game.phase)) return false; if (game.collection.length === game.toys.length) return false; const pose = clawPose(game); game.position = game.plan && !game.plan.prize ? { x: pose.x, z: pose.z } : { ...START }; game.phase = 'aim'; game.elapsed = 0; game.plan = null; return true; }
// After a delivery the empty claw drives from the chute to the start while the next round is announced.
export function homeClaw(game, dt) {
  const plan = game.plan;
  if (game.phase !== 'result' || !plan?.prize || dt <= 0) return false;
  plan.park ??= { x: clamp(CHUTE.x - (plan.offset?.x || 0), FIELD.minX, FIELD.maxX), z: clamp(CHUTE.z - (plan.offset?.z || 0), FIELD.minZ, FIELD.maxZ) };
  const dx = START.x - plan.park.x, dz = START.z - plan.park.z, distance = Math.hypot(dx, dz);
  if (distance < 1e-9) return false;
  // Mutate in place: this runs every result-phase frame.
  const step = .85 * dt;
  if (distance <= step) Object.assign(plan.park, START);
  else { plan.park.x += dx / distance * step; plan.park.z += dz / distance * step; }
  return true;
}
export function aimTarget(game) {
  const toys = game.toys.map(t => game.carousel && t.id === game.rider && !t.claimed ? riderAhead(game, CONTACT_DELAY) : t);
  return planGrab(game.position, toys).prize;
}
export function drop(game) {
  if (game.phase !== 'aim') return false;
  // Predict only the descent height. Award a catch from the actual contact pose.
  const future = game.toys.map(t => game.carousel && t.id === game.rider && !t.claimed ? riderAhead(game, CONTACT_DELAY) : t);
  game.plan = planGrab(game.position, future);
  if (game.carousel) {
    const overDeck = Math.hypot(game.position.x - CAROUSEL.x, game.position.z - CAROUSEL.z) < .57;
    if (overDeck && !game.plan.touched) { game.plan.low = Math.max(game.plan.low, BED + CAROUSEL.height + FINGER_DEPTH + .021); game.plan.stop = 'platform'; game.plan.reason = 'platform'; }
    game.plan.pendingContact = true; game.plan.prize = null; game.plan.offset = null;
  }
  game.phase = 'anticipate'; game.elapsed = 0; game.rounds++; return true;
}
export function advance(game, dt) {
  if (!(game.phase in PHASES)) return false;
  // Split at phase boundaries so frame rate cannot move the interception time.
  while (dt > 1e-10 && game.phase in PHASES) {
    const seconds = phaseSeconds(game);
    const step = Math.min(dt, seconds - game.elapsed);
    moveCarousel(game, step); game.elapsed += step; dt -= step;
    if (game.elapsed >= seconds - 1e-10) {
      // An empty claw has nothing to carry: the turn ends after its short lift.
      const next = game.phase === 'lift' && !game.plan.prize ? 'result' : PHASE_ORDER[PHASE_ORDER.indexOf(game.phase) + 1] || 'result';
      game.elapsed = 0;
      if (next === 'grip' && game.plan.pendingContact) {
        const actual = planGrab(game.position, game.toys), low = game.plan.low, blocked = game.plan.blockedDescent, touched = game.plan.touched, platform = game.plan.stop === 'platform';
        game.plan = actual; game.plan.low = low;
        // An empty grab over the carousel deck means the star was elsewhere at contact.
        if (platform && !actual.touched) { game.plan.stop = 'platform'; game.plan.reason = 'platform'; }
        if (blocked) { game.plan.blockedDescent = blocked; game.plan.prize = null; game.plan.offset = null; game.plan.touched = touched; game.plan.stop = 'mesh-contact'; game.plan.reason = 'bumped'; }
        if (actual.prize) game.plan.offset.y = low - BED - (actual.prize.elevation || 0);
      }
      game.phase = next;
      if (next === 'reveal' && game.plan.prize) { game.plan.prize.claimed = true; game.collection.push(game.plan.prize.id); if (game.carousel && game.plan.prize.id === game.rider) promoteRider(game); }
    }
  }
  return true;
}

export function clawPose(game) {
  const plan = game.plan;
  const pose = { x: game.position.x, y: HIGH, z: game.position.z, radii: [OPEN_RADIUS, OPEN_RADIUS, OPEN_RADIUS] };
  if (!plan) return pose;
  const { phase, elapsed } = game, t = elapsed / (phaseSeconds(game, phase) || 1);
  Object.assign(pose, plan.position);
  if (phase === 'descend') pose.y = plan.blockedDescent || mix(HIGH, plan.low, ease(t));
  if (phase === 'grip') { pose.y = plan.low; pose.radii = plan.radii.map((r, i) => mix(OPEN_RADIUS, r, ease((t - i * .075) / .67))); }
  if (['lift', 'transfer', 'release', 'deliver', 'reveal', 'result'].includes(phase)) {
    pose.y = phase === 'lift' ? mix(plan.low, HIGH, ease(t)) : HIGH;
    pose.radii = plan.prize ? [...plan.radii] : phase === 'lift' ? plan.radii.map(r => mix(r, OPEN_RADIUS, ease(t * 4))) : [OPEN_RADIUS, OPEN_RADIUS, OPEN_RADIUS];
  }
  // Only a held prize travels to the chute; an empty claw stays over its drop.
  if (plan.prize && ['transfer', 'release', 'deliver', 'reveal', 'result'].includes(phase)) {
    const travel = phase === 'transfer' ? ease(t) : 1;
    pose.x = mix(plan.position.x, clamp(CHUTE.x - (plan.offset?.x || 0), FIELD.minX, FIELD.maxX), travel);
    pose.z = mix(plan.position.z, clamp(CHUTE.z - (plan.offset?.z || 0), FIELD.minZ, FIELD.maxZ), travel);
    if (phase === 'result' && plan.park) { pose.x = plan.park.x; pose.z = plan.park.z; }
  }
  if (phase === 'release') pose.radii = pose.radii.map(r => mix(r, OPEN_RADIUS, ease(t)));
  if (['deliver', 'reveal', 'result'].includes(phase)) pose.radii = [OPEN_RADIUS, OPEN_RADIUS, OPEN_RADIUS];
  return pose;
}
