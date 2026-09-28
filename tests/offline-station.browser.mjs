// Real production bytes, CacheStorage and service worker lifecycle. No production
// writes, granted admission, hand tracking quality or physical-play claims.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';
import { offlinePack } from '../scripts/offline-pack.mjs';

const dir = await mkdtemp(join(tmpdir(), 'claw-offline-'));
let browser, app;
const deadline = setTimeout(() => browser?.close(), 180_000);
const status = page => page.evaluate(async () => (await import('/prepared/client.js')).assetStatus());
const prepare = page => page.evaluate(async () => (await import('/prepared/client.js')).prepareAssets());
try {
  await cp('dist', dir, { recursive: true });
  app = await createPilotServer({ filename: ':memory:', dist: dir, origin: 'http://127.0.0.1', staffCode: 'offline-test-staff-secret', hostCode: 'offline-test-host', secure: false, publicTryEnabled: true });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch(browserOptions);
  const context = await browser.newContext();
  const host = await context.newPage();
  host.on('console', msg => { if (msg.text().startsWith('LIFECYCLE')) console.log(msg.text()); });
  await host.goto(origin + '/privacy');
  const first = await prepare(host);
  assert.equal(first.prepared.complete, true);
  assert.equal(first.controlling, false, 'host registration alone is not game readiness');
  const manifest = JSON.parse(await readFile(join(dir, 'prepared/manifest.json')));
  assert.equal(first.prepared.id, manifest.id);
  for (const required of ['vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.wasm', 'vision_wasm_module_internal.wasm', 'gesture_recognizer.task', 'left.glb', 'right.glb']) assert.ok(manifest.entries.some(entry => entry.url.endsWith(required)), required);
  console.log(`Verified pack: ${manifest.entries.length} files, ${manifest.bytes} bytes`);
  const page = await context.newPage();
  // Asset/runtime coverage does not need the full scene on a local software GPU.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return /webgl/.test(type) ? null : getContext.call(this, type, ...args);
    };
  });
  console.log('Opening prepared shell');
  await page.goto(origin + '/prepared/index.html?setup=manual');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  console.log('Prepared page controlled');
  const build = JSON.parse(await readFile('dist/build-info.json'));
  assert.ok((await page.locator('#build-info').textContent()).includes(`LOCAL PREPARED BUILD ${build.commit}`));
  assert.equal((await status(page)).controlling, true);
  await context.setOffline(true);
  await page.reload();
  assert.equal((await status(page)).complete, true);
  assert.equal(await page.evaluate(() => window.__OFFLINE_SHELL__), true);
  assert.equal(await page.evaluate(() => window.__SHARED_PILOT__), undefined);
  // Verify every public byte is available after reload with the network disabled.
  await page.evaluate(async entries => {
    for (const entry of entries) {
      const response = await fetch(entry.url);
      if (response.status !== 200 || (await response.arrayBuffer()).byteLength !== entry.bytes) throw Error(entry.url);
    }
    for (const path of ['/api/session', '/api/host/export', '/build-info.json', '/staff', '/official']) {
      let failed = false;
      try { await fetch(path); } catch { failed = true; }
      if (!failed) throw Error(`Private fallback: ${path}`);
    }
  }, manifest.entries);
  const cachePaths = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(new URL(request.url).pathname);
    return result;
  });
  assert.ok(cachePaths.every(path => manifest.entries.some(entry => entry.url === path) || path === '/prepared/complete'));
  console.log('Offline shell, both hand models, complete manifest and privacy boundaries pass');

  // Real bundled worker inference, restarted for each hand mode while offline.
  const workerURL = manifest.entries.find(entry => /\/prepared-vision-worker-/.test(entry.url)).url;
  for (const maxHands of [1, 2]) {
    const count = await page.evaluate(async ({ workerURL, maxHands }) => {
      const worker = new Worker(workerURL, { type: 'module' });
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Offline inference timed out')), 30000);
          worker.onerror = e => { clearTimeout(timeout); reject(Error(e.message)); };
          worker.onmessage = ({ data }) => {
            if (data.type === 'error') { clearTimeout(timeout); reject(Error(data.message)); }
            if (data.type === 'result') { clearTimeout(timeout); resolve(data.result.landmarks.length); }
            if (data.type === 'ready') {
              const canvas = new OffscreenCanvas(32, 32);
              canvas.getContext('2d').fillRect(0, 0, 32, 32);
              const bitmap = canvas.transferToImageBitmap();
              worker.postMessage({ type: 'frame', bitmap, now: 1 }, [bitmap]);
            }
          };
          worker.postMessage({ type: 'init', base: location.origin, delegate: 'CPU', maxHands });
        });
      } finally { worker.terminate(); }
    }, { workerURL, maxHands });
    assert.equal(count, 0);
  }
  console.log('Offline bundled worker inference and restart pass for both hand modes');

  const mainURL = manifest.entries.find(entry => /\/vision-main-thread-/.test(entry.url)).url;
  for (const maxHands of [1, 2]) {
    await page.reload(); // Reset the SDK's cached SIMD capability result.
    const loaded = [];
    const requested = request => loaded.push(new URL(request.url()).pathname);
    page.on('request', requested);
    const count = await page.evaluate(async ({ mainURL, maxHands }) => {
      const module = await import(mainURL);
      const create = Object.values(module).find(value => typeof value === 'function');
      const instantiate = WebAssembly.instantiate;
      // Force the SDK's non-SIMD resolver for the second restart. The first
      // restart exercises its normal SIMD choice. WebGL is denied above so
      // the production main-thread GPU-to-CPU fallback is used.
      if (maxHands === 2) WebAssembly.instantiate = (bytes, ...args) => {
        if (bytes instanceof Uint8Array && bytes.length < 100 && bytes.includes(253)) return Promise.reject(Error('Synthetic unsupported SIMD'));
        return instantiate(bytes, ...args);
      };
      let runtime;
      try {
        runtime = await create(location.origin, maxHands);
        WebAssembly.instantiate = instantiate;
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Offline main-thread inference timed out')), 30000);
          runtime.onmessage = ({ data }) => {
            if (data.type === 'result') { clearTimeout(timeout); resolve(data.result.landmarks.length); }
            if (data.type === 'error') { clearTimeout(timeout); reject(Error(data.message)); }
          };
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 32;
          canvas.getContext('2d').fillRect(0, 0, 32, 32);
          runtime.postMessage({ type: 'frame', video: canvas, now: 1 });
        });
      } finally { WebAssembly.instantiate = instantiate; runtime?.terminate(); }
    }, { mainURL, maxHands });
    page.off('request', requested);
    assert.equal(count, 0);
    assert.ok(loaded.includes(`/vision/wasm/vision_wasm${maxHands === 2 ? '_nosimd' : ''}_internal.wasm`), 'actual requested runtime variant');
  }
  console.log('Offline main-thread CPU fallback, SIMD/non-SIMD and restart pass');

  const fresh = await browser.newContext({ offline: true });
  await assert.rejects((await fresh.newPage()).goto(origin + '/prepared/index.html'));
  await fresh.close();
  if (process.env.CLAW_OFFLINE_RUNTIME_ONLY !== '1') {
    const game = await context.newPage();
    await game.goto(origin + '/prepared/index.html?setup=manual');
    await game.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true', null, { timeout: 30000 });
    assert.equal(await game.locator('#try-notice').isVisible(), true);
    assert.equal(await game.locator('.brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    assert.match(await game.locator('#build-info').textContent(), /LOCAL PREPARED BUILD/);
    // The two-hand URL reload must keep the same pack while offline.
    await game.goto(origin + '/prepared/index.html?setup=manual&controls=dual');
    await game.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true', null, { timeout: 30000 });
    assert.equal((await status(game)).id, manifest.id);
    await game.close();
    console.log('Rendered offline game reload passes');
  } else console.log('Rendered-game check omitted by explicit local runtime-only mode; hosted coverage required');
  await context.setOffline(false);
  // A second build changes the shell while reusing the real production assets.
  await writeFile(join(dir, 'index.html'), (await readFile(join(dir, 'index.html'), 'utf8')).replace('</head>', '<meta name="pack-test" content="second"></head>'));
  const plugin = offlinePack();
  plugin.configResolved({ root: dir, build: { outDir: '.' } });
  await plugin.closeBundle();
  const modelPath = join(dir, 'vision/gesture_recognizer.task');
  const model = await readFile(modelPath);
  // An interrupted/missing model download cannot complete a replacement.
  await rm(modelPath);
  await assert.rejects(prepare(host));
  assert.equal((await status(page)).id, manifest.id);
  // A sign-in/error body in place of the model must reject preparation.
  await writeFile(modelPath, '<html>Sign in</html>');
  await assert.rejects(prepare(host));
  assert.equal((await status(page)).id, manifest.id, 'failed replacement preserves current worker');
  await context.setOffline(true);
  await page.reload();
  assert.equal((await status(page)).complete, true, 'prior complete pack survives failed replacement');
  await context.setOffline(false);
  await writeFile(modelPath, model);
  const replacement = await prepare(host);
  assert.equal(replacement.waiting, true, 'even an idle old tab prevents activation during a run');
  assert.notEqual(replacement.prepared.id, manifest.id);
  await page.reload();
  assert.equal((await status(page)).id, manifest.id, 'mode/reload remains on one build');
  await host.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration('/prepared/');
    for (const key of ['installing', 'waiting', 'active']) {
      const worker = r?.[key];
      console.log('LIFECYCLE', key, worker?.state);
      worker?.addEventListener('statechange', () => console.log('LIFECYCLE', key, worker.state));
    }
  });
  await page.close();
  await host.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration('/prepared/'))?.waiting);
  const updated = await context.newPage();
  await updated.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /webgl/.test(type) ? null : getContext.call(this, type, ...args); };
  });
  const pending = new Map();
  updated.on('request', r => { pending.set(r, new URL(r.url()).pathname); console.log('REQUEST', r.resourceType(), new URL(r.url()).pathname); });
  updated.on('requestfinished', r => { pending.delete(r); console.log('FINISHED', new URL(r.url()).pathname); });
  updated.on('requestfailed', r => { pending.delete(r); console.log('FAILED', new URL(r.url()).pathname, r.failure()); });
  updated.on('response', r => console.log('RESPONSE', r.status(), new URL(r.url()).pathname, 'SW', r.fromServiceWorker()));
  updated.on('domcontentloaded', () => console.log('DOMCONTENTLOADED'));
  updated.on('load', () => console.log('LOAD'));
  updated.on('pageerror', e => console.log('PAGEERROR', e.message));
  const cdp = await context.newCDPSession(updated);
  await cdp.send('ServiceWorker.enable');
  cdp.on('ServiceWorker.workerVersionUpdated', e => console.log('WORKERS', JSON.stringify(e)));
  try {
    await updated.goto(origin + '/prepared/index.html?setup=manual');
  } catch (error) {
    console.log('PENDING', [...pending.values()]);
    console.log('REGISTRATION', await host.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration('/prepared/');
      return { active: r?.active?.state, waiting: r?.waiting?.state, installing: r?.installing?.state };
    }));
    throw error;
  }
  assert.equal((await status(updated)).id, replacement.prepared.id);
  assert.equal(await updated.locator('meta[name="pack-test"]').getAttribute('content'), 'second');
  await context.setOffline(true);
  await updated.reload();
  assert.equal((await status(updated)).complete, true);
  console.log('Interrupted/corrupt replacement rejection, old-pack reload and deferred activation pass');
  // Eviction leaves a shell-only pack incomplete, with no network fallback.
  await updated.evaluate(async id => {
    const cache = await caches.open(`claw-public-pack-v1-${id}`);
    await cache.delete('/vision/gesture_recognizer.task');
  }, replacement.prepared.id);
  assert.equal((await status(updated)).complete, false);
  assert.equal(await updated.evaluate(async () => (await fetch('/vision/gesture_recognizer.task')).status), 503);
  await context.setOffline(false);
  assert.equal((await prepare(host)).prepared.complete, true, 'explicit preparation repairs an evicted pack');
  console.log('Incomplete-cache detection and explicit repair pass');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  if (app) { await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
  await rm(dir, { recursive: true, force: true });
}
