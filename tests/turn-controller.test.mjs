import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, begin, PHASES, MISS_LIFT } from '../src/arcade-mechanics.js';
import { createTurnState, beginTurnState, beginFirstTurnPreparation, requestDrop, stepTurn, nextTurnSeconds, FIRST_TURN_PREPARATION_SECONDS, FIRST_TURN_CONTROL_LOSS_GRACE_SECONDS, HIT_STOP_SECONDS } from '../src/turn-controller.js';

const step = (game, state, dt, options = {}, input = { x: 0, z: 0 }) => stepTurn(game, state, input, dt, options);
const runTurn = (game, state, options = {}) => { const effects = []; for (let i = 0; i < 4000 && !effects.some(e => e.type === 'finish'); i++) effects.push(...step(game, state, 1 / 60, options)); return effects; };

test('three turns, one result each, one drop each; a second request is refused', () => {
  const game = createGame({ carousel: true }), state = createTurnState(15);
  for (let turn = 1; turn <= 3; turn++) {
    beginTurnState(state, 15); assert.ok(begin(game)); game.position = { x: -.38, z: .72 };
    assert.equal(requestDrop(game, state), 'dropped');
    assert.equal(requestDrop(game, state), false, 'no double acceptance');
    assert.equal(state.dropRemainingMs, 15000, 'aiming time locked at the request');
    const effects = runTurn(game, state, { preparing: false });
    assert.equal(effects.filter(e => e.type === 'drop').length, 0, 'the request already dropped; the step never drops twice');
    assert.equal(effects.filter(e => e.type === 'finish').length, 1);
    assert.equal(game.phase, 'result');
  }
});

test('the aiming clock drops once on timeout with zero speed time', () => {
  const game = createGame({ carousel: true }), state = createTurnState(15); begin(game); game.position = { x: -1.18, z: .6 };
  const effects = []; for (let i = 0; i < 16 * 60 && !effects.some(e => e.type === 'drop'); i++) effects.push(...step(game, state, 1 / 60));
  const drops = effects.filter(e => e.type === 'drop');
  assert.equal(drops.length, 1); assert.equal(drops[0].trigger, 'timeout'); assert.equal(state.dropRemainingMs, 0);
  assert.ok(effects.filter(e => e.type === 'tick').length >= 5, 'the last five seconds tick');
  assert.equal(game.phase, 'anticipate');
});

test('a dual strike locks the time at the request, keeps the carousel moving, then drops exactly once', () => {
  const game = createGame({ carousel: true }), state = createTurnState(15); begin(game); game.position = { x: .80, z: .22 };
  state.remaining = 10.5;
  assert.equal(requestDrop(game, state, { dual: true, feedback: { hands: {} } }), 'slam');
  assert.equal(state.dropRemainingMs, 10500);
  const before = game.carouselTime; const effects = [];
  for (let t = 0; t < .5; t += 1 / 60) effects.push(...step(game, state, 1 / 60, { slamSeconds: .36 }));
  assert.ok(game.carouselTime > before, 'the carousel kept turning through the strike');
  assert.equal(effects.filter(e => e.type === 'drop').length, 1);
  assert.equal(state.pendingSlam, null); assert.deepEqual(state.contactFeedback, { hands: {} });
  assert.ok(Math.abs(state.remaining - 10.5) < 1e-9, 'aiming time does not run during the strike');
});

test('the hit-stop holds the world for 80 ms at contact and reduced motion skips it', () => {
  for (const reducedMotion of [false, true]) {
    const game = createGame({ carousel: true }), state = createTurnState(15); begin(game); game.position = { x: -.38, z: .72 };
    requestDrop(game, state);
    while (game.phase !== 'grip') step(game, state, 1 / 120, { reducedMotion });
    const elapsed = game.elapsed; step(game, state, .05, { reducedMotion }); step(game, state, .02, { reducedMotion });
    if (reducedMotion) assert.ok(game.elapsed > elapsed + .06, 'reduced motion: no hold');
    else { assert.ok(Math.abs(game.elapsed - elapsed) < 1e-9, 'held'); step(game, state, .05, { reducedMotion }); assert.ok(game.elapsed > elapsed, 'then resumes'); assert.equal(HIT_STOP_SECONDS, .08); }
  }
});

test('the next turn is announced only while preparing, after the outcome-dependent pause', () => {
  const game = createGame({ carousel: true }), state = createTurnState(15); begin(game); game.position = { x: -1.18, z: .6 };
  requestDrop(game, state); runTurn(game, state); assert.equal(game.phase, 'result'); assert.equal(game.plan.prize, null);
  let effects = []; for (let t = 0; t < 3; t += 1 / 60) effects.push(...step(game, state, 1 / 60, { preparing: false }));
  assert.equal(effects.filter(e => e.type === 'nextTurn').length, 0, 'a finished run or an open dialog never starts the next turn');
  state.nextTurnElapsed = 0; effects = []; let seconds = 0;
  while (!effects.some(e => e.type === 'nextTurn') && seconds < 5) { effects.push(...step(game, state, 1 / 60, { preparing: true })); seconds += 1 / 60; }
  assert.ok(Math.abs(seconds - nextTurnSeconds(false)) < .05, `miss announce ends at ${nextTurnSeconds(false)} s (${seconds.toFixed(2)})`);
});

test('first-turn preparation waits for control and resets after sustained loss', () => {
  const game = createGame({ carousel: true }), state = createTurnState(9);
  beginFirstTurnPreparation(state, 15);
  assert.equal(FIRST_TURN_PREPARATION_SECONDS, 4);
  assert.equal(FIRST_TURN_CONTROL_LOSS_GRACE_SECONDS, .7);
  assert.equal(game.phase, 'idle');
  assert.equal(requestDrop(game, state), false, 'idle preparation cannot accept a drop');

  const carouselAtStart = game.carouselTime, input = { x: 1, z: -1 }, effects = [];
  assert.deepEqual(step(game, state, 1 / 60, { preparing: false, controlReady: true }, input), [], 'a blocking dialog holds preparation');
  assert.equal(state.firstTurnPreparationElapsed, 0);
  for (let i = 0; i < 90; i++) step(game, state, 1 / 60, { preparing: true, controlReady: false }, input);
  assert.equal(state.firstTurnControlReady, false, 'hands must be recognized before countdown begins');
  assert.equal(state.firstTurnPreparationElapsed, 0);

  for (let i = 0; i < 30; i++) step(game, state, 1 / 60, { preparing: true, controlReady: true }, input);
  const elapsedBeforeBriefLoss = state.firstTurnPreparationElapsed;
  for (let i = 0; i < 24; i++) step(game, state, 1 / 60, { preparing: true, controlReady: false }, input);
  assert.equal(state.firstTurnControlReady, true, 'brief camera gaps stay in the current count-in');
  assert.equal(state.firstTurnPreparationElapsed, elapsedBeforeBriefLoss, 'the countdown freezes during a brief loss');
  for (let i = 0; i < 18; i++) step(game, state, 1 / 60, { preparing: true, controlReady: true }, input);
  assert.ok(state.firstTurnPreparationElapsed > elapsedBeforeBriefLoss);
  for (let i = 0; i < 50; i++) step(game, state, 1 / 60, { preparing: true, controlReady: false }, input);
  assert.equal(state.firstTurnControlReady, false, 'sustained control loss returns prep to waiting');
  assert.equal(state.firstTurnPreparationElapsed, 0, 'reacquisition starts again from ROUND 1');
  for (let i = 0; i < 90; i++) step(game, state, 1 / 60, { preparing: true, controlReady: false }, input);
  assert.equal(state.firstTurnPreparationElapsed, 0, 'waiting itself never consumes count-in time');

  let elapsed = 0;
  while (!effects.some(effect => effect.type === 'nextTurn') && elapsed < 4.5) {
    effects.push(...step(game, state, 1 / 60, { preparing: true, controlReady: true }, input));
    elapsed += 1 / 60;
    assert.equal(game.phase, 'idle', 'the first turn stays unstarted during preparation');
    assert.equal(game.carouselTime, carouselAtStart, 'the moving target starts from its existing timing origin');
    assert.equal(state.remaining, 15, 'the full aiming time remains available');
    assert.deepEqual(input, { x: 0, z: 0 }, 'steering input is ignored during preparation');
    assert.equal(effects.some(effect => ['aim', 'drop', 'finish'].includes(effect.type)), false);
  }
  assert.ok(Math.abs(elapsed - FIRST_TURN_PREPARATION_SECONDS) < .02, `count-in ends after ${elapsed.toFixed(2)} s`);
  assert.equal(effects.filter(effect => effect.type === 'nextTurn').length, 1);
  assert.equal(effects.find(effect => effect.type === 'nextTurn').initial, true);
  assert.equal(state.firstTurnPreparationElapsed, null);

  beginTurnState(state, 15); assert.ok(begin(game));
  step(game, state, .1);
  assert.ok(Math.abs(state.remaining - 14.9) < 1e-9, 'aiming time starts only after the count-in');
});

test('a zero step changes nothing and a catch reports its score pop once', () => {
  const game = createGame({ carousel: true }), state = createTurnState(15); begin(game); game.position = { x: -.38, z: .72 };
  const snapshot = JSON.stringify([game.position, state]); step(game, state, 0); assert.equal(JSON.stringify([game.position, state]), snapshot);
  requestDrop(game, state); const effects = runTurn(game, state);
  assert.equal(effects.filter(e => e.type === 'scorePop').length, 1); assert.equal(effects.find(e => e.type === 'scorePop').prizeId, 'butter');
});
