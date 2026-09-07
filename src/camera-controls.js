// Lazy camera adapter: the event state machine owns registration and turns.
export async function createCameraControls({ video, overlay, select, onChange, canControl, onDrop }) {
  const { HandController } = await import('./vision.js');
  let input = { x: 0, z: 0 }, state = { kind: 'off', message: 'Start the camera to play' }, at = 0;
  let diagnostic = {};
  const notify = next => { state = next; at = performance.now(); onChange(next); };
  const controller = new HandController({ video, overlay, select, getProfile: () => 'clasp',
    getPhase: () => canControl() ? 'aim' : 'blocked',
    onDiagnostic: next => { if (import.meta.env?.DEV) diagnostic = { ...diagnostic, ...next }; },
    onStart: () => {}, // A gesture must never register a player or advance a turn.
    onDrop: () => { if (canControl()) onDrop(); },
    onInput: next => { input = next; }, onState: notify,
  });
  const reset = () => { controller.resetOwner(); if (controller.running) notify({ kind: 'ready', message: 'Hold one open hand still to steer.' }); };
  return {
    get diagnostic() { return diagnostic; },
    get running() { return controller.running; }, get starting() { return controller.starting; },
    get input() { return canControl() && controller.running && performance.now() - at < 700 ? input : { x: 0, z: 0 }; },
    get waiting() { return controller.running && (!['tracking', 'clenching', 'clasping', 'dropping'].includes(state.kind) || performance.now() - at >= 700); },
    start: () => controller.start(), stop: () => controller.stop(), reset,
  };
}
