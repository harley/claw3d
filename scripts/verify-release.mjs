// Release smoke check only: no camera access, player registration or score writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from './browser-options.mjs';
import { waitForRelease } from './release-readiness.mjs';
import { createSecretRedactor } from './release-secrets.mjs';
import { expectedPublicTry, expectedOfficialEvents, expectedPublicDiagnostics, verifyReleaseBrowser } from './release-browser.mjs';

const secrets = createSecretRedactor();
async function main() {
const origin = 'https://claw.coderpush.com';
const expected = process.env.EXPECTED_BUILD;
const publicTry = expectedPublicTry(process.env.EXPECTED_PUBLIC_TRY);
const officialEvents = expectedOfficialEvents(process.env.EXPECTED_OFFICIAL_EVENTS);
const publicDiagnostics = expectedPublicDiagnostics(process.env.EXPECTED_PUBLIC_DIAGNOSTICS);
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
  const { operatorBuild, anonymousEntry } = await verifyReleaseBrowser({
    browser, origin, expected, cookies, hostCode: credentials.HOST_CODE, publicTry, officialEvents, publicDiagnostics,
  });
  console.log(JSON.stringify({ build, operatorBuild, anonymousEntry, officialEvents, publicDiagnostics, cameraStarted: false, scoreSubmitted: false }));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `Verified [Cloud Claw](${origin}) at \`${expected}\`: authenticated BUILD, rendered staff operator panel, anonymous ${anonymousEntry} entry, official entry ${officialEvents ? 'enabled' : 'disabled'}, public diagnostics ${publicDiagnostics ? 'enabled' : 'disabled'} and no page errors. No camera or scores used. Physical playtesting remains required.\n`);
} finally { await browser.close(); }
}

main().catch(error => {
  // Playwright's call log can include fill values. Redact locally as well as
  // registering GitHub masks before passing any credentials to the browser.
  console.error(secrets.redact(error.stack ?? error));
  process.exitCode = 1;
});
