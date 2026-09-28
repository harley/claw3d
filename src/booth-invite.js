// Private contact details stay in this form, never in score storage or telemetry.
export function createBoothInvite() {
  const panel = document.getElementById('booth-invite');
  const form = document.getElementById('invite-form');
  const status = document.getElementById('invite-status');
  const button = document.getElementById('invite-submit');
  let runId = null, busy = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!runId || busy) return;
    const submittedRun = runId;
    busy = true; button.disabled = true; status.dataset.state = 'saving'; status.textContent = 'Saving request…';
    try {
      const response = await fetch(`/api/play/runs/${submittedRun}/contact`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.elements.name.value.trim(), contact: form.elements.contact.value.trim(), consent: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request could not be saved.');
      if (runId !== submittedRun) return;
      status.dataset.state = 'saved';
      status.textContent = result.eligible
        ? 'Request saved. You qualify for another booth try.'
        : 'Request saved. Beat 300 for another booth try.';
      form.reset(); form.hidden = true;
    } catch (error) {
      if (runId === submittedRun) {
        status.dataset.state = 'error';
        status.textContent = `${error.name === 'TypeError' || error.name === 'TimeoutError' ? 'Could not connect.' : error.message} Please retry.`;
      }
    } finally {
      busy = false; button.disabled = false;
    }
  });
  return {
    show(run) {
      if (runId !== run?.id) {
        runId = run?.id || null;
        form.reset(); form.hidden = false; panel.open = false; status.textContent = ''; status.dataset.state = '';
      }
      panel.hidden = !runId;
    },
    get busy() { return busy; },
    get editing() { return panel.contains(document.activeElement); },
  };
}
