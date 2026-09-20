import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { installCameraFixture } from './camera-fixture.mjs';

const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage();
  await installCameraFixture(page);
  await page.addInitScript(() => {
    const NativeAudio = window.AudioContext;
    window.musicNotes = [];
    window.AudioContext = class extends NativeAudio {
      createOscillator() {
        const oscillator = super.createOscillator(), record = { stops: 0 };
        const start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator);
        const frequency = oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
        oscillator.frequency.setValueAtTime = (value, time) => { record.frequency = value; return frequency(value, time); };
        oscillator.start = time => {
          if (oscillator.type === 'triangle' && record.frequency > 500) window.musicNotes.push(record);
          start(time);
        };
        oscillator.stop = time => { record.stops++; stop(time); };
        return oscillator;
      }
    };
  });
  await page.goto('http://127.0.0.1:4196/?setup=manual');
  await page.waitForFunction(() => window.__littleCloud);
  await page.locator('#play').click(); await page.waitForFunction(() => window.testCamera?.running);
  await page.locator('#play').click(); await page.locator('#name').press('Enter');
  const count = () => page.evaluate(() => window.musicNotes.length);
  await page.waitForTimeout(350); assert.equal(await count(), 0, 'audition cannot activate Sound');
  await page.locator('#sound').click(); await page.waitForFunction(() => window.musicNotes.length >= 2);
  assert.ok(await count() >= 2, 'active aiming plays the melody');
  const quiet = async () => {
    await page.waitForTimeout(100); const before = await count();
    await page.waitForTimeout(400); assert.equal(await count(), before);
  };
  await page.locator('#feedback-open').click(); await quiet();
  await page.locator('#feedback-dialog [aria-label="Close feedback"]').click();
  const resumed = await count(); await page.waitForTimeout(350); assert.ok(await count() > resumed);
  await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); }); await quiet();
  await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  await page.waitForTimeout(300);
  await page.locator('#operator-open').click(); await page.locator('#pause').click(); await quiet();
  await page.locator('#operator-open').click(); await page.locator('#pause').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.testCamera.clench()); await quiet();
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'result'); await quiet();
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
  await page.waitForTimeout(300); await page.locator('#sound').click(); await quiet();
  assert.ok(await page.evaluate(() => window.musicNotes.some(n => n.stops === 2)), 'interruptions cancel a sounding melody note');
  console.log('PASS released music opt-in; aiming playback; quiet during dialogs, lost camera, pause, drops, round cue and mute');
} finally { await browser.close(); }
