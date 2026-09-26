import { createHostTickets } from './host-tickets.js';
import { createHostRecovery } from './host-recovery.js';
// Current-event host console. Server-owned recovery; no scoring or purge actions.
const KEY = 'cloud-claw:host-event:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const browserStorage = { getItem: key => globalThis.sessionStorage.getItem(key), setItem: (key, value) => globalThis.sessionStorage.setItem(key, value) };
export function createHostEvents(root, { onUnauthorized, storage = browserStorage, fetcher = fetch } = {}) {
  let current = null, saved = { eventId: null, pending: null }, busy = false, readable = true, ticketBusy = false, recoveryBusy = false;
  root.innerHTML = `<h3>OFFICIAL EVENT</h3>
    <p id="event-state" role="status">No event selected in this tab.</p>
    <form id="event-create"><label for="event-name">Event name</label><input id="event-name" maxlength="60" required>
      <button id="event-create-button">CREATE DRAFT EVENT</button></form>
    <div class="event-actions"><button id="event-refresh">REFRESH STATE</button><button id="event-open">OPEN EVENT</button>
      <button id="event-close">CLOSE EVENT</button><button id="event-retry">RETRY PENDING ACTION</button><button id="event-new">CREATE ANOTHER EVENT</button></div>
    <label id="event-close-confirm"><input id="event-close-check" type="checkbox"> Close permanently: unused tickets expire; admitted runs have 10 minutes to finish, then expire unscored.</label>
    <p id="event-message" role="status"></p><fieldset id="host-ticket-actions" class="host-workflow"><section id="host-tickets" hidden></section></fieldset><fieldset id="host-recovery-actions" class="host-workflow"><section id="host-recovery" hidden></section></fieldset>`;
  const $ = id => root.querySelector(`#${id}`);
  const tickets = createHostTickets($('host-tickets'), { onUnauthorized, storage, fetcher, onEvent: value => { current = value; }, onBusy: value => { ticketBusy = value; render(); } });
  const recovery = createHostRecovery($('host-recovery'), { onUnauthorized, storage, fetcher, onEvent: value => { current = value; }, onBusy: value => { recoveryBusy = value; render(); } });
  function persist(next) {
    const text = JSON.stringify(next); storage.setItem(KEY, text);
    if (storage.getItem(KEY) !== text) throw new Error('Browser storage unavailable. Keep this tab for recovery.');
    saved = next;
  }
  function render() {
    $('event-state').textContent = busy ? 'Checking server…' : current ? `${current.name} · ${current.state.toUpperCase()}` : saved.eventId ? 'Event state unverified. Refresh to check.' : 'No event selected in this tab.';
    $('event-create').hidden = Boolean(saved.eventId);
    $('event-name').value = saved.pending?.payload?.name ?? $('event-name').value;
    $('event-name').disabled = !readable || busy || Boolean(saved.pending);
    for (const button of root.querySelectorAll('button')) if (!button.closest('.host-workflow')) button.disabled = busy || ticketBusy || recoveryBusy || !readable;
    $('host-ticket-actions').disabled = busy || recoveryBusy || !current || current.state !== 'open';
    $('host-recovery-actions').disabled = busy || ticketBusy || !current;
    if (current?.state !== 'open') for (const id of ['recovery-submit', 'recovery-reissue', 'recovery-reason', 'recovery-confirm', 'recovery-reissue-confirm']) $(id).disabled = true;
    $('event-create-button').disabled ||= Boolean(saved.pending);
    $('event-refresh').hidden = !saved.eventId || Boolean(saved.pending);
    $('event-open').hidden = current?.state !== 'draft' || Boolean(saved.pending);
    $('event-close').hidden = !['draft', 'open'].includes(current?.state) || Boolean(saved.pending);
    $('event-close-confirm').hidden = $('event-close').hidden;
    $('event-close').disabled ||= !$('event-close-check').checked;
    $('event-retry').hidden = !saved.pending;
    $('event-new').hidden = current?.state !== 'closed' || Boolean(saved.pending);
  }
  async function request(path, payload) {
    const response = await fetcher(`/api/host/events${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'Event request failed.'); error.status = response.status; throw error; }
    return data;
  }
  async function refresh() {
    current = null;
    if (!saved.eventId) return;
    const result = await request(`/${saved.eventId}/export`);
    if (result.event?.id !== saved.eventId || !['draft', 'open', 'closed'].includes(result.event.state)) throw new Error('Invalid event response. Refresh to check.');
    // Never retain or render the export's participant/run/action records.
    current = result.event;
  }
  async function perform(action) {
    if (busy || ticketBusy || recoveryBusy) return;
    tickets.suspend(); recovery.suspend();
    busy = true; $('event-message').textContent = ''; render();
    try { await action(); }
    catch (error) {
      current = null;
      $('event-message').textContent = error.status === 404 ? 'Event unavailable: it may have expired or been removed, or event controls are disabled.'
        : error.status ? error.message : 'Could not confirm the action. Keep this tab and retry; do not create a replacement event.';
      if ([401, 403].includes(error.status)) { root.hidden = true; onUnauthorized(); }
    } finally { await tickets.open(saved.pending ? null : current); await recovery.open(saved.pending ? null : current); busy = false; render(); }
  }
  async function sendPending() {
    const { path, payload } = saved.pending;
    const result = await request(path, payload);
    const eventId = saved.eventId ?? result.eventId;
    if (!UUID.test(eventId) || result.eventId !== eventId) throw new Error('Invalid event response.');
    persist({ eventId, pending: null });
    await refresh(); $('event-close-check').checked = false;
    $('event-message').textContent = 'Server state refreshed.';
  }
  function mutate(path, payload) {
    return perform(async () => {
      if (saved.pending) throw new Error('Retry the pending action first.');
      persist({ ...saved, pending: { path, payload: { ...payload, requestKey: crypto.randomUUID() } } });
      await sendPending();
    });
  }
  $('event-create').addEventListener('submit', event => {
    event.preventDefault(); const name = $('event-name').value.trim();
    if (!name || name.length > 60 || /[\p{Cc}\p{Cf}]/u.test(name)) { $('event-message').textContent = 'Enter an event name between 1 and 60 characters without control characters.'; return; }
    if (!saved.eventId) void mutate('', { name });
  });
  $('event-open').addEventListener('click', () => { if (current?.state === 'draft') void mutate(`/${saved.eventId}/state`, { state: 'open' }); });
  $('event-close-check').addEventListener('change', render);
  $('event-close').addEventListener('click', () => { if ($('event-close-check').checked && ['draft', 'open'].includes(current?.state)) void mutate(`/${saved.eventId}/state`, { state: 'closed' }); });
  $('event-refresh').addEventListener('click', () => { void perform(refresh); });
  $('event-retry').addEventListener('click', () => { if (saved.pending) void perform(sendPending); });
  $('event-new').addEventListener('click', () => { if (current?.state === 'closed') void perform(async () => { persist({ eventId: null, pending: null }); current = null; $('event-name').value = ''; }); });
  root.hidden = true;
  return {
    open() {
      root.hidden = false;
      return perform(async () => {
        readable = false;
        saved = JSON.parse(storage.getItem(KEY) ?? 'null') ?? { eventId: null, pending: null };
        if (saved.eventId && !UUID.test(saved.eventId)) throw new Error('Invalid saved event.');
        const pending = saved.pending;
        if (pending && (!UUID.test(pending.payload?.requestKey) || (saved.eventId
          ? pending.path !== `/${saved.eventId}/state` || !['open', 'closed'].includes(pending.payload.state)
          : pending.path !== '' || typeof pending.payload.name !== 'string'))) throw new Error('Invalid pending action.');
        readable = true;
        await refresh();
        if (saved.pending) $('event-message').textContent = 'Unconfirmed action retained. Retry with the original request key.';
      });
    },
  };
}
