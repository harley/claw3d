/* PACK is injected by the build. This worker owns public bytes, never score data. */
const cacheName = `claw-public-pack-v1-${PACK.id}`;
const markerURL = new URL('/prepared/complete', self.location.origin).href;
const entries = new Map(PACK.entries.map(entry => [entry.url, entry]));
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function validated(response, entry) {
  if (!response || response.status !== 200 || response.redirected || !['basic', 'default'].includes(response.type)
    || response.headers.get('content-type')?.split(';')[0].trim() !== entry.type) throw Error(`Invalid asset response: ${entry.url}`);
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== entry.bytes || hex(await crypto.subtle.digest('SHA-256', bytes)) !== entry.sha256) throw Error(`Asset digest mismatch: ${entry.url}`);
  return response;
}

async function complete() {
  const cache = await caches.open(cacheName);
  if (!(await cache.match(markerURL))) return false;
  try {
    for (const entry of PACK.entries) await validated(await cache.match(entry.url), entry);
    return true;
  } catch { return false; }
}

async function prepare() {
  // A failed install leaves earlier build caches and their live workers untouched.
  if (await complete()) return;
  const cache = await caches.open(cacheName);
  await cache.delete(markerURL);
  for (const entry of PACK.entries) {
    const response = await fetch(entry.url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000) });
    await cache.put(entry.url, await validated(response, entry));
  }
  await cache.put(markerURL, new Response(PACK.id, { headers: { 'Content-Type': 'text/plain' } }));
}
let preparation;
function prepareOnce() {
  preparation ||= prepare().finally(() => { preparation = null; });
  return preparation;
}
self.addEventListener('install', event => event.waitUntil(prepareOnce()));

// No skipWaiting, clients.claim, background sync or cache deletion. A replacement
// activates only after every old controlled page closes (including a playing tab).
// Journal compatibility/admission belongs to the page, not the asset worker.
self.addEventListener('message', event => {
  if (!['PACK_STATUS', 'PREPARE_PACK'].includes(event.data?.type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'PREPARE_PACK') await prepareOnce();
      event.ports[0].postMessage({ id: PACK.id, bytes: PACK.bytes, complete: await complete() });
    } catch { event.ports[0].postMessage({ id: PACK.id, bytes: PACK.bytes, complete: false }); }
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = event.request.mode === 'navigate';
  const path = navigation && ['/prepared/', '/prepared/index.html'].includes(url.pathname) ? '/prepared/index.html' : url.pathname;
  // Protected navigation, APIs, exports and build-info never get a cache fallback.
  if (navigation && path !== '/prepared/index.html' || !entries.has(path) || url.search && !navigation) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    if (!(await cache.match(markerURL))) return new Response('Preparation incomplete. Reconnect and prepare this station again.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    try { return await validated(await cache.match(path), entries.get(path)); }
    catch { return new Response('Prepared asset unavailable. Reconnect and prepare this station again.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
