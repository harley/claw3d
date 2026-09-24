import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { browserOptions } from '../scripts/browser-options.mjs';
import { assertScoredStart, cameraInput, installCameraFixture } from './camera-fixture.mjs';

const browser = await chromium.launch(browserOptions);
try {
  await mkdir('.screenshots', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installCameraFixture(page);
  await page.goto('http://127.0.0.1:4196/?setup=manual');
  await page.waitForFunction(() => window.__littleCloud);
  await page.waitForFunction(() => [...document.querySelectorAll('.prize-tag')].every(tag => tag.hidden));

  await page.locator('#play').click();
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
  await page.locator('#play').click();
  await page.locator('#name').fill('Target Label');
  await page.locator('#name').press('Enter');
  await assertScoredStart(page);
  await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');

  async function aimToy(id) {
    for (let i = 0; i < 50; i++) {
      const state = await page.evaluate(() => window.__littleCloud.snapshot());
      const toy = state.toys.find(item => item.id === id);
      assert.ok(toy, `toy ${id} exists`);
      if (state.aligned === id) break;
      const dx = toy.position[0] - state.position.x, dz = toy.position[2] - state.position.z;
      await cameraInput(page, { x: Math.abs(dx) < .025 ? 0 : Math.sign(dx), z: Math.abs(dz) < .025 ? 0 : Math.sign(dz) });
      await page.waitForTimeout(100);
    }
    await cameraInput(page, { x: 0, z: 0 });
    await page.waitForFunction(id => window.__littleCloud.snapshot().aligned === id, id);
  }

  async function inspectTarget(id, expectedSide) {
    await page.waitForFunction(() => {
      const element = document.querySelector('.prize-tag.targeted');
      if (!element) return false;
      const bounds = element.getBoundingClientRect(), parent = document.getElementById('prize-tags').getBoundingClientRect();
      return bounds.left >= parent.left + 9 && bounds.right <= parent.right - 9 && bounds.top >= parent.top + 9 && bounds.bottom <= parent.bottom - 9;
    });
    const target = await page.evaluate(async id => {
      const T = await import('/node_modules/three/build/three.module.js');
      const state = window.__littleCloud.snapshot(true);
      const toy = state.toys.find(item => item.id === id);
      const element = document.querySelector('.prize-tag.targeted');
      const bounds = element.getBoundingClientRect(), parent = document.getElementById('prize-tags').getBoundingClientRect();
      const scene = document.getElementById('scene').getBoundingClientRect();
      const camera = new T.PerspectiveCamera(35, scene.width / scene.height, .1, 70);
      camera.position.fromArray(state.camera); camera.lookAt(...state.cameraLook); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      const top = new T.Vector3(...toy.bounds.max).project(camera);
      const style = getComputedStyle(element);
      return {
        visible: !element.hidden, count: document.querySelectorAll('.prize-tag.targeted').length,
        text: element.textContent, fontSize: parseFloat(style.fontSize), color: style.color,
        borderWidth: parseFloat(style.borderTopWidth), bounds: bounds.toJSON(), parent: parent.toJSON(),
        toyTopY: scene.top + (1 - top.y) * scene.height / 2,
      };
    }, id);
    assert.equal(target.visible, true);
    assert.equal(target.count, 1, 'only the active toy gets an emphasized label');
    assert.match(target.text, /^\d{3}$/);
    assert.ok(target.fontSize >= 18, `label is large enough (${target.fontSize}px)`);
    assert.equal(target.color, 'rgb(255, 255, 255)');
    assert.ok(target.borderWidth >= 2);
    assert.ok(target.bounds.left >= target.parent.left + 9 && target.bounds.right <= target.parent.right - 9, 'label stays inside the left and right edges');
    assert.ok(target.bounds.top >= target.parent.top + 9 && target.bounds.bottom <= target.parent.bottom - 9, 'label stays inside the top and bottom edges');
    assert.ok(target.bounds.bottom < target.toyTopY, 'plaque stays above the target toy');
    assert.equal(expectedSide, target.bounds.left + target.bounds.width / 2 < target.parent.left + target.parent.width / 2 ? 'left' : 'right');
    return target;
  }

  await aimToy('bonbon');
  await inspectTarget('bonbon', 'left');
  await page.screenshot({ path: '.screenshots/issue-95-target-label-desktop.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.prize-tag.targeted')?.getBoundingClientRect().width > 0);
  await inspectTarget('bonbon', 'left');
  await page.screenshot({ path: '.screenshots/issue-95-target-label-narrow-left.png' });

  await aimToy('sprout');
  await inspectTarget('sprout', 'right');
  await page.screenshot({ path: '.screenshots/issue-95-target-label-narrow-right.png' });

  await cameraInput(page, { x: -1, z: 0 });
  await page.waitForTimeout(500);
  await cameraInput(page, { x: 0, z: 0 });
  await page.waitForFunction(() => !window.__littleCloud.snapshot().aligned);
  assert.equal(await page.locator('.prize-tag.targeted').count(), 0, 'no toy label remains emphasized when aiming away');
  assert.equal(await page.locator('.prize-tag:not([hidden])').count(), 0, 'all point labels hide when no toy is targeted');
  assert.deepEqual(errors, []);
  console.log('PASS active target plaque readability, edge placement, narrow layout, and untargeted state');
} finally {
  await browser.close();
}
