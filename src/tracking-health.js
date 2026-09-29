// Read-only presentation of the existing five-second adaptation window.
export function trackingHealth(sample, feedback = {}) {
  if (feedback.kind === 'loading') return 'Starting tracking';
  if (feedback.kind === 'error') return 'Tracking unavailable';
  if (feedback.kind === 'off') return 'Tracking off';
  if (feedback.kind === 'delayed') return 'Tracking delayed';
  if (!sample) return 'Measuring tracking';
  if (sample.freshHz < 4 || sample.rejectRate >= .15) return 'Tracking slow';
  if (['ready', 'lost'].includes(feedback.kind)) return 'Waiting for hand';
  return 'Tracking ready';
}

export function trackingSample(vision, elapsedMs) {
  if (!vision || elapsedMs <= 0) return null;
  const rejected = Object.values(vision.rejected).reduce((sum, count) => sum + count, 0);
  const total = vision.results + rejected;
  return { freshHz: vision.results * 1000 / elapsedMs, rejectRate: total ? rejected / total : 0,
    ageP95: vision.captureToReceiptP95Ms };
}

export function createTrackingHealth({ root, restart, build }) {
  root.hidden = false;
  const toggle = root.querySelector('[data-health-toggle]');
  const panel = root.querySelector('[data-health-panel]');
  const action = root.querySelector('[data-health-restart]');
  const text = (key, value) => { const node = root.querySelector(`[data-health-${key}]`); if (node.textContent !== value) node.textContent = value; };
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  root.querySelector('[data-health-close]').addEventListener('click', () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); });
  action.addEventListener('click', restart);
  text('build', build);
  let lastUpdate = -Infinity;
  return {
    update({ time, sample, feedback, busy, inFlight, holdCause }) {
      if (time - lastUpdate < 500) return;
      lastUpdate = time;
      const status = trackingHealth(sample, feedback);
      text('status', status);
      text('rate', sample ? `${sample.freshHz.toFixed(1)} Hz` : '—');
      text('fresh', sample ? `${sample.freshHz.toFixed(1)} / sec` : 'Measuring');
      text('age', sample?.ageP95 != null ? `${Math.round(sample.ageP95)} ms` : '—');
      text('reject', sample ? `${Math.round(sample.rejectRate * 100)}%` : '—');
      text('hold', holdCause || 'None this session');
      action.disabled = busy || inFlight;
      text('restart', busy ? 'Starting tracking…' : inFlight ? 'Wait for claw to finish' : 'Restart tracking');
      root.dataset.health = /slow|delayed|unavailable/.test(status) ? 'warning' : 'normal';
    },
  };
}
