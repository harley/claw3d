# Historical clasp camera evidence

These results describe earlier builds. Their clasp gestures, hold timing and old player instructions are superseded by the fist controls in [PRODUCT.md](../PRODUCT.md). Preserve them as historical evidence, not current operating instructions.

## Evidence

The first camera-feedback iteration keeps recognition and the controlling-hand highlight visible before play and during delivery, while blocking game actions outside aiming. The preview follows the camera aspect ratio and gives a readable next instruction. Automated regressions cover setup without actions, a fresh clasp after blocked input, and preview alignment. Practice now performs one real unscored drop before run creation. The ring is a steering guide, never a gate: an accepted clasp drops at the current position even before reaching it. The complete animation finishes without hands, then PRACTICE COMPLETE visibly leads into three scored turns only after server acknowledgement. Practice creates no run or score submission. Exit Practice is available before a drop and after its result; it cannot interrupt an accepted animation or an outstanding ranked start. Failed ranked starts retain the same retry key. Scored aiming still waits for acquired control; accepted delivery completes after input loss.

Camera captures older than 300 ms, out of order, or from a stopped/restarted/hidden camera generation cannot affect control. Owner loss beyond 650 ms releases the track and requires a stable single hand again. Calibration uses a fixed anchor; the highlighted hand is labeled YOU and its neutral point is shown. Developer snapshots expose capture age and rejection reason without recording frames.

The green moving-star cue means bring already-armed hands together, then hold for 650 ms. It leads the actual contact time by that hold plus the 1.05-second anticipation/descent. Hands must first be shown apart; the cue does not include an arbitrary human reaction or convergence time. Use a new shared pilot board for this control version; existing browser-local results are preserved.

Physical first-time-player acceptance remains outstanding. Automated fixtures are integration evidence only: five first-time visitors must still test acquisition within 10 seconds, rehearsal drop within 15 seconds of acquisition, and three turns without coaching, unintended drops or host recovery. Record hesitation, capture-age behavior, lighting/occlusion and strategy for a second attempt against the final BUILD. No physical gesture result is claimed by this implementation.

Local device smoke test on 2026-09-08 (Vietnam time), code commit `69a7b33`: the actual preview operator panel showed BUILD `69a7b33`; MacBook Pro Camera opened at 960×540 and reached SHOW ONE HAND. The camera was stopped after checking startup. No camera frames were saved, no physical gesture was performed, and the existing interrupted local run was left unchanged. This proves device startup only.

U1–U3 automated verification: 72 unit tests and all five sequential booth browser suites pass. Additional browser checks exercise both 4:3 and 16:9 camera aspect ratios, a successful retry after denied permission, and the displayed star cue followed by a simulated 650 ms hold. The latter is timing integration evidence, not measured human convergence or recognition delay.

`npm run check` checks unit behavior and the build. `npm run check:booth` also runs camera integration, event flow, carousel, contact and delivery checks. Automated checks do not establish gesture feel or spectator impact. Save local screenshots under `.screenshots/` and summarize physical observations here with the tested commit.

## Clearer camera play — September 8

The machine now shows an ivory arcade glove holding the joystick when steering is acquired. This is visual feedback for relaxed-hand control; making a fist is not a new input. The glove follows the stick, shows an amber ring during a clasp hold, and disappears on lost/stale input or blocked control. An accepted drop remains a game-phase decision and finishes after hands leave view. Reduced motion preserves the same ownership states without glove travel.

The main action panel owns setup, recovery, steering and hold instructions in one polite live region. The webcam keeps its uncropped image and a short recognition label. Only the current target receives a score tag; moving-star tags follow the visible star, while jackpot timing still predicts contact. The detailed jackpot cue appears when aiming near its pickup ring. Shared saving/retry messages remain visible.

The retired Blender runtime and its models/tests were removed; the checkpoint branch preserves that prototype. The active procedural scene remains the only player implementation. Rigid carousel trim and target geometry are batched, projection uses the resize dimensions, and unchanged timer/cue text is not rewritten each frame. Frame-history diagnostics run only in development.

Automated feedback checks cover acquired control, apart-before-hold guidance, partial hold/cancellation, stale worker output, modal suppression, reduced-motion calibration, and complete unscored delivery after hand loss. These are synthetic integration checks; five first-time physical-camera runs remain outstanding.

Verification for this pass: 68 unit tests and the build passed; all six sequential booth suites and the built shared-session suite passed. At 1440×900 in headless Chrome, full-quality idle rendering fell from 437 to 400 draw calls with the same 579,490 triangles. Both six-second samples averaged 60 fps (p95 16.7/16.8 ms); this is reduced rendering work, not a measured FPS gain. With the glove and hold feedback visible, the final sample used 408 draw calls. Local screenshots are synthetic and remain ignored.
