import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCameraFixture, cameraInput, cameraDrop } from './camera-fixture.mjs';
import { browserOptions } from '../scripts/browser-options.mjs';

// Contract: rendered steel fingers must physically acquire each live prize,
// retain contact through lift, carry the original offset and release once.
// Existing contact replays exercise only the old upright finger geometry.
const browser = await chromium.launch(browserOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4196/?setup=manual');
  await page.waitForFunction(() => window.__littleCloud);
  assert.ok((await page.evaluate(() => window.__littleCloud.snapshot())).claw.rotation, 'the active entry boots the new physical claw');
  const report = await page.evaluate(async () => {
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const M = await import('/src/arcade-mechanics.js');
    const { clawWorldPoint } = await import('/src/claw-suspension.js');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:100'; document.body.append(canvas);
    const scene = new ArcadeScene(canvas, { suspendedClaw: true }), render = scene.renderer.render.bind(scene.renderer);
    scene.renderer.render = () => {};
    const rows = [];
    for (const fps of [60, 30, 10]) for (const id of ['butter', 'blue-hour', 'peach', 'miso', 'bonbon', 'sprout', 'swing', 'settled-swing', 'side', 'empty', 'displaced']) {
      const game = M.createGame({ carousel: true, suspendedClaw: true }); scene.groundToys(game); M.begin(game);
      const target = game.toys.find(t => t.id === (['swing', 'settled-swing', 'displaced'].includes(id) ? 'butter' : id));
      if (id === 'sprout') { M.moveCarousel(game, M.CAROUSEL.period - M.CONTACT_DELAY); game.position = { x: .8, z: .22 }; }
      else if (id === 'side') game.position = { x: -.18, z: .72 };
      else if (id === 'empty') game.position = { x: -1.12, z: .66 };
      else game.position = { x: target.x, z: target.z };
      if (['swing', 'settled-swing'].includes(id)) {
        game.position.x -= .34; M.advanceSuspension(game, 1 / fps);
        for (let i = 0; i < Math.round(.4 * fps); i++) { game.position.x += .85 / fps; M.advanceSuspension(game, 1 / fps); }
        for (let i = 0; i < Math.round((id === 'settled-swing' ? 1.5 : .36) * fps); i++) M.advanceSuspension(game, 1 / fps);
      }
      scene.update(game, 0, 0, { x: 0, z: 0 }, null); M.drop(game);
      let lastGrip, firstLift, maxHeldError = 0, peakSwing = 0, displaced = false, releaseAnchor, maxReleaseDrift = 0, frame;
      for (frame = 0; frame < fps * 15 && game.phase !== 'result'; frame++) {
        M.advance(game, 1 / fps);
        if (id === 'displaced' && game.phase === 'grip' && !displaced) { game.suspension.x = .28; displaced = true; }
        scene.update(game, 1 / fps, frame / fps, { x: 0, z: 0 }, null);
        const pose = M.clawPose(game); peakSwing = Math.max(peakSwing, Math.abs(pose.rotation.z));
        if (game.phase === 'grip') lastGrip = scene.fingers.map(f => f.radius);
        if (game.phase === 'lift') firstLift ??= scene.fingers.map(f => f.radius);
        if (game.plan.prize && ['lift', 'transfer'].includes(game.phase)) {
          const expected = clawWorldPoint(pose, game.plan.heldLocalOffset), actual = scene.toys.get(game.plan.prize.id).position;
          maxHeldError = Math.max(maxHeldError, Math.hypot(expected.x - actual.x, expected.y - actual.y, expected.z - actual.z));
        }
        if (game.plan.prize && game.phase === 'release') {
          const actual = scene.toys.get(game.plan.prize.id).position;
          releaseAnchor ??= { x: actual.x, z: actual.z };
          maxReleaseDrift = Math.max(maxReleaseDrift, Math.hypot(actual.x - releaseAnchor.x, actual.z - releaseAnchor.z));
        }
      }
      rows.push({ fps, id, caught: game.plan.prize?.id || null, reason: game.plan.reason, collection: [...game.collection], rounds: game.rounds, phase: game.phase,
        contacts: game.plan.gripContacts, peakSwing, maxHeldError, maxReleaseDrift, releaseAnchor,
        snap: lastGrip && firstLift ? Math.max(...lastGrip.map((r, i) => Math.abs(r - firstLift[i]))) : null });
    }
    // Show a real held prize, not the empty comparison model, for visual review.
    const game = M.createGame({ carousel: true, suspendedClaw: true }); scene.groundToys(game); M.begin(game); game.position = { x: -.38, z: .72 }; M.drop(game);
    for (let i = 0; i < 240 && !(game.phase === 'lift' && game.elapsed > .8); i++) { M.advance(game, 1 / 60); scene.update(game, 1 / 60, i / 60, { x: 0, z: 0 }, null); }
    scene.camera.position.set(.35, 3.9, 6.1); scene.camera.lookAt(0, 3, 0); render(scene.scene, scene.camera);
    return rows;
  });
  await page.screenshot({ path: '.screenshots/suspended-claw-pickup.png' });
  console.log(JSON.stringify(report, null, 2));
  for (const row of report) {
    // A small residual swing still lands inside Butter's support; plush ears
    // no longer stop it. The larger grip displacement remains a miss.
    const expected = ['side', 'empty', 'displaced'].includes(row.id) ? null : ['swing', 'settled-swing'].includes(row.id) ? 'butter' : row.id;
    assert.equal(row.caught, expected, `${row.fps} FPS ${row.id}: ${row.reason}`);
    assert.equal(row.phase, 'result'); assert.equal(row.rounds, 1);
    assert.deepEqual(row.collection, expected ? [expected] : [], 'one delivery or no prize');
    if (expected) {
      assert.ok(row.contacts.every(id => id === expected), 'all three visible fingers contacted the caught toy');
      assert.ok(row.snap < 1e-8, 'resolved finger contacts carry into lift');
      assert.ok(row.maxHeldError < 1e-8, 'the toy follows the displaced/tilted claw');
      assert.ok(row.maxReleaseDrift < 1e-8, 'released toy no longer follows head swing');
      assert.ok(Math.abs(row.releaseAnchor.x + 1.08) < .12 && Math.abs(row.releaseAnchor.z - .66) < .12, 'release stays over the chute');
    }
    if (row.id === 'swing') assert.ok(row.peakSwing > .005, 'pickup replay actually exercises residual inertia');
  }
  // Contract: plush yields to steel and the aim cue is honest. Near-centre
  // rabbit drops once stopped on rigid ear tips while the hub pierced the head;
  // the points cue promised catches that a finger then bumped. Drops above
  // only test dead centre, so they caught neither.
  const plush = await page.evaluate(async () => {
    const { ArcadeScene } = await import('/src/arcade-scene.js');
    const M = await import('/src/arcade-mechanics.js');
    const { clawWorldPoint } = await import('/src/claw-suspension.js');
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const toys = M.createGame({ carousel: true, suspendedClaw: true, boothToys: true }).toys;
    const scene = new ArcadeScene(canvas, { suspendedClaw: true, assortment: toys }); scene.renderer.render = () => {};
    const settle = (game, id, dx, dz) => {
      const toy = game.toys.find(t => t.id === id); game.position = { x: toy.x + dx, z: toy.z + dz };
      for (let i = 0; i < 120; i++) M.advanceSuspension(game, 1 / 60);
      scene.update(game, 1 / 60, 0, { x: 0, z: 0 }, null);
      const aimed = M.aimTarget(game);
      return aimed && scene.contacts.clearDrop(game, aimed) ? aimed.id : null;
    };
    const grid = [];
    for (const id of ['bonbon', 'miso', 'blue-hour', 'peach', 'butter']) for (const dx of [-.16, -.08, 0, .08, .16]) for (const dz of [-.16, -.08, 0, .08, .16]) {
      const game = M.createGame({ carousel: true, suspendedClaw: true, boothToys: true }); scene.groundToys(game); M.begin(game);
      const cue = settle(game, id, dx, dz); M.drop(game);
      let crownGap = -Infinity, folded = 0;
      for (let frame = 0; frame < 300 && !['lift', 'result'].includes(game.phase); frame++) {
        M.advance(game, 1 / 60); scene.update(game, 1 / 60, frame / 60, { x: 0, z: 0 }, null);
        if (game.phase !== 'grip' || !game.plan.prize) continue;
        // The squashed crown under the hub centre must not rise into the collar.
        const pose = M.clawPose(game);
        const object = scene.toys.get(game.plan.prize.id); object.updateWorldMatrix(true, true);
        const top = clawWorldPoint(pose, { x: 0, y: -.15, z: 0 }), bottom = clawWorldPoint(pose, { x: 0, y: -.85, z: 0 });
        const hit = scene.contacts.hit(object.position.clone().set(top.x, top.y, top.z), object.position.clone().set(bottom.x, bottom.y, bottom.z), [game.plan.prize], 0, true);
        if (hit) crownGap = Math.max(crownGap, hit.point.y - clawWorldPoint(pose, { x: 0, y: -.4925, z: 0 }).y);
        for (const ear of object.userData.articulation) if (ear.kind !== 'paw') folded = Math.max(folded, Math.abs(ear.object.rotation.z - ear.rest.z));
      }
      grid.push({ id, dx, dz, cue, caught: game.plan.prize?.id || null, reason: game.plan.reason, crownGap, folded });
    }
    // A later bump tips away from its own contact, not the first one's.
    const game = M.createGame({ carousel: true, suspendedClaw: true, boothToys: true }); scene.groundToys(game);
    const miso = game.toys.find(t => t.id === 'miso'), bumps = [];
    for (const dx of [.16, -.16]) {
      M.begin(game); settle(game, 'miso', dx, -.04); M.drop(game);
      let direction = null;
      for (let frame = 0; frame < 900 && (game.phase !== 'result' || miso.impact); frame++) {
        if (game.phase !== 'result') M.advance(game, 1 / 60);
        scene.update(game, 1 / 60, frame / 60, { x: 0, z: 0 }, null);
        direction ??= miso.impact ? Math.sign(miso.impact.x) : null;
      }
      bumps.push({ reason: game.plan.reason, direction, cleared: !miso.impact });
    }
    // Aiming at a toy lights the cue; the toy itself does not move.
    const aim = M.createGame({ carousel: true, suspendedClaw: true, boothToys: true }); scene.groundToys(aim); M.begin(aim);
    aim.position = { x: aim.toys.find(t => t.id === 'butter').x, z: aim.toys.find(t => t.id === 'butter').z };
    const body = scene.toys.get('butter').userData.body, matrix = () => (body.updateWorldMatrix(true, false), body.matrixWorld.elements.join());
    scene.update(aim, 1 / 60, 0, { x: 0, z: 0 }, null); const plain = matrix();
    scene.update(aim, 1 / 60, 0, { x: 0, z: 0 }, aim.toys.find(t => t.id === 'butter')); const cued = matrix();
    return { grid, bumps, still: plain === cued };
  });
  for (const row of plush.grid) {
    const at = `${row.id} ${row.dx},${row.dz}`;
    if (row.cue) assert.notEqual(row.reason, 'bumped', `${at}: the points cue promised a drop that bumped`);
    if (row.dx === 0 && row.dz === 0) { assert.equal(row.cue, row.id, `${at}: centred cue`); assert.equal(row.caught, row.id, `${at}: centred catch`); }
    if (row.caught) assert.ok(row.crownGap <= .01, `${at}: hub pierced the crown by ${row.crownGap}`);
  }
  for (const [id, dx, dz] of [['bonbon', 0, -.08], ['butter', 0, -.08], ['butter', -.08, 0]]) {
    const row = plush.grid.find(r => r.id === id && r.dx === dx && r.dz === dz);
    assert.equal(row.caught, id, `${id} ${dx},${dz} near-centre rabbit catch: ${row.reason}`);
    assert.ok(row.folded > .2, `${id} ${dx},${dz} ears fold aside under the claw`);
  }
  assert.deepEqual(plush.bumps.map(b => b.reason), ['bumped', 'bumped']);
  assert.ok(plush.bumps.every(b => b.cleared), 'a settled bump reaction ends');
  assert.equal(plush.bumps[0].direction, -plush.bumps[1].direction, 'mirrored bumps tip opposite ways');
  assert.ok(plush.still, 'the aim cue leaves the toy where it stands');
  // Contract: the active entry retains the selected claw across a real run,
  // scores exactly three accepted drops, and finishes despite hand loss.
  await installCameraFixture(page);
  await page.goto('http://127.0.0.1:4196/?setup=manual');
  await page.waitForFunction(() => document.documentElement.dataset.arcadeReady === 'true');
  await page.locator('#play').click();
  await page.waitForFunction(() => window.__littleCloud.snapshot().event.handCamera.running);
  await page.locator('#play').click();
  await page.locator('#name').fill('Steel claw replay'); await page.locator('#name').press('Enter');
  for (let turn = 1; turn <= 3; turn++) {
    await page.waitForFunction(() => window.__littleCloud.snapshot().phase === 'aim');
    if (turn === 1) {
      await cameraInput(page, { x: 0, z: 0, target: { x: -.38, z: .72 } });
      await page.waitForFunction(() => {
        const p = window.__littleCloud.snapshot().position;
        return Math.hypot(p.x + .38, p.z - .72) < .005;
      });
      await cameraInput(page, { x: 0, z: 0 });
      await page.waitForTimeout(2000);
    }
    assert.equal(await cameraDrop(page), true);
    assert.equal(await cameraDrop(page), false, 'a committed drop cannot score twice');
    await page.evaluate(() => { window.testCamera.visible = false; window.testCamera.tick(); });
    await page.waitForFunction(turn => {
      const e = window.__littleCloud.snapshot().event;
      return (e.run || e.complete)?.turns.length === turn;
    }, turn, { timeout: 20000 });
    const snapshot = await page.evaluate(() => window.__littleCloud.snapshot());
    assert.ok(snapshot.claw.rotation, 'fresh game retains the suspended claw');
    if (turn === 1) assert.equal(snapshot.event.run.turns[0].prizeId, 'butter');
    await page.evaluate(() => { window.testCamera.visible = true; window.testCamera.tick(); });
  }
  const completed = await page.evaluate(() => window.__littleCloud.snapshot().event);
  assert.equal(completed.run, null);
  assert.equal(completed.complete.turns.length, 3);
  assert.equal(completed.board.runs.length, 1);
  assert.equal(completed.complete.total, completed.complete.turns.reduce((sum, t) => sum + t.score, 0));
  assert.equal(await cameraDrop(page), false, 'a completed run cannot accept a fourth drop');
  assert.deepEqual(errors, []);
  console.log('PASS suspended steel claw: mesh pickup, inertia, misses, lift continuity and chute delivery at 60/30/10 FPS');
} finally { await browser.close(); }
