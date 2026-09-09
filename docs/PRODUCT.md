# Cloud Claw: one memorable minute

## Promise

At the CoderPush × AWS booth, a visitor controls a tiny claw with their hands, gets three meaningful chances, and leaves with a score worth comparing with friends.

The wow moment is direct control followed by a believable grab, a tense lift and a satisfying score reveal. More text, scene decoration or control modes will not substitute for this.

## Accepted constraints

- Camera-only gameplay: one hand steers; a deliberate fist clench drops. Name entry and host controls may use ordinary form input.
- Three turns, up to 15 seconds of active aiming each, automatic next turns and one final score/rank.
- Five stationary toys worth 100 points; moving star worth 200. Higher reward requires visibly harder timing. Keep results skill-based and avoid hidden random losses.
- Dark arcade presentation, clear CoderPush/AWS branding, spacious zoomed-out play area, brief state-dependent instructions.
- A missed grab should make physical sense. Current contact stops and grounded rocking are constrained approximations, not full rigid-body toppling.
- Standalone preview scores stay in the browser. The protected shared staff pilot stores names and results centrally; client-reported catches remain trusted, so it is not a verified competition backend.
- The leaderboard is for fun and comparison only; rank earns no additional prize. Physical giveaway rules are separate. Min's ball artwork and 20/30/50-point proposal still need alignment with the game before adoption or printing.

## Current milestone: finish a run without coaching

Use the existing prototype. Do not start another rewrite.

1. Make camera setup and hand acquisition obvious. Show one useful instruction at a time; give visible confirmation when steering is ready.
2. Make the fist clench predictable. Verify steering freezes intentionally during confirmation and delivery always finishes after hands leave view. Check jackpot cue timing against the actual fist hold delay before tuning difficulty.
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

## Current camera behavior

Camera recognition and the controlling-hand highlight remain visible during setup and delivery, but only aiming accepts game actions. Calibration uses a fixed anchor; the highlighted hand is labeled YOU and its neutral point is shown. Captures older than 300 ms, out of order, or from a stopped/restarted/hidden camera generation cannot control the game. Capture age stops steering; receipt time detects a tracking delay. Slow but live replies cannot trigger the seven-second no-response shutdown. Owner loss beyond 650 ms requires stable single-hand acquisition again. Frames are not recorded.

Practice performs one real unscored drop before run creation. The ring is a steering guide, never a gate. An accepted drop finishes without hands, then the completed practice leads into exactly three scored turns after server acknowledgement. Exit Practice cannot interrupt an accepted animation or an outstanding ranked start. Scored aiming waits for acquired control.

The action panel owns setup, recovery, steering and hold instructions. The webcam remains uncropped with a short recognition label. The joystick glove follows steering and shows an amber ring during a fist hold. Only the current target receives a score tag. The moving-star cue tells an already-armed player to clench and hold; its lead includes the 550 ms hold and 1.05-second contact delay, but no assumed human reaction time. Reduced motion preserves the same control states. Shared saving/retry messages remain visible.

Earlier clasp control and rendering measurements are preserved in [the historical camera evidence](archive/2026-09-08-clasp-camera-evidence.md). They are not current player instructions or physical acceptance of fist controls.

## Fist drop — September 8

Player feedback found the two-hand clasp unreliable. The active camera adapter now uses only the steering hand: show an open hand, steer, then clench for 550 ms to drop. Opening before confirmation cancels and recentres steering. A second hand, missing/stale capture or blocked input cancels confirmation; reopen before retrying. An accepted drop still finishes without hands and scores only once. The instructions, progress bar and glove ring show fist confirmation, and the moving-star cue uses the same 550 ms hold constant. This supersedes the archived clasp controls and timing. Physical recognition and first-time-player acceptance remain unverified.

Verification for fist drop: 72 unit tests, the production build and all six sequential booth browser suites passed. Regressions cover clasp rejection in fist mode, blocked/stale input, reopen-before-retry, one drop per hold, cancellation and uncertainty. Browser checks cover the active fist profile, visible hold feedback, unscored rehearsal, three scored turns, star timing and delivery clearance. These are automated results, not a physical-camera playtest.

The shared service records the new controls as `camera-fist-hold-550-v2`. On upgrade, its existing rules-version handling starts one fresh board for new runs. Previous boards and scores remain exportable, and pending old-run submissions retain their original board and rules.

Release consistency review: the live jackpot cue now says “CLENCH FIST & HOLD”; practice includes the hold, camera guidance says open-hand steering, and startup/readiness wording matches the rendered UI. All six booth suites and the built shared-session suite passed. A copied live database upgrade preserved three boards, two completed runs and six turns, adding one fresh fist-control board. The regression also checks pending old turns and repeat restarts. Physical first-time-player acceptance remains outstanding.

## Practice-first feedback — September 9

The staff pilot now opens in practice mode. Nickname is optional (blank displays Player); each attempt keeps the existing one-drop warm-up and three scored turns, with unlimited replays. Practice scores stay outside event rankings. The host can uncheck practice for the next player; named event runs retain server acknowledgement and score retries.

“Something felt wrong” is available during play and from results. It captures a category, optional comment and the current build/page session/game state. Saving is acknowledged explicitly; uncertain feedback retries with the same ID. A feedback dialog pauses aiming but cannot freeze an accepted drop.

The shared pilot stores bounded, allowlisted gameplay transitions and coarse performance summaries for 30 days, up to 100,000 events. Camera images, landmarks, names and credentials are excluded from this event stream. Comments are optional and should omit personal details. Host reporting supports daily review by build/mode with counts and page-session denominators. A page session is not a unique person; a reload starts another session. Missing completion is a question to investigate, not proof of a crash. Human first-time-player acceptance and enjoyment still require actual coworkers playing.

Release checks: 85 unit tests and the production build pass; all six sequential booth suites and the built shared-session suite pass. The shared regression covers anonymous practice, unchanged event rankings, feedback retry/idempotency, delivery through the feedback dialog, reporting from renderer failure and ranked score recovery. A copied production database upgrade preserved every board, run, turn and setting row. Focused review corrected Unicode decoding across HTTP chunks and rejected-feedback recovery. These checks use synthetic camera input; physical first-time-player acceptance remains outstanding.

## Tracking timing repair — September 9

A physical-camera report found false hand-loss messages and repeated camera failures. Regressions reproduced two timing faults: continuously late replies could trigger the no-response shutdown, and fresh 250 ms detections could never sustain the fist hold. Fresh detections up to 300 ms apart now preserve confirmation between captures; only time between closed detections counts toward the 550 ms hold. A stale reply still cancels confirmation and requires reopening. Tracking delays now display “Tracking delayed” instead of claiming the hand left the view. The camera remains open while late replies arrive and resumes control when fresh detections return. A truly silent worker still stops after seven seconds. These timing regressions do not measure real-hand recognition accuracy; a physical replay against the repaired build remains required.
