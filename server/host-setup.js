// This page deliberately loads no game, camera, telemetry or score client.
export function hostSetupPage(authenticated) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080e1c"><title>Host setup · Cloud Claw</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#080e1c;color:#edf3ff;font:17px/1.6 system-ui,sans-serif}main{max-width:580px;margin:0 auto;padding:48px 24px}header{color:#ffba60;font-size:13px;letter-spacing:.08em}h1{font-size:38px;line-height:1.2;margin:28px 0 16px}h2{font-size:24px;margin:0 0 8px}p{margin:12px 0;color:#b9c8dd}section{border:1px solid #334b6b;background:#101c2e;border-radius:20px;padding:24px;margin:24px 0}label{display:block}input,button,.primary{font:inherit;border-radius:12px;padding:14px 18px;width:100%;margin-top:12px}input{background:#080e1c;color:inherit;border:1px solid #6d83a1}button,.primary{cursor:pointer;background:#ffba60;color:#111827;border:0;font-weight:700}button:disabled{cursor:wait;opacity:.65}a{color:#68d4fa}a.primary{display:block;text-align:center;text-decoration:none}small{color:#b9c8dd}#message{color:#ffba60;min-height:1.6em}#station-status{color:#edf3ff}footer{display:flex;justify-content:space-between;gap:16px}footer button{width:auto;margin:0;padding:0;background:transparent;color:#b9c8dd;font-size:14px;font-weight:400}details{margin-top:24px;font-size:13px;color:#b9c8dd}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #68d4fa;outline-offset:4px}[hidden]{display:none!important}
</style></head><body><main>
<header>CODERPUSH × AWS CLOUD & AI DAY</header><h1>Host setup</h1>
<form id="login"${authenticated ? ' hidden' : ''}><p>Sign in once to set up this computer for the event.</p><label for="code">Host code</label><input id="code" type="password" autocomplete="current-password" maxlength="128" required><button id="sign-in">Sign in</button></form>
<div id="setup"${authenticated ? '' : ' hidden'}><section><h2>Hanoi · Tuesday, 29 September</h2><p>2026 · Hanoi time (UTC+7)</p><p id="station-status" role="status">Checking this browser…</p><button id="status-retry" hidden>Retry</button><button id="station-enroll" disabled>Use this computer</button></section><p>Event-day plays on this browser join the Hanoi leaderboard. Every completed play also ranks publicly.</p></div>
<p id="message" role="status" aria-live="polite"></p><a id="open-game" class="primary" href="/">Open game</a><p id="lock-note"${authenticated ? '' : ' hidden'}><small>Opening the game signs you out of host controls. Event setup stays on this browser.</small></p>
<details id="build-details" hidden><summary>Build details</summary><p id="build-info"></p></details>
<footer><a href="/privacy" target="_blank" rel="noopener">Privacy</a><button id="sign-out"${authenticated ? '' : ' hidden'}>Sign out</button></footer>
</main><script>
let signedIn = ${authenticated}, opening = false, signingIn = null;
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
async function refresh() {
  const state = await request('/api/host/station');
  const button = byId('station-enroll');
  byId('station-status').textContent = state.ended ? 'The Hanoi event has finished. Public play is still open.' : state.enrolled ? state.active ? 'Ready · plays on this browser count for the event now.' : 'Ready for 29 September. Keep using this browser for the event.' : 'This browser has not been set up for the event.';
  button.hidden = state.ended || state.enrolled;
  button.disabled = false;
  try {
    const build = await request('/build-info.json');
    byId('build-info').textContent = 'BUILD ' + build.commit + (build.dirty ? ' · uncommitted changes' : '') + ' · ' + build.branch;
    byId('build-details').hidden = !signedIn;
  } catch { /* Setup does not depend on build metadata. */ }
}
async function loadSetup() {
  byId('status-retry').hidden = true; byId('station-enroll').disabled = true; byId('message').textContent = '';
  try { await refresh(); }
  catch(error) { report(error); byId('status-retry').hidden = !signedIn; }
}
async function lockHost() {
  try { await request('/api/logout', {}); }
  catch(error) { if (error.status !== 401) throw error; }
  showAccess(false);
}
byId('status-retry').addEventListener('click', loadSetup);
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
byId('station-enroll').addEventListener('click', async () => {
  byId('station-enroll').disabled = true; byId('message').textContent = '';
  try { await request('/api/host/station', {}); await loadSetup(); }
  catch(error) { report(error); }
  finally { byId('station-enroll').disabled = false; }
});
byId('sign-out').addEventListener('click', async () => {
  byId('sign-out').disabled = true;
  try { if (signingIn) await signingIn; await lockHost(); byId('message').textContent = 'Signed out. Event setup stays on this browser.'; }
  catch(error) { report(error); }
  finally { byId('sign-out').disabled = false; }
});
byId('open-game').addEventListener('click', async event => {
  event.preventDefault(); if (opening) return; opening = true; byId('sign-in').disabled = true;
  try { if (signingIn) await signingIn; await lockHost(); location.assign('/'); }
  catch(error) { report(error); }
  finally { opening = false; byId('sign-in').disabled = false; }
});
if (signedIn) loadSetup();
</script></body></html>`;
}
