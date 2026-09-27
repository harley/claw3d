import * as T from 'three';
import { supportHull, gravityStep, hangingStep, MASS_CENTRE_Y } from './arcade-gravity.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { BED, HIGH, BODY, FIELD, CAROUSEL, FINGER_DEPTH, OPEN_RADIUS, FINGER_ANGLES, mix, ease, PHASES, planGrab, clawPose, resolveSuspendedGrab } from './arcade-mechanics.js';
import { steelFingerSamples, steelFingerWidth, clawWorldPoint } from './claw-suspension.js';

// Swept finger samples test visible geometry. The grasp support model still
// decides catches; these contacts can reject one, never manufacture a win.
const radius = .027;
const vector = (x, y, z) => new T.Vector3(x, y, z);
function fingerSamples(r) {
  const elbow = mix(.29, .365, (r - .075) / .335);
  return [[.11, -.145], [(.11 + elbow) / 2, -.3325], [elbow, -.52],
    [mix(elbow, r, .33), -.668], [mix(elbow, r, .66), -.816], [r, -.965]];
}
export class ToyContacts {
  constructor(toys) {
    this.toys = toys; this.meshes = new Map(); this.ray = new T.Raycaster(); this.ray.firstHitOnly = true;
    this.obstacleBounds = new Map(); this.gravityVertices = new Map(); this.gravityProfiles = new Map();
    for (const [id, root] of toys) {
      const meshes = [];
      root.traverse(mesh => { if (!mesh.isMesh) return; if (!mesh.geometry.boundsTree) mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { maxLeafSize: 8 }); mesh.raycast = acceleratedRaycast; meshes.push(mesh); });
      this.meshes.set(id, meshes);
    }
  }
  hit(start, end, available, clearance = radius) {
    const direction = end.clone().sub(start), length = direction.length(); if (length < .00001) return null;
    this.ray.set(start, direction.divideScalar(length)); this.ray.near = 0; this.ray.far = length + clearance;
    const meshes = available.flatMap(toy => this.meshes.get(toy.id));
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const toy = available.find(toy => this.meshes.get(toy.id).includes(hit.object));
    return { ...hit, toy, fraction: Math.max(0, (hit.distance - clearance) / length) };
  }
  impact(toy, point, phase) {
    if (toy.impact) return;
    let dx = toy.x - point.x, dz = toy.z - point.z;
    // Resolve nearly straight pushes along their dominant axis to avoid tiny
    // side impulses wedging a toy between conservative neighbour bounds.
    if (Math.abs(dx) < Math.abs(dz) * .15) dx = 0;
    if (Math.abs(dz) < Math.abs(dx) * .15) dz = 0;
    const length = Math.hypot(dx, dz) || 1;
    toy.impact = { x: length === 1 && !dx && !dz ? 1 : dx / length, z: dz / length, angle: 0, velocity: 0,
      target: toy.family === 'bunny' ? .42 : toy.family === 'capybara' ? .22 : .30, phase };
  }
  // Resting rotation is gameplay state: use the same transformed ellipsoid for
  // subsequent aim/catch decisions that the player sees in the scene.
  rest(toy, object) {
    if (!toy.restPose) return;
    const { x, z, angle } = toy.restPose;
    object.quaternion.setFromAxisAngle(vector(z, 0, -x), angle)
      .multiply(new T.Quaternion().setFromAxisAngle(vector(0, 1, 0), toy.yaw));
    object.position.set(toy.x, BED + (toy.elevation || 0), toy.z);
    object.updateWorldMatrix(true, true);
    const bounds = new T.Box3().setFromObject(object, true);
    const lift = BED + (toy.elevation || 0) - bounds.min.y;
    object.position.y += lift; toy.restPose.lift = lift;
    object.updateWorldMatrix(true, true);
    const shape = BODY[toy.family];
    const center = vector(0, shape.cy - (toy.groundOffset || 0), 0).multiplyScalar(toy.scale).applyQuaternion(object.quaternion).add(object.position);
    const axes = [vector(1, 0, 0), vector(0, 1, 0), vector(0, 0, 1)].map(axis => axis.applyQuaternion(object.quaternion));
    const weights = [shape.rx, shape.ry, shape.rz].map(r => 1 / (r * toy.scale) ** 2);
    toy.support = { x: center.x, y: center.y, z: center.z,
      radius: Math.sqrt(Math.max(axes.reduce((sum, a, i) => sum + a.x * a.x / weights[i], 0), axes.reduce((sum, a, i) => sum + a.z * a.z / weights[i], 0))),
      xx: axes.reduce((sum, a, i) => sum + a.x * a.x * weights[i], 0),
      xz: axes.reduce((sum, a, i) => sum + a.x * a.z * weights[i], 0),
      zz: axes.reduce((sum, a, i) => sum + a.z * a.z * weights[i], 0) };
  }
  gravityProfile(toy, object) {
    let vertices = this.gravityVertices.get(toy.id);
    if (!vertices) {
      object.updateWorldMatrix(true, true);
      const inverse = object.matrixWorld.clone().invert(); vertices = [];
      for (const mesh of this.meshes.get(toy.id)) {
        const transform = inverse.clone().multiply(mesh.matrixWorld), positions = mesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) vertices.push(new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(transform));
      }
      this.gravityVertices.set(toy.id, vertices);
    }
    const { x, z } = toy.restPose, key = `${x.toFixed(4)}:${z.toFixed(4)}:${toy.yaw}:${toy.scale}`;
    const cached = this.gravityProfiles.get(toy.id);
    if (cached?.key === key) return cached;
    const c = Math.cos(toy.yaw), s = Math.sin(toy.yaw), shape = BODY[toy.family];
    const points = vertices.map(p => ({ x: ((p.x * c + p.z * s) * x + (p.z * c - p.x * s) * z) * toy.scale, y: p.y * toy.scale }));
    const cy = (MASS_CENTRE_Y[toy.family] - (toy.groundOffset || 0)) * toy.scale;
    const profile = { key, hull: supportHull(points), cy,
      inertia: (shape.rx ** 2 + shape.ry ** 2) * toy.scale ** 2 / 5 + cy ** 2,
      damping: toy.family === 'robot' ? 3.5 : toy.family === 'star' ? 4.5 : 6 };
    this.gravityProfiles.set(toy.id, profile); return profile;
  }
  settle(game, toy, object, dt) {
    const state = toy.restPose;
    if (!state || state.sleeping || dt <= 0 || toy.id === game.rider || toy.transit) return;
    // Contact can support a toy while the fingers press it. Gravity takes over
    // as soon as they lift; an accepted grip uses the hanging constraint below.
    if (['descend', 'grip'].includes(game.phase) && game.plan?.touched?.id === toy.id) return;
    const profile = this.gravityProfile(toy, object);
    const obstacles = game.toys.filter(other => other !== toy && !other.claimed).map(other => this.boundsFor(other.id));
    const overlap = (a, b) => Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) * Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)) * Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
    for (let remaining = Math.min(dt, .1); remaining > 1e-8;) {
      const step = Math.min(remaining, 1 / 120); remaining -= step;
      const old = { x: toy.x, z: toy.z, angle: state.angle, velocity: state.velocity || 0 };
      const baseline = new T.Box3().setFromObject(object);
      const next = gravityStep(profile, state, step);
      state.angle = next.angle; state.velocity = next.velocity; state.sleeping = next.sleeping;
      toy.x += state.x * next.shift; toy.z += state.z * next.shift;
      this.rest(toy, object);
      const bounds = new T.Box3().setFromObject(object);
      const outside = bounds.min.x < -1.62 || bounds.max.x > 1.62 || bounds.min.z < -1.10 || bounds.max.z > 1.17;
      if (outside || obstacles.some(box => overlap(bounds, box) > overlap(baseline, box) + .00000001)) {
        toy.x = old.x; toy.z = old.z; state.angle = old.angle; state.velocity = 0; state.sleeping = false;
        this.rest(toy, object); break;
      }
      if (state.sleeping) break;
    }
  }
  hang(toy, object, plan, phase, dt, elapsed) {
    const state = toy.restPose;
    if (!state) return;
    const shape = BODY[toy.family];
    const localAnchor = vector(0, shape.cy + shape.ry * .65 - (toy.groundOffset || 0), 0).multiplyScalar(toy.scale);
    if (!plan.hangingAnchor) {
      const rotated = localAnchor.clone().applyQuaternion(object.quaternion);
      plan.hangingAnchor = { x: plan.offset.x + rotated.x, y: -plan.offset.y + rotated.y, z: plan.offset.z + rotated.z };
      state.velocity = 0;
    }
    for (let remaining = Math.min(dt, .1); remaining > 1e-8;) {
      const step = Math.min(remaining, 1 / 120); remaining -= step;
      Object.assign(state, hangingStep(state, step));
    }
    object.quaternion.setFromAxisAngle(vector(state.z, 0, -state.x), state.angle)
      .multiply(new T.Quaternion().setFromAxisAngle(vector(0, 1, 0), phase === 'deliver' ? object.rotation.y : toy.yaw));
    if (['lift', 'transfer', 'release', 'deliver'].includes(phase)) {
      const rotated = localAnchor.applyQuaternion(object.quaternion), anchor = plan.hangingAnchor;
      const weight = phase === 'deliver' ? 1 - ease((elapsed / PHASES.deliver) / .4) : 1;
      object.position.x += (anchor.x - rotated.x - plan.offset.x) * weight;
      object.position.y += (anchor.y - rotated.y + plan.offset.y) * weight;
      object.position.z += (anchor.z - rotated.z - plan.offset.z) * weight;
    }
    if (phase === 'reveal' && state.angle === 0) { delete toy.restPose; delete toy.support; }
  }
  descentHit(pose, from, to, available) {
    let first = null;
    for (const angle of FINGER_ANGLES) for (const [r, y] of fingerSamples(OPEN_RADIUS)) {
      const x = pose.x + Math.cos(angle) * r, z = pose.z + Math.sin(angle) * r;
      const hit = this.hit(vector(x, from + y, z), vector(x, to + y, z), available);
      if (hit) {
        const stop = hit.point.y - y + radius;
        if (stop <= HIGH && (!first || stop > first.stop)) first = { ...hit, stop };
      }
    }
    return first;
  }
  push(game, hit, pose, distance) {
    const toy = hit.toy;
    // Riders belong to the carousel trajectory, not the loose bed simulation.
    if (toy.id === game.rider || toy.elevation || toy.transit) return false;
    const dx = toy.x - pose.x, dz = toy.z - pose.z, length = Math.hypot(dx, dz);
    const center = toy.support || toy;
    if (!game.plan.pushDescent.pushed?.includes(toy.id) && (length < .12 || Math.hypot(hit.point.x - center.x, hit.point.z - center.z) < .09)) return false;
    if (length < .0001) return false;
    const direction = { x: dx / length, z: dz / length };
    const resting = toy.restPose || { x: 0, z: 0, angle: 0 };
    const object = this.toys.get(toy.id), baseline = new T.Box3().setFromObject(object);
    const obstacles = game.toys.filter(other => other !== toy && !other.claimed).map(other => this.boundsFor(other.id));
    const overlap = (a, b) => Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) * Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)) * Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
    const old = { x: toy.x, z: toy.z, restPose: toy.restPose, support: toy.support };
    for (let attempt = 0; attempt < 5; attempt++, distance *= .5) {
      toy.x = old.x + direction.x * distance; toy.z = old.z + direction.z * distance;
      const leanX = resting.x * resting.angle + direction.x * distance * 3.5;
      const leanZ = resting.z * resting.angle + direction.z * distance * 3.5;
      const lean = Math.hypot(leanX, leanZ);
      toy.restPose = { x: lean > .0001 ? leanX / lean : direction.x, z: lean > .0001 ? leanZ / lean : direction.z, angle: Math.min(Math.PI, lean), velocity: 0, sleeping: false };
      this.rest(toy, object);
      const bounds = new T.Box3().setFromObject(object);
      const outside = bounds.min.x < -1.62 || bounds.max.x > 1.62 || bounds.min.z < -1.10 || bounds.max.z > 1.17;
      const unreachable = toy.support.x < FIELD.minX || toy.support.x > FIELD.maxX || toy.support.z < FIELD.minZ || toy.support.z > FIELD.maxZ;
      const onDeck = game.carousel && Math.hypot(toy.x - CAROUSEL.x, toy.z - CAROUSEL.z) < .55 + Math.max(BODY[toy.family].rx, BODY[toy.family].rz) * toy.scale;
      if (!outside && !unreachable && !onDeck && !obstacles.some(box => overlap(bounds, box) > overlap(baseline, box) + .00000001)) {
        delete toy.impact;
        const pushed = game.plan.pushDescent.pushed ??= [];
        if (!pushed.includes(toy.id)) pushed.push(toy.id);
        return distance;
      }
    }
    Object.assign(toy, old);
    object.position.set(toy.x, BED + (toy.elevation || 0), toy.z); object.rotation.set(0, toy.yaw, 0);
    this.rest(toy, object); object.updateWorldMatrix(true, true);
    return false;
  }
  resolvePush(game, pose, dt) {
    const plan = game.plan, state = plan.pushDescent;
    if (!state || !['descend', 'grip'].includes(game.phase) || state.finished) return;
    const available = game.toys.filter(toy => !toy.claimed);
    const desired = game.phase === 'grip' ? state.target : mix(HIGH, state.target, ease(game.elapsed / PHASES.descend));
    let budget = Math.max(0, Math.min(dt, .1)) * .9;
    let hit = this.descentHit(pose, state.y, desired, available);
    for (let attempt = 0; hit && budget > .0001 && attempt < 16; attempt++) {
      const moved = this.push(game, hit, pose, Math.min(.012, budget));
      if (!moved) break;
      budget -= moved;
      hit = this.descentHit(pose, state.y, desired, available);
    }
    pose.y = hit ? Math.max(desired, Math.min(state.y, hit.stop)) : desired;
    state.y = pose.y;
    if (hit) { plan.blockedDescent = pose.y; plan.touched = hit.toy; }
    else delete plan.blockedDescent;
    if (game.phase === 'grip') {
      const actual = planGrab(game.position, game.toys);
      Object.assign(plan, actual, { low: pose.y, pushDescent: state });
      state.finished = true;
      if (hit) { plan.blockedDescent = pose.y; plan.prize = null; plan.offset = null; plan.touched = hit.toy; plan.reason = 'bumped'; plan.stop = 'mesh-contact'; }
      if (plan.prize) plan.offset.y = pose.y - BED - (plan.prize.elevation || 0) - (plan.prize.restPose?.lift || 0);
      pose.radii = [OPEN_RADIUS, OPEN_RADIUS, OPEN_RADIUS];
    }
  }
  resolve(game, pose, dt = 0) {
    if (!game.plan) return;
    if (game.suspendedClaw) { this.resolveSuspended(game, pose); return; }
    if (game.plan.stop === 'neighbour' && !game.plan.meshDescentPrepared) {
      const deck = game.carousel && Math.hypot(pose.x - CAROUSEL.x, pose.z - CAROUSEL.z) < .57 ? CAROUSEL.height : 0;
      game.plan.low = BED + deck + FINGER_DEPTH + .021; game.plan.meshDescentPrepared = true;
      if (game.plan.pushDescent) game.plan.pushDescent.target = game.plan.low;
    }
    if (!['descend', 'grip'].includes(game.phase)) return;
    const available = game.toys.filter(toy => !toy.claimed);
    for (const toy of available) this.toys.get(toy.id).updateWorldMatrix(true, true);
    if (game.pushContact) this.resolvePush(game, pose, dt);
    if (!game.pushContact && game.phase === 'descend' && !game.plan.blockedDescent) {
      let first = null;
      for (const angle of FINGER_ANGLES) for (const [r, y] of fingerSamples(OPEN_RADIUS)) {
        const x = pose.x + Math.cos(angle) * r, z = pose.z + Math.sin(angle) * r;
        const hit = this.hit(vector(x, HIGH + y, z), vector(x, pose.y + y, z), available);
        if (hit) { const stop = hit.point.y - y + radius; if (stop <= HIGH && (!first || stop > first.stop)) first = { ...hit, stop }; }
      }
      if (first && pose.y < first.stop) {
        game.plan.blockedDescent = first.stop; game.plan.low = first.stop; game.plan.prize = null; game.plan.offset = null;
        game.plan.touched = first.toy; game.plan.stop = 'mesh-contact'; game.plan.reason = 'bumped'; pose.y = first.stop;
        this.impact(first.toy, first.point, 'descend');
      }
    }
    if (game.phase === 'grip') {
      for (let i = 0; i < 3; i++) {
        const angle = FINGER_ANGLES[i], goal = pose.radii[i], opened = fingerSamples(OPEN_RADIUS), closed = fingerSamples(goal);
        let fraction = 1, contact = null;
        for (let j = 0; j < opened.length; j++) {
          const [a, y] = opened[j], [b] = closed[j];
          const hit = this.hit(vector(pose.x + Math.cos(angle) * a, pose.y + y, pose.z + Math.sin(angle) * a), vector(pose.x + Math.cos(angle) * b, pose.y + y, pose.z + Math.sin(angle) * b), available);
          if (hit && hit.fraction < fraction) { fraction = hit.fraction; contact = hit; }
        }
        if (contact) {
          pose.radii[i] = mix(OPEN_RADIUS, goal, fraction);
          if (!game.plan.prize && !game.pushContact) this.impact(contact.toy, contact.point, 'grip');
        }
      }
      // Carry the last resolved pose into lifting, even when a frame skips the
      // end of grip. Keep closing targets separate so contacts cannot feed back.
      game.plan.resolvedRadii = [...pose.radii];
    }
  }
  resolveSuspended(game, pose) {
    const plan = game.plan;
    const remember = () => { plan.previousClawPose = { ...pose, rotation: { ...pose.rotation }, radii: [...pose.radii] }; };
    if (!['descend', 'grip'].includes(game.phase)) { remember(); return; }
    const available = game.toys.filter(toy => !toy.claimed);
    for (const toy of available) this.toys.get(toy.id).updateWorldMatrix(true, true);
    const point = (p, angle, sample) => {
      const world = clawWorldPoint(p, { x: Math.cos(angle) * sample.x, y: sample.y, z: Math.sin(angle) * sample.x });
      return vector(world.x, world.y, world.z);
    };
    // Sweep the entire visible curved finger from its previous physical pose,
    // including lateral swing. Recasting vertically under the carriage misses it.
    if (!plan.blockedDescent && (game.phase === 'descend' || plan.pendingContact)) {
      const previous = plan.previousClawPose || { ...pose, y: HIGH };
      let fraction = 1, contact = null;
      const samples = steelFingerSamples(OPEN_RADIUS);
      for (const angle of FINGER_ANGLES) for (const [index, sample] of samples.entries()) {
        const start = point(previous, angle, sample), end = point(pose, angle, sample);
        const hit = this.hit(start, end, available, steelFingerWidth(index / (samples.length - 1)));
        if (hit && hit.fraction < fraction) { fraction = hit.fraction; contact = hit; }
        if (end.y < BED + .012 && start.y > end.y) fraction = Math.min(fraction, Math.max(0, (start.y - BED - .012) / (start.y - end.y)));
      }
      if (fraction < 1) {
        const previousY = previous.carriage?.y ?? HIGH;
        plan.low = mix(previousY, pose.carriage.y, fraction) + .002;
        plan.blockedDescent = plan.low;
        plan.prize = null; plan.offset = null;
        plan.reason = contact ? 'bumped' : 'empty'; plan.stop = contact ? 'mesh-contact' : 'bed';
        if (contact) { plan.touched = contact.toy; this.impact(contact.toy, contact.point, 'descend'); }
        Object.assign(pose, clawPose(game));
      }
    }
    if (game.phase === 'grip') {
      if (plan.pendingContact) resolveSuspendedGrab(game, pose);
      for (let i = 0; i < 3; i++) {
        const angle = FINGER_ANGLES[i], goal = pose.radii[i];
        const opened = steelFingerSamples(OPEN_RADIUS), closed = steelFingerSamples(goal);
        let fraction = 1, contact = null;
        for (let j = 0; j < opened.length; j++) {
          const hit = this.hit(point(pose, angle, opened[j]), point(pose, angle, closed[j]), available, steelFingerWidth(j / (opened.length - 1)));
          if (hit && hit.fraction < fraction) { fraction = hit.fraction; contact = hit; }
        }
        if (contact) {
          pose.radii[i] = mix(OPEN_RADIUS, goal, fraction);
          plan.gripContacts[i] = contact.toy.id;
          if (!plan.prize) this.impact(contact.toy, contact.point, 'grip');
        }
      }
      plan.resolvedRadii = [...pose.radii];
    }
    remember();
  }
  // A full setFromObject traversal per obstacle per frame is the rock() hot
  // cost. The box is a pure function of the toy's mesh world matrices, so the
  // cache keys on exactly those — child animation under a static root (grip
  // compression, lift jiggle, blinks) invalidates just like a moved root.
  boundsFor(id) {
    const object = this.toys.get(id);
    object.updateWorldMatrix(true, true);
    const meshes = this.meshes.get(id);
    const cached = this.obstacleBounds.get(id);
    if (cached && cached.matrices.every((matrix, i) => matrix.equals(meshes[i].matrixWorld))) return cached.box;
    const box = new T.Box3().setFromObject(object);
    this.obstacleBounds.set(id, { box, matrices: meshes.map(mesh => mesh.matrixWorld.clone()) });
    return box;
  }
  rock(game, toy, object, dt) {
    const impact = toy.impact; if (!impact) return;
    const pressed = ['descend', 'grip'].includes(game.phase), target = pressed ? impact.target : 0;
    impact.velocity += ((target - impact.angle) * 42 - impact.velocity * 10) * dt;
    impact.angle = Math.max(-.08, Math.min(.5, impact.angle + impact.velocity * dt));
    const base = BED + (toy.elevation || 0), yaw = new T.Quaternion().setFromAxisAngle(vector(0, 1, 0), toy.yaw);
    const axis = vector(impact.z, 0, -impact.x).normalize(), bounds = new T.Box3();
    const baseline = new T.Box3().setFromObject(object);
    const overlap = (a, b) => Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)) * Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)) * Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
    const obstacles = game.toys.filter(other => other !== toy && !other.claimed).map(other => this.boundsFor(other.id));
    const apply = angle => { object.quaternion.copy(new T.Quaternion().setFromAxisAngle(axis, angle).multiply(yaw)); object.position.y = base; object.updateWorldMatrix(true, true); bounds.setFromObject(object); object.position.y += base - bounds.min.y; object.updateWorldMatrix(true, true); bounds.setFromObject(object); };
    let angle = impact.angle, accepted = false;
    for (let attempt = 0; attempt < 9; attempt++) {
      apply(angle);
      const outside = bounds.min.x < Math.min(-1.62, baseline.min.x) || bounds.max.x > Math.max(1.62, baseline.max.x) || bounds.min.z < Math.min(-1.10, baseline.min.z) || bounds.max.z > Math.max(1.17, baseline.max.z);
      if (!outside && !obstacles.some(box => overlap(bounds, box) > overlap(baseline, box) + .0001)) { accepted = true; break; }
      angle *= .5; impact.velocity = 0;
    }
    if (!accepted) { angle = 0; apply(0); }
    impact.angle = angle;
  }
}
