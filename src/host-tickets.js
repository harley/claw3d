const PREFIX = 'cloud-claw:host-tickets:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const browserStorage = { getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) };

// Retain request identities and secret-free receipts. Server transactions own
// identity and issuance; a display name is never used to locate a participant.
export function createHostTicketApi({ storage = browserStorage, fetcher = fetch, onChange = () => {} } = {}) {
  let eventId = null, current = null, participants = [], saved = { participantId: null, ticketId: null, operations: [] }, busy = false, readable = false, code = '', message = '';
  const pending = () => saved.operations.find(row => !row.receipt && !row.rejected);
  const tickets = () => saved.operations.filter(row => row.receipt?.ticketId).map(row => row.receipt);
  const selected = () => tickets().find(row => row.ticketId === saved.ticketId && row.participantId === saved.participantId);
  const state = () => ({ busy, current, participants, participantId: saved.participantId, tickets: tickets().filter(row => row.participantId === saved.participantId), ticket: selected(), code, message,
    pending: Boolean(pending()), canMutate: readable && !busy && current?.state === 'open' && !pending() });
  const notify = () => onChange(state());
  function persist(next) {
    const text = JSON.stringify(next); storage.setItem(PREFIX + eventId, text);
    if (storage.getItem(PREFIX + eventId) !== text) throw new Error('Storage unavailable');
    saved = next;
  }
  async function request(path, payload) {
    const response = await fetcher(`/api/host/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
    if (!response.ok) { const error = new Error('Host request failed'); error.status = response.status; throw error; }
    return response.json();
  }
  async function refresh() {
    current = null; participants = []; code = '';
    const data = await request(`events/${eventId}/export`);
    if (data.event?.id !== eventId || !Array.isArray(data.participants)) throw new Error('Invalid event response');
    current = data.event;
    participants = data.participants.map(({ id, name }) => ({ id, name }));
    if (saved.participantId && !participants.some(row => row.id === saved.participantId)) throw new Error('Participant unavailable');
  }
  async function perform(action) {
    if (busy) return;
    busy = true; code = ''; message = ''; notify();
    try { await action(); }
    catch (error) {
      const closed = current?.state === 'closed';
      if (!closed) current = null;
      participants = []; code = '';
      message = closed ? 'Event is closed. Participant creation, issuance and reissue are disabled; retained requests are preserved.' : [401, 403].includes(error.status) ? 'Host access expired. Sign in again, then refresh this event; retained requests keep their original keys.'
        : error.status === 400 ? 'Server rejected the name or request. Check the display name, refresh and try again.'
        : error.status === 404 ? 'Event or ticket unavailable. Refresh the event; expired or removed events cannot issue tickets.'
          : error.status === 409 ? 'Server rejected this action. The ticket may be used or revoked, or the event closed. Refresh; this does not recover a redeemed attempt.'
            : error.status === 503 ? 'Admissions are paused. Keep this tab and retry the retained request after the host service resumes.'
              : 'Could not confirm the action. Keep this tab and refresh, then retry the retained request. Do not create a duplicate.';
      if ([401, 403].includes(error.status)) onChange({ ...state(), unauthorized: true });
    } finally { busy = false; notify(); }
  }
  function assertOpen() {
    if (!readable || current?.state !== 'open') throw new Error('Refresh an open event first');
  }
  async function sendPending() {
    await refresh(); assertOpen();
    const operation = pending(); if (!operation) return;
    const { kind, payload, requestKey } = operation;
    const path = kind === 'reissue' ? `event-tickets/${payload.ticketId}/reissue` : `events/${eventId}/${kind === 'participant' ? 'participants' : 'tickets'}`;
    let result;
    persist(saved);
    try { result = await request(path, { ...(kind === 'reissue' ? {} : payload), requestKey }); }
    catch (error) {
      // A definitive validation/conflict response to this exact key is retained
      // as rejected history. Transport/auth/availability failures stay pending.
      if ([400, 409].includes(error.status)) persist({ ...saved, operations: saved.operations.map(row => row === operation ? { ...row, rejected: error.status } : row) });
      throw error;
    }
    const participantId = kind === 'participant' ? result.participantId : payload.participantId;
    if (!UUID.test(participantId) || result.eventId !== eventId || result.participantId !== participantId || (kind !== 'participant' && !UUID.test(result.ticketId))) throw new Error('Invalid receipt');
    const receipt = kind === 'participant' ? { participantId } : { participantId, ticketId: result.ticketId, expiresAt: result.expiresAt };
    persist({ ...saved, participantId, ticketId: receipt.ticketId ?? null,
      operations: saved.operations.map(row => row === operation ? { ...row, receipt } : row) });
    await refresh();
    if (current.state === 'open' && receipt.ticketId && /^T-[A-Fa-f0-9]{32}$/.test(result.code)) code = result.code;
    message = kind === 'participant' ? 'Participant selected by its server ID. Equal names remain separate people.'
      : code ? 'Copy this single-use ticket now. Its code is not saved; reissue revokes only an unused ticket.'
        : 'Ticket identity recovered; its code is not returned again. Revoke/reissue only if unused. A redeemed attempt needs separate host recovery.';
  }
  function mutate(kind, payload) {
    return perform(async () => {
      assertOpen(); if (pending()) throw new Error('Pending action');
      if (kind !== 'participant' && !participants.some(row => row.id === payload.participantId)) throw new Error('Select a participant');
      persist({ ...saved, operations: [...saved.operations, { kind, payload, requestKey: crypto.randomUUID(), receipt: null }] });
      await sendPending();
    });
  }
  return {
    state,
    clearCode() { code = ''; notify(); },
    async open(id) {
      if (busy) return;
      eventId = id; current = null; participants = []; readable = false; code = '';
      return perform(async () => {
        if (!UUID.test(id)) throw new Error('Invalid event');
        const record = JSON.parse(storage.getItem(PREFIX + id) || 'null') || { participantId: null, ticketId: null, operations: [] };
        if (!Array.isArray(record.operations) || (record.participantId && !UUID.test(record.participantId)) || record.operations.some(row => !UUID.test(row.requestKey) || !['participant', 'ticket', 'reissue'].includes(row.kind) || !row.payload || (row.kind === 'participant' ? typeof row.payload.name !== 'string' : !UUID.test(row.payload.participantId) || (row.kind === 'reissue' && !UUID.test(row.payload.ticketId))))) throw new Error('Invalid retained data');
        saved = record; readable = true; await refresh();
        message = pending() ? 'Unconfirmed request retained. Retry it with the original key.' : current.state !== 'open' ? 'Event is not open. Participant creation and ticket issuance are disabled.' : '';
      });
    },
    select(participantId) { return perform(async () => {
      assertOpen(); if (pending() || !participants.some(row => row.id === participantId)) throw new Error('Select a participant');
      persist({ ...saved, participantId, ticketId: null });
    }); },
    selectTicket(ticketId) { return perform(async () => { assertOpen(); if (!pending() && tickets().some(row => row.ticketId === ticketId && row.participantId === saved.participantId)) persist({ ...saved, ticketId }); }); },
    create(name) { return mutate('participant', { name }); },
    issue() { return mutate('ticket', { participantId: saved.participantId }); },
    reissue() { const ticket = selected(); if (!ticket) return Promise.resolve(); return mutate('reissue', { ticketId: ticket.ticketId, participantId: ticket.participantId }); },
    retry() { return perform(sendPending); },
  };
}

export function createHostTickets(root, { onUnauthorized = () => {}, onBusy = () => {}, onEvent = () => {}, ...options } = {}) {
  root.innerHTML = `<h3>PARTICIPANTS & TICKETS</h3><p>Names are labels, never identity. Select the participant’s exact ID for an extra attempt; their event best stays with that identity.</p>
    <form id="participant-create"><label for="participant-name">New participant display name</label><input id="participant-name" maxlength="24" required><button id="participant-create-button">CREATE NEW PARTICIPANT</button></form>
    <label for="participant-select">Existing participant · server ID</label><select id="participant-select"></select><p id="participant-identity"></p>
    <button id="ticket-issue">ISSUE SINGLE-USE TICKET</button>
    <label for="ticket-select">Retained ticket receipts (not live redemption status)</label><select id="ticket-select"></select>
    <p id="ticket-identity"></p><label><input id="ticket-reissue-confirm" type="checkbox"> Revoke this unused ticket and issue its replacement. This cannot recover a redeemed attempt.</label><button id="ticket-reissue">REVOKE / REISSUE UNUSED TICKET</button>
    <div id="ticket-secret" hidden><label for="host-ticket-code">Copy now · code is not saved</label><input id="host-ticket-code" readonly autocomplete="off"><button id="ticket-copy">COPY TICKET CODE</button></div>
    <button id="ticket-retry">RETRY RETAINED REQUEST</button><p id="ticket-message" role="status"></p>`;
  const $ = id => root.querySelector(`#${id}`);
  let confirmationTicket = null;
  const api = createHostTicketApi({ ...options, onChange: state => {
    if (state.busy || !state.canMutate || confirmationTicket !== state.ticket?.ticketId) $('ticket-reissue-confirm').checked = false;
    confirmationTicket = state.ticket?.ticketId;
    onEvent(state.current);
    onBusy(state.busy);
    for (const button of root.querySelectorAll('button')) button.disabled = !state.canMutate;
    $('participant-select').replaceChildren(new Option('Select an exact participant ID', ''), ...state.participants.map(row => new Option(`${row.name} · ${row.id}`, row.id)));
    $('participant-select').value = state.participantId || ''; $('participant-select').disabled = !state.canMutate;
    $('participant-name').disabled = !state.canMutate;
    $('participant-identity').textContent = state.participantId ? `Selected ID: ${state.participantId}` : 'No participant selected.';
    $('ticket-issue').disabled ||= !state.participantId;
    $('ticket-select').replaceChildren(new Option('Select a retained ticket ID', ''), ...state.tickets.map(row => new Option(row.ticketId, row.ticketId)));
    $('ticket-select').value = state.ticket?.ticketId || ''; $('ticket-select').disabled = !state.canMutate;
    $('ticket-identity').textContent = state.ticket ? `Ticket ID: ${state.ticket.ticketId} · expires ${new Date(state.ticket.expiresAt).toLocaleString()}` : '';
    $('ticket-reissue').disabled ||= !state.ticket || !$('ticket-reissue-confirm').checked;
    $('ticket-retry').hidden = !state.pending; $('ticket-retry').disabled = state.busy || state.current?.state !== 'open';
    $('ticket-secret').hidden = !state.code; $('host-ticket-code').value = state.code;
    $('ticket-copy').disabled = !state.code || state.busy;
    $('ticket-message').textContent = state.message;
    if (state.unauthorized) { root.hidden = true; onUnauthorized(); }
  } });
  $('participant-create').addEventListener('submit', event => { event.preventDefault(); void api.create($('participant-name').value.trim()); });
  $('participant-select').addEventListener('change', () => { void api.select($('participant-select').value); });
  $('ticket-select').addEventListener('change', () => { try { api.selectTicket($('ticket-select').value); } catch { $('ticket-message').textContent = 'Storage unavailable. Keep this tab and ask the host.'; } });
  $('ticket-issue').addEventListener('click', () => { void api.issue(); });
  $('ticket-reissue-confirm').addEventListener('change', () => { $('ticket-reissue').disabled = !api.state().canMutate || !api.state().ticket || !$('ticket-reissue-confirm').checked; });
  $('ticket-reissue').addEventListener('click', () => { if ($('ticket-reissue-confirm').checked) { $('ticket-reissue-confirm').checked = false; void api.reissue(); } });
  $('ticket-retry').addEventListener('click', () => { void api.retry(); });
  $('ticket-copy').addEventListener('click', async () => {
    const code = api.state().code; if (!code) return;
    try { await navigator.clipboard.writeText(code); $('ticket-message').textContent = 'Ticket copied. Share it only with this participant.'; }
    catch { $('host-ticket-code').select(); $('ticket-message').textContent = 'Clipboard unavailable. Copy the selected code manually.'; }
  });
  root.closest('dialog')?.addEventListener('close', () => { $('ticket-reissue-confirm').checked = false; api.clearCode(); });
  return {
    suspend() { root.hidden = true; $('ticket-reissue-confirm').checked = false; api.clearCode(); },
    async open(event) { root.hidden = !event; if (event) await api.open(event.id); },
  };
}
