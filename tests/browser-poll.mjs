import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Playwright's waitForFunction treats a returned Promise as truthy before it
// resolves. Poll evaluate instead when readiness requires asynchronous APIs.
export async function waitForAsync(page, predicate, argument, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  while (true) {
    let timer;
    const ready = await Promise.race([
      page.evaluate(predicate, argument),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Timed out waiting for asynchronous browser readiness')), Math.max(0, deadline - Date.now()));
      }),
    ]).finally(() => clearTimeout(timer));
    if (ready) return;
    assert.ok(Date.now() < deadline, 'Timed out waiting for asynchronous browser readiness');
    await delay(Math.min(100, Math.max(0, deadline - Date.now())));
  }
}
