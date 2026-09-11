# Plan: gesture latency, production telemetry, wow pass

Source: Fable 5 full-codebase review, 2026-09-11 session (all of `src/` read, 95/95 unit tests passing at `830cc36` on main). This file is the durable record of that review's findings and the agreed priority order. Follow AGENTS.md loops: one observed problem per iteration, `npm run check` before commit, `npm run check:booth` for camera/phase/scoring/collision changes, browser suites sequential.

## Verdict from the review

Correctness discipline is good (capture-age/out-of-order gates in `src/vision.js:151-172`, phase-boundary-split `advance()` in `src/arcade-mechanics.js:132`, fist arming rules in `src/fist.js`) and must be preserved by every change below. Weaknesses: gesture latency never optimized, telemetry can't measure it, visual payoff is peripheral, ~40% of the input module is dead code, `src/arcade.js` is a 556-line god module.

## Track 1 — Gesture latency chain (do first; the "sharp and swift" core)

Current: MediaPipe GestureRecognizer with `delegate: 'CPU'` (`src/vision-worker.js:10`), capture paced by `setInterval(65)` ≈ 15 Hz (`src/vision.js:101`), main-thread `createImageBitmap` resize to 640px (`src/vision.js:145`), steering smoothed with `input += (target-input)*.5` at result rate while the game consumes at 60 Hz. Felt latency plausibly 150–250 ms; a 550 ms fist hold gets ~8 evidence frames.

Ordered changes, each measured with the existing `onDiagnostic` latency numbers (capture before/after):

1. `delegate: 'GPU'` with automatic CPU fallback on init error.
2. Replace `setInterval(65)` with `video.requestVideoFrameCallback` pacing (keep the `busy` guard).
3. Move capture off the main thread: `MediaStreamTrackProcessor` → transfer `VideoFrame` to the worker (Chrome-only acceptable for the booth; keep the bitmap path as fallback).
4. Test 320px capture vs 640px for accuracy at booth distance.
5. One-euro filter on hand center instead of the fixed 0.5 lerp.
6. Optional, measure-first: switch GestureRecognizer → HandLandmarker (own `fistEvidence()` in `src/fist.js` already does the classification; the classifier head is nearly redundant compute — but it currently provides a rescue vote, so compare miss rates before removing).

Invariants that must survive (regression-tested in `tests/vision.test.mjs`): stale/out-of-order/hidden-capture rejection, owner-loss grace, "fist before arming never drops", input zeroed on any gate failure.

## Track 2 — Production telemetry (so Track 1 and booth targets are measurable)

- Promote `diagnostic` (inference ms, capture age, reject reasons — currently DEV-only in `src/camera-controls.js:9`) into the 30 s `performance` rollup in `src/arcade.js` frame(): vision p50/p95 latency, result rate Hz, reject-rate by reason.
- Gesture funnel events via `playtest.track`: `hold_start`, `drop_fired`, `hold_cancelled {reason: opened|uncertain_reset|hand_lost|frame_gap}`, and `time_to_control` (camera_ready → first owned tracking).
- These map onto the acceptance targets already in `docs/PRODUCT.md` (§ Acceptance targets).

## Track 3 — Wow pass / strong visual cues

- Put fist-hold confirmation where the player looks: fill the target ring as an arc + color ramp (`createTarget`/`update` in `src/arcade-scene.js`), and pre-tension the claw (fingers twitch a few degrees, cable tautens) as hold progress rises.
- Catch payoff: instanced confetti/spark burst on catch, bigger on the 200-pt star. One draw call.
- Animate existing emissives: marquee bulb chase during delivery, strobe on jackpot (pattern already exists in `carouselLights` updates).
- Attract mode in `idle` phase only: marquee chase, occasional toy wave/blink (rigs already exist in `createToy` userData), pulsing "show your hand" cue.
- Small camera push-in during `descend`/`grip` (input is frozen there; reuse the reveal lerp pattern at `src/arcade-scene.js:331`). Keep the no-drift-while-aiming rule.

## Track 4 — Dead code deletion (safe, big readability win)

`getProfile` is hardcoded to `'fist'` (`src/camera-controls.js:7`). Therefore delete: `src/clasp.js` entirely; the `'palm'`/`'clasp'` branches, pinch-steering and open-palm-drop paths in `src/vision.js handle()`; legacy `moveClaw`/`findCatch`/`FIELD` in `src/mechanics.js` (keep `pinchRatio`/`matchHand`/`joystickAxis`/`clamp` — still live); the tests that only exercise deleted paths. Merge duplicated `clamp`/`ease` with `src/arcade-mechanics.js`.

## Track 5 — Perf audit + structure (after the above)

- Measure the star toys' `transmission: .64` material (`src/arcade-art.js:127`) on booth hardware — it forces an extra full-scene transmission pass per frame; consider faking with opacity+clearcoat+sheen.
- Hot-path cleanup in `src/arcade.js`/`src/vision.js`: compute modal/blocked state once per frame instead of 3–5× `document.querySelector('dialog[open]')`; replace the per-frame `JSON.stringify` UI signature; stop reassigning `overlay.width` per draw (`src/vision.js:305`); cache obstacle Box3 in `ToyContacts.rock`.
- Split `src/arcade.js`: audio synth → `arcade-audio.js`, `updateUI`+DOM helpers → `arcade-hud.js`, shared-board sync → own controller. No behavior change.

## Status

Track 1 steps 1–5 implemented 2026-09-11 (steps 2+3 land as one capture-pipeline change; per-step measurement was therefore not performed — recorded here as a deviation from the plan's ordered discipline). Step 6 (HandLandmarker) deliberately deferred: it requires physical-camera miss-rate comparison before removing the classifier's rescue vote.

What shipped: GPU delegate with automatic CPU fallback at init and on a failed first inference (worker heartbeats during the rebuild and announces the delegate flip so diagnostics stay truthful); zero-copy `MediaStreamTrackProcessor` VideoFrame capture on Chrome with `requestVideoFrameCallback` and 65 ms-timer fallbacks, the timer always running as staleness/liveness watchdog; `?capture=N` forces the bitmap path at width N for the 320-vs-640 A/B (step 4 instrumented, accuracy comparison needs booth distance); one-euro filter on the hand centre replacing the fixed 0.5 lerp, with filter reset on every fresh grab so steering starts at zero. CPU-delegate sessions never receive full-resolution stream frames. A 17-agent adversarial review confirmed and fixed 6 defects before integration (phantom-steering bias from filter convergence residue, watchdog cadence regression, unguarded recognizer.close(), rebuild starving the 7 s liveness watchdog, stale delegate attribution, full-res frames to CPU).

Whole-change evidence (synthetic camera, headless Chrome dev build — NOT physical validation): capture-age p50 25.2→9.8 ms, p95 28.5→21.6 ms, result rate 14.7→19.7 Hz, delegate GPU, driver stream. Booth-hardware before/after and felt-latency playtest remain open, as does the step 4 accuracy A/B.

Track 2 implemented 2026-09-11 (branch `feat/track2-production-telemetry`): the 30 s `performance` rollup now carries vision latency p50/p95, result rate and capture-reject counts by reason (aggregated in `camera-controls.js`, no longer DEV-only); the gesture funnel ships as `hold_start`, `hold_cancelled {cause}` and `time_to_control {acquisitionMs}`, signalled from `FistDrop`/`HandController` without touching recognition behaviour. Deviation from the plan: no separate `drop_fired` event — the existing `drop {trigger: 'gesture'}` already records exactly that funnel terminal, so a duplicate type was not added. Host report cohorts aggregate the new fields; server allowlist extended accordingly. § Acceptance targets in PRODUCT.md now names the metric behind each target.

Tracks 3–5 not started. Track 3 is player-facing; 4–5 are hygiene.
