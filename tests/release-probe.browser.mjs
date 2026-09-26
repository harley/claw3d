// Distinct release contract: the production verifier works across private/public
// entry modes without camera access, player writes or collector contamination.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { waitForRelease } from '../scripts/release-readiness.mjs';
import { verifyReleaseBrowser } from '../scripts/release-browser.mjs';
import { createPilotServer } from '../server/index.js';

const dist = await mkdtemp(join(tmpdir(), 'claw-release-probe-'));
const expected = '123abcd'.padEnd(40, '0');
const origin = 'http://127.0.0.1:4294';
const staffCode = 'release-test-staff-secret', hostCode = 'release-test-host-secret';
let browser;
try {
  // Disposable production bundle with a synthetic main identity, never dist/.
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    env: { ...process.env, CLAW_BUILD_OUT_DIR: dist, BUILD_COMMIT: expected, BUILD_BRANCH: 'main', BUILD_DIRTY: 'false' }, stdio: 'pipe',
  });
  browser = await chromium.launch(browserOptions);
  for (const { publicTry, officialEvents, publicDiagnostics } of [
    { publicTry: false, officialEvents: false, publicDiagnostics: false },
    { publicTry: true, officialEvents: false, publicDiagnostics: false },
    { publicTry: true, officialEvents: true, publicDiagnostics: true },
    { publicTry: true, officialEvents: true, publicDiagnostics: false },
  ]) {
    const app = await createPilotServer({ filename: ':memory:', origin, staffCode, hostCode, dist, secure: false,
      publicTryEnabled: publicTry, publicDiagnosticsEnabled: publicDiagnostics, officialEventsEnabled: officialEvents, officialAdmissionsEnabled: false });
    const writes = [];
    app.server.prependListener('request', req => { if (!['GET', 'HEAD'].includes(req.method)) writes.push(`${req.method} ${req.url}`); });
    await new Promise(resolve => app.server.listen(4294, '127.0.0.1', resolve));
    try {
      const { cookies } = await waitForRelease({ origin, expected, staffCode, attempts: 1 });
      const options = { browser, origin, expected, cookies, hostCode, publicTry, officialEvents, publicDiagnostics };
      assert.deepEqual(await verifyReleaseBrowser(options), {
        operatorBuild: 'BUILD 123abcd · main', anonymousEntry: publicTry ? 'public Try' : 'staff gate',
      });
      await assert.rejects(verifyReleaseBrowser({ ...options, publicTry: !publicTry, officialEvents: false }), /Anonymous entry differs from EXPECTED_PUBLIC_TRY/);
      if (publicTry) {
        await assert.rejects(verifyReleaseBrowser({ ...options, publicDiagnostics: !publicDiagnostics }), /Public diagnostics differs from EXPECTED_PUBLIC_DIAGNOSTICS/);
        await assert.rejects(verifyReleaseBrowser({ ...options, officialEvents: !officialEvents }), /Official entry differs from EXPECTED_OFFICIAL_EVENTS/);
      }
      assert.deepEqual(writes, ['POST /api/login', 'POST /api/host/login'], 'Only verification authentication may reach the server');
      assert.equal(Boolean(app.database.db.prepare("SELECT 1 FROM sqlite_master WHERE name='public_playtest_events'").get()), publicDiagnostics,
        'Disabled diagnostics must not create its observation table');
      for (const table of ['runs', 'turns', ...(publicDiagnostics ? ['public_playtest_events'] : []), ...(officialEvents ? ['official_runs', 'official_turns'] : [])]) {
        assert.equal(app.database.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
      }
    } finally {
      await new Promise(resolve => app.server.close(resolve));
      app.database.close();
    }
  }
  console.log('Release probe: private/public Try, official ticket entry, diagnostics on/off notice, protected staff operator, expected-mode mismatches, zero camera/player/telemetry writes passed.');
} finally {
  await browser?.close();
  await rm(dist, { recursive: true, force: true });
}
