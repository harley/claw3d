import * as T from 'three';
import { FINGER_ANGLES } from './arcade-mechanics.js';
import { SUSPENSION_Y, CABLE_ATTACH_Y, STEEL_HUB_BOTTOM, STEEL_HINGE, steelFingerPoint, steelFingerWidth } from './claw-suspension.js';

const steps = 32, sides = 8;
function stripGeometry() {
  const geometry = new T.BufferGeometry(), indices = [];
  geometry.setAttribute('position', new T.BufferAttribute(new Float32Array((steps + 1) * sides * 3), 3).setUsage(T.DynamicDrawUsage));
  for (let i = 0; i < steps; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    indices.push(a, b, a + sides, b, b + sides, a + sides);
  }
  geometry.setIndex(indices); return geometry;
}
function shapeFinger(finger, radius) {
  if (finger.radius === radius) return;
  finger.radius = radius;
  const position = finger.blade.geometry.attributes.position;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = steelFingerPoint(radius, t);
    const a = steelFingerPoint(radius, Math.max(0, t - .001)), b = steelFingerPoint(radius, Math.min(1, t + .001));
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    const taper = (1 - t) ** .6, width = steelFingerWidth(t), thickness = .018 * taper + .0003;
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2;
      position.setXYZ(i * sides + j, p.x - dy / length * Math.cos(angle) * thickness, p.y + dx / length * Math.cos(angle) * thickness, Math.sin(angle) * width);
    }
  }
  position.needsUpdate = true;
  finger.blade.geometry.computeVertexNormals(); finger.blade.geometry.computeBoundingSphere();
}
export function buildSteelClaw(parent, materials) {
  const claw = new T.Group(); parent.add(claw);
  const polished = new T.MeshStandardMaterial({ color: '#e2e9f0', metalness: 1, roughness: .19 });
  const steel = new T.MeshStandardMaterial({ color: '#7c8999', metalness: .95, roughness: .26 });
  const tube = (radius, height, y, material = polished) => {
    const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, height, 24), material);
    mesh.position.y = y; mesh.castShadow = true; claw.add(mesh); return mesh;
  };
  tube(.041, .12, .04); tube(.096, .026, .085); tube(.077, .30, -.12);
  tube(.088, .035, -.285, steel); tube(.047, .19, -.38); tube(.083, .025, STEEL_HUB_BOTTOM + .0125);
  const fingers = FINGER_ANGLES.map(angle => {
    const root = new T.Group(); root.rotation.y = -angle; claw.add(root);
    const blade = new T.Mesh(stripGeometry(), polished); blade.castShadow = true; root.add(blade);
    const pin = new T.Mesh(new T.CylinderGeometry(.030, .030, .088, 16), steel);
    pin.position.set(STEEL_HINGE.x, STEEL_HINGE.y, 0); pin.rotation.x = Math.PI / 2; root.add(pin);
    const bracket = new T.Mesh(new T.BoxGeometry(.028, .18, .044), polished);
    bracket.position.set(.09, -.24, 0); bracket.rotation.z = -.17; root.add(bracket);
    const finger = { root, blade, radius: null }; shapeFinger(finger, .41); return finger;
  });
  const leadRoot = new T.Group(); parent.add(leadRoot);
  const points = Array.from({ length: 161 }, (_, i) => {
    const t = i / 160, radius = .030 * Math.sin(Math.PI * t) ** .3;
    return new T.Vector3(.085 + Math.cos(t * Math.PI * 28) * radius, -t, Math.sin(t * Math.PI * 28) * radius);
  });
  const lead = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 160, .006, 5, false), materials.rubber);
  lead.castShadow = true; leadRoot.add(lead);
  return { claw, fingers, leadRoot, lead };
}
const attachment = new T.Vector3(), anchor = new T.Vector3(), delta = new T.Vector3(), up = new T.Vector3(0, 1, 0);
export function updateSteelClaw(scene, pose) {
  scene.claw.rotation.set(pose.rotation?.x || 0, 0, pose.rotation?.z || 0);
  scene.fingers.forEach((finger, i) => shapeFinger(finger, pose.radii[i]));
  attachment.set(0, CABLE_ATTACH_Y, 0).applyEuler(scene.claw.rotation).add(scene.claw.position);
  anchor.set(pose.carriage.x, SUSPENSION_Y, pose.carriage.z);
  delta.copy(attachment).sub(anchor);
  scene.cable.position.copy(anchor).add(attachment).multiplyScalar(.5);
  scene.cable.scale.y = Math.max(.001, delta.length()); scene.cable.quaternion.setFromUnitVectors(up, delta.clone().normalize());
  scene.steelLeadRoot.position.copy(anchor); scene.steelLeadRoot.rotation.copy(scene.claw.rotation);
  scene.steelLead.scale.y = Math.max(.001, delta.length());
}
