import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPilotServer } from '../server/index.js';

// Public entry/asset routing is a new access boundary. These disposable HTTP
// tests catch accidental auth bypasses and symlink escapes without a browser.
async function fixture(t, publicTryEnabled = false, officialEventsEnabled = true) {
  const dir = await mkdtemp(join(tmpdir(), 'public-try-'));
  for (const path of ['assets', 'models/hands', 'vision/wasm']) await mkdir(join(dir, path), { recursive: true });
  for (const path of ['index.html', 'build-info.json', 'private.txt', 'assets/game.js', 'assets/game.css', 'models/hands/left.glb', 'vision/gesture_recognizer.task', 'vision/wasm/runtime.wasm']) await writeFile(join(dir, path), path === 'index.html' ? '<head></head>Arcade' : 'fixture');
  await symlink(join(dir, 'private.txt'), join(dir, 'assets/secret.js'));
  const origin = 'http://127.0.0.1:4291';
  const app = await createPilotServer({ filename: ':memory:', dist: dir, origin, staffCode: 'public-try-staff-secret', hostCode: 'public-host-code', secure: false, publicTryEnabled, officialEventsEnabled });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.database.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path, { data, cookie, method = data ? 'POST' : 'GET' } = {}) => fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
    method, headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: data ? JSON.stringify(data) : undefined,
  });
  return { app, request };
}

test('Try defaults off and retains the staff gate and protected assets', async t => {
  const { request } = await fixture(t);
  assert.match(await (await request('/')).text(), /Staff pilot/);
  for (const path of ['/try', '/index.html', '/assets/game.js', '/vision/gesture_recognizer.task']) assert.equal((await request(path)).status, 401);
});

test('enabled Try exposes only its entry and required assets, without owners or score authority', async t => {
  const { app, request } = await fixture(t, true);
  for (const path of ['/', '/try']) {
    const response = await request(path); assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    const html = await response.text(); assert.match(html, /__PUBLIC_TRY__=true/); assert.match(html, /__PUBLIC_DIAGNOSTICS__=false/); assert.doesNotMatch(html, /__SHARED_PILOT__|__PUBLIC_OFFICIAL__/);
  }
  for (const path of ['/assets/game.js', '/assets/game.css', '/models/hands/left.glb', '/vision/gesture_recognizer.task', '/vision/wasm/runtime.wasm']) {
    assert.equal((await request(path)).status, 200);
    assert.equal((await request(path, { method: 'HEAD' })).status, 200);
    assert.equal((await request(path, { data: {} })).status, 401);
  }
  assert.equal((await request('/assets/secret.js')).status, 404);
  for (const path of ['/index.html', '/private.txt', '/build-info.json', '/assets/%2e%2e/private.txt', '/api/session', '/api/board', '/api/host/export', '/api/host/playtest', '/api/host/public-playtest', '/api/official/session', '/api/official/board']) assert.equal((await request(path)).status, 401, path);
  for (const path of ['/api/runs', '/api/host/boards', '/api/host/login', '/api/official/redeem']) assert.equal((await request(path, { data: {} })).status, 401, path);
  assert.equal((await request('/api/public/session', { data: {} })).status, 404, 'diagnostics remain independently disabled');
  for (const table of ['owners', 'runs', 'turns', 'official_runs']) assert.equal(app.database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
});

test('enabled Try cannot replace or elevate the separate staff session', async t => {
  const { request } = await fixture(t, true);
  assert.match(await (await request('/staff')).text(), /Staff pilot/);
  const login = await request('/api/login', { data: { code: 'public-try-staff-secret' } });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.match(await (await request('/staff', { cookie })).text(), /__SHARED_PILOT__=true;window.__OFFICIAL_EVENTS__=true/);
  const practice = await request('/try', { cookie }); assert.equal(practice.headers.get('set-cookie'), null);
  assert.match(await practice.text(), /__PUBLIC_TRY__=true/);
  assert.equal((await request('/api/session', { cookie })).status, 200);
  assert.equal((await request('/api/host/export', { cookie })).status, 403);
});

// The host UI flag must follow the existing server feature switch, not public Try.
test('disabled official API cannot advertise host event controls', async t => {
  const { request } = await fixture(t, true, false);
  const login = await request('/api/login', { data: { code: 'public-try-staff-secret' } });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.match(await (await request('/staff', { cookie })).text(), /__OFFICIAL_EVENTS__=false/);
});


test('public official entry requires both flags and never changes default practice', async t => {
  for (const [publicTry, events] of [[false, true], [true, false], [true, true]]) {
    const { request } = await fixture(t, publicTry, events);
    const official = await request('/official');
    assert.equal(official.status, publicTry && events ? 200 : 401);
    if (publicTry && events) assert.match(await official.text(), /__PUBLIC_OFFICIAL__=true/);
    if (publicTry) assert.match(await (await request('/?play=official')).text(), /__PUBLIC_TRY__=true/);
    if (!(publicTry && events)) assert.equal((await request('/api/official/public/redeem', { data: {} })).status, 404);
  }
});

// A worker uses the policy on its own script response, not the document's.
test('same-origin connection policy covers public entry, worker assets and staff gate', async t => {
  const { request } = await fixture(t, true);
  for (const path of ['/', '/try', '/staff', '/assets/game.js', '/vision/wasm/runtime.wasm', '/healthz']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-security-policy'), "connect-src 'self'", path);
  }
});
