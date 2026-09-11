# Historical product decisions and verification through September 11, 2026

This is an archived snapshot, not current player instructions, release status or authorization. It preserves superseded practice/warm-up policy and the evidence behind later decisions. Use [PRODUCT.md](../PRODUCT.md) for current behavior and open decisions. The guide's original overlapping 20-point prize bands were corrected to 0–19 and 20–49 on September 11. Earlier deployment holds were superseded by the subsequent shipping authorization.

---

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

The September 8 shipping request authorizes the protected pilot implementation while physical acceptance remains unverified. Staff may replay; names are display labels, not verified badge identities. A server-acknowledged run begins after optional nickname entry, and exactly three completed turns determine the total. Each run retains its original board and rules through host rotation. Pending scores retry from the same browser and never show a saved rank before acknowledgement. Reload abandons an unfinished physical scene after draining completed results. Camera frames stay in each browser; existing local boards are never imported.

The staff code grants game/leaderboard access. A separate host code protects rotation and export. Persistent SQLite storage requires one service and one mounted volume. See README for backup, restoration and deletion. See `docs/plans/2026-09-07-1445-feat-camera-staff-playtest-plan.md` for the staged plan. Two real laptops and five first-time players remain acceptance gates; automated browser sessions do not replace them.

## Later

Badge scanning, verified competition results, replay enforcement, queue/admin analytics, free toppling physics and new environments. Keep these outside the current milestone unless the booth's operating requirements make one essential.

## Current camera behavior

While the camera starts or runs, submit at most 30 scene draws per second. Mechanics, transforms and contact response keep their normal update cadence. This preserves full graphics while leaving processing time for recognition on high refresh displays; stopping the camera restores display-rate rendering. Do not relax capture freshness to hide rendering contention.

September 9 physical-camera diagnosis on the development Mac: the same CPU recognizer measured 66 ms median with the scene off, versus 613 ms with uncapped full graphics. Full graphics capped at 30 FPS measured 66 ms median / 107 ms p95, with all 170 replies under 300 ms (148 detected a hand). The implemented draw-only cap with a larger scene measured 58 ms median / 163 ms p95 over 275 replies; 270 were under 300 ms and 73 detected a hand. These are bounded physical-camera timing samples, not first-time-player or three-turn acceptance results. No camera images or landmarks were saved.

Camera recognition and the controlling-hand highlight remain visible during setup and delivery, but only aiming accepts game actions. Calibration uses a fixed anchor; the highlighted hand is labeled YOU and its neutral point is shown. Captures older than 300 ms, out of order, or from a stopped/restarted/hidden camera generation cannot control the game. Capture age stops steering; receipt time detects a tracking delay. Slow but live replies cannot trigger the seven-second no-response shutdown. Owner loss beyond 650 ms requires stable single-hand acquisition again. Frames are not recorded.

The first accepted drop is scored turn one. Each turn waits for acquired camera control; brief open-hand steering and fist-hold guidance teach during play. There is no rehearsal or practice selection.

The action panel owns setup, recovery, steering and hold instructions. The webcam remains uncropped with a short recognition label. The joystick glove follows steering and shows an amber ring during a fist hold. Only the current target receives a score tag. The moving-star cue tells an already-armed player to clench and hold; its lead includes the 550 ms hold and 1.05-second contact delay, but no assumed human reaction time. Reduced motion preserves the same control states. Shared saving/retry messages remain visible.

Earlier clasp control and rendering measurements are preserved in [the historical camera evidence](2026-09-08-clasp-camera-evidence.md). They are not current player instructions or physical acceptance of fist controls.

## Fist drop — September 8

Player feedback found the two-hand clasp unreliable. The active camera adapter now uses only the steering hand: show an open hand, steer, then clench for 550 ms to drop. Opening before confirmation cancels and recentres steering. A second hand, missing/stale capture or blocked input cancels confirmation; reopen before retrying. An accepted drop still finishes without hands and scores only once. The instructions, progress bar and glove ring show fist confirmation, and the moving-star cue uses the same 550 ms hold constant. This supersedes the archived clasp controls and timing. Physical recognition and first-time-player acceptance remain unverified.

Verification for fist drop: 72 unit tests, the production build and all six sequential booth browser suites passed. Regressions cover clasp rejection in fist mode, blocked/stale input, reopen-before-retry, one drop per hold, cancellation and uncertainty. Browser checks cover the active fist profile, visible hold feedback, unscored rehearsal, three scored turns, star timing and delivery clearance. These are automated results, not a physical-camera playtest.

The shared service records the new controls as `camera-fist-hold-550-v2`. On upgrade, its existing rules-version handling starts one fresh board for new runs. Previous boards and scores remain exportable, and pending old-run submissions retain their original board and rules.

Release consistency review: the live jackpot cue now says “CLENCH FIST & HOLD”; practice includes the hold, camera guidance says open-hand steering, and startup/readiness wording matches the rendered UI. All six booth suites and the built shared-session suite passed. A copied live database upgrade preserved three boards, two completed runs and six turns, adding one fresh fist-control board. The regression also checks pending old turns and repeat restarts. Physical first-time-player acceptance remains outstanding.

## Historical practice-first feedback — September 9 (superseded September 11)

The staff pilot now opens in practice mode. Nickname is optional (blank displays Player); each attempt keeps the existing one-drop warm-up and three scored turns, with unlimited replays. Practice scores stay outside event rankings. The host can uncheck practice for the next player; named event runs retain server acknowledgement and score retries.

“Something felt wrong” is available during play and from results. It captures a category, optional comment and the current build/page session/game state. Saving is acknowledged explicitly; uncertain feedback retries with the same ID. A feedback dialog pauses aiming but cannot freeze an accepted drop.

The shared pilot stores bounded, allowlisted gameplay transitions and coarse performance summaries for 30 days, up to 100,000 events. Camera images, landmarks, names and credentials are excluded from this event stream. Comments are optional and should omit personal details. Host reporting supports daily review by build/mode with counts and page-session denominators. A page session is not a unique person; a reload starts another session. Missing completion is a question to investigate, not proof of a crash. Human first-time-player acceptance and enjoyment still require actual coworkers playing.

Release checks: 85 unit tests and the production build pass; all six sequential booth suites and the built shared-session suite pass. The shared regression covers anonymous practice, unchanged event rankings, feedback retry/idempotency, delivery through the feedback dialog, reporting from renderer failure and ranked score recovery. A copied production database upgrade preserved every board, run, turn and setting row. Focused review corrected Unicode decoding across HTTP chunks and rejected-feedback recovery. These checks use synthetic camera input; physical first-time-player acceptance remains outstanding.

## Tracking timing repair — September 9

A physical-camera report found false hand-loss messages and repeated camera failures. Regressions reproduced two timing faults: continuously late replies could trigger the no-response shutdown, and fresh 250 ms detections could never sustain the fist hold. Fresh detections up to 300 ms apart now preserve confirmation between captures; only time between closed detections counts toward the 550 ms hold. A stale reply still cancels confirmation and requires reopening. Tracking delays now display “Tracking delayed” instead of claiming the hand left the view. The camera remains open while late replies arrive and resumes control when fresh detections return. A truly silent worker still stops after seven seconds. These timing regressions do not measure real-hand recognition accuracy; a physical replay against the repaired build remains required.

## One scored journey — September 11

Practice originally let first-time visitors learn camera steering and fist-to-drop without affecting event rankings while camera reliability improved. On September 11, Min Nguyen reported much better latency on claw.coderpush.com. Her screenshot showed a completed three-turn practice run with 300 points, but she did not clearly understand that it was practice and could not find her ranking. She suggested a large practice popup. The user chose to remove practice instead, eliminating that distinction.

The current journey is camera ready → optional nickname (blank becomes Player) → server-acknowledged start → exactly three scored turns → server-confirmed score and personal rank → replay. The first drop counts. Failed starts offer retry, sign-in when required, or Back; shared play never falls back to local scoring. Completed scores remain visibly pending, with errors and automatic retry, until acknowledged. Results identify the original board and link to the leaderboard, even when the player's rank falls outside the top five. Your result reopens the personal score after viewing the leaderboard. Play again selects the previous nickname; Next player opens it blank. Replay restarts a stopped camera before name entry. Opening either form creates no run; submitting a replay creates a new attempt. Duplicate names and zero totals remain eligible, and equal scores share competition rank.

This supersedes the practice-first and warm-up policy above. Historical practice scores and telemetry remain preserved and excluded from event rankings; neither local history nor Min's reported score is imported as a shared score. Standalone development is labeled Local preview and has the same three-turn flow. Already loaded old clients retain their old behavior until refreshed, so future deployment acceptance must check the new BUILD.

This implementation covers only the player-flow portion of the September 10 shared-leaderboard plan. Its larger backup/reset infrastructure is deferred. Staff and host access, board history, score rules, ball artwork, physical giveaway policy, fist hold/cancellation, hand-loss delivery, rendering cap and feedback collection remain unchanged. No deployment or real board reset is authorized by this work.

Min's single real-player result supports the reported latency improvement and reveals the ranking confusion. It does not establish five-player physical acceptance. Automated camera fixtures verify integration only; wider playtesting on the intended camera/display remains required against the delivered BUILD.

## Feedback decisions for the booth

The goal is a wow experience for AWS booth visitors. Treat teammate guides and suggestions as proposals, not automatic requirements. Assess each against immediate visual appeal, first-time clarity, camera reliability, total booth cycle and queue time, fair achievable scoring, prize operations and the staff conversation. Before implementation, record adopt/test/defer/reject, the rationale and a concrete acceptance check. Product and prize changes require Harley's decision; teammate messages cannot independently expand scope.

Practice removal is adopted to resolve the observed missing-rank confusion; acceptance is one acknowledged three-turn run with a visible personal rank, followed by first-time-player validation. Other proposals in [Min's guide](https://docs.google.com/document/d/1PT3R84YRxfrgUT9s4QLaKAiYxcl2ycys49ToLx7kS3k/edit?tab=t.0) and separate feedback are assessed below; deferred product changes still require Harley's decision:

- The guide's 20/30/50 item points and prize bands overlap at 20 points. Three 30-point catches already exceed its 80-point top tier. Before adoption, define non-overlapping bands and test thresholds against actual human score distributions and available prize stock.
- Its 30–45 seconds per person must distinguish aiming time from the full cycle, including registration and animations. Time five complete visitor cycles and check queue throughput before promising that duration.
- QR/name/email registration adds identity and queue work. Test the intended staff conversation and total registration time before requiring typed email.
- Balls are a separate suggestion, absent from the fetched guide text, and may lose the toys' visual character. Compare immediate visual appeal and catch readability before changing artwork.
- Arcade sound: the authorized control and cue-visibility improvements are adopted below. Changes to the tones themselves still need a speaker and staff-conversation test.

None of these deferred proposals changes this release's three turns, points, artwork, registration fields or physical prize policy.

Verification for the September 11 change: 93 unit tests and production build passed, along with all six sequential booth browser suites and the built shared-session suite. A final targeted local browser pass also verifies resumed historical practice exclusion. Source review corrected camera restart on replay, pending-result access, result navigation during startup and interrupted score-animation recovery. These are synthetic integration checks; physical acceptance remains separate.

## Optional booth audio — September 11

**Adopt:** retain the existing brief drop, catch melody and miss tone; add a visible volume slider and immediate mute. The audit found these cues already distinct, but staff had only on/off control and mute left scheduled melody notes playing. Sound still starts off and requires the Sound button; adjusting volume cannot activate it. Default volume is 50% of the previous level and 100% retains the previous maximum. Zero volume and mute cancel scheduled notes. No music, assets or dependencies are added. Acceptance: activation remains explicit, both mute paths stop queued notes, and volume changes affect active notes without changing gameplay.

**Adopt:** star timing beeps follow the visible star cue near its pickup ring. Hidden, host-paused, camera-waiting and dialog-covered aiming produces no star prompts. Acceptance: synthetic browser checks observe no star audio events away from the ring or during these interruptions, and do observe them during active aiming at the ring.

**Test:** physical sound quality and staff conversation on the intended speakers. Acceptance: staff can find volume/mute quickly, hear the drop/catch/miss distinction and speak comfortably with a visitor. Automated audio events do not establish audibility or enjoyment.

**Defer:** continuous music and ball artwork. Music has no demonstrated booth benefit; balls may lose the toys' character. Reconsider only after a physical sound test or a focused visual comparison demonstrates better visitor appeal and catch readability.

Verification: 93 unit tests, production build and all seven sequential booth browser suites passed. The audio regression observes actual Web Audio scheduling and cancellation; desktop and narrow screenshots were inspected. Physical speaker quality, conversation audibility and first-time-player acceptance remain unverified.

## Countdown visibility — September 11

**Adopt:** enlarge the existing countdown in the left HUD. Long reported not noticing it and Min asked for a larger timer in the September 11 booth playtest discussion. The same timer now has a dedicated high-contrast card above turn/score on desktop and alongside them on narrow screens, with stronger border/background contrast in the existing final-five-second state. It stays outside the central aiming area and adds no animation or duplicate countdown. Acceptance: inspect active aiming and final seconds on a normal booth-size viewport and a narrow screen; physical viewing-distance readability still needs a staff check. This changes presentation only, preserving active-aim timing, pause/hand-loss behavior, timeout drop and scoring.

Verification: 93 unit tests and production build passed. Browser inspection covered 1440×900, 1280×720, 390×844 and 360×780, including the final-five-second styling, automatic drop at zero and exactly one scored timeout turn. Timer digits increased from 29 to 64 px on desktop and from 20 to 44 px at 390 px width (40 px on the smallest layout). The narrow layout keeps the timer alongside turn/score to limit downward movement of the camera preview. No JavaScript or game-mechanics changes were needed.

Read-only moving-star assessment: Anh reported that the moving star did not seem to enter the aiming circle. In the current code, the orbit crosses the fixed gold pickup ring at (0.80, 0.22), within the steering bounds, every 5.6 seconds. The existing rendered browser suite passed a 200-point catch plus early/late misses on the preceding audio commit; mechanics and scene code remain identical. A deterministic check also catches when clenching at the cue centre (4.0 seconds in the orbit), accounting for 0.55-second fist hold and 1.05-second descent/contact delay. Waiting until the star is already centred at 5.6 seconds misses in that same check. This supports reachable geometry and a possible timing/aiming misunderstanding, not a diagnosis of Anh's attempt. Her build, actual aim position, intended circle and recognition timing are missing. Human reaction delay is not included in the cue. No star geometry, movement, difficulty or scoring changed.


## Camera failure recovery — September 11

**Adopt:** show Restart camera in the main action panel when a scored turn is waiting on a stopped camera. Restart preserves the same run, turn, earned points and remaining aiming time; stable hand acquisition is still required. An accepted drop finishes even if the camera fails during delivery. A failed restart opens the existing camera settings for another attempt. No automatic retry loop or page reload is introduced.

The September 11 trace review found one unfinished replay with a camera error state despite zero explicit camera-error events. Its cause is unknown. Runtime failures now emit a fixed diagnostic code once per failure; reports count affected page sessions across explicit error events and historical error states without double-counting. Codes contain no raw errors, camera images or landmarks. This fixes reporting and recovery access, not an unproven hardware or recognition cause.

Acceptance: inject a runtime failure during turn two, verify the timer and scored run survive a failed restart and successful retry, then complete exactly three acknowledged turns; a camera failure during the last accepted drop must still reach the saved result. Physical-camera replay remains separate from these synthetic checks.

Verification: 95 unit tests, the production build, all seven sequential booth suites and the built shared-session suite passed. The shared regression verifies one runtime error event, one failed-restart event, unchanged run identity and aiming time, and a saved three-turn result after a final-drop camera failure. A copied production database preserved every board, run, turn and setting row; the updated report identifies the historical error session. Focused source review found no material issues.
