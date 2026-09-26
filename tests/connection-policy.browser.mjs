// Real browser enforcement and actual MediaPipe inference; no camera or private data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { createPilotServer } from '../server/index.js';

const dir = await mkdtemp(join(tmpdir(), 'cloud-claw-egress-'));
let externalPosts = 0, vendorRequests = 0, app, browser;
const external = createServer((req, res) => {
  if (req.method === 'POST') externalPosts++;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(req.method === 'GET' ? '<!doctype html><title>Control</title>' : 'ok');
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
try {
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><head></head><title>Policy test</title>');
  await cp('public/vision', join(dir, 'vision'), { recursive: true });
  await cp('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', join(dir, 'assets/mediapipe.js'));
  // The same probe runs inside the document and a served module worker. A blob
  // worker would inherit the document's policy and miss the worker-header bug.
  await writeFile(join(dir, 'assets/probe.js'), `
    export async function probe(externalUrl, worker = false) {
      const violations = [];
      const onViolation = e => violations.push({ directive: e.effectiveDirective, uri: e.blockedURI });
      globalThis.addEventListener('securitypolicyviolation', onViolation);
      try {
        const health = await (await fetch('/healthz')).json();
        let blocked = false;
        try { await fetch(externalUrl, { method: 'POST', body: 'synthetic' }); }
        catch { blocked = true; }
        const { FilesetResolver, GestureRecognizer } = await import('/assets/mediapipe.js');
        const files = await FilesetResolver.forVisionTasks('/vision/wasm', worker);
        const recognizer = await GestureRecognizer.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/vision/gesture_recognizer.task', delegate: 'CPU' },
          runningMode: 'VIDEO', numHands: 1,
        });
        let handCount;
        try {
          const canvas = new OffscreenCanvas(32, 32);
          canvas.getContext('2d').fillRect(0, 0, 32, 32);
          const bitmap = canvas.transferToImageBitmap();
          try { handCount = recognizer.recognizeForVideo(bitmap, 1).landmarks.length; }
          finally { bitmap.close(); }
        } finally { recognizer.close(); } // Flushes the real SDK's usage logger.
        await new Promise(resolve => setTimeout(resolve, 100));
        return { health, blocked, handCount, violations };
      } finally { globalThis.removeEventListener('securitypolicyviolation', onViolation); }
    }
  `);
  await writeFile(join(dir, 'assets/worker.js'), `
    import { probe } from './probe.js';
    self.onmessage = async e => {
      try { self.postMessage(await probe(e.data, true)); }
      catch (error) { self.postMessage({ error: error.message }); }
    };
  `);
  await listen(external);
  const externalUrl = `http://127.0.0.1:${external.address().port}`;
  app = await createPilotServer({ filename: ':memory:', dist: dir, origin: 'http://127.0.0.1',
    staffCode: 'egress-test-staff-code', hostCode: 'egress-test-host-code', secure: false, publicTryEnabled: true });
  await listen(app.server);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch(browserOptions);
  const page = await browser.newPage();
  // If the CSP regresses, stop the real logger before any request reaches Google.
  await page.context().route('https://odml.pa.googleapis.com/**', route => { vendorRequests++; return route.abort(); });
  await page.goto(externalUrl);
  await page.evaluate(url => fetch(url, { method: 'POST', body: 'synthetic control' }), externalUrl);
  assert.equal(externalPosts, 1, 'control server can receive a browser POST');
  externalPosts = 0;
  await page.goto(origin);
  const main = await page.evaluate(async url => (await import('/assets/probe.js')).probe(url), externalUrl);
  const worker = await page.evaluate(url => new Promise((resolve, reject) => {
    const worker = new Worker('/assets/worker.js', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker policy probe timed out')); }, 30_000);
    worker.onmessage = e => { clearTimeout(timer); worker.terminate(); resolve(e.data); };
    worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage(url);
  }), externalUrl);
  for (const [name, result] of Object.entries({ main, worker })) {
    assert.equal(result.error, undefined, name);
    assert.equal(result.health?.ok, true, `${name}: first-party fetch succeeds`);
    assert.equal(result.blocked, true, `${name}: external POST rejects`);
    assert.equal(result.handCount, 0, `${name}: real CPU inference on blank frame succeeds`);
    assert.ok(result.violations.some(v => v.directive === 'connect-src' && v.uri.startsWith(externalUrl)), `${name}: external counter blocked by CSP`);
    assert.ok(result.violations.some(v => v.directive === 'connect-src' && (v.uri === 'https://odml.pa.googleapis.com' || v.uri.startsWith('https://odml.pa.googleapis.com/'))), `${name}: actual SDK logging blocked by CSP`);
  }
  assert.equal(externalPosts, 0, 'neither document nor worker contacted the external counter');
  assert.equal(vendorRequests, 0, 'CSP stopped SDK logging before the protective network interceptor');
  console.log('Connection policy: page + served worker block external/SDK uploads; same-origin fetch and real CPU inference pass.');
} finally {
  await browser?.close();
  if (app) { await close(app.server); app.database.close(); }
  if (external.listening) await close(external);
  await rm(dir, { recursive: true, force: true });
}
