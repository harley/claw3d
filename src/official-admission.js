// Unwired admission only. No activation, gameplay, staff login or score writes.
const PREFIX = 'cloud-claw:admission:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminal = run => ['complete', 'void', 'expired'].includes(run.status);
const browserStorage = {
  get length() { return globalThis.localStorage.length; },
  key: i => globalThis.localStorage.key(i),
  getItem: key => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  removeItem: key => globalThis.localStorage.removeItem(key),
};
async function fingerprint(code) {
  if (typeof code !== 'string' || !/^T-[A-Fa-f0-9]{32}$/.test(code)) throw new Error('Enter the original ticket code.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toUpperCase()));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createOfficialAdmission({ storage = browserStorage, fetcher = fetch } = {}) {
  const fresh = new Set(), busy = new Set();
  function read(requestKey) {
    if (!UUID.test(requestKey)) throw new Error('Invalid admission identifier.');
    const record = JSON.parse(storage.getItem(PREFIX + requestKey) ?? 'null');
    if (!record || record.requestKey !== requestKey || !UUID.test(record.nonce) || !/^[0-9a-f]{64}$/.test(record.ticketHash))
      throw new Error('Admission record unavailable. Keep browser data and ask the host.');
    return record;
  }
  function write(record) {
    const text = JSON.stringify(record), key = PREFIX + record.requestKey;
    storage.setItem(key, text);
    if (storage.getItem(key) !== text) throw new Error('Admission storage unavailable.');
  }
  function view(record) {
    return { requestKey: record.requestKey, nonce: record.nonce, receipt: record.receipt,
      submitted: record.submitted, recoveryRequired: !fresh.has(record.requestKey) || Boolean(record.receipt && record.receipt.status !== 'accepted') };
  }
  async function request(path, data) {
    let response;
    try {
      response = await fetcher(`/api/official/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
        ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) });
    } catch { throw new Error('Admission response unavailable. Retry this admission with the original ticket.'); }
    // Do not surface arbitrary transport/server text that could echo a secret.
    if (!response.ok) {
      const error = new Error('Admission unavailable. Keep browser data and ask the host.');
      error.status = response.status; throw error;
    }
    let run;
    try { run = await response.json(); } catch { /* Retain the pending intent. */ }
    if (!run || !UUID.test(run.id) || run.rules?.turns !== 3 || !Array.isArray(run.turns) ||
      !['accepted', 'active', 'interrupted', 'complete', 'void', 'expired'].includes(run.status))
      throw new Error('Admission receipt unavailable. Retry this admission with the original ticket.');
    return run;
  }
  async function exclusive(requestKey, action) {
    if (busy.has(requestKey)) throw new Error('Admission operation already in progress.');
    busy.add(requestKey);
    try { return await action(); } finally { busy.delete(requestKey); }
  }
  return {
    // Creation and reads never send requests. A new intent is an explicit action,
    // never an automatic response to a failure, reload or rejected ticket.
    async prepare(code) {
      const record = { requestKey: crypto.randomUUID(), nonce: crypto.randomUUID(), ticketHash: await fingerprint(code), submitted: false, receipt: null };
      write(record); fresh.add(record.requestKey); return view(record);
    },
    read: requestKey => view(read(requestKey)),
    list() {
      const records = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(PREFIX)) records.push(view(read(key.slice(PREFIX.length))));
      }
      return records;
    },
    redeem(requestKey, code) {
      return exclusive(requestKey, async () => {
        const record = read(requestKey);
        if (await fingerprint(code) !== record.ticketHash) throw new Error('Re-enter the original ticket for this admission.');
        // Verify the actual record, not just a tiny probe, before every POST.
        record.submitted = true; write(record);
        const run = await request('redeem', { code, requestKey, nonce: record.nonce });
        if (record.receipt && record.receipt.id !== run.id) throw new Error('Admission receipt conflict. Ask the host.');
        record.receipt = run; write(record); return view(record);
      });
    },
    discard(requestKey) {
      if (busy.has(requestKey) || read(requestKey).submitted) throw new Error('Submitted admission must be retained for recovery.');
      storage.removeItem(PREFIX + requestKey); fresh.delete(requestKey);
    },
    acknowledge(requestKey) {
      return exclusive(requestKey, async () => {
        const record = read(requestKey), run = await request('session');
        if (!record.receipt || run.id !== record.receipt.id || !terminal(run)) throw new Error('Only a confirmed terminal admission can be cleared.');
        // This removes only admission metadata. Score outboxes have their own
        // acknowledgement protocol and must never be cleared here.
        storage.removeItem(PREFIX + requestKey); fresh.delete(requestKey);
      });
    },
  };
}
