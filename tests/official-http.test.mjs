import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPilotServer } from '../server/index.js';
import { CLOSE_GRACE_MS, EVENT_RETENTION_MS } from '../server/official-events.js';

const staffCode = 'http-test-staff-secret-with-entropy', hostCode = 'http-test-host-code';
const origin = 'https://events.example';
const key = () => randomUUID();
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'official-http-')), dist = join(dir, 'dist');
  await mkdir(dist); await writeFile(join(dist, 'index.html'), '<head></head><body>Staff pilot</body>');
  let app;
  const base = { filename: join(dir, 'pilot.sqlite'), dist, origin, staffCode, hostCode, secure: true,
    officialEventsEnabled: true, officialAdmissionsEnabled: true, ...options };
  async function stop() { if (app) { await new Promise(resolve => app.server.close(resolve)); app.database.close(); app = null; } }
  async function start(overrides = {}) {
    await stop(); app = await createPilotServer({ ...base, ...overrides });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  }
  await start();
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  function client(initial = {}) {
    const jar = new Map(Object.entries(initial));
    return { jar, async request(path, data, { method = data === undefined ? 'GET' : 'POST', headers = {}, saveCookies = true, raw } = {}) {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
        method, headers: { origin, 'content-type': 'application/json', 'x-real-ip': '192.0.2.1',
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
        body: raw ?? (data === undefined ? undefined : JSON.stringify(data)),
      });
      if (saveCookies) for (const cookie of response.headers.getSetCookie()) {
        const [k, v] = cookie.split(';')[0].split('=');
        if (v) jar.set(k, v); else jar.delete(k);
      }
      const text = await response.text();
      return { status: response.status, headers: response.headers, text,
        data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
    } };
  }
  async function login(host = false) {
    const c = client(); assert.equal((await c.request('/api/login', { code: staffCode })).status, 200);
    if (host) assert.equal((await c.request('/api/host/login', { code: hostCode })).status, 200);
    return c;
  }
  async function setup() {
    const host = await login(true), staff = await login();
    const created = await host.request('/api/host/events', { name: 'Booth', requestKey: key() });
    assert.equal(created.status, 201); const eventId = created.data.eventId;
    assert.equal((await host.request(`/api/host/events/${eventId}/state`, { state: 'open', requestKey: key() })).status, 200);
    const participant = await host.request(`/api/host/events/${eventId}/participants`, { name: 'Jade', requestKey: key() });
    assert.equal(participant.status, 200);
    async function ticket() {
      const r = await host.request(`/api/host/events/${eventId}/tickets`, { participantId: participant.data.participantId, requestKey: key() });
      assert.equal(r.status, 200); return r.data;
    }
    async function admit() {
      const issued = await ticket(), input = { code: issued.code, requestKey: key(), nonce: key() };
      const r = await staff.request('/api/official/redeem', input); assert.equal(r.status, 200);
      const official = client({ cc_official: staff.jar.get('cc_official') });
      assert.equal((await official.request(`/api/official/runs/${r.data.id}/activate`, { nonce: input.nonce })).status, 200);
      return { issued, input, run: r.data, official };
    }
    return { host, staff, eventId, participant: participant.data, ticket, admit };
  }
  return { get app() { return app; }, restart: start, client, login, setup };
}
const turnsPath = id => `/api/official/runs/${id}/turns`;
async function complete(c, id, prizeId = 'butter') {
  let r;
  for (const turn of [1, 2, 3]) { r = await c.request(turnsPath(id), { turn, prizeId }); assert.equal(r.status, 200); }
  return r.data;
}

// Domain tests cannot detect route bypasses or forged HTTP principals. These
// tests use actual requests/cookies and a disposable SQLite service, no GPU.
test('event API defaults off, does not migrate, and leaves staff gate intact', async t => {
  const f = await fixture(t, { officialEventsEnabled: false });
  const host = await f.login(true), visitor = f.client();
  assert.equal((await host.request('/api/host/events', { name: 'No', requestKey: key() })).status, 404);
  assert.equal((await visitor.request('/api/official/session')).status, 404);
  assert.equal(f.app.database.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE 'official_%'").get().n, 0);
  assert.match((await visitor.request('/')).text, /Staff pilot/);
  assert.equal((await visitor.request('/api/board')).status, 401);
});

test('every event host route rejects absent, staff and official-only credentials', async t => {
  const f = await fixture(t), s = await f.setup(), { official, run } = await s.admit();
  const cases = [
    ['/api/host/events', { name: 'New', requestKey: key() }],
    [`/api/host/events/${s.eventId}/state`, { state: 'closed', requestKey: key() }],
    [`/api/host/events/${s.eventId}/participants`, { name: 'Other', requestKey: key() }],
    [`/api/host/events/${s.eventId}/participant-lookup`, { code: s.participant.code }],
    [`/api/host/events/${s.eventId}/tickets`, { participantId: s.participant.participantId, requestKey: key() }],
    [`/api/host/event-tickets/${key()}/reissue`, { requestKey: key() }],
    [`/api/host/event-runs/${run.id}/recover`, { reason: 'camera_failure', requestKey: key() }],
    [`/api/host/events/${s.eventId}/export`], [`/api/host/events/${s.eventId}/board`],
    ['/api/host/events/prune', { confirm: 'REMOVE_EXPIRED_EVENT_RECORDS' }],
    ['/api/host/export'], ['/api/host/playtest'], ['/api/host/boards', { name: 'No' }],
  ];
  for (const [c, status] of [[f.client(), 401], [s.staff, 403], [official, 401]]) {
    for (const [path, body] of cases) assert.equal((await c.request(path, body)).status, status, path);
  }
  assert.equal((await official.request('/api/host/login', { code: hostCode })).status, 401);
  assert.equal((await official.request('/api/runs', { name: 'No', requestKey: key() })).status, 401);
  assert.equal((await official.request('/api/board')).status, 401);
  assert.equal((await s.staff.request('/api/host/events', { role: 'host', ownerId: 'spoof', name: 'No', requestKey: key() })).status, 403);
  assert.equal((await s.host.request(`/api/host/events/${s.eventId}/board`)).status, 200);
});

test('only verified staff owner can redeem; run cookie grants one run/event without staff elevation', async t => {
  const f = await fixture(t), s = await f.setup(), ticket = await s.ticket();
  const input = { code: ticket.code, requestKey: key(), nonce: key() };
  assert.equal((await f.client().request('/api/official/redeem', input)).status, 401);
  const spoofed = f.client({ cc_session: s.staff.jar.get('cc_session'), cc_owner: 'A'.repeat(43) });
  assert.equal((await spoofed.request('/api/official/redeem', input)).status, 401);
  assert.equal((await s.staff.request('/api/official/redeem', { ...input, ownerId: 'spoof', role: 'host' })).status, 400);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 0);
  const response = await s.staff.request('/api/official/redeem', input);
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie()[0];
  assert.match(cookie, /^cc_official=/); assert.match(cookie, /Path=\/api\/official;/);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /; Secure/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const old = f.client({ cc_official: s.staff.jar.get('cc_official') }), next = await s.admit();
  assert.equal((await old.request(`/api/official/runs/${next.run.id}`)).status, 404, 'same owner does not widen a run cookie');
  assert.equal((await next.official.request(`/api/official/runs/${response.data.id}`)).status, 404);
  assert.equal((await next.official.request('/api/official/session')).data.id, next.run.id);
  const otherStaff = await f.login();
  assert.equal((await otherStaff.request('/api/official/redeem', input)).status, 409);
  assert.equal((await otherStaff.request(`/api/official/runs/${next.run.id}`)).status, 401);
});

test('concurrent and lost-response redemption reuse one cookie and survive restart; logout revokes it', async t => {
  const f = await fixture(t), s = await f.setup(), ticket = await s.ticket();
  const input = { code: ticket.code, requestKey: key(), nonce: key() };
  const responses = await Promise.all(Array.from({ length: 12 }, () => s.staff.request('/api/official/redeem', input, { saveCookies: false })));
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(new Set(responses.map(r => r.data.id)).size, 1);
  assert.equal(new Set(responses.map(r => r.headers.getSetCookie()[0].split(';')[0])).size, 1);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_run_sessions').get().n, 1);
  // No successful response was saved to this browser; retry restores capability.
  const retry = await s.staff.request('/api/official/redeem', input), runId = retry.data.id;
  const official = f.client({ cc_official: s.staff.jar.get('cc_official') });
  await f.restart();
  assert.equal((await official.request('/api/official/session')).data.id, runId);
  assert.equal((await official.request(`/api/official/runs/${runId}/activate`, { nonce: input.nonce })).status, 200);
  assert.equal((await official.request(turnsPath(runId), { turn: 1, prizeId: 'sprout' })).status, 200);
  const stolenOld = f.client({ cc_official: official.jar.get('cc_official') });
  assert.equal((await official.request('/api/official/logout', {})).status, 200);
  assert.equal((await stolenOld.request('/api/official/session')).status, 401);
  const renewed = await s.staff.request('/api/official/redeem', input);
  assert.equal(renewed.status, 200); assert.equal(renewed.data.turns.length, 1);
  assert.notEqual(s.staff.jar.get('cc_official'), stolenOld.jar.get('cc_official'));
  assert.equal((await stolenOld.request('/api/official/session')).status, 401);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
  f.app.database.db.exec('UPDATE sessions SET expires=0');
  const surviving = f.client({ cc_official: s.staff.jar.get('cc_official') });
  assert.equal((await surviving.request('/api/official/session')).data.id, runId, 'staff expiry does not drop an accepted run');
  assert.equal((await s.staff.request('/api/official/redeem', input)).status, 401, 'staff expiry still blocks redemption');
});

test('real HTTP turn/reload/recovery flow cannot resurrect a void attempt and best score keeps identity', async t => {
  const f = await fixture(t), s = await f.setup(), first = await s.admit();
  assert.equal((await complete(first.official, first.run.id)).total, 300);
  assert.equal((await first.official.request(turnsPath(first.run.id), { turn: 4, prizeId: null })).status, 400);
  const second = await s.admit();
  assert.equal((await second.official.request(turnsPath(second.run.id), { turn: 1, prizeId: 'sprout' })).status, 200);
  assert.equal((await second.official.request(`/api/official/runs/${second.run.id}/interrupt`, {})).data.status, 'interrupted');
  assert.equal((await second.official.request(`/api/official/runs/${second.run.id}/activate`, { nonce: second.input.nonce })).status, 409);
  const recovery = { reason: 'camera_failure', requestKey: key() };
  const replacement = await s.host.request(`/api/host/event-runs/${second.run.id}/recover`, recovery);
  assert.equal(replacement.status, 200); assert.equal(replacement.data.participantId, s.participant.participantId);
  assert.equal((await second.official.request(turnsPath(second.run.id), { turn: 2, prizeId: 'sprout' })).status, 409);
  assert.equal((await second.official.request('/api/official/session')).data.status, 'void');
  const lookup = await s.host.request(`/api/host/events/${s.eventId}/participant-lookup`, { code: s.participant.code });
  assert.equal(lookup.data.participantId, s.participant.participantId);
  const input = { code: replacement.data.code, requestKey: key(), nonce: key() };
  const replaced = await s.staff.request('/api/official/redeem', input);
  const official = f.client({ cc_official: s.staff.jar.get('cc_official') });
  await official.request(`/api/official/runs/${replaced.data.id}/activate`, { nonce: input.nonce });
  await complete(official, replaced.data.id, 'sprout');
  assert.deepEqual((await official.request('/api/official/board')).data, [{ name: 'Jade', total: 600, rank: 1 }]);
  assert.deepEqual((await first.official.request(`/api/official/runs/${first.run.id}/best`)).data.best, { total: 600, rank: 1 });
  const exported = await s.host.request(`/api/host/events/${s.eventId}/export`);
  assert.equal(exported.data.runs.length, 3);
  for (const value of ['owner_id', 'nonce_hash', 'code_hash', 'qr_hash', 'token', s.staff.jar.get('cc_official'), s.participant.code]) assert.ok(!exported.text.includes(value));
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.equal((await s.host.request(`/api/host/event-runs/${first.run.id}/recover`, { reason: 'camera_failure', requestKey: key() })).status, 409);
});

test('origin, method, body shape and size checks run before mutations', async t => {
  const f = await fixture(t), s = await f.setup(), ticket = await s.ticket();
  const input = { code: ticket.code, requestKey: key(), nonce: key() };
  assert.equal((await s.staff.request('/api/official/redeem', input, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.staff.request('/api/official/redeem', input, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await s.staff.request('/api/official/redeem', input, { raw: 'null' })).status, 400);
  assert.equal((await s.staff.request('/api/official/redeem', input, { raw: '{' })).status, 400);
  assert.equal((await s.staff.request('/api/official/redeem', { code: 'T-' + 'A'.repeat(5000), requestKey: key(), nonce: key() })).status, 413);
  assert.equal((await s.staff.request('/api/official/redeem')).status, 405);
  assert.equal((await s.staff.request('/api/official/redeem', { code: ticket.code })).status, 400);
  assert.equal((await s.host.request(`/api/host/events/${s.eventId}/tickets`, { participantId: {}, requestKey: key() })).status, 400);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 0);
  const a = await s.admit();
  assert.equal((await a.official.request(turnsPath(a.run.id), { turn: 1, prizeId: null, runId: key() })).status, 400);
  assert.equal((await a.official.request(turnsPath(a.run.id), { turn: 1, prizeId: null }, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await a.official.request(`/api/official/runs/${a.run.id}`, {}, { method: 'DELETE' })).status, 405);
  assert.equal((await a.official.request('/api/official/logout', {}, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await a.official.request('/api/official/session')).data.turns.length, 0);
});

test('closure grace, session expiry and prospective host pruning apply through HTTP', async t => {
  const f = await fixture(t), s = await f.setup(), a = await s.admit(), b = await s.admit(), unused = await s.ticket();
  assert.equal((await s.host.request(`/api/host/events/${s.eventId}/state`, { state: 'closed', requestKey: key() })).status, 200);
  assert.equal((await s.staff.request('/api/official/redeem', { code: unused.code, requestKey: key(), nonce: key() })).status, 409);
  assert.equal((await complete(a.official, a.run.id)).status, 'complete');
  f.app.database.db.prepare('UPDATE official_events SET closed_at=? WHERE id=?').run(Date.now() - CLOSE_GRACE_MS, s.eventId);
  assert.equal((await b.official.request('/api/official/session')).data.status, 'expired');
  assert.equal((await b.official.request(turnsPath(b.run.id), { turn: 1, prizeId: null })).status, 409);
  assert.equal((await s.staff.request('/api/official/redeem', a.input)).data.status, 'complete', 'closed event still permits receipt replay');
  f.app.database.db.prepare('UPDATE official_run_sessions SET expires=0 WHERE run_id=?').run(a.run.id);
  assert.equal((await a.official.request('/api/official/session')).status, 401);
  f.app.database.db.prepare('UPDATE official_runs SET accepted_at=? WHERE id=?').run(Date.now() - 12 * 3600_000, a.run.id);
  assert.equal((await s.staff.request('/api/official/redeem', a.input)).status, 401, 'replays cannot extend the absolute credential lifetime');
  const before = f.app.database.exportData(); delete before.exportedAt;
  assert.equal((await s.host.request('/api/host/events/prune', {})).status, 400);
  assert.equal((await s.host.request('/api/host/events/prune', { confirm: 'REMOVE_EXPIRED_EVENT_RECORDS' })).data.removedEvents, 0);
  f.app.database.db.prepare('UPDATE official_events SET retain_until=created_at-? WHERE id=?').run(EVENT_RETENTION_MS, s.eventId);
  assert.equal((await s.host.request('/api/host/events/prune', { confirm: 'REMOVE_EXPIRED_EVENT_RECORDS' })).data.removedEvents, 1);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_run_sessions').get().n, 0);
  const after = f.app.database.exportData(); delete after.exportedAt; assert.deepEqual(after, before);
});

test('paused admissions preserve admitted outboxes and official sessions; disabling/re-enabling preserves all data', async t => {
  const f = await fixture(t), s = await f.setup(), a = await s.admit(), ticket = await s.ticket();
  const legacy = await s.staff.request('/api/runs', { name: 'Legacy', requestKey: key() });
  await f.restart({ officialAdmissionsEnabled: false });
  assert.equal((await s.staff.request('/api/official/redeem', { code: ticket.code, requestKey: key(), nonce: key() })).status, 503);
  assert.equal((await s.host.request(`/api/host/events/${s.eventId}/tickets`, { participantId: s.participant.participantId, requestKey: key() })).status, 503);
  assert.equal((await s.host.request(`/api/host/event-runs/${a.run.id}/recover`, { reason: 'camera_failure', requestKey: key() })).status, 503);
  assert.equal((await s.staff.request('/api/official/redeem', a.input)).data.id, a.run.id);
  assert.equal((await complete(a.official, a.run.id)).total, 300);
  await f.restart({ officialEventsEnabled: false });
  assert.equal((await a.official.request('/api/official/session')).status, 404);
  for (const turn of [1, 2, 3]) assert.equal((await s.staff.request(`/api/runs/${legacy.data.id}/turns`, { turn, prizeId: null })).status, 200);
  await f.restart({ officialAdmissionsEnabled: false });
  assert.equal((await a.official.request('/api/official/session')).data.total, 300);
  assert.equal((await s.staff.request(`/api/runs/${legacy.data.id}`)).data.turns.length, 3);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
});

test('official per-run rate limit cannot be reset with forwarded headers or consume host budget', async t => {
  const f = await fixture(t), s = await f.setup(), a = await s.admit();
  // Activation used one of this run's 120 requests per minute.
  for (let i = 0; i < 119; i++) assert.equal((await a.official.request('/api/official/session')).status, 200);
  assert.equal((await a.official.request('/api/official/session', undefined, { headers: { 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '198.51.100.3' } })).status, 429);
  assert.equal((await s.host.request(`/api/host/events/${s.eventId}/export`)).status, 200);
});
