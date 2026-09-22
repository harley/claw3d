// Print the live production sourceCommit, read through an authenticated
// /build-info.json using the staff code held in Railway. Prints nothing (and
// exits 0) when the site or credentials are unavailable so the caller can fall
// back; never prints the code itself.
import { execFileSync } from 'node:child_process';

const origin = process.env.LIVE_ORIGIN || 'https://claw.coderpush.com';
let staffCode = '';
try {
  const vars = JSON.parse(execFileSync('railway', ['variable', 'list',
    '--project', process.env.RAILWAY_PROJECT_ID, '--environment', process.env.RAILWAY_ENVIRONMENT_ID,
    '--service', process.env.RAILWAY_SERVICE_ID, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }));
  staffCode = vars.STAFF_CODE || '';
} catch { /* fall back below */ }
if (!staffCode) process.exit(0);
try {
  const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify({ code: staffCode }), signal: AbortSignal.timeout(10000) });
  if (!login.ok) process.exit(0);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const response = await fetch(`${origin}/build-info.json`, { headers: { cookie, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) process.exit(0);
  const build = await response.json();
  if (/^[a-f0-9]{40}$/.test(build?.sourceCommit || '')) console.log(build.sourceCommit);
} catch { /* nothing printed: caller falls back */ }
