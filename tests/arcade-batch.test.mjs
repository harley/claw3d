import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { batch } from '../src/arcade-art.js';

// Contract: indexed batching lowers vertex storage without changing rendered
// triangles, normals, UVs, materials or shadow partitions. Contact replays alone
// cannot catch changed shading/UV data or a silent loss of index sharing.
test('indexed batches preserve exact triangle attributes and material partitions', () => {
  const root = new T.Group();
  root.position.set(1, 2, 3); root.rotation.y = .3;
  const material = new T.MeshStandardMaterial();
  for (const [i, geometry] of [new T.SphereGeometry(1, 24, 16), new T.BoxGeometry().toNonIndexed(), new T.SphereGeometry(1, 24, 16)].entries()) {
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(i * .3, i * .4, 0); mesh.scale.set(1, .7, .6); mesh.rotation.z = .2;
    mesh.castShadow = i === 2; root.add(mesh);
  }
  const legacy = root.clone(true), indexed = root.clone(true);
  const sourceCounts = root.children.map(m => m.geometry.attributes.position.count);
  batch(legacy, { indexed: false }); batch(indexed, { indexed: true });
  assert.equal(indexed.children.length, legacy.children.length);
  let before = 0, after = 0;
  for (let i = 0; i < legacy.children.length; i++) {
    const a = legacy.children[i], b = indexed.children[i];
    assert.equal(a.material, b.material); assert.equal(a.castShadow, b.castShadow);
    assert.ok(b.geometry.index);
    const expanded = b.geometry.toNonIndexed();
    for (const key of Object.keys(a.geometry.attributes)) {
      assert.deepEqual(expanded.attributes[key].array, a.geometry.attributes[key].array, key);
    }
    before += a.geometry.attributes.position.count;
    after += b.geometry.attributes.position.count;
    expanded.dispose();
  }
  assert.ok(after < before * .25, `${before} -> ${after} vertices`);
  assert.deepEqual(root.children.map(m => m.geometry.attributes.position.count), sourceCounts, 'shared source geometries remain unchanged');
  console.log(`Batch fixture: ${before} -> ${after} vertices; exact triangle attributes preserved`);
});
