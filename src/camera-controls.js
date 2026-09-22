// Lazy camera adapter: the event state machine owns registration and turns.
export async function createCameraControls({ video, overlay, select, onChange, canControl, onDrop, onGesture, getControlProfile, getControlTarget }) {
  const { HandController } = await import('./vision.js');
  let input = { x: 0, z: 0 }, state = { kind: 'off', message: 'Start the camera to play' }, at = 0;
  let diagnostic = {};
  // Production vision telemetry: per-result capture-to-control latency and
  // reject counts, drained by the caller's periodic rollup.
  const emptyStats = () => ({ latencies: [], results: 0, rejected: {} });
  let stats = emptyStats(), adaptation = emptyStats();
  const record = (target, next) => {
    if (next.rejected) target.rejected[next.rejected] = (target.rejected[next.rejected] || 0) + 1;
    else if (next.captureAge !== undefined) target.results++;
    if (next.milliseconds !== undefined && target.latencies.length < 2000) target.latencies.push(next.milliseconds);
  };
  const notify = next => { state = next; at = performance.now(); onChange(next); };
  const controller = new HandController({ video, overlay, select,
    getPhase: () => canControl() ? 'aim' : 'blocked',
    onDiagnostic: next => {
      if (import.meta.env?.DEV) diagnostic = { ...diagnostic, ...next };
      record(stats, next); record(adaptation, next);
    },
    onGesture, getControlProfile, getControlTarget,
    onStart: () => {}, // A gesture must never register a player or advance a turn.
    onDrop: () => canControl() && onDrop() === true,
    onInput: next => { input = next; }, onState: notify,
  });
  const reset = () => { controller.resetOwner(); if (controller.running) notify({ kind: 'ready', message: 'Hold one open hand still to steer.' }); };
  const drain = target => {
    const { latencies, results, rejected } = target;
    const sorted = latencies.sort((a, b) => a - b);
    // Nearest-rank keeps p95 honest for small samples (n=2 must report the max).
    const pct = p => sorted.length ? Math.min(60000, sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]) : null;
    return { results, rejected, latencyP50Ms: pct(.5), latencyP95Ms: pct(.95) };
  };
  const visionStats = () => { const sample = drain(stats); stats = emptyStats(); return sample; };
  const adaptationStats = () => { const sample = drain(adaptation); adaptation = emptyStats(); return sample; };
  return {
    get diagnostic() { return diagnostic; },
    visionStats, adaptationStats,
    // Presentation expires with input, including when the worker stops reporting.
    get feedback() {
      const fresh = performance.now() - at < 700;
      return { ...state, kind: !controller.running ? controller.starting ? 'loading' : state.kind === 'error' ? 'error' : 'off' : fresh ? state.kind : 'delayed',
        progress: fresh ? state.progress || 0 : 0, controlEnabled: controller.running && fresh && canControl() };
    },
    get running() { return controller.running; }, get starting() { return controller.starting; },
    get input() { return canControl() && controller.running && performance.now() - at < 700 ? input : { x: 0, z: 0 }; },
    get waiting() { return controller.running && (!['tracking', 'clenching'].includes(state.kind) || performance.now() - at >= 700); },
    setPerformanceMode: mode => controller.setPerformanceMode(mode),
    start: () => controller.start(), stop: () => controller.stop(), reset,
  };
}
