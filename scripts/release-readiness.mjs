import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitForRelease({ origin, expected, staffCode, fetcher = fetch, wait = delay, attempts = 60 }) {
  let cookies, build;
  const request = async (path, options) => {
    try { return await fetcher(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(10000) }); }
    catch { return null; } // A deployment can briefly interrupt transport.
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!cookies) {
      const login = await request('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', origin },
        body: JSON.stringify({ code: staffCode }),
      });
      if (login?.ok) {
        cookies = login.headers.getSetCookie();
        assert.ok(cookies.length, 'Staff session missing');
      } else if (login && login.status < 500) {
        throw new Error(`Staff sign-in failed (HTTP ${login.status}); not retrying credentials.`);
      }
    }
    if (cookies) {
      const response = await request('/build-info.json', {
        headers: { cookie: cookies.map(value => value.split(';')[0]).join('; '), 'Cache-Control': 'no-cache' },
      });
      if (response?.ok) {
        try { build = await response.json(); } catch { build = null; }
        if (build?.sourceCommit === expected && build.commit === expected.slice(0, 7) && build.branch === 'main' && build.dirty === false) return { build, cookies };
      } else if (response?.status === 401) {
        throw new Error('Staff session was rejected during release verification.');
      }
    }
    if (attempt + 1 < attempts) await wait(5000);
  }
  throw new Error('Live BUILD did not reach the checked clean main commit within the readiness window.');
}
