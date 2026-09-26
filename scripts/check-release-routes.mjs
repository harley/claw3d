// Only run inside check-release-container.sh's disposable production container.
// HTTP tests cover domain policy; this proves Docker defaults and overrides reach
// the real entrypoint, and that admission containment still drains accepted runs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

assert.equal(process.env.RAILWAY_DEPLOYMENT_ID, 'container-smoke');
assert.equal(process.env.PUBLIC_ORIGIN, 'https://example.invalid');
assert.equal(process.env.DATA_DIR, '/data');
const statePath = '/data/release-route-probe.json';
const mode = process.argv[2];
assert.ok(['seed', 'paused', 'private', 'events-off', 'diagnostics-off'].includes(mode));
function client(initial = []) {
  const jar = new Map(initial);
  return { jar, async request(path, data, expected = 200) {
    const response = await fetch(`http://127.0.0.1:4200${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { origin: 'https://example.invalid', 'content-type': 'application/json',
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, expected, `${mode}: ${path}`);
    for (const value of response.headers.getSetCookie()) {
      const [name, token] = value.split(';')[0].split('=');
      if (token) jar.set(name, token); else jar.delete(name);
    }
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text();
  } };
}

const visitor = client();
assert.match(await visitor.request('/staff'), /id="login"/);
for (const path of ['/build-info.json', '/api/session', '/api/board', '/api/host/export']) {
  await visitor.request(path, undefined, 401);
}
await visitor.request('/api/public/session', undefined, 404); // Collection has no GET route.
if (mode === 'diagnostics-off') {
  await visitor.request('/api/public/session', {}, 404);
  await visitor.request('/api/public/playtest', { events: [] }, 404);
} else {
  // A disposable session proves the API flag without storing observations.
  await visitor.request('/api/public/playtest', { events: [] }, 401);
  const diagnostics = await visitor.request('/api/public/session', {});
  assert.ok(Number.isFinite(Date.parse(diagnostics.expiresAt)));
}
if (mode === 'private') {
  assert.match(await visitor.request('/'), /id="login"/);
  await visitor.request('/try', undefined, 401);
  await visitor.request('/official', undefined, 401);
} else {
  for (const path of ['/', '/try']) {
    const html = await visitor.request(path);
    assert.match(html, /window\.__PUBLIC_TRY__=true/);
    assert.match(html, new RegExp(`window\\.__PUBLIC_DIAGNOSTICS__=${mode !== 'diagnostics-off'}`));
    assert.doesNotMatch(html, /id="login"/);
  }
  if (mode === 'events-off') await visitor.request('/official', undefined, 401);
  else {
    const official = await visitor.request('/official');
    assert.match(official, /window\.__PUBLIC_OFFICIAL__=true/);
    assert.match(official, /id="official-ticket-form"/);
    assert.doesNotMatch(official, /id="login"/);
  }
}

if (mode === 'seed') {
  const host = client(), staff = client();
  await staff.request('/api/login', { code: 'synthetic-staff-code' });
  await staff.request('/api/host/export', undefined, 403);
  await host.request('/api/login', { code: 'synthetic-staff-code' });
  await host.request('/api/host/login', { code: 'synthetic-host-code' });
  const event = await host.request('/api/host/events', { name: 'Container probe', requestKey: randomUUID() }, 201);
  await host.request(`/api/host/events/${event.eventId}/state`, { state: 'open', requestKey: randomUUID() });
  const participant = await host.request(`/api/host/events/${event.eventId}/participants`, { name: 'Synthetic', requestKey: randomUUID() });
  const ticketInput = { participantId: participant.participantId, requestKey: randomUUID() };
  const ticketPath = `/api/host/events/${event.eventId}/tickets`;
  const ticket = await host.request(ticketPath, ticketInput);
  const unused = await host.request(ticketPath, { ...ticketInput, requestKey: randomUUID() });
  const admission = { code: ticket.code, nonce: randomUUID(), requestKey: randomUUID() };
  const run = await visitor.request('/api/official/public/redeem', admission);
  const runPath = `/api/official/public/runs/${run.id}`;
  await visitor.request(`${runPath}/activate`, { nonce: admission.nonce });
  await visitor.request(`${runPath}/turns`, { turn: 1, prizeId: null });
  await writeFile(statePath, JSON.stringify({ runPath, admission, unused, ticketPath, ticketInput,
    hostCookies: [...host.jar], playerCookies: [...visitor.jar] }), { mode: 0o600 });
} else {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const player = client(state.playerCookies);
  if (mode === 'paused') {
    await visitor.request('/api/official/public/redeem', {
      code: state.unused.code, nonce: randomUUID(), requestKey: randomUUID(),
    }, 503);
    const host = client(state.hostCookies);
    await host.request(state.ticketPath, { ...state.ticketInput, requestKey: randomUUID() }, 503);
    assert.equal((await player.request('/api/official/public/redeem', state.admission)).id, state.runPath.split('/').at(-1));
    for (const turn of [2, 3]) await player.request(`${state.runPath}/turns`, { turn, prizeId: null });
  }
  if (mode === 'paused') {
    const result = await player.request(`${state.runPath}/session`);
    assert.equal(result.status, 'complete');
    assert.equal(result.turns.length, 3);
    assert.equal(result.total, 0);
  } else if (mode === 'diagnostics-off') {
    assert.equal((await player.request(`${state.runPath}/session`)).status, 'complete');
  } else if (mode === 'private' || mode === 'events-off') {
    await player.request(`${state.runPath}/session`, undefined, 404);
  }
}
console.log(`Production image ${mode} routes and access boundaries passed.`);
