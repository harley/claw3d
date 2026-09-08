# Cloud Claw: one memorable minute

## Promise

At the CoderPush × AWS booth, a visitor controls a tiny claw with their hands, gets three meaningful chances, and leaves with a score worth comparing with friends.

The wow moment is direct control followed by a believable grab, a tense lift and a satisfying score reveal. More text, scene decoration or control modes will not substitute for this.

## Accepted constraints

- Camera-only gameplay: one hand steers; a deliberate two-hand clasp drops. Name entry and host controls may use ordinary form input.
- Three turns, up to 15 seconds of active aiming each, automatic next turns and one final score/rank.
- Five stationary toys worth 100 points; moving star worth 200. Higher reward requires visibly harder timing. Keep results skill-based and avoid hidden random losses.
- Dark arcade presentation, clear CoderPush/AWS branding, spacious zoomed-out play area, brief state-dependent instructions.
- A missed grab should make physical sense. Current contact stops and grounded rocking are constrained approximations, not full rigid-body toppling.
- Standalone preview scores stay in the browser. The protected shared staff pilot stores names and results centrally; client-reported catches remain trusted, so it is not a verified competition backend.
- The leaderboard is for fun and comparison only; rank earns no additional prize. Physical giveaway rules are separate. Min's ball artwork and 20/30/50-point proposal still need alignment with the game before adoption or printing.

## Current milestone: finish a run without coaching

Use the existing prototype. Do not start another rewrite.

1. Make camera setup and hand acquisition obvious. Show one useful instruction at a time; give visible confirmation when steering is ready.
2. Make the clasp predictable. Verify steering freezes intentionally during confirmation and delivery always finishes after hands leave view. Check jackpot cue timing against the actual clasp hold delay before tuning difficulty.
3. Make success and failure readable. Check finger contact, toy reaction, lift tension and final score from the visitor's viewing position.

Work on one item at a time. The next engineering change should come from the first failing step in a physical-camera playtest.

## Acceptance targets, not measured results

Test five first-time players on the intended booth camera/display, without coaching after name entry. Record build ID, completion time, where they hesitate, unintended drops and freezes. Do not record their video by default.

- All five complete a three-turn run without a stuck state or host recovery.
- At least four acquire control within 10 seconds and understand the drop gesture without explanation.
- A normally tracked run finishes in about 60–90 seconds; note setup or tracking delays separately.
- No duplicate score, extra turn or leaderboard loss on normal completion/reload.
- Ask each player what they would try differently on another run. A specific answer is useful evidence that the game invites another attempt; do not infer excitement from automated checks.

After each session, select the single biggest obstacle, change it, commit it and replay the same scenario. Adjust scores/difficulty only after control reliability is established; competitive rule changes need a new leaderboard session.

## Shared staff playtest

The September 8 shipping request authorizes the protected pilot implementation while physical acceptance remains unverified. Staff may replay; names are display labels, not verified badge identities. A server-acknowledged run follows rehearsal, and exactly three completed turns determine the total. Each run retains its original board and rules through host rotation. Pending scores retry from the same browser and never show a saved rank before acknowledgement. Reload abandons an unfinished physical scene after draining completed results. Camera frames stay in each browser; existing local boards are never imported.

The staff code grants game/leaderboard access. A separate host code protects rotation and export. Persistent SQLite storage requires one service and one mounted volume. See README for backup, restoration and deletion. See `docs/plans/2026-09-07-1445-feat-camera-staff-playtest-plan.md` for the staged plan. Two real laptops and five first-time players remain acceptance gates; automated browser sessions do not replace them.

## Later

Badge scanning, verified competition results, replay enforcement, queue/admin analytics, free toppling physics and new environments. Keep these outside the current milestone unless the booth's operating requirements make one essential.

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
