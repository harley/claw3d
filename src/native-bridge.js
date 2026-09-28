// One dispatcher for acquisition and operator requests on the trusted Android page.
const bridges = new WeakMap();
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
export function nativeBridge(target = globalThis.TomkoNative) {
  if (!target) throw new Error('Android bridge unavailable.');
  if (bridges.has(target)) return bridges.get(target);
  const listeners = new Set();
  let pending = null, nextId = 0;
  const send = message => target.postMessage(JSON.stringify(message));
  target.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'export-result' && pending?.id === message.id) {
      const request = pending; pending = null;
      if (message.status === 'saved' || message.status === 'cancelled') request.resolve(message.status);
      else request.reject(new Error(message.message || 'Export failed. Scores remain on this device.'));
    }
    for (const listener of listeners) listener(message);
  };
  const bridge = {
    send,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    exportScores(data, filename) {
      if (pending) return Promise.reject(new Error('Finish the open export first.'));
      if (typeof data !== 'string' || new TextEncoder().encode(data).length > MAX_EXPORT_BYTES) {
        return Promise.reject(new Error('Export exceeds the 2 MB limit. Scores remain on this device.'));
      }
      return new Promise((resolve, reject) => {
        pending = { id: ++nextId, resolve, reject };
        try { send({ type: 'export', id: pending.id, filename, data }); }
        catch (error) { pending = null; reject(error); }
      });
    },
  };
  bridges.set(target, bridge);
  return bridge;
}
