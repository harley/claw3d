import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { offlinePack, requiredModels } from '../scripts/offline-pack.mjs';
import { createPilotServer } from '../server/index.js';

test('public pack contains verified public bytes, neutral shell and only the required public routes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'claw-pack-'));
  let app;
  try {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<head></head><body>Camera stays on-device.</body>');
    await writeFile(join(dir, 'assets/test.js'), 'export default 42;');
    await writeFile(join(dir, 'build-info.json'), '{"private":true,"commit":"abcdef0","sourceCommit":"abcdef0123456789","branch":"private-branch"}');
    await writeFile(join(dir, 'export.json'), '{"private":true}');
    for (const path of requiredModels) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), 'synthetic model bytes');
    }
    const plugin = offlinePack();
    plugin.configResolved({ root: dir, build: { outDir: '.' } });
    await plugin.closeBundle();
    const manifest = JSON.parse(await readFile(join(dir, 'prepared/manifest.json')));
    assert.deepEqual(manifest.build, {commit:'abcdef0',sourceCommit:'abcdef0123456789'});
    assert.doesNotMatch(JSON.stringify(manifest),/private-branch|private/);
    assert.deepEqual(manifest.entries.map(entry => entry.url), ['/assets/test.js', '/prepared/client.js', '/prepared/index.html', ...requiredModels].sort());
    for (const entry of manifest.entries) {
      const bytes = await readFile(join(dir, entry.url));
      assert.equal(entry.bytes, bytes.length);
      assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
    }
    app = await createPilotServer({ filename: ':memory:', dist: dir, origin: 'http://127.0.0.1', staffCode: 'offline-pack-test-secret', hostCode: 'offline-host', secure: false, publicTryEnabled: true });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    for (const route of ['/prepared/', '/prepared/index.html', '/prepared/client.js', '/prepared/manifest.json', '/prepared/worker.js']) {
      const response = await fetch(origin + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (route.endsWith('/') || route.endsWith('.html')) {
        const html = await response.text();
        assert.match(html, /__OFFLINE_SHELL__=true/);
        assert.doesNotMatch(html, /__SHARED_PILOT__|__OFFICIAL_EVENTS__|__PUBLIC_DIAGNOSTICS__/);
      }
    }
    await rm(join(dir, requiredModels[0]));
    await assert.rejects(plugin.closeBundle(), /Offline pack is missing/);
    for (const route of ['/prepared/private.json', '/build-info.json', '/export.json']) assert.equal((await fetch(origin + route)).status, 401);
  } finally {
    if (app) { await new Promise(resolve => app.server.close(resolve)); app.database.close(); }
    await rm(dir, { recursive: true, force: true });
  }
});
