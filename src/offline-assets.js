// Explicit host preparation API. Importing this module never registers a worker.
// U6 supplies host UI; possession of an asset pack does not grant admission.
export async function prepareAssets(serviceWorker = navigator.serviceWorker) {
  const response = await fetch('/prepared/manifest.json', { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/json') throw Error('Asset manifest unavailable.');
  const expected = await response.json();
  const registration = await serviceWorker.register('/prepared/worker.js', { scope: '/prepared/', updateViaCache: 'none' });
  await registration.update();
  const installing = registration.installing;
  if (installing) await new Promise((resolve, reject) => {
    const changed = () => {
      if (installing.state === 'installed' || installing.state === 'activated') { installing.removeEventListener('statechange', changed); resolve(); }
      if (installing.state === 'redundant') { installing.removeEventListener('statechange', changed); reject(Error('Asset preparation failed. The previous pack is preserved.')); }
    };
    installing.addEventListener('statechange', changed);
    changed();
  });
  const candidate = registration.waiting || registration.active || installing;
  let prepared = await assetStatus(candidate);
  if (prepared.id === expected.id && !prepared.complete) prepared = await assetStatus(candidate, 'PREPARE_PACK');
  if (!prepared.complete || prepared.id !== expected.id) throw Error('The current asset pack is incomplete. The previous pack is preserved.');
  return { waiting: Boolean(registration.waiting), prepared, controlling: false };
}

export function assetStatus(worker = navigator.serviceWorker.controller, type = 'PACK_STATUS') {
  if (!worker) return Promise.resolve({ complete: false, controlling: false });
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(Error('Asset verification timed out.')); }, 60_000);
    channel.port1.onmessage = ({ data }) => { clearTimeout(timer); channel.port1.close(); resolve({ ...data, controlling: worker === navigator.serviceWorker.controller }); };
    worker.postMessage({ type }, [channel.port2]);
  });
}
