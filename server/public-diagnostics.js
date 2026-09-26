import { createHash, randomBytes } from 'node:crypto';
import { ApiError } from './database.js';
import { createBudget, throttled } from './request-budget.js';
import { createPlaytestStore } from './playtest.js';

const TTL = 30 * 60_000;
const hash = value => createHash('sha256').update(value).digest('hex');
export const PUBLIC_BUDGETS = Object.freeze({ issuanceIp: 20, issuanceGlobal: 200, telemetrySession: 10, telemetryIp: 120, telemetryGlobal: 600 });

export function createPublicDiagnostics({ db, body, json, cookies, cookie, clientAddress, now = Date.now }) {
  const sessions = new Map(), budget = createBudget({ now });
  const store = createPlaytestStore(db, { now, maxEvents: 20_000, publicOnly: true });
  function prune() {
    for (const [key, expires] of sessions) if (expires <= now()) sessions.delete(key);
    budget.prune(); store.prune();
  }
  function session(req) {
    const value = cookies(req).cc_diagnostics;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const key = hash(value), expires = sessions.get(key);
    if (!expires || expires <= now()) { sessions.delete(key); return null; }
    return { key, expires };
  }
  return {
    prune, read: store.read,
    async handle(req, res, path) {
      if (req.method !== 'POST' || !['/api/public/session', '/api/public/playtest'].includes(path)) throw new ApiError(404, 'Route not found.');
      const ip = clientAddress(req);
      // Charge before reading a body, even for invalid/missing credentials or Origin.
      const issuance = path === '/api/public/session';
      const prefix = issuance ? 'issue' : 'telemetry';
      budget.take(`${prefix}:ip:${ip}`, issuance ? PUBLIC_BUDGETS.issuanceIp : PUBLIC_BUDGETS.telemetryIp);
      // A caller already denied locally must not drain every other IP's budget.
      budget.take(`${prefix}:global`, issuance ? PUBLIC_BUDGETS.issuanceGlobal : PUBLIC_BUDGETS.telemetryGlobal);
      const auth = session(req);
      if (issuance) {
        const input = await body(req);
        if (Object.keys(input).length) throw new ApiError(400, 'An empty object is required.');
        if (auth) return json(res, 200, { expiresAt: new Date(auth.expires).toISOString() });
        for (const [key, expires] of sessions) if (expires <= now()) sessions.delete(key);
        if (sessions.size >= 10_000) throw throttled();
        const value = randomBytes(32).toString('base64url'), expires = now() + TTL;
        sessions.set(hash(value), expires);
        res.setHeader('Set-Cookie', cookie('cc_diagnostics', value, TTL / 1000, '/api/public'));
        return json(res, 200, { expiresAt: new Date(expires).toISOString() });
      }
      if (!auth) throw new ApiError(401, 'Diagnostics session required.');
      budget.take(`telemetry:session:${auth.key}`, PUBLIC_BUDGETS.telemetrySession);
      const input = await body(req, 16384);
      // Public diagnostics can never claim event context, a run, or free text.
      if (!Array.isArray(input.events) || input.events.some(event => !event || event.mode !== 'practice' || Object.hasOwn(event, 'runId') || (event.data && Object.hasOwn(event.data, 'comment')))) throw new ApiError(400, 'Practice diagnostics only.');
      return json(res, 200, store.ingest(input));
    },
  };
}
