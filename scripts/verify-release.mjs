// Release smoke check only: no camera access, player registration or score writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { waitForRelease } from './release-readiness.mjs';
import { createSecretRedactor } from './release-secrets.mjs';

const secrets = createSecretRedactor();
async function main() {
const origin = 'https://claw.coderpush.com';
const expected = process.env.EXPECTED_BUILD;
assert.match(expected ?? '', /^[a-f0-9]{40}$/, 'EXPECTED_BUILD must be the checked full commit SHA');
let credentials;
try {
  credentials = JSON.parse(execFileSync('railway', ['variable', 'list',
    '--project', process.env.RAILWAY_PROJECT_ID,
    '--environment', process.env.RAILWAY_ENVIRONMENT_ID,
    '--service', process.env.RAILWAY_SERVICE_ID, '--json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }));
} catch { throw new Error('Could not read Railway verification credentials.'); }
assert.ok(credentials.STAFF_CODE && credentials.HOST_CODE, 'Missing pilot verification credentials');
secrets.add(credentials.STAFF_CODE);
secrets.add(credentials.HOST_CODE);
const { build, cookies } = await waitForRelease({ origin, expected, staffCode: credentials.STAFF_CODE });
for (const cookie of cookies) secrets.add(cookie.split(';')[0].slice(cookie.indexOf('=') + 1));

const browser = await chromium.launch(browserOptions);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(cookies.map(value => {
    const [pair] = value.split(';'), separator = pair.indexOf('=');
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin, httpOnly: true, secure: true };
  }));
  let cameraCalls = 0;
  await context.exposeBinding('releaseCameraAttempt', () => { cameraCalls++; });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      await window.releaseCameraAttempt();
      throw new Error('Release verification must not start the camera.');
    };
  });
  const unexpectedWrites = [];
  await context.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    // Keep release probes out of real-player telemetry, and prevent accidental
    // score/board writes even if a future UI regression tries to issue one.
    if (path === '/api/playtest' && request.method() === 'POST') {
      const events = request.postDataJSON()?.events ?? [];
      return route.fulfill({ json: { accepted: events.map(event => event.id) } });
    }
    if (!['GET', 'HEAD'].includes(request.method()) && !(path === '/api/host/login' && request.method() === 'POST')) {
      unexpectedWrites.push(`${request.method()} ${path}`);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => document.documentElement?.dataset.arcadeReady === 'true');
  await page.locator('#operator-open').click();
  await page.locator('#host-code').fill(credentials.HOST_CODE);
  await page.locator('#host-form button').click();
  await page.locator('#operator').waitFor();
  const operatorBuild = await page.locator('#build-info').textContent();
  assert.equal(operatorBuild, `BUILD ${expected.slice(0, 7)} · main`);
  assert.equal(await page.locator('#camera-video').evaluate(video => video.srcObject === null), true);
  assert.equal(cameraCalls, 0, 'Release probe attempted camera access');
  assert.deepEqual(unexpectedWrites, [], 'Release probe attempted a data mutation');
  assert.deepEqual(errors, [], 'Live page errors');
  console.log(JSON.stringify({ build, operatorBuild, cameraStarted: false, scoreSubmitted: false }));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `Verified [Cloud Claw](${origin}) at \`${expected}\`: authenticated BUILD, rendered operator panel and no page errors. No camera or scores used. Physical playtesting remains required.\n`);
} finally { await browser.close(); }
}

main().catch(error => {
  // Playwright's call log can include fill values. Redact locally as well as
  // registering GitHub masks before passing any credentials to the browser.
  console.error(secrets.redact(error.stack ?? error));
  process.exitCode = 1;
});
