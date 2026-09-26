import assert from 'node:assert/strict';

export function expectedPublicTry(value = 'false') {
  assert.ok(['true', 'false'].includes(value), 'EXPECTED_PUBLIC_TRY must be true or false');
  return value === 'true';
}

export function expectedOfficialEvents(value = 'false') {
  assert.ok(['true', 'false'].includes(value), 'EXPECTED_OFFICIAL_EVENTS must be true or false');
  return value === 'true';
}

export function expectedPublicDiagnostics(value = 'false') {
  assert.ok(['true', 'false'].includes(value), 'EXPECTED_PUBLIC_DIAGNOSTICS must be true or false');
  return value === 'true';
}

// The expectation comes from reviewed release configuration, never from the
// page being checked. These contexts cannot start cameras or write player data.
export async function verifyReleaseBrowser({ browser, origin, expected, cookies, hostCode, publicTry, officialEvents = false, publicDiagnostics = false }) {
  assert.ok(!officialEvents || publicTry, 'Public official entry requires EXPECTED_PUBLIC_TRY');
  const contexts = [], errors = [], unexpectedWrites = [];
  let cameraCalls = 0;
  async function context(authenticated) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    contexts.push(context);
    if (authenticated) await context.addCookies(cookies.map(value => {
      const [pair] = value.split(';'), separator = pair.indexOf('=');
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin, httpOnly: true, secure: origin.startsWith('https:') };
    }));
    await context.exposeBinding('releaseCameraAttempt', () => { cameraCalls++; });
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        await window.releaseCameraAttempt();
        throw new Error('Release verification must not start the camera.');
      };
    });
    await context.route('**/api/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      // Suppress both collectors, including anonymous session creation.
      if (path === '/api/public/session') return route.fulfill({ status: 404, json: { error: 'Release probe: diagnostics disabled' } });
      if (['/api/playtest', '/api/public/playtest'].includes(path) && request.method() === 'POST') {
        const events = request.postDataJSON()?.events ?? [];
        return route.fulfill({ json: { accepted: events.map(event => event.id) } });
      }
      if (!['GET', 'HEAD'].includes(request.method()) && !(authenticated && path === '/api/host/login' && request.method() === 'POST')) {
        unexpectedWrites.push(`${request.method()} ${path}`);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    return page;
  }
  try {
    const anonymous = await context(false);
    await anonymous.goto(`${origin}/?setup=manual`);
    assert.equal(await anonymous.evaluate(() => window.__PUBLIC_TRY__ === true), publicTry, 'Anonymous entry differs from EXPECTED_PUBLIC_TRY');
    if (publicTry) {
      await anonymous.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
      assert.equal(await anonymous.locator('#try-notice').isVisible(), true, 'Public Try notice missing');
      assert.equal(await anonymous.locator('#login').count(), 0, 'Public Try unexpectedly requires staff sign-in');
      assert.equal(await anonymous.evaluate(() => window.__PUBLIC_DIAGNOSTICS__ === true), publicDiagnostics, 'Public diagnostics differs from EXPECTED_PUBLIC_DIAGNOSTICS');
      const notice = await anonymous.locator('#try-diagnostics-notice').textContent();
      assert.equal(await anonymous.locator('#try-diagnostics-notice').isVisible(), true, 'Diagnostics notice missing');
      assert.match(notice, publicDiagnostics ? /Limited gameplay and performance data.*30 days/ : /Gameplay diagnostics are off/);
      assert.equal(await anonymous.evaluate(() => window.__OFFICIAL_EVENTS__ === true), officialEvents, 'Official entry differs from EXPECTED_OFFICIAL_EVENTS');
      if (officialEvents) {
        const entry = anonymous.locator('#official-entry');
        assert.equal(await entry.isVisible(), true, 'Deliberate official entry missing');
        assert.equal(await entry.getAttribute('href'), '/official');
        // Inspect the ticket entry only. Never redeem or activate a ticket.
        await anonymous.goto(`${origin}/official?setup=manual`);
        await anonymous.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
        assert.equal(await anonymous.evaluate(() => window.__PUBLIC_OFFICIAL__ === true), true, 'Public official bootstrap missing');
        assert.equal(await anonymous.locator('#login').count(), 0, 'Official entry unexpectedly requires staff sign-in');
        await anonymous.locator('#official-status-open').click();
        assert.equal(await anonymous.locator('#official-ticket-form').isVisible(), true, 'Official ticket form missing');
        assert.equal(await anonymous.locator('#official-code').isVisible(), true);
        assert.equal(await anonymous.locator('#official-redeem').isVisible(), true);
      }
    } else {
      assert.equal(await anonymous.locator('#login #code').isVisible(), true, 'Private entry must show the staff gate');
    }
    await anonymous.goto(`${origin}/staff?setup=manual`);
    assert.equal(await anonymous.locator('#login #code').isVisible(), true, 'Anonymous staff entry must remain protected');
    await anonymous.close();

    const page = await context(true);
    await page.goto(`${origin}/staff?setup=manual`);
    await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
    await page.locator('#operator-open').click();
    await page.locator('#host-code').fill(hostCode);
    await page.locator('#host-form button').click();
    await page.locator('#operator').waitFor();
    const operatorBuild = await page.locator('#build-info').textContent();
    assert.equal(operatorBuild, `BUILD ${expected.slice(0, 7)} · main`);
    assert.equal(await page.locator('#camera-video').evaluate(video => video.srcObject === null), true);
    assert.equal(cameraCalls, 0, 'Release probe attempted camera access');
    assert.deepEqual(unexpectedWrites, [], 'Release probe attempted a data mutation');
    assert.deepEqual(errors, [], 'Live page errors');
    return { operatorBuild, anonymousEntry: publicTry ? 'public Try' : 'staff gate' };
  } finally {
    for (const context of contexts) await context.close();
  }
}
