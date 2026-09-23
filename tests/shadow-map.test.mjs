import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ArcadeScene } from '../src/arcade-scene.js';
import { mesh, batch } from '../src/arcade-art.js';

test('only registered moving casters invalidate the shadow map', () => {
  const scene = Object.create(ArcadeScene.prototype);
  scene.shadowTracked = []; scene.shadowSnapshots = new WeakMap();
  scene.renderer = { shadowMap: { needsUpdate: false } };
  const root = new T.Group(), caster = mesh(root, new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial());
  const decoration = mesh(new T.Group(), new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial());
  scene.trackShadowCaster(root);
  assert.equal(caster.castShadow, true);
  assert.equal(decoration.castShadow, false);
  scene.updateShadowMap();
  assert.equal(scene.renderer.shadowMap.needsUpdate, false);
  decoration.position.x = 1; scene.updateShadowMap();
  assert.equal(scene.renderer.shadowMap.needsUpdate, false);
  caster.position.x = 1; scene.updateShadowMap();
  assert.equal(scene.renderer.shadowMap.needsUpdate, true);
  scene.renderer.shadowMap.needsUpdate = false;
  scene.updateShadowMap();
  assert.equal(scene.renderer.shadowMap.needsUpdate, false);
  root.visible = false; scene.updateShadowMap();
  assert.equal(scene.renderer.shadowMap.needsUpdate, true);
});

test('static batches keep only explicitly selected structural casters', () => {
  const root = new T.Group(), material = new T.MeshStandardMaterial();
  mesh(root, new T.BoxGeometry(1, 1, 1), material).castShadow = true;
  mesh(root, new T.BoxGeometry(1, 1, 1), material, 2);
  batch(root);
  assert.equal(root.children.length, 2);
  assert.deepEqual(root.children.map(child => child.castShadow).sort(), [false, true]);
});

test('close and wide frusta invalidate only when coverage changes', () => {
  const scene = Object.create(ArcadeScene.prototype);
  scene.key = new T.DirectionalLight();
  scene.renderer = { shadowMap: { needsUpdate: false } };
  scene.setShadowFrustum(false);
  assert.equal(scene.key.shadow.camera.right - scene.key.shadow.camera.left, 5.8);
  assert.equal(scene.renderer.shadowMap.needsUpdate, true);
  scene.renderer.shadowMap.needsUpdate = false;
  scene.setShadowFrustum(false);
  assert.equal(scene.renderer.shadowMap.needsUpdate, false);
  scene.setShadowFrustum(true);
  assert.ok(scene.key.shadow.camera.left <= -4.5, 'delivery shelf remains covered');
  assert.equal(scene.renderer.shadowMap.needsUpdate, true);
});

test('simple quality halves the map and refreshes it without disabling shadows', () => {
  const scene = Object.create(ArcadeScene.prototype);
  scene.key = new T.DirectionalLight();
  scene.key.shadow.mapSize.set(2048, 2048);
  scene.renderer = { shadowMap: { enabled: true, needsUpdate: false }, setPixelRatio: () => {} };
  scene.resize = () => {};
  scene.setQuality(true);
  assert.equal(scene.key.shadow.mapSize.x, 1024);
  assert.equal(scene.renderer.shadowMap.enabled, true);
  assert.equal(scene.renderer.shadowMap.needsUpdate, true);
  scene.renderer.shadowMap.needsUpdate = false;
  scene.setQuality(true);
  assert.equal(scene.renderer.shadowMap.needsUpdate, false);
  const previousRatio = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1.5;
  try { scene.setQuality(false); } finally { globalThis.devicePixelRatio = previousRatio; }
  assert.equal(scene.key.shadow.mapSize.x, 2048);
  assert.equal(scene.renderer.shadowMap.needsUpdate, true);
});
