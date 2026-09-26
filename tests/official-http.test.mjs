import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOfficialSessionApi } from '../src/official-session-api.js';
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

// The existing HTTP tests exercise server policy. These exercise the browser
// adapter against that same boundary: a lost acknowledgement must not create a
// duplicate score, and reload/credential changes must not restart a scene.
function storage() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i],
    getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
async function outbox(t) {
  const f = await fixture(t), s = await f.setup(), issued = await s.ticket();
  const input = { code: issued.code, requestKey: key(), nonce: key() };
  const admitted = await s.staff.request('/api/official/redeem', input);
  assert.equal(admitted.status, 200);
  const c = f.client({ cc_official: s.staff.jar.get('cc_official') }), local = storage(), tab = storage(), calls = [], notices = [];
  let offline = false, lose = '', afterResponse = async () => {};
  const fetcher = async (url, options) => {
    calls.push(url);
    if (offline) throw Error('offline');
    const r = await c.request(url, options.body ? JSON.parse(options.body) : undefined);
    await afterResponse(url, r);
    if (lose && url.endsWith(lose)) { lose = ''; throw Error('response lost after commit'); }
    return Response.json(r.data, { status: r.status });
  };
  const client = (tabStorage = tab) => createOfficialSessionApi({ storage: local, tabStorage, fetcher, onChange: n => notices.push(n) });
  return { f, s, c, local, tab, calls, notices, input, run: admitted.data, client,
    set offline(value) { offline = value; }, set lose(value) { lose = value; }, set afterResponse(value) { afterResponse = value; } };
}

test('official client drains exactly three turns after acknowledgement loss and reload without staff access', async t => {
  const o = await outbox(t), api = o.client();
  o.lose = '/activate';
  await assert.rejects(api.activate(o.run, o.input.nonce), /response lost/);
  assert.throws(() => api.queue({ ...o.run, turns: [{ turn: 1, prizeId: null }] }), /does not own/);
  const run = await api.activate(o.run, o.input.nonce);
  await assert.rejects(api.activate(o.run, o.input.nonce), /cannot restart/);
  o.lose = '/turns';
  run.turns.push({ turn: 1, prizeId: 'butter', remainingMs: 7500, score: 999999 });
  await api.queue(run);
  assert.equal(api.state().attempts[0].pending, 1);
  assert.equal(o.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 1);
  o.offline = true;
  run.turns.push({ turn: 2, prizeId: null }, { turn: 3, prizeId: 'sprout' });
  await api.queue(run);
  const beforeReload = o.calls.length;
  o.offline = false;
  const reloaded = o.client(); await reloaded.initialize();
  assert.equal(o.calls.slice(beforeReload).some(url => url.endsWith('/activate')), false);
  assert.equal(o.local.length, 0); assert.equal(o.tab.length, 0);
  assert.equal(o.notices.find(n => n.saved)?.saved.total, 325);
  assert.equal(o.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 3);
  assert.equal(o.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
  assert.ok(o.calls.every(url => url.startsWith('/api/official/')));
});

test('official reload interrupts only its tab after draining and cannot reactivate', async t => {
  const o = await outbox(t), api = o.client();
  const run = await api.activate(o.run, o.input.nonce);
  await o.client(storage()).initialize();
  assert.equal((await o.c.request('/api/official/session')).data.status, 'active');
  o.offline = true; run.turns.push({ turn: 1, prizeId: null }); await api.queue(run);
  const reloaded = o.client(); await reloaded.initialize();
  await assert.rejects(reloaded.activate(o.run, o.input.nonce), /cannot restart/);
  assert.throws(() => reloaded.acknowledge(run.id), /must sync/);
  o.offline = false; const start = o.calls.length; await reloaded.flush();
  assert.deepEqual(o.calls.slice(start).map(url => url.split('/').at(-1)), ['session', 'turns', 'interrupt']);
  assert.equal((await o.c.request('/api/official/session')).data.status, 'interrupted');
  assert.equal(reloaded.state().attempts[0].pending, 0);
  reloaded.acknowledge(run.id); assert.equal(o.local.length, 0);
});

test('official client keeps void, expired and expired-capability outboxes for review without late scoring', async t => {
  for (const condition of ['void', 'expired', 'capability']) {
    const o = await outbox(t), api = o.client(), run = await api.activate(o.run, o.input.nonce);
    o.offline = true; run.turns.push({ turn: 1, prizeId: 'sprout' }); await api.queue(run); o.offline = false;
    if (condition === 'void') {
      assert.equal((await o.s.host.request(`/api/host/event-runs/${run.id}/recover`, { reason: 'camera_failure', requestKey: key() })).status, 200);
    } else if (condition === 'expired') {
      o.f.app.database.db.prepare("UPDATE official_events SET state='closed',closed_at=? WHERE id=?").run(Date.now() - CLOSE_GRACE_MS, o.s.eventId);
    } else o.f.app.database.db.prepare('UPDATE official_run_sessions SET expires=0 WHERE run_id=?').run(run.id);
    const start = o.calls.length; await api.flush();
    assert.equal(o.calls.slice(start).some(url => url.endsWith('/turns')), false);
    assert.equal(o.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 0);
    assert.equal(api.state().attempts[0].pending, 1);
    assert.equal(api.state().needsCapability, condition === 'capability');
    if (condition !== 'capability') {
      assert.equal(api.state().attempts[0].status, condition);
      assert.throws(() => api.queue(run), /does not own/);
      api.acknowledge(run.id); assert.equal(o.local.length, 0);
    }
  }
});

test('official and legacy outboxes keep separate ownership when a browser capability changes', async t => {
  const { createSessionApi } = await import('../src/session-api.js');
  const o = await outbox(t), api = o.client(), run = await api.activate(o.run, o.input.nonce);
  let legacyOffline = false;
  const legacy = createSessionApi({ storage: o.local, tabStorage: o.tab, fetcher: async (url, options) => {
    if (legacyOffline) throw Error('offline');
    const r = await o.s.staff.request(url, options.body ? JSON.parse(options.body) : undefined);
    return Response.json(r.data, { status: r.status });
  } });
  const old = await legacy.start('Legacy', key()); legacyOffline = true;
  old.turns = [1, 2, 3].map(turn => ({ turn, prizeId: null })); legacy.queue(old); await legacy.flush();
  const legacyKeys = Array.from({ length: o.local.length }, (_, i) => o.local.key(i)).filter(k => k.startsWith('cloud-claw:pending:v2:'));
  const snapshot = legacyKeys.map(k => o.local.getItem(k));
  o.offline = true; run.turns.push({ turn: 1, prizeId: null }); await api.queue(run); o.offline = false;
  const other = await o.s.admit(); o.c.jar.set('cc_official', other.official.jar.get('cc_official'));
  const start = o.calls.length; await api.flush();
  assert.deepEqual(o.calls.slice(start), ['/api/official/session']);
  assert.deepEqual(legacyKeys.map(k => o.local.getItem(k)), snapshot);
  legacyOffline = false; await legacy.flush();
  assert.equal(legacy.state().pending, 0); assert.equal(api.state().attempts[0].pending, 1);
  assert.equal(o.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns WHERE run_id=?').get(run.id).n, 0);
});

test('official client refuses unavailable storage, conflicting results and a fourth turn', async t => {
  const o = await outbox(t), api = o.client(), set = o.local.setItem;
  o.local.setItem = () => { throw Error('storage unavailable'); };
  await assert.rejects(api.activate(o.run, o.input.nonce), /storage unavailable/);
  assert.equal(o.calls.length, 0);
  o.local.setItem = set;
  const run = await api.activate(o.run, o.input.nonce);
  run.turns.push({ turn: 1, prizeId: null }); await api.queue(run);
  assert.throws(() => api.queue({ ...run, turns: [{ turn: 1, prizeId: 'butter' }] }), /cannot change/);
  assert.throws(() => api.queue({ ...run, turns: [1, 2, 3, 4].map(turn => ({ turn, prizeId: null })) }), /three ordered/);
  assert.throws(() => api.queue({ ...run, turns: [{ turn: 2, prizeId: null }] }), /three ordered/);
  assert.equal(o.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 1);
});

test('official lost activation reload interrupts instead of retrying activation', async t => {
  const o = await outbox(t), api = o.client(); o.lose = '/activate';
  await assert.rejects(api.activate(o.run, o.input.nonce));
  const reloaded = o.client(); o.offline = true; await reloaded.initialize();
  assert.throws(() => reloaded.acknowledge(o.run.id), /Interruption must sync/);
  o.offline = false; const start = o.calls.length; await reloaded.flush();
  assert.deepEqual(o.calls.slice(start).map(url => url.split('/').at(-1)), ['session', 'interrupt']);
  await assert.rejects(reloaded.activate(o.run, o.input.nonce), /cannot restart/);
  assert.equal((await o.c.request('/api/official/session')).data.status, 'interrupted');
});

test('official storage exhaustion preserves completed turns for same-page recovery', async t => {
  const o = await outbox(t), api = o.client(), run = await api.activate(o.run, o.input.nonce), set = o.local.setItem;
  o.local.setItem = () => { throw Error('quota exceeded'); }; o.offline = true;
  run.turns = [1, 2, 3].map(turn => ({ turn, prizeId: null })); await api.queue(run);
  assert.equal(api.state().attempts[0].pending, 3); assert.ok(api.state().error);
  o.local.setItem = set; o.offline = false; await api.flush();
  assert.equal(o.notices.find(n => n.saved)?.saved.total, 0);
  assert.equal(o.local.length, 0);
});

test('delayed official acknowledgement cannot overwrite turns queued by the live page', async t => {
  const o = await outbox(t), a = o.client(), run = await a.activate(o.run, o.input.nonce);
  o.offline = true; run.turns.push({ turn: 1, prizeId: null }); await a.queue(run); o.offline = false;
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  o.afterResponse = async url => {
    if (!url.endsWith('/turns')) return;
    o.afterResponse = async () => {}; started(); await new Promise(resolve => { release = resolve; });
  };
  const pending = o.client(storage()).flush(); await began;
  o.offline = true; run.turns.push({ turn: 2, prizeId: 'butter' }, { turn: 3, prizeId: null }); await a.queue(run);
  o.offline = false; release(); await pending;
  assert.equal(o.local.length, 0);
  assert.equal(o.notices.find(n => n.saved)?.saved.total, 100);
  assert.equal(o.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 3);
});

// Admission must persist before ticket consumption; domain/outbox tests cannot
// detect identifier replacement or browser storage failures at this boundary.
async function admission(t) {
  const { createOfficialAdmission } = await import('../src/official-admission.js');
  const f = await fixture(t), s = await f.setup(), issued = await s.ticket(), local = storage(), calls = [];
  let lose = false, afterResponse = () => {}, c = s.staff;
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    const r = await c.request(url, options.body ? JSON.parse(options.body) : undefined, { saveCookies: !lose });
    afterResponse();
    if (lose) { lose = false; throw Error('lost response'); }
    return Response.json(r.data, { status: r.status });
  };
  return { f, s, issued, local, calls, fetcher, client: () => createOfficialAdmission({ storage: local, fetcher }),
    set lose(value) { lose = value; }, set afterResponse(value) { afterResponse = value; }, set transport(value) { c = value; } };
}

test('admission refuses unavailable or silent storage before consuming a ticket', async t => {
  const a = await admission(t), api = a.client(), set = a.local.setItem;
  for (const refusing of [() => { throw Error('quota'); }, () => {}]) {
    a.local.setItem = refusing;
    await assert.rejects(api.prepare(a.issued.code));
    assert.equal(a.calls.length, 0);
  }
  a.local.setItem = set;
  const intent = await api.prepare(a.issued.code);
  a.local.setItem = () => { throw Error('quota'); };
  await assert.rejects(api.redeem(intent.requestKey, a.issued.code));
  assert.equal(a.calls.length, 0);
  assert.equal(a.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 0);
  a.local.setItem = set;
  const result = await api.redeem(intent.requestKey, a.issued.code);
  assert.equal(result.receipt.status, 'accepted');
  assert.equal(result.recoveryRequired, false);
});

test('lost redemption response reload reuses durable identifiers and capability without activation', async t => {
  const a = await admission(t), api = a.client(), intent = await api.prepare(a.issued.code);
  a.lose = true;
  await assert.rejects(api.redeem(intent.requestKey, a.issued.code), /response unavailable/);
  assert.throws(() => api.discard(intent.requestKey), /must be retained/);
  assert.equal(a.s.staff.jar.has('cc_official'), false);
  await a.f.restart();
  const reloaded = a.client(), before = a.calls.length;
  assert.deepEqual(reloaded.list().map(x => x.requestKey), [intent.requestKey]);
  assert.equal(reloaded.read(intent.requestKey).recoveryRequired, true);
  assert.equal(a.calls.length, before);
  const recovered = await reloaded.redeem(intent.requestKey, a.issued.code);
  assert.equal(recovered.recoveryRequired, true);
  assert.equal(recovered.nonce, intent.nonce);
  const capability = a.s.staff.jar.get('cc_official');
  assert.ok(capability);
  const retried = await reloaded.redeem(intent.requestKey, a.issued.code);
  assert.deepEqual(retried, recovered);
  assert.equal(a.s.staff.jar.get('cc_official'), capability);
  assert.equal(a.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
  assert.equal(a.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 0);
  assert.ok(a.calls.every(x => x.url === '/api/official/redeem' && x.credentials === 'same-origin'));
  assert.ok(a.calls.every(x => x.body === a.calls[0].body));
  const stored = Array.from({ length: a.local.length }, (_, i) => a.local.getItem(a.local.key(i))).join('');
  assert.equal(stored.includes(a.issued.code), false);
  assert.equal(stored.includes(capability), false);
});

test('receipt persistence failure retains replay identity and recovery works with a changed ticket case', async t => {
  const a = await admission(t), api = a.client(), intent = await api.prepare(a.issued.code), set = a.local.setItem;
  a.afterResponse = () => { a.local.setItem = () => { throw Error('quota'); }; };
  await assert.rejects(api.redeem(intent.requestKey, a.issued.code), /quota/);
  assert.equal(api.read(intent.requestKey).receipt, null);
  a.local.setItem = set; a.afterResponse = () => {};
  const recovered = await a.client().redeem(intent.requestKey, 'T-' + a.issued.code.slice(2).toLowerCase());
  assert.equal(recovered.receipt.status, 'accepted');
  assert.equal(recovered.recoveryRequired, true);
  assert.equal(a.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
});

test('distinct admission intents bind tickets and retain unrelated outboxes during terminal cleanup', async t => {
  const a = await admission(t), api = a.client(), second = await a.s.ticket();
  const one = await api.prepare(a.issued.code), two = await api.prepare(second.code);
  assert.notEqual(one.requestKey, two.requestKey); assert.notEqual(one.nonce, two.nonce);
  assert.notEqual(one.requestKey, one.nonce);
  await assert.rejects(api.redeem(one.requestKey, second.code), /original ticket/);
  assert.equal(a.calls.length, 0);
  const result = await api.redeem(one.requestKey, a.issued.code);
  const outbox = createOfficialSessionApi({ storage: a.local, tabStorage: storage(), fetcher: a.fetcher });
  const active = await outbox.activate(result.receipt, result.nonce);
  await assert.rejects(api.acknowledge(one.requestKey), /terminal/);
  a.local.setItem('cloud-claw:pending:v2:other', 'legacy');
  await outbox.queue({ ...active, turns: [1, 2, 3].map(turn => ({ turn, prizeId: null })) });
  await api.acknowledge(one.requestKey);
  assert.equal(a.local.getItem('cloud-claw:pending:v2:other'), 'legacy');
  assert.equal(api.read(two.requestKey).submitted, false);
  api.discard(two.requestKey);
  assert.equal(api.list().length, 0);
  assert.equal(a.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 3);
});

test('server rejection retains admission identifiers and never falls back to staff or legacy scoring', async t => {
  const a = await admission(t), api = a.client(), intent = await api.prepare(a.issued.code);
  a.transport = a.f.client();
  await assert.rejects(api.redeem(intent.requestKey, a.issued.code), { status: 401 });
  assert.equal(api.read(intent.requestKey).nonce, intent.nonce);
  a.transport = a.s.staff;
  await a.f.restart({ officialAdmissionsEnabled: false });
  await assert.rejects(api.redeem(intent.requestKey, a.issued.code), { status: 503 });
  assert.equal(a.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 0);
  await a.f.restart();
  const result = await api.redeem(intent.requestKey, a.issued.code);
  const duplicate = await api.prepare(a.issued.code);
  await assert.rejects(api.redeem(duplicate.requestKey, a.issued.code), { status: 409 });
  const other = await a.s.admit();
  assert.notEqual(other.run.id, result.receipt.id);
  await assert.rejects(api.acknowledge(intent.requestKey), /terminal/);
  assert.equal(api.read(intent.requestKey).receipt.id, result.receipt.id);
  assert.ok(a.calls.every(x => ['/api/official/redeem', '/api/official/session'].includes(x.url)));
  assert.equal(a.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
});

// This boundary adds coordinator lifecycle, not another scoring implementation.
// Real HTTP catches cookie mixups, result scope and dual-logout ordering.
async function player(t) {
  const { createOfficialPlayer } = await import('../src/official-player.js');
  const a = await admission(t), tabStorage = storage();
  const client = () => createOfficialPlayer({ storage: a.local, tabStorage, fetcher: a.fetcher });
  const flow = client(); await flow.initialize();
  return { ...a, a, tabStorage, client, flow };
}
test('official player explicitly activates once and confirms exactly three server turns before dual logout', async t => {
  const p = await player(t), { flow } = p;
  await flow.redeem(p.issued.code);
  assert.equal(flow.state().canActivate, true);
  assert.equal(p.calls.some(c => c.url.endsWith('/activate')), false);
  const run = await flow.activate();
  await assert.rejects(flow.activate(), /cannot restart/);
  await assert.rejects(flow.handoff(), /Resolve retained/);
  await flow.queue({ ...run, turns: [1, 2, 3].map(turn => ({ turn, prizeId: 'butter', remainingMs: 0, score: 9999 })), total: 99999 });
  assert.equal(flow.state().result.attempt.id, run.id);
  assert.notEqual(flow.state().result.attempt.total, 99999);
  assert.equal(flow.state().result.attempt.turns.length, 3);
  assert.equal(flow.state().result.best.rank, 1);
  const cookie = p.s.staff.jar.get('cc_official');
  await assert.rejects(flow.redeem((await p.s.ticket()).code), /Finish this attempt/);
  await flow.handoff();
  assert.equal(p.s.staff.jar.has('cc_official'), false);
  assert.equal(p.s.staff.jar.has('cc_session'), false);
  assert.equal((await p.f.client({ cc_official: cookie }).request('/api/official/session')).status, 401);
  assert.equal(p.local.length, 0);
  assert.equal(p.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
});
test('player loss and reload retain admission identity, never auto activate, and storage failure prevents consumption', async t => {
  const p = await player(t), set = p.tabStorage.setItem;
  p.tabStorage.setItem = () => {};
  await assert.rejects(p.flow.redeem(p.issued.code), /storage unavailable/);
  assert.equal(p.calls.length, 0);
  p.tabStorage.setItem = set;
  p.a.lose = true;
  await assert.rejects(p.flow.redeem(p.issued.code), /response unavailable/);
  const intent = p.flow.state().intent;
  const reloaded = p.client(); await reloaded.initialize();
  await reloaded.redeem(p.issued.code);
  assert.equal(reloaded.state().intent.requestKey, intent.requestKey);
  assert.equal(reloaded.state().intent.nonce, intent.nonce);
  assert.equal(reloaded.state().canActivate, false);
  await assert.rejects(reloaded.activate(), /cannot restart/);
  assert.equal(p.calls.filter(c => c.url.endsWith('/activate')).length, 0);
  assert.equal(p.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
});
test('reloaded official player drains saved turns before interruption and cannot restart or hand off unresolved data', async t => {
  const p = await player(t); await p.flow.redeem(p.issued.code); const run = await p.flow.activate();
  p.a.transport = { request: async () => { throw Error('offline'); } };
  await p.flow.queue({ ...run, turns: [{ turn: 1, prizeId: null }] });
  p.a.transport = p.s.staff;
  const before = p.calls.length, reloaded = p.client(); await reloaded.initialize();
  const writes = p.calls.slice(before).filter(c => c.method === 'POST').map(c => c.url.split('/').at(-1));
  assert.deepEqual(writes, ['turns', 'interrupt']);
  const saved = await p.s.staff.request(`/api/official/runs/${run.id}`);
  assert.equal(saved.data.status, 'interrupted'); assert.equal(saved.data.turns.length, 1);
  await assert.rejects(reloaded.activate(), /cannot restart/);
  await assert.rejects(reloaded.handoff(), /Resolve retained/);
  assert.ok(p.local.length > 0);
});
test('wrong official cookie blocks player flow without posting to another attempt or clearing retained turns', async t => {
  const p = await player(t); await p.flow.redeem(p.issued.code); const run = await p.flow.activate();
  const other = await p.s.admit(); assert.notEqual(other.run.id, run.id);
  const before = p.calls.length;
  await p.flow.refresh();
  assert.equal(p.flow.state().blocked, true);
  assert.ok(p.calls.slice(before).every(c => c.method !== 'POST'));
  assert.throws(() => p.flow.queue({ ...run, turns: [{ turn: 1, prizeId: null }] }), /no longer playable/);
  assert.ok(p.local.length > 0);
});
test('acknowledged result recovers after reload and handoff retries a lost logout response', async t => {
  const p = await player(t); await p.flow.redeem(p.issued.code); const run = await p.flow.activate();
  await p.flow.queue({ ...run, turns: [1, 2, 3].map(turn => ({ turn, prizeId: null })) });
  const recovered = p.client(); await recovered.initialize();
  assert.equal(recovered.state().result.attempt.id, run.id);
  assert.equal(recovered.state().canActivate, false);
  const original = p.s.staff.request.bind(p.s.staff); let lost = true;
  p.a.transport = { request: async (path, ...args) => {
    const response = await original(path, ...args);
    if (path === '/api/official/logout' && lost) { lost = false; throw Error('lost logout response'); }
    return response;
  } };
  await assert.rejects(recovered.handoff(), /unavailable/);
  const signingOut = p.client(); await signingOut.initialize();
  assert.equal(signingOut.state().handingOff, true);
  await assert.rejects(signingOut.redeem(p.issued.code), /Finish this attempt/);
  await signingOut.handoff();
  assert.equal(p.s.staff.jar.has('cc_session'), false);
});

test('player storage denial prevents admission and server-confirmed expiry permits explicit handoff', async t => {
  const p = await player(t), get = p.tabStorage.getItem;
  p.tabStorage.getItem = () => { throw Error('denied'); };
  const denied = p.client(); await denied.initialize();
  assert.equal(denied.state().ready, false);
  assert.match(denied.state().error, /storage unavailable/);
  await assert.rejects(denied.redeem(p.issued.code), /Please wait/);
  assert.equal(p.calls.length, 0);
  p.tabStorage.getItem = get;
  await p.flow.redeem(p.issued.code); await p.flow.activate();
  p.f.app.database.db.prepare("UPDATE official_events SET state='closed',closed_at=? WHERE id=?").run(Date.now() - CLOSE_GRACE_MS, p.s.eventId);
  await p.flow.refresh();
  assert.equal(p.flow.state().blocked, true);
  assert.match(p.flow.state().error, /expired/);
  await p.flow.handoff();
  assert.equal(p.local.length, 0);
  assert.equal(p.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_turns').get().n, 0);
});

// Host controller boundary: real HTTP + storage, including secrets returned
// only once. Domain tests alone cannot catch replacement client request keys.
async function hostTickets(t) {
  const { createHostTicketApi } = await import('../src/host-tickets.js');
  const f = await fixture(t), s = await f.setup(), local = storage(), calls = [];
  let lose = '', transport = s.host;
  const fetcher = async (url, options) => {
    calls.push({ url, body: options.body });
    const response = await transport.request(url, options.body ? JSON.parse(options.body) : undefined);
    if (lose && url.endsWith(lose)) { lose = ''; throw Error('lost'); }
    return Response.json(response.data, { status: response.status });
  };
  const client = () => createHostTicketApi({ storage: local, fetcher });
  const api = client(); await api.open(s.eventId);
  return { f, s, local, calls, api, client, set lose(value) { lose = value; }, set transport(value) { transport = value; } };
}
test('host participant response loss reload retries one durable identity; equal names stay distinct', async t => {
  const h = await hostTickets(t); h.lose = '/participants';
  await h.api.create('Same name'); assert.equal(h.api.state().pending, true);
  const reloaded = h.client(); await reloaded.open(h.s.eventId); await reloaded.retry();
  const first = reloaded.state().participantId;
  await reloaded.create('Same name'); const second = reloaded.state().participantId;
  assert.notEqual(first, second);
  await reloaded.select(first); await reloaded.issue();
  assert.equal(reloaded.state().ticket.participantId, first);
  await reloaded.issue(); assert.equal(reloaded.state().tickets.length, 2, 'explicit extra attempt retains selected identity');
  assert.equal(h.f.app.database.db.prepare("SELECT COUNT(*) AS n FROM official_participants WHERE name='Same name'").get().n, 2);
  const posts = h.calls.filter(row => row.url.endsWith('/participants'));
  assert.equal(posts[0].body, posts[1].body);
});
test('host storage refusal prevents consuming writes, including silently dropped intent', async t => {
  const h = await hostTickets(t), set = h.local.setItem;
  for (const refusal of [() => { throw Error('quota'); }, () => {}]) {
    h.local.setItem = refusal;
    await h.api.create('Refused');
    assert.equal(h.calls.filter(row => row.body).length, 0);
    h.local.setItem = set; await h.api.open(h.s.eventId);
  }
});
test('lost ticket and reissue responses recover IDs, never duplicate grants or recover redeemed tickets', async t => {
  const h = await hostTickets(t); await h.api.select(h.s.participant.participantId);
  h.lose = '/tickets'; await h.api.issue();
  const reloaded = h.client(); await reloaded.open(h.s.eventId); await reloaded.retry();
  const first = reloaded.state().ticket.ticketId;
  assert.equal(reloaded.state().code, ''); assert.match(reloaded.state().message, /not returned again/);
  assert.equal(h.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 1);
  h.lose = '/reissue'; await reloaded.reissue();
  const again = h.client(); await again.open(h.s.eventId); await again.retry();
  const second = again.state().ticket.ticketId;
  assert.notEqual(first, second); assert.equal(again.state().code, '');
  assert.equal(h.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 2);
  await again.reissue(); const code = again.state().code, ticket = again.state().ticket;
  assert.match(code, /^T-/);
  const records = Array.from({ length: h.local.length }, (_, i) => h.local.getItem(h.local.key(i))).join('');
  assert.equal(records.includes(code), false);
  assert.ok(h.calls.every(row => !row.url.includes(code)));
  assert.equal((await h.s.staff.request('/api/official/redeem', { code, requestKey: key(), nonce: key() })).status, 200);
  await again.reissue(); assert.match(again.state().message, /does not recover a redeemed/);
  assert.equal(again.state().code, ''); assert.equal(again.state().pending, false, 'confirmed rejection retained without blocking a new explicit action');
  assert.equal(h.f.app.database.db.prepare('SELECT state FROM official_tickets WHERE id=?').get(ticket.ticketId).state, 'redeemed');
  assert.equal(h.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 3);
});
test('host console refresh confirms closure, expiry and auth loss before further ticket writes', async t => {
  const h = await hostTickets(t); await h.api.select(h.s.participant.participantId);
  await h.api.issue(); assert.ok(h.api.state().code);
  h.transport = h.s.staff;
  await h.api.open(h.s.eventId); assert.equal(h.api.state().canMutate, false); assert.equal(h.api.state().code, '');
  assert.match(h.api.state().message, /Host access expired/);
  h.transport = h.s.host; await h.api.open(h.s.eventId);
  await h.s.host.request(`/api/host/events/${h.s.eventId}/state`, { state: 'closed', requestKey: key() });
  await h.api.issue(); assert.equal(h.api.state().canMutate, false); assert.match(h.api.state().message, /Event is closed/);
  assert.equal(h.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 1);
  h.f.app.database.db.prepare('UPDATE official_events SET retain_until=0').run();
  await h.api.open(h.s.eventId); assert.equal(h.api.state().canMutate, false); assert.match(h.api.state().message, /expired/);
});
test('host receipt storage failure withholds the secret and preserves the consuming request key', async t => {
  const h = await hostTickets(t); await h.api.select(h.s.participant.participantId);
  const set = h.local.setItem;
  h.local.setItem = (key, value) => {
    if (JSON.parse(value).operations.some(row => row.receipt?.ticketId)) throw Error('quota after response');
    set(key, value);
  };
  await h.api.issue(); assert.equal(h.api.state().pending, true); assert.equal(h.api.state().code, '');
  h.local.setItem = set;
  const next = h.client(); await next.open(h.s.eventId); await next.retry();
  assert.equal(next.state().code, ''); assert.ok(next.state().ticket.ticketId);
  assert.equal(h.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_tickets').get().n, 1);
  const posts = h.calls.filter(row => row.url.endsWith('/tickets'));
  assert.equal(posts[0].body, posts[1].body);
});

const publicPath = (id, operation = 'session') => `/api/official/public/runs/${id}/${operation}`;
const admissionInput = ticket => ({ code: ticket.code, requestKey: key(), nonce: key() });
async function publicFixture(t) {
  const f = await fixture(t, { publicTryEnabled: true }), s = await f.setup(), c = f.client();
  return { f, s, c, async admit() {
    const input = admissionInput(await s.ticket());
    const response = await c.request('/api/official/public/redeem', input);
    assert.equal(response.status, 200, response.text); return { input, run: response.data, response };
  } };
}
async function completePublic(c, run, input) {
  assert.equal((await c.request(publicPath(run.id, 'activate'), { nonce: input.nonce })).status, 200);
  for (const turn of [1, 2, 3]) assert.equal((await c.request(publicPath(run.id, 'turns'), { turn, prizeId: null })).status, 200);
}
function applyCookies(c, response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [name, value] = cookie.split(';')[0].split('=');
    if (value) c.jar.set(name, value); else c.jar.delete(name);
  }
}
test('public admission is anonymous, exact-run scoped, non-overwriting and retires against delayed replay across restart', async t => {
  const p = await publicFixture(t), { f, s, c } = p;
  const before = f.app.database.db.prepare('SELECT COUNT(*) AS n FROM owners').get().n;
  const a = await p.admit(), name = `cc_official_${a.run.id}`;
  assert.match(a.response.headers.getSetCookie()[0], /Path=\/api\/official; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  assert.deepEqual([...c.jar.keys()], [name]);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM owners').get().n, before);
  assert.equal((await c.request('/api/session')).status, 401);
  assert.equal((await c.request('/api/host/events', { name: 'forged', requestKey: key() })).status, 401);
  assert.equal((await c.request('/api/official/session')).status, 401);
  assert.equal((await c.request(publicPath(key()))).status, 401);
  const bInput = admissionInput(await s.ticket());
  assert.equal((await c.request('/api/official/public/redeem', bInput)).status, 409);
  const delayedRedeem = await c.request('/api/official/public/redeem', a.input, { saveCookies: false });
  assert.equal(delayedRedeem.status, 200);
  await completePublic(c, a.run, a.input);
  assert.equal((await c.request(publicPath(a.run.id, 'logout'), { nonce: key() })).status, 409);
  const delayedLogout = await c.request(publicPath(a.run.id, 'logout'), { nonce: a.input.nonce }, { saveCookies: false });
  assert.equal(delayedLogout.status, 200);
  await f.restart();
  assert.equal((await c.request('/api/official/public/redeem', a.input)).status, 409, 'retirement survives process restart');
  const b = await c.request('/api/official/public/redeem', bInput); assert.equal(b.status, 200);
  const bCookie = c.jar.get(`cc_official_${b.data.id}`);
  applyCookies(c, delayedRedeem); applyCookies(c, delayedLogout);
  assert.equal(c.jar.get(`cc_official_${b.data.id}`), bCookie, 'late A responses cannot change B');
  assert.equal((await c.request(publicPath(a.run.id, 'logout'), { nonce: a.input.nonce })).status, 401);
  assert.equal((await c.request(publicPath(b.data.id))).data.id, b.data.id);
  assert.equal((await c.request('/api/official/public/redeem', a.input)).status, 409);
});
test('public admission validates fields, proves never-admitted rejection, preserves exact paused retry and budgets immediate peers', async t => {
  const p = await publicFixture(t), { f, c } = p, input = admissionInput(await p.s.ticket());
  assert.equal((await c.request('/api/official/public/redeem', { ...input, ownerId: 'forged' })).status, 400);
  assert.equal((await c.request('/api/official/public/redeem', input, { headers: { origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await c.request('/api/official/public/redeem', input, { headers: { 'content-type': 'text/plain' } })).status, 415);
  const invalid = admissionInput({ code: 'T-' + '0'.repeat(32) });
  const rejected = await c.request('/api/official/public/redeem', invalid);
  assert.equal(rejected.data.neverAdmitted, true); assert.equal(rejected.data.requestKey, invalid.requestKey);
  const accepted = await c.request('/api/official/public/redeem', input, { saveCookies: false }); assert.equal(accepted.status, 200);
  const fresh = admissionInput(await p.s.ticket());
  await f.restart({ officialAdmissionsEnabled: false });
  const retry = await c.request('/api/official/public/redeem', input); assert.equal(retry.data.id, accepted.data.id);
  assert.equal((await f.client().request('/api/official/public/redeem', fresh)).status, 503);
  await completePublic(c, retry.data, input);
  assert.equal((await c.request(publicPath(retry.data.id))).data.status, 'complete');
});
test('public admission budgets malformed traffic before parsing and ignores spoofed forwarding', async t => {
  const f = await fixture(t, { publicTryEnabled: true }), c = f.client();
  for (let i = 0; i < 60; i++) {
    const r = await c.request('/api/official/public/redeem', {}, { headers: { 'x-real-ip': `192.0.2.${i + 1}`, 'x-forwarded-for': `198.51.100.${i + 1}` } });
    assert.equal(r.status, 400);
  }
  assert.equal((await c.request('/api/official/public/redeem', {})).status, 429);
  assert.equal(f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_run_sessions').get().n, 0);
});
function webLocks() {
  let tail = Promise.resolve();
  return { request(_name, action) { const next = tail.then(action); tail = next.catch(() => {}); return next; } };
}
async function publicPlayer(t) {
  const p = await publicFixture(t), { createOfficialPlayer } = await import('../src/official-player.js');
  const local = storage(), locks = webLocks(), tab = storage(); let hook = async () => {};
  const fetcher = async (path, options = {}) => {
    const response = await p.c.request(path, options.body ? JSON.parse(options.body) : undefined);
    await hook(path, response);
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  };
  const client = (tabStorage = tab, overrides = {}) => createOfficialPlayer({ storage: local, tabStorage, fetcher, publicScope: true, locks, ...overrides });
  const flow = client(); await flow.initialize();
  return { ...p, local, tab, client, flow, set hook(value) { hook = value; } };
}
test('public two-tab transitions block unresolved admission; never-admitted proof frees only rejected intent', async t => {
  const p = await publicPlayer(t), b = p.client(storage()); await b.initialize();
  await assert.rejects(p.flow.redeem('T-' + '0'.repeat(32)), /unavailable/);
  assert.equal(p.local.length, 0);
  const aTicket = await p.s.ticket(), bTicket = await p.s.ticket();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  p.hook = async path => { if (path.endsWith('/redeem')) { entered(); await paused; } };
  const aPending = p.flow.redeem(aTicket.code); await started;
  const bPending = b.redeem(bTicket.code); release();
  await aPending; await assert.rejects(bPending, /Another attempt/);
  assert.equal(p.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
  const noLocks = p.client(storage(), { locks: null }); await noLocks.initialize();
  assert.equal(noLocks.state().ready, false);
});
test('public void handoff is server-confirmed, origin-shared, retryable after logout loss and preserves staff auth', async t => {
  const p = await publicPlayer(t), ticket = await p.s.ticket();
  await p.flow.redeem(ticket.code); const run = await p.flow.activate();
  await assert.rejects(p.flow.handoff(), /Resolve retained/);
  const replacement = await p.s.host.request(`/api/host/event-runs/${run.id}/recover`, { reason: 'camera_failure', requestKey: key() });
  assert.equal(replacement.status, 200, replacement.text);
  await p.flow.refresh(); assert.equal(p.flow.state().canHandoff, true);
  // Unrelated legacy storage and staff authority are not public-handoff scope.
  p.local.setItem('unrelated-history', 'keep');
  const staffToken = p.s.staff.jar.get('cc_session'); p.c.jar.set('cc_session', staffToken);
  let lost = true;
  p.hook = async path => { if (path.endsWith('/logout') && lost) { lost = false; throw Error('lost'); } };
  await assert.rejects(p.flow.handoff(), /unavailable/);
  assert.ok(p.local.getItem('cloud-claw:official-player:v1:handoff'));
  const b = p.client(storage()); await b.initialize();
  await assert.rejects(b.redeem(replacement.data.code), /Finish this attempt/);
  await b.handoff();
  assert.equal(p.local.getItem('cloud-claw:official-player:v1:handoff'), null);
  assert.equal(p.local.getItem('unrelated-history'), 'keep');
  assert.equal(p.c.jar.get('cc_session'), staffToken);
  assert.equal((await p.c.request('/api/session')).status, 200);
  const fresh = p.client(storage()); await fresh.initialize();
  await fresh.redeem(replacement.data.code); assert.equal(fresh.state().canActivate, true);
});
test('public lost admission response survives restart without new owner, nonce or activation', async t => {
  const p = await publicPlayer(t), ticket = await p.s.ticket(); let lost = true;
  p.hook = async path => { if (path.endsWith('/redeem') && lost) { lost = false; throw Error('lost'); } };
  await assert.rejects(p.flow.redeem(ticket.code), /response unavailable/);
  const intent = p.flow.state().intent;
  await p.f.restart();
  const recovered = p.client(); await recovered.initialize(); await recovered.redeem(ticket.code);
  assert.equal(recovered.state().intent.nonce, intent.nonce);
  assert.equal(recovered.state().intent.requestKey, intent.requestKey);
  assert.equal(recovered.state().canActivate, false);
  const thief = p.f.client();
  assert.equal((await thief.request('/api/official/public/redeem', { code: ticket.code, requestKey: key(), nonce: key() })).status, 409);
  assert.equal(p.f.app.database.db.prepare('SELECT COUNT(*) AS n FROM official_runs').get().n, 1);
  assert.equal(p.f.app.database.db.prepare('SELECT state FROM official_runs').get().state, 'accepted');
});
test('public terminal cleanup detects silent storage refusal and handoff holds admission lock through logout', async t => {
  const p = await publicPlayer(t); await p.flow.redeem((await p.s.ticket()).code); const run = await p.flow.activate();
  await p.flow.queue({ ...run, turns: [1, 2, 3].map(turn => ({ turn, prizeId: null })) });
  const remove = p.local.removeItem;
  p.local.removeItem = name => { if (!name.startsWith('cloud-claw:admission:')) remove(name); };
  await assert.rejects(p.flow.handoff(), /storage unavailable/);
  assert.ok(p.local.getItem('cloud-claw:official-player:v1:handoff'));
  assert.equal((await p.c.request(publicPath(run.id))).status, 200, 'cookie is not revoked before durable cleanup');
  p.local.removeItem = remove;
  const second = await p.s.ticket(), b = p.client(storage()); await b.initialize();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; }), pause = new Promise(resolve => { release = resolve; });
  p.hook = async path => { if (path.endsWith('/logout')) { entered(); await pause; } };
  const aEnding = p.flow.handoff(); await started;
  const bStarting = b.redeem(second.code); release(); await aEnding; await bStarting;
  assert.equal(b.state().intent.receipt.status, 'accepted');
  assert.notEqual(b.state().intent.receipt.id, run.id);
  assert.equal((await p.c.request(publicPath(b.state().intent.receipt.id))).status, 200);
});
