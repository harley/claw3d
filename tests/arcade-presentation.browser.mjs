import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCameraFixture } from './camera-fixture.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 await installCameraFixture(page);
 await page.goto('http://127.0.0.1:4196'); await page.waitForFunction(() => window.__littleCloud);
 await page.locator('#play').click(); await page.waitForFunction(() => window.testCamera?.running);
 await page.locator('#play').click(); await page.locator('#name').press('Enter');
 await page.evaluate(() => window.testCamera.clench());
 assert.equal(await page.locator('#status').textContent(), 'DROP!');
 await page.screenshot({ path: '.screenshots/arcade-drop.png' });
 await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'lift');
 assert.match(await page.locator('#status').textContent(), /^(GOT IT!|MISSED)$/);
 assert.equal(await page.evaluate(() => window.__littleCloud.snapshot().event.run.turns.length), 0);
 await page.screenshot({ path: '.screenshots/arcade-outcome.png' });
 await page.waitForTimeout(1700);
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '0');
 assert.equal(await page.locator('#action-copy').getAttribute('role'), 'status');
 assert.equal(await page.locator('#celebration').count(), 0);
 for (const width of [1440, 820, 390, 360]) {
  await page.setViewportSize({ width, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
 }
 await page.setViewportSize({ width: 390, height: 620 });
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await page.reload(); await page.waitForFunction(() => window.__littleCloud);
 await page.locator('#operator-open').click(); await page.locator('#reset').click();
 await page.locator('#play').click(); await page.waitForFunction(() => window.testCamera?.running);
 await page.locator('#play').click(); await page.locator('#name').press('Enter');
 await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
 await page.waitForTimeout(1800);
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).opacity), '1', 'recovery guidance never expires');
 assert.equal(await page.locator('#action-copy').evaluate(el => getComputedStyle(el).animationName), 'none');
 await page.screenshot({ path: '.screenshots/arcade-reduced-narrow.png', fullPage: true });
 const preview = await page.locator('#camera-preview').boundingBox();
 assert.ok(preview && preview.height > 0, 'camera preview is visible before measuring');
 assert.ok(preview.y + preview.height < 710, 'uncropped preview and recognition fit above the short-screen footer');
 await page.evaluate(() => window.testCamera.stop());
 await page.waitForFunction(() => document.getElementById('button-text').textContent === 'Restart camera');
 const bounds = await page.evaluate(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }; return { arcade: r('arcade'), button: r('play') }; });
 assert.ok(bounds.button.bottom < bounds.arcade.bottom - 30, 'restart is above footer on short screens');
 await page.locator('#play').click();
 await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
 console.log('PASS immediate, timed, single-surface outcomes; persistent recovery; narrow layout and reduced motion');
} finally { await browser.close(); }
