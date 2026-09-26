const PREFIX = 'cloud-claw:host-recovery:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = ['camera_failure', 'connection_failure', 'browser_failure'];
const UNFINISHED = ['accepted', 'active', 'interrupted'];
const browserStorage = { getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) };

// The host chooses an opaque attempt. Server transactions decide whether it
// can be voided; no player outbox, capability or score is edited here.
export function createHostRecoveryApi({ storage = browserStorage, fetcher = fetch, onChange = () => {} } = {}) {
  let eventId, current = null, runs = [], saved = { selectedId: null, operations: [] }, busy = false, readable = false, code = '', message = '', secretEpoch = 0, revealSecret = false;
  const pending = () => saved.operations.find(row => !row.receipt && !row.rejected);
  const selected = () => runs.find(row => row.id === saved.selectedId);
  const replacement = () => saved.operations.filter(row => row.payload.runId === saved.selectedId && row.receipt).at(-1)?.receipt;
  const state = () => ({ current, runs, selected: selected(), replacement: replacement(), busy, code, message, pending: Boolean(pending()),
    canMutate: readable && !busy && current?.state === 'open' && !pending() });
  const notify = () => onChange(state());
  function persist(next) {
    const text = JSON.stringify(next); storage.setItem(PREFIX + eventId, text);
    if (storage.getItem(PREFIX + eventId) !== text) throw Error('Storage unavailable');
    saved = next;
  }
  async function request(path, payload) {
    const response = await fetcher(`/api/host/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
      ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}) });
    if (!response.ok) { const error = Error('Host request failed'); error.status = response.status; throw error; }
    return response.json();
  }
  async function refresh() {
    current = null; runs = []; code = '';
    const data = await request(`events/${eventId}/export`);
    if (data.event?.id !== eventId || !Array.isArray(data.runs)) throw Error('Invalid event');
    current = data.event;
    runs = data.runs.map(({ id, participantId, name, status, turns, total }) => ({ id, participantId, name, status, turnCount: turns.length, total }));
  }
  async function perform(action) {
    if (busy) return;
    busy = true; code = ''; message = ''; notify();
    try { await action(); }
    catch (error) {
      current = null; runs = []; code = '';
      message = [401, 403].includes(error.status) ? 'Host access expired. Sign in again and refresh; the original request is retained.'
        : error.status === 404 ? 'Event or attempt unavailable or expired. Preserve this tab for host reconciliation.'
          : error.status === 409 ? 'Server refused recovery or reissue. Refresh: a completed/void attempt, closed event or used/revoked ticket cannot be replaced.'
            : error.status === 400 ? 'Request rejected. Refresh and select a listed technical reason.'
              : error.status === 503 ? 'Admissions are paused. Preserve the original request; retry after the service resumes.'
                : 'Could not confirm the action. Keep this tab, refresh and retry the retained request; do not issue a duplicate.';
      if ([401, 403].includes(error.status)) onChange({ ...state(), unauthorized: true });
    } finally { busy = false; notify(); }
  }
  async function sendPending() {
    await refresh();
    const operation = pending(); if (!operation) return;
    // Retry even after close: the server may return a committed receipt, but
    // refuses a new grant. A void old run is expected after response loss.
    persist(saved);
    const { kind, payload, requestKey } = operation, epoch = secretEpoch;
    let result;
    try {
      result = await request(kind === 'recover' ? `event-runs/${payload.runId}/recover` : `event-tickets/${payload.ticketId}/reissue`,
        { requestKey, ...(kind === 'recover' ? { reason: payload.reason } : {}) });
    } catch (error) {
      if ([400, 409].includes(error.status)) persist({ ...saved, operations: saved.operations.map(row => row === operation ? { ...row, rejected: error.status } : row) });
      throw error;
    }
    if (result.eventId !== eventId || result.participantId !== payload.participantId || !UUID.test(result.ticketId)
      || (kind === 'recover' && result.replacesRunId !== payload.runId)) throw Error('Invalid receipt');
    const receipt = { runId: payload.runId, participantId: result.participantId, ticketId: result.ticketId, expiresAt: result.expiresAt };
    persist({ ...saved, operations: saved.operations.map(row => row === operation ? { ...row, receipt } : row) });
    await refresh();
    if (revealSecret && epoch === secretEpoch && current.state === 'open' && /^T-[a-f0-9]{32}$/i.test(result.code)) code = result.code;
    message = code ? 'Old attempt voided. Copy the replacement ticket now; its code is not saved.'
      : 'Replacement receipt recovered, not its code. Explicitly revoke/reissue only if unused. Used tickets require inspection of their own attempt; do not reset player data.';
  }
  function mutate(kind, reason) {
    return perform(async () => {
      if (!readable || pending()) throw Error('Retained request needs reconciliation');
      await refresh();
      const run = selected(), receipt = replacement();
      if (current.state !== 'open' || !run || (kind === 'recover' ? !UNFINISHED.includes(run.status) || !REASONS.includes(reason) : !receipt)) {
        message = 'Recovery unavailable. Select an unfinished attempt in an open event and a listed technical reason. Completed results are preserved.'; return;
      }
      const payload = { runId: run.id, participantId: run.participantId, ...(kind === 'recover' ? { reason } : { ticketId: receipt.ticketId }) };
      persist({ ...saved, operations: [...saved.operations, { kind, payload, requestKey: crypto.randomUUID(), receipt: null }] });
      await sendPending();
    });
  }
  return {
    state,
    clearCode() { revealSecret = false; secretEpoch++; code = ''; notify(); },
    open(id) {
      return perform(async () => {
        revealSecret = true; readable = false; current = null; runs = []; eventId = id;
        if (!UUID.test(id)) throw Error('Invalid event');
        const record = JSON.parse(storage.getItem(PREFIX + id) || 'null') || { selectedId: null, operations: [] };
        if (!Array.isArray(record.operations) || (record.selectedId && !UUID.test(record.selectedId)) || record.operations.some(row => !UUID.test(row.requestKey)
          || !UUID.test(row.payload?.runId) || !UUID.test(row.payload?.participantId)
          || (row.kind === 'recover' ? !REASONS.includes(row.payload.reason) : row.kind !== 'reissue' || !UUID.test(row.payload.ticketId))
          || (row.receipt && (!UUID.test(row.receipt.ticketId) || row.receipt.runId !== row.payload.runId || row.receipt.participantId !== row.payload.participantId)))) throw Error('Invalid retained record');
        saved = record; readable = true; await refresh();
        message = pending() ? 'Unconfirmed recovery request retained. Retry its original key.' : current.state !== 'open' ? 'Event is not open. New recoveries and replacement tickets are disabled.' : '';
      });
    },
    select(id) { return perform(async () => {
      if (!readable || pending()) throw Error('Retained request needs reconciliation');
      await refresh(); if (!runs.some(row => row.id === id)) throw Error('Attempt unavailable');
      persist({ ...saved, selectedId: id });
    }); },
    recover(reason) { return mutate('recover', reason); },
    reissue() { return mutate('reissue'); },
    retry() { return perform(sendPending); },
  };
}

export function createHostRecovery(root, { onUnauthorized = () => {}, onBusy = () => {}, onEvent = () => {}, ...options } = {}) {
  root.innerHTML = `<h3>TECHNICAL FAILURE RECOVERY</h3><p>Inspect the exact attempt and participant ID. Void only an unfinished attempt after a technical failure. Completed scores stay unchanged.</p>
    <label for="recovery-attempt">Attempt · server ID</label><select id="recovery-attempt"></select><p id="recovery-summary"></p>
    <label for="recovery-reason">Technical reason</label><select id="recovery-reason"><option value="">Select a reason</option><option value="camera_failure">Camera failure</option><option value="connection_failure">Connection failure</option><option value="browser_failure">Browser failure</option></select>
    <label><input id="recovery-confirm" type="checkbox"> Void this unfinished attempt and revoke its old ticket. Late scores cannot count. Issue one replacement for the same participant.</label><button id="recovery-submit">VOID / REPLACE ATTEMPT</button>
    <p id="recovery-receipt"></p><label><input id="recovery-reissue-confirm" type="checkbox"> Lost replacement code: revoke/reissue only this unused replacement ticket.</label><button id="recovery-reissue">REISSUE UNUSED REPLACEMENT</button>
    <div id="recovery-secret" hidden><label for="recovery-code">Copy now · code is not saved</label><input id="recovery-code" readonly autocomplete="off"><button id="recovery-copy">COPY REPLACEMENT CODE</button></div>
    <button id="recovery-retry">RETRY RETAINED REQUEST</button><p id="recovery-message" role="status"></p>`;
  const $ = id => root.querySelector(`#${id}`);
  let confirmationTarget = '';
  function resetConfirmation() { $('recovery-confirm').checked = false; $('recovery-reissue-confirm').checked = false; }
  function render(state) {
    const target = `${state.selected?.id}:${state.selected?.status}:${state.replacement?.ticketId}`;
    if (state.busy || target !== confirmationTarget || !state.canMutate) resetConfirmation();
    confirmationTarget = target;
    onEvent(state.current); onBusy(state.busy);
    $('recovery-attempt').replaceChildren(new Option('Select an exact attempt ID', ''), ...state.runs.map(run => new Option(`${run.status} · ${run.id}`, run.id)));
    $('recovery-attempt').value = state.selected?.id || '';
    $('recovery-attempt').disabled = state.busy || state.pending || !state.current;
    const run = state.selected;
    $('recovery-summary').textContent = run ? `${run.name} · participant ID ${run.participantId}\nAttempt ${run.id} · ${run.status.toUpperCase()} · ${run.turnCount}/3 saved turns · total ${run.total ?? 'unconfirmed'}` : 'No attempt selected. Refresh state to inspect server records.';
    $('recovery-reason').disabled = !state.canMutate || !UNFINISHED.includes(run?.status);
    $('recovery-confirm').disabled = $('recovery-reason').disabled;
    $('recovery-submit').disabled = $('recovery-reason').disabled || !REASONS.includes($('recovery-reason').value) || !$('recovery-confirm').checked;
    $('recovery-receipt').textContent = state.replacement ? `Replacement ticket ID ${state.replacement.ticketId} · expires ${new Date(state.replacement.expiresAt).toLocaleString()}. Receipt is not live redemption status.` : 'No retained replacement receipt for this attempt.';
    $('recovery-reissue-confirm').disabled = !state.canMutate || !state.replacement;
    $('recovery-reissue').disabled = $('recovery-reissue-confirm').disabled || !$('recovery-reissue-confirm').checked;
    $('recovery-retry').hidden = !state.pending; $('recovery-retry').disabled = state.busy || !state.current;
    $('recovery-secret').hidden = !state.code; $('recovery-code').value = state.code; $('recovery-copy').disabled = !state.code || state.busy;
    $('recovery-message').textContent = state.message;
    if (state.unauthorized) { root.hidden = true; onUnauthorized(); }
  }
  const api = createHostRecoveryApi({ ...options, onChange: render });
  $('recovery-attempt').addEventListener('change', () => { resetConfirmation(); $('recovery-reason').value = ''; void api.select($('recovery-attempt').value); });
  $('recovery-reason').addEventListener('change', () => { resetConfirmation(); render(api.state()); });
  for (const id of ['recovery-confirm', 'recovery-reissue-confirm']) $(id).addEventListener('change', () => render(api.state()));
  $('recovery-submit').addEventListener('click', () => { if ($('recovery-confirm').checked) { resetConfirmation(); void api.recover($('recovery-reason').value); } });
  $('recovery-reissue').addEventListener('click', () => { if ($('recovery-reissue-confirm').checked) { resetConfirmation(); void api.reissue(); } });
  $('recovery-retry').addEventListener('click', () => { void api.retry(); });
  $('recovery-copy').addEventListener('click', async () => {
    const code = api.state().code; if (!code) return;
    try { await navigator.clipboard.writeText(code); $('recovery-message').textContent = 'Replacement copied. Give it only to this participant.'; }
    catch { $('recovery-code').select(); $('recovery-message').textContent = 'Clipboard unavailable. Copy the selected code manually.'; }
  });
  root.closest('dialog')?.addEventListener('close', () => { resetConfirmation(); api.clearCode(); });
  return {
    suspend() { root.hidden = true; resetConfirmation(); api.clearCode(); },
    async open(event) { root.hidden = !event; if (event) await api.open(event.id); },
  };
}
