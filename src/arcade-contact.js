import * as T from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { BED, HIGH, CAROUSEL, FINGER_DEPTH, OPEN_RADIUS, FINGER_ANGLES, mix } from './arcade-mechanics.js';

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
    this.obstacleBounds = new Map();
    for (const [id, root] of toys) {
      const meshes = [];
      root.traverse(mesh => { if (!mesh.isMesh) return; if (!mesh.geometry.boundsTree) mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { maxLeafSize: 8 }); mesh.raycast = acceleratedRaycast; meshes.push(mesh); });
      this.meshes.set(id, meshes);
    }
  }
  hit(start, end, available) {
    const direction = end.clone().sub(start), length = direction.length(); if (length < .00001) return null;
    this.ray.set(start, direction.divideScalar(length)); this.ray.near = 0; this.ray.far = length + radius;
    const meshes = available.flatMap(toy => this.meshes.get(toy.id));
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const toy = available.find(toy => this.meshes.get(toy.id).includes(hit.object));
    return { ...hit, toy, fraction: Math.max(0, (hit.distance - radius) / length) };
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
  resolve(game, pose) {
    if (!game.plan) return;
    if (game.plan.stop === 'neighbour' && !game.plan.meshDescentPrepared) {
      const deck = game.carousel && Math.hypot(pose.x - CAROUSEL.x, pose.z - CAROUSEL.z) < .57 ? CAROUSEL.height : 0;
      game.plan.low = BED + deck + FINGER_DEPTH + .021; game.plan.meshDescentPrepared = true;
    }
    if (!['descend', 'grip'].includes(game.phase)) return;
    const available = game.toys.filter(toy => !toy.claimed);
    for (const toy of available) this.toys.get(toy.id).updateWorldMatrix(true, true);
    if (game.phase === 'descend' && !game.plan.blockedDescent) {
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
          if (!game.plan.prize) this.impact(contact.toy, contact.point, 'grip');
        }
      }
      // Carry the last resolved pose into lifting, even when a frame skips the
      // end of grip. Keep closing targets separate so contacts cannot feed back.
      game.plan.resolvedRadii = [...pose.radii];
    }
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
