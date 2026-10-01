// This page deliberately loads no game, camera, telemetry or score client.
export function hostSetupPage(authenticated) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080e1c"><title>Host setup · Cloud Claw</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#080e1c;color:#edf3ff;font:17px/1.6 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:48px 24px}header{color:#ffba60;font-size:13px;letter-spacing:.08em}h1{font-size:38px;line-height:1.2;margin:28px 0 16px}h2{font-size:24px;margin:0 0 8px}p{margin:12px 0;color:#b9c8dd}section{border:1px solid #334b6b;background:#101c2e;border-radius:20px;padding:24px;margin:24px 0}label{display:block}input,select,button,.primary{font:inherit;border-radius:12px;padding:14px 18px;width:100%;margin-top:12px}input,select{background:#080e1c;color:inherit;border:1px solid #6d83a1}button,.primary{cursor:pointer;background:#ffba60;color:#111827;border:0;font-weight:700}button:disabled{cursor:wait;opacity:.65}a{color:#68d4fa}a.primary{display:block;text-align:center;text-decoration:none}small{color:#b9c8dd}#message{color:#ffba60;min-height:1.6em}#station-status{color:#edf3ff}footer{display:flex;justify-content:space-between;gap:16px}footer button{width:auto;margin:0;padding:0;background:transparent;color:#b9c8dd;font-size:14px;font-weight:400}.schedule{display:grid;grid-template-columns:1fr 1fr;gap:12px}.schedule input{min-width:0}#event-counts{font-weight:700;color:#edf3ff}#event-export{display:inline-block;margin-top:12px}@media(max-width:520px){.schedule{grid-template-columns:1fr}main{padding:28px 18px}section{padding:20px}}details{margin-top:24px;font-size:13px;color:#b9c8dd}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #68d4fa;outline-offset:4px}[hidden]{display:none!important}
</style></head><body><main>
<header>CODERPUSH × AWS · CLOUD CLAW</header><h1>Host setup</h1>
<form id="login"${authenticated ? ' hidden' : ''}><p>Sign in once to set up this computer for the event.</p><label for="code">Host code</label><input id="code" type="password" autocomplete="current-password" maxlength="128" required><button id="sign-in">Sign in</button></form>
<div id="setup"${authenticated ? '' : ' hidden'}>
<section><h2>Event browser</h2><label for="event-select">Choose an event</label><select id="event-select" disabled></select><p id="event-schedule"></p><p id="station-status" role="status">Checking this browser…</p><button id="status-retry" hidden>Retry</button><button id="station-enroll" disabled>Use this computer</button><button id="event-refresh">Refresh status and counts</button><p><small>Enrollment replaces the previous event computer. Every completed play stays on the public leaderboard. Event reports include only starts accepted on the enrolled browser during the schedule.</small></p><p id="event-counts"></p><a id="event-export" download="cloud-claw-event-results.json" hidden>Download event results (JSON)</a></section>
<section><h2>Prepare the next event</h2><form id="event-create"><label for="event-name">Event name</label><input id="event-name" maxlength="60" required placeholder="Cloud & AI Day · Ho Chi Minh City"><div class="schedule"><label for="event-start">Starts<input id="event-start" type="datetime-local" required></label><label for="event-end">Ends<input id="event-end" type="datetime-local" required></label></div><p id="event-time-zone"><small></small></p><p><small>Schedules are fixed after creation. Preparing an event does not enroll this browser or change existing results.</small></p><button id="event-create-button">Create event</button></form><p id="event-create-status" role="status"></p></section>
<section><h2>Station checklist</h2><p>Use a laptop browser with the camera connected and the TV as its display. In the game, check framing, sound and fullscreen, then complete a three-turn trial before admitting players.</p><p><small>A TV streaming device is a candidate only after browser, camera and sustained responsiveness checks. An offline Android package is a separate setup.</small></p></section>
<section><h2>Booth follow-up</h2><p>Optional contact requests linked to completed scores. Use only for result and booth-invitation follow-up. No email or SMS is sent automatically.</p><a id="contacts-export" href="/api/host/contacts" download>Download contact requests (JSON)</a></section></div>
<p id="message" role="status" aria-live="polite"></p><a id="open-game" class="primary" href="/">Open game</a><p id="lock-note"${authenticated ? '' : ' hidden'}><small>Opening the game signs you out of host controls. Event setup stays on this browser.</small></p>
<details id="build-details" hidden><summary>Build details</summary><p id="build-info"></p></details>
<footer><a href="/privacy" target="_blank" rel="noopener">Privacy</a><button id="sign-out"${authenticated ? '' : ' hidden'}>Sign out</button></footer>
</main><script>
let signedIn = ${authenticated}, opening = false, signingIn = null, action = null;
let events = [], station = null, selectedId = null, pending = null, storageReady = true;
const draftKey = 'cloud-claw:public-event-draft:v1';
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localTime = value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16); };

const byId = id => document.getElementById(id);
function showAccess(value) {
  signedIn = value;
  byId('login').hidden = value;
  byId('build-details').hidden = true;
  for (const id of ['setup','lock-note','sign-out']) byId(id).hidden = !value;
}
async function request(path, data) {
  const response = await fetch(path, { cache:'no-store', signal:AbortSignal.timeout(8000), ...(data === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }) });
  if (response.status === 401) showAccess(false);
  const result = await response.json();
  if (!response.ok) { const error = Error(response.status === 401 && path !== '/api/host/sign-in' ? 'Host access expired. Sign in again.' : result.error || 'Could not complete that action. Try again.'); error.status = response.status; throw error; }
  return result;
}
function report(error) { byId('message').textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Could not connect. Check your connection and try again.' : error.message; }
function renderEvents() {
  const select = byId('event-select');
  select.replaceChildren(...events.map(event => { const option = document.createElement('option'); option.value = event.id; option.textContent = event.name + ' · ' + event.state; return option; }));
  if (!events.some(event => event.id === selectedId)) selectedId = station?.event?.id || events[0]?.id;
  select.value = selectedId || ''; select.disabled = Boolean(action || opening || !station);
  const event = events.find(event => event.id === selectedId);
  const enrolled = station?.enrolled && station.event.id === event?.id;
  const button = byId('station-enroll');
  button.hidden = !event || event.state === 'ended' || enrolled;
  button.disabled = !station || Boolean(action || opening);
  byId('event-refresh').disabled = Boolean(action || opening);
  byId('station-status').textContent = !station ? 'Browser status is unverified. Retry before enrolling.' : !event ? 'Create an event to prepare this computer.' : event.state === 'ended' ? 'This event has finished. Public play is still open.' : enrolled ? station.active ? 'Ready · plays on this browser count for the event now.' : 'Ready · event recording begins at the scheduled start.' : 'This browser is not enrolled for the selected event.';
  byId('event-schedule').textContent = event ? new Date(event.startsAt).toLocaleString([], {timeZone:event.timeZone,dateStyle:'medium',timeStyle:'short'}) + ' → ' + new Date(event.endsAt).toLocaleString([], {timeZone:event.timeZone,dateStyle:'medium',timeStyle:'short'}) + ' · ' + event.timeZone : '';
  byId('event-counts').textContent = event ? event.completedPlays + ' completed plays · ' + event.startedPlays + ' recorded starts' : '';
  const link = byId('event-export'); link.hidden = !event;
  if (event) link.href = '/api/host/public-events/' + encodeURIComponent(event.id) + '/export';
  for (const id of ['event-name','event-start','event-end']) byId(id).disabled = !storageReady || Boolean(pending || action || opening);
  byId('event-create-button').disabled = !storageReady || Boolean(action || opening);
  byId('event-create-button').textContent = pending ? 'Retry event creation' : 'Create event';
}
async function refresh() {
  // No optimistic enrollment: both status and the event list must be confirmed.
  const state = await request('/api/host/station');
  const list = await request('/api/host/public-events');
  station = state; events = list.events; renderEvents();
  try {
    const build = await request('/build-info.json');
    byId('build-info').textContent = 'BUILD ' + build.commit + (build.dirty ? ' · uncommitted changes' : '') + ' · ' + build.branch;
    byId('build-details').hidden = !signedIn;
  } catch { /* Setup does not depend on build metadata. */ }
}
async function loadSetup() {
  station = null; byId('status-retry').hidden = true; renderEvents(); byId('message').textContent = '';
  try { await refresh(); }
  catch(error) { report(error); byId('status-retry').hidden = !signedIn; }
}
async function perform(work) {
  if (action || opening || !signedIn) return;
  action = Promise.resolve().then(work); renderEvents();
  try { await action; } catch(error) { report(error); }
  finally { action = null; renderEvents(); }
}
async function lockHost() {
  try { await request('/api/logout', {}); }
  catch(error) { if (error.status !== 401) throw error; }
  showAccess(false);
}
byId('status-retry').addEventListener('click', () => perform(loadSetup));
byId('event-refresh').addEventListener('click', () => perform(loadSetup));
byId('login').addEventListener('submit', async event => {
  event.preventDefault(); if (opening || signingIn) return;
  byId('sign-in').disabled = true; byId('message').textContent = '';
  signingIn = (async () => {
    try { await request('/api/host/sign-in', { code:byId('code').value }); byId('code').value = ''; showAccess(true); await loadSetup(); }
    catch(error) { report(error); }
  })();
  try { await signingIn; }
  finally { signingIn = null; byId('sign-in').disabled = opening; }
});
byId('event-select').addEventListener('change', () => { selectedId = byId('event-select').value; renderEvents(); });
byId('station-enroll').addEventListener('click', () => perform(async () => {
  byId('message').textContent = '';
  await request('/api/host/station', { eventId:selectedId }); await loadSetup();
}));
byId('event-create').addEventListener('submit', event => {
  event.preventDefault();
  void perform(async () => {
    if (!pending) {
      const startsAt = new Date(byId('event-start').value), endsAt = new Date(byId('event-end').value);
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw Error('Choose an end after the start.');
      const draft = { name:byId('event-name').value.trim(), startsAt:startsAt.toISOString(), endsAt:endsAt.toISOString(), timeZone, requestKey:crypto.randomUUID() };
      const text = JSON.stringify(draft); sessionStorage.setItem(draftKey,text);
      if (sessionStorage.getItem(draftKey) !== text) throw Error('Browser storage unavailable. Event creation has not started.');
      pending = draft;
    }
    renderEvents();
    let created;
    try { created = await request('/api/host/public-events',pending); }
    catch(error) {
      if (error.status === 400) { sessionStorage.removeItem(draftKey); pending = null; }
      else byId('event-create-status').textContent = 'Creation is unconfirmed. Retry the original request; do not create a replacement.';
      throw error;
    }
    sessionStorage.removeItem(draftKey); pending = null; selectedId = created.id; byId('event-name').value = '';
    byId('event-create-status').textContent = 'Event created. Select Use this computer when this is the event station.';
    await loadSetup();
  });
});
byId('sign-out').addEventListener('click', async () => {
  if (opening) return; opening = true; byId('sign-out').disabled = true; renderEvents();
  try { if (signingIn) await signingIn; if (action) await action.catch(() => {}); await lockHost(); byId('message').textContent = 'Signed out. Event setup stays on this browser.'; }
  catch(error) { report(error); }
  finally { opening = false; byId('sign-out').disabled = false; renderEvents(); }
});
byId('open-game').addEventListener('click', async event => {
  event.preventDefault(); if (opening) return; opening = true; byId('sign-in').disabled = true; renderEvents();
  try { if (signingIn) await signingIn; if (action) await action.catch(() => {}); await lockHost(); location.assign('/'); }
  catch(error) { report(error); }
  finally { opening = false; byId('sign-in').disabled = false; renderEvents(); }
});
byId('event-time-zone').firstElementChild.textContent = 'Start and end use this computer’s local time: ' + timeZone + '.';
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); tomorrow.setHours(9,0,0,0);
byId('event-start').value = localTime(tomorrow); tomorrow.setHours(18,0,0,0); byId('event-end').value = localTime(tomorrow);
try {
  pending = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
  if (pending) {
    if (!pending.requestKey || !pending.startsAt || !pending.endsAt || !pending.timeZone || typeof pending.name !== 'string') throw Error('Invalid retained event draft.');
    byId('event-name').value = pending.name; byId('event-start').value = localTime(pending.startsAt); byId('event-end').value = localTime(pending.endsAt);
    byId('event-create-status').textContent = 'Unconfirmed creation retained. Retry uses its original schedule and request.';
  }
} catch { storageReady = false; byId('event-create-status').textContent = 'Event draft storage is unavailable. Recover this tab’s storage before creating another event.'; }
renderEvents();
if (signedIn) loadSetup();
</script></body></html>`;
}
