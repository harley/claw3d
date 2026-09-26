import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Render the real menu markup/styles without WebGL. The existing hand-menu
// journey below owns camera wiring and real recognition; this checks cues,
// target eligibility and layout independently of GPU throughput.
export async function assertMenuGuidance(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
      .replace('</head>', '<link rel="stylesheet" href="/src/arcade.css"></head>');
    await page.route('**/menu-guidance-fixture', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('http://127.0.0.1:4196/menu-guidance-fixture');
    await page.evaluate(async () => {
      const { createHandMenu } = await import('/src/hand-menu.js');
      document.getElementById('loading').hidden = true;
      document.getElementById('player-form').addEventListener('submit', e => e.preventDefault());
      window.menu = createHandMenu(); window.clicks = [];
      document.addEventListener('click', e => { if (e.target.closest('button')) window.clicks.push(e.target.closest('button').id); });
      window.updateMenu = (kind = 'ready', extra = {}, options = {}) => {
        window.feedback = { kind, controlEnabled: true, ...extra };
        menu.update(window.mode, feedback, options);
      };
    });
    const show = mode => page.evaluate(mode => {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      window.mode = mode;
      if (['registration', 'final'].includes(mode)) document.getElementById(mode).showModal();
      updateMenu();
    }, mode);
    const point = id => page.evaluate(id => {
      updateMenu();
      const el = document.getElementById(id); el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      updateMenu('tracking', { pointer: { x: .18 + (r.x + r.width / 2) / innerWidth * .64, y: .15 + (r.y + r.height / 2) / innerHeight * .70 } });
    }, id);
    for (const [mode, ids] of Object.entries({ idle: ['play', 'mode-one', 'mode-two', 'result-open'], resume: ['play'], registration: ['register-play', 'register-cancel'], final: ['play-again', 'next-player', 'final-leaderboard'] })) {
      await show(mode);
      assert.equal(await page.locator('#menu-guide').isVisible(), true, `${mode}: one central prompt`);
      assert.equal(await page.locator('#menu-guide').count(), 1);
      assert.equal(await page.locator('#hand-cursor').isVisible(), false);
      for (const id of ids) {
        await page.evaluate(id => { document.getElementById(id).hidden = false; }, id);
        await point(id);
        assert.equal(await page.locator('#menu-guide').isVisible(), false);
        assert.equal(await page.locator('#hand-cursor.demonstrating').count(), 1, `${id}: demonstration`);
        assert.equal(await page.locator('.cursor-cue').textContent(), 'Clench to select');
        assert.equal(await page.locator('#hand-cursor').evaluate(el => el.style.getPropertyValue('--hold')), '0');
        await page.evaluate(() => updateMenu('clenching', { pointer: feedback.pointer, progress: 0 }));
        assert.equal(await page.locator('#hand-cursor.demonstrating').count(), 0, 'clenching stops the demo before hold progress');
        await page.evaluate(() => updateMenu('clenching', { pointer: feedback.pointer, progress: .5 }));
        assert.equal(await page.locator('#hand-cursor.demonstrating').count(), 0);
        assert.equal(await page.locator('#hand-cursor').evaluate(el => el.style.getPropertyValue('--hold')), '0.5');
        await page.evaluate(() => updateMenu('tracking', { pointer: feedback.pointer }));
        assert.equal(await page.evaluate(() => menu.confirm(mode, { ...feedback, kind: 'clenching' })), false, 'early opening cancels hold');
        await point(id);
        await page.evaluate(() => updateMenu('clenching', { pointer: feedback.pointer, progress: .5 }));
        await page.evaluate(() => updateMenu('lost'));
        assert.equal(await page.locator('#menu-guide').isVisible(), true);
        assert.equal(await page.evaluate(() => menu.confirm(mode, feedback)), false, 'loss cannot select');
        await point(id);
        await page.evaluate(() => updateMenu('clenching', { pointer: feedback.pointer, progress: 1 }));
        assert.equal(await page.evaluate(() => menu.confirm(mode, feedback)), true, `${mode}/${id}: completed hold`);
        assert.equal(await page.evaluate(() => menu.confirm(mode, feedback)), false, 'completed hold selects once');
      }
    }
    await show('idle');
    await point('play');
    await page.waitForTimeout(2800);
    assert.equal(await page.locator('#hand-cursor').evaluate(el => el.style.getPropertyValue('--hold')), '0', 'a whole animation cannot fill input progress');
    const clicks = await page.evaluate(() => clicks.length);
    assert.equal(clicks, 10, 'only completed holds created clicks');
    await page.evaluate(() => { document.getElementById('play').disabled = true; menu.update(mode, feedback); });
    assert.equal(await page.locator('#hand-cursor.demonstrating').count(), 0, 'disabling a hovered action stops teaching');
    await point('operator-open');
    assert.equal(await page.locator('#hand-cursor.demonstrating').count(), 0, 'host control is not taught');
    await page.evaluate(() => updateMenu('tracking', { pointer: { x: .5, y: .5 } }));
    assert.equal(await page.locator('#hand-cursor.demonstrating').count(), 0, 'blank space is not taught');
    for (const kind of ['off', 'loading', 'error', 'delayed', 'blocked']) {
      await page.evaluate(kind => updateMenu(kind), kind);
      assert.equal(await page.locator('#menu-guide').isVisible(), false, `${kind}: preserve specific help`);
      assert.equal(await page.locator('#hand-cursor').isVisible(), false);
    }
    await page.evaluate(() => updateMenu('ready', {}, { showGuide: false }));
    assert.equal(await page.locator('#menu-guide').isVisible(), false, 'explicit pause preserves pause help');
    await page.evaluate(() => { mode = ''; updateMenu(); });
    assert.equal(await page.locator('#menu-guide').isVisible(), false, 'gameplay and host dialogs have no menu cue');
    await show('registration');
    await page.evaluate(() => { menu.clear(); document.getElementById('menu-guide').remove(); document.getElementById('hand-cursor').remove(); });
    await page.evaluate(async () => { menu = (await import('/src/hand-menu.js')).createHandMenu({ leftHand: true }); updateMenu(); });
    assert.equal(await page.locator('#menu-guide strong').textContent(), 'Raise your left hand');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await show('registration');
    const before = await page.locator('#register-play').evaluate(el => el.offsetTop);
    await page.screenshot({ path: '.screenshots/clp81-narrow-guide.png' });
    await point('register-play');
    const after = await page.locator('#register-play').evaluate(el => el.offsetTop);
    assert.deepEqual(after, before, 'recognition does not move the primary button');
    assert.equal(await page.locator('.cursor-hand').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await page.locator('.cursor-fist').evaluate(el => getComputedStyle(el).animationName), 'none');
    const label = await page.locator('.cursor-cue').boundingBox();
    const back = await page.locator('#register-cancel').boundingBox();
    assert.ok(label.y + label.height <= back.y || label.y >= back.y + back.height, 'caption does not cover Back');
    assert.ok(label.x >= 0 && label.x + label.width <= 375, 'cue fits narrow viewport');
    await page.screenshot({ path: '.screenshots/clp81-narrow-hover.png' });
    await page.evaluate(() => menu.clear());
    assert.equal(await page.locator('#hand-cursor').isVisible(), false, 'hidden-page clear removes demo and progress');
    console.log('PASS menu teaching, eligible targets, cancellation, static reduced motion and narrow layout');
  } finally { await page.close(); }
}
