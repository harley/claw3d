import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CabinetHands } from '../src/cabinet-hands.js';

async function rig() {
  const scene = new T.Scene();
  const hands = new CabinetHands(scene, { async loadAsync(url) {
    const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  } });
  await hands.ready;
  assert.equal(hands.error, null);
  const stick = new T.Object3D(), button = new T.Object3D();
  stick.position.set(-1.28, 1.70, 1.44); stick.scale.setScalar(1.4);
  button.position.set(1.28, 1.72, 1.44); scene.add(stick, button);
  const feedback = { profile: 'dual', kind: 'tracking', hands: {
    left: { pointer: {}, kind: 'tracking', grab: { stage: 'gripped' } },
    right: { pointer: {}, kind: 'tracking' },
  } };
  return { hands, scene, stick, button, update: (progress, reduced = false, dt = 1/60, kind = 'slamming') => {
    hands.update('aim', 0, dt, progress === undefined ? feedback : { ...feedback, kind, slamProgress: progress }, true, stick, button, reduced);
    return hands.hands.right.pivot.position.toArray();
  } };
}

// Conservative control-panel and front-post bounds from buildCabinet. Inspect
// actual deformed triangles, including sleeves, rather than wrist/DOM anchors.
const boxes = [new T.Box3(new T.Vector3(-1.75, 1.435, 1.175), new T.Vector3(1.75, 1.6555, 1.705)),
  new T.Box3(new T.Vector3(1.045, 1.657, 1.205), new T.Vector3(1.515, 1.717, 1.675)),
  ...[-1.73, 1.73].map(x => new T.Box3(new T.Vector3(x-.08, 1.535, 1.165), new T.Vector3(x+.08, 4.555, 1.335)))];
const shaftBox = new T.Box3(new T.Vector3(-.023, 0, -.023), new T.Vector3(.023, .182, .023));
function clearance(rig, role) {
  const { scene, hands, stick, button } = rig;
  scene.updateMatrixWorld(true);
  const center = stick.localToWorld(new T.Vector3(0, .205, 0));
  const inverse = stick.matrixWorld.clone().invert();
  let ball = Infinity, dome = Infinity, cabinetHits = 0, shaftHits = 0;
  const triangle = new T.Triangle(), closest = new T.Vector3(), origin = new T.Vector3();
  const domePoint = point => new T.Vector3((point.x-button.position.x)/.21, (point.y-button.position.y)/.135, (point.z-button.position.z)/.21);
  hands.hands[role].pivot.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    const vertices = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => mesh.getVertexPosition(i, new T.Vector3()).applyMatrix4(mesh.matrixWorld));
    const indices = mesh.geometry.index.array;
    for (let i = 0; i < indices.length; i += 3) {
      const a = vertices[indices[i]], b = vertices[indices[i+1]], c = vertices[indices[i+2]];
      triangle.set(a, b, c).closestPointToPoint(center, closest);
      ball = Math.min(ball, closest.distanceTo(center)-.14);
      if (boxes.some(box => box.intersectsTriangle(triangle))) cabinetHits++;
      triangle.set(domePoint(a), domePoint(b), domePoint(c)).closestPointToPoint(origin, closest);
      dome = Math.min(dome, closest.length()-1);
      triangle.set(a.clone().applyMatrix4(inverse), b.clone().applyMatrix4(inverse), c.clone().applyMatrix4(inverse));
      if (shaftBox.intersectsTriangle(triangle)) shaftHits++;
    }
  });
  return { ball, dome, cabinetHits, shaftHits };
}

test('actual left-hand mesh clears the ball, shaft and cabinet through grip, release and steering extremes', async () => {
  const r = await rig();
  for (const pitch of [-.24, -.12, 0, .12, .24]) for (const roll of [-.24, -.12, 0, .12, .24]) for (const curl of [0, .1, .25, .5, .75, 1]) {
    r.stick.rotation.set(pitch, 0, roll);
    r.hands.hands.left.curl = curl;
    r.update(undefined, false, 0);
    const result = clearance(r, 'left'), context = JSON.stringify({ pitch, roll, curl, ...result });
    assert.ok(result.ball >= .001, context);
    assert.equal(result.shaftHits, 0, context); assert.equal(result.cabinetHits, 0, context);
    if (curl === 1) assert.ok(result.ball < .004, `grip must stay in contact: ${context}`);
  }
});

test('actual right-hand mesh clears dome/panel/posts through rest, strike and depressed contact', async () => {
  const r = await rig();
  for (const reduced of [false, true]) for (const capY of [1.72, 1.695, 1.67]) for (let frame = -1; frame <= 40; frame++) {
    r.button.position.y = capY;
    r.update(frame < 0 ? undefined : frame/40, reduced, 1);
    const result = clearance(r, 'right'), context = JSON.stringify({ reduced, capY, frame, ...result });
    assert.ok(result.dome >= .005, context); assert.equal(result.cabinetHits, 0, context);
    if (frame === 40) assert.ok(result.dome < .04, `palm must reach the cap: ${context}`);
  }
});

test('a committed 3D strike freezes its pose during host pause and survives lost evidence', async () => {
  const { hands, update } = await rig();
  const position = update(.4);
  assert.deepEqual(update(.4, false, 0, 'blocked'), position);
  assert.equal(hands.hands.right.pivot.visible, true);
  assert.notDeepEqual(update(.8), position);
});

test('reduced motion keeps the palm stationary throughout committed strike', async () => {
  const { update } = await rig();
  assert.deepEqual(update(.1, true), update(.9, true));
});

// Loader ownership is independent of WebGL: invalid/partial assets must never
// leave a visible half-rig or retain disposable resources after failure.
function disposableModel() {
  const scene = new T.Group(), geometry = new T.BoxGeometry(), material = new T.MeshBasicMaterial();
  const disposed = [];
  geometry.addEventListener('dispose', () => disposed.push('geometry'));
  material.addEventListener('dispose', () => disposed.push('material'));
  scene.add(new T.Mesh(geometry, material));
  return { scene, disposed };
}

test('an invalid rig reports an error and disposes both it and a late sibling', async () => {
  const invalid = disposableModel(), late = disposableModel();
  let finishRight;
  const hands = new CabinetHands(new T.Scene(), { loadAsync(url) {
    return url.includes('left') ? Promise.resolve(invalid) : new Promise(resolve => { finishRight = resolve; });
  } });
  assert.equal(hands.state, 'loading');
  await hands.ready;
  assert.equal(hands.state, 'error'); assert.match(hands.error, /missing wrist/);
  assert.deepEqual(invalid.disposed.sort(), ['geometry', 'material']);
  finishRight(late); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(late.disposed.sort(), ['geometry', 'material']);
  assert.equal(hands.root.children.length, 0); assert.deepEqual(hands.hands, {});
  assert.equal(hands.state, 'error', 'a late request cannot reverse failure');
});

test('a failed sibling disposes an already initialized hand without exposing it', { timeout: 5000 }, async () => {
  let rejectRight, left;
  const hands = new CabinetHands(new T.Scene(), { async loadAsync(url) {
    if (url.includes('right')) return new Promise((resolve, reject) => { rejectRight = reject; });
    const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
    left = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    return left;
  } });
  while (!hands.hands.left) await new Promise(resolve => setImmediate(resolve));
  assert.equal(hands.state, 'loading'); assert.equal(hands.root.visible, false);
  let disposed = 0;
  left.scene.getObjectByProperty('type', 'SkinnedMesh').geometry.addEventListener('dispose', () => { disposed++; });
  rejectRight(new Error('Network unavailable')); await hands.ready;
  assert.equal(hands.state, 'error'); assert.equal(disposed, 1);
  assert.equal(hands.root.children.length, 0); assert.deepEqual(hands.hands, {});
});
