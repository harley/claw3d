# Cloud Claw: one memorable minute

## Promise

At the CoderPush × AWS booth, a visitor controls a tiny claw with their hands, gets three meaningful chances, and leaves with a score worth comparing with friends.

The wow moment is direct control followed by a believable grab, a tense lift and a satisfying score reveal. More text, scene decoration or control modes will not substitute for this.

## Accepted constraints

- Camera-only gameplay: one hand steers; a deliberate fist clench drops. Player menus use a mirrored hand cursor and a held fist to select. Names are generated and editable; host controls use ordinary input.
- Three turns, up to 15 seconds of active aiming each, automatic next turns with a Round → 3 → 2 → 1 → Start announcement and one final score/rank.
- Five stationary toys worth 100 base points; moving star worth 200. Successful catches add 0–50 speed points based on aiming time remaining when the drop is accepted. Higher reward requires visibly harder timing. Keep results skill-based and avoid hidden random losses.
- Dark arcade presentation, clear CoderPush/AWS branding, spacious zoomed-out play area, brief state-dependent instructions.
- A missed grab should make physical sense. Current contact stops and grounded rocking are constrained approximations, not full rigid-body toppling.
- Standalone preview scores stay in the browser. The protected shared staff pilot stores names and results centrally; client-reported catches remain trusted, so it is not a verified competition backend.
- The leaderboard is for fun and comparison only; rank earns no additional prize. Physical giveaway rules are separate. Min's ball artwork and 20/30/50-point proposal still need alignment with the game before adoption or printing.


## Local hands-free and speed-score trial

Camera startup runs on launch; the browser still controls permission and may prompt on first use. A refusal opens camera setup with an explicit retry, without a retry loop. `?setup=manual` disables automatic camera and sound startup for diagnostics and existing setup tests.

The menu cursor maps a mirrored hand centre across the screen. Point at PLAY, START, Back, replay, Next player or leaderboard, then hold a fist for 550 ms. The highlighted target locks during the hold. Lost/stale tracking cancels selection. Moving between menus and gameplay resets ownership and requires reopening the hand, preventing a menu gesture from dropping the claw. Operator, feedback and sign-in controls remain ordinary inputs. Generated names such as NOVA-482 are display labels and can be edited; duplicates are allowed.

Player copy uses short action/status labels. Routine subtitles are removed; privacy notices, recovery instructions and save errors remain. The timer shows the current speed bonus, target tags show the available catch total, and results split base points from speed points.

Rules `cloud-day-speed-v3` score a catch as base + floor(50 × remaining aiming milliseconds / 15000). Misses remain zero. Time locks at drop acceptance; hand loss, host pause, menus and delivery do not consume bonus time. Exactly three turns still count. Local and shared rule upgrades start a separate board and preserve old results; interrupted local runs remain in export, and shared pending runs retain their original rules. Shared timing, like catches, is client-reported rather than competition-grade verification. This local trial still needs physical hand targeting and first-time-player testing before deployment.

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

Production telemetry now measures these targets directly: `time_to_control` records camera-ready-to-first-tracking acquisition against the 10-second target, the gesture funnel (`hold_start` → `drop` or `hold_cancelled` with cause opened/uncertain_reset/hand_lost/frame_gap/blocked/stale) quantifies unintended drops and confirmation friction, and the 30-second `performance` rollup carries vision latency percentiles, result rate and capture-reject counts. Telemetry supports but never replaces observing the five players in person.

## Current player journey

Automatic camera startup → generated editable callsign → server-acknowledged start → exactly three scored turns → server-confirmed total and personal rank. The first drop counts. There is no practice toggle or warm-up. Historical practice scores and telemetry remain stored and excluded from event rankings; they are never imported into the shared board.

After turns one and two, the centre shows ROUND 2 or ROUND 3 for 0.9 seconds, counts 3, 2, 1 for 0.7 seconds each, then shows START! for 0.7 seconds before aiming resumes. The camera returns to the full machine while the player prepares. This announcement consumes no aiming time and accepts no drop; no click is required. Host pause, an open dialog or a hidden page holds the announcement. Missing hands hold aiming after it. A miss lifts and returns the empty claw home, then scores zero immediately; it skips the empty release, shelf delivery and reveal. The next aim begins 8.5 simulation seconds after an accepted missed drop, or 6.6 seconds after MISSED appears, versus 10.6 and 8.5 previously. A successful drop completes its full delivery in 8.8 seconds; the next aim begins 12.5 seconds after acceptance instead of 16.25. Every delivery phase remains, with a smoothly revealed courier tray. Sustained 10 FPS advances at real time; gaps longer than 100 ms remain capped to prevent a resumed or blocked frame from skipping contact and outcome boundaries. The wooden outlet floor sits above the red cabinet base so overlapping surfaces cannot flash red through the wood.

Failed starts offer retry, sign-in when required or Back, without local scoring fallback. Pending results remain visibly unsaved until acknowledged. Results show their original board and personal rank, including ranks outside the top five. View leaderboard and Your result switch between the board and personal result. Reopening results restores the full score if its animation was interrupted.

Play again selects the previous nickname; Next player generates a new callsign. Neither creates a run before submission. Replay restarts a stopped camera before name entry. Duplicate names and zero totals remain eligible; equal totals share competition rank. Staff replay is available for testing. Event-day one-play/one-prize enforcement is a separate unresolved policy and must not be implemented using nicknames.

Standalone development is labeled Local preview and keeps scores in that browser. Reloaded legacy local practice runs remain excluded from rankings. An already loaded older client keeps its behavior until refreshed; check BUILD before starting a new playtest.

## Camera control and recovery

One open hand steers; a deliberate fist held for 550 ms locks the drop. Opening early cancels and recentres steering. A second hand, missing/stale capture or blocked input cancels confirmation; reopen before retrying. The central message uses white sans-serif lettering on a compact solid dark backing, without the red offset shadow; supporting instructions have the same dark backing for contrast over the cabinet. The first tracked turn shows one compact “Clench & hold to drop” instruction without a subtitle. After the first accepted drop, normal tracked aiming leaves the centre clear for the rest of that run; the live-region instruction remains available to assistive technology. Each new player/run gets the instruction again. Hold confirmation and camera recovery remain visible when needed, including the instruction to reopen after a cancelled hold. Near the star, its existing timing cue replaces duplicate central guidance. Idle, round announcements and missed returns no longer add routine subtitles. The uncropped camera view identifies the controlling hand, and an amber glove ring shows hold progress. Only the current target receives a score tag.

Fresh detections up to 300 ms apart preserve confirmation between captures; only time between closed detections counts toward the hold. Captures older than 300 ms, out of order or from a stopped/restarted/hidden generation cannot control the game. Owner loss beyond 650 ms requires stable single-hand acquisition again. Late but live replies show Tracking delayed; a worker silent for seven seconds stops the camera.

When delayed tracking resumes, the returning hand establishes a fresh steering neutral, including interruptions shorter than the ownership grace period. This prevents movement from the old neutral before the player deliberately moves again. Rendered synthetic timing checks cover delayed/missing input and hold cancellation; physical gesture quality still requires booth testing.

Steering follows the hand centre through a one-euro filter: still hands stay planted, deliberate moves track without trailing lag, and every fresh grab or re-acquisition starts steering at exactly zero. Hand tracking prefers the GPU delegate with automatic CPU fallback (at startup and on a failed first inference); on Chrome, capture streams camera frames zero-copy to the worker instead of a fixed 15 Hz timer, with `requestVideoFrameCallback` and timer fallbacks elsewhere. A CPU-fallback session keeps the resized 640 px capture path. Synthetic headless measurement recorded capture-age p50 25→10 ms and result rate 15→20 Hz for this change; felt latency on booth hardware still needs physical playtesting.

Sustained performance problems now trigger measured adaptation instead of relaxing input safety. While the camera runs, two consecutive poor five-second windows—rendering below 24 FPS, low camera-result rate, or at least 15% rejected captures—select simple rendering and a 320 px worker capture path. Six consecutive healthy camera windows restore full quality; camera-off time never counts as recovery. An operator selection pins quality until reload. The 300 ms capture-age limit, fist evidence and ownership rules do not change. The existing 30-second telemetry rollup remains separate from the adaptation windows. An explicit diagnostic `?capture=N` override is never replaced automatically. Synthetic tests verify the thresholds and capture-driver transition; physical Firefox/Ubuntu responsiveness remains an acceptance test.

If a browser cannot give MediaPipe an `OffscreenCanvas` inside its worker, the worker explicitly hands initialization back to a timer-paced main-thread runtime. This avoids MediaPipe's worker-side `document is not defined` canvas fallback on affected iPhone WebKit versions. The compatibility runtime reads the video element directly, retains GPU→CPU recovery and is disposed if camera stop or switching wins during startup. Engine-level tests establish startup behavior, not iPhone or Ubuntu hardware acceptance.

Missing hands, camera setup and feedback dialogs hold aiming but never freeze an accepted drop. Only explicit host pause stops an in-flight drop; hidden pages suspend scene progression until visible. Restart camera appears beside the camera preview on narrow screens and below the cabinet on desktop when a scored turn is waiting on a stopped camera. Restart preserves run identity, turn, earned points and remaining aiming time, then waits for stable hand acquisition. A failed restart opens camera settings for another attempt. There is no automatic retry loop or required page reload.

While the camera starts or runs, submit at most 30 scene draws per second. Mechanics, transforms and contact response retain their update cadence. Stopping the camera restores display-rate rendering. The physical timing evidence behind this cap is preserved in [the historical record](archive/2026-09-11-product-history.md); it does not establish first-time-player acceptance. Camera frames and landmarks are not recorded.

## Countdown, audio and moving star

The same countdown is prominent in the left HUD: 64 px desktop digits, 44 px at 390 px width and 40 px on the smallest layout. The existing final-five-second state adds stronger contrast without animation. Narrow screens keep the timer beside turn/score to limit camera-preview displacement. Active aiming time, expiry/drop behavior and scoring are unchanged.

Sound defaults on at 50%. The browser may require one trusted click or key before audio starts; TAP FOR SOUND exposes this state. Recognized hand gestures cannot unlock browser audio. Muting persists for the page session, and normal interactions never undo mute. The visible slider cannot activate sound; its default is 50% of the previous level and its maximum is the previous maximum. Mute and zero volume cancel queued notes. A quiet original melody plays during active camera aiming, and quiet motor-like pulses accompany actual hand-controlled claw movement, capped at one pulse per 140 ms and silent at rest or travel limits. The melody stops during camera waiting, drops, round announcements, dialogs, host pause, hidden pages, mute and zero volume. Original major-key fanfares accompany drop acceptance, successful trophy travel to the shelf and completion of every three-turn run, including zero totals. Each fanfare is finite (under 2.4 seconds), with no downloaded audio assets. Host pause, settings dialogs and hidden pages cancel queued notes; the final-result dialog permits its completion fanfare. Grip and catch/miss cues still follow their phases. A single bold upper-centre message shows DROP immediately, then GOT IT/MISSED at lift (about 1.9 seconds after acceptance). These messages clear after at most 1.6 seconds; delivery narration and the separate celebration banner are removed. Points still appear only at turn completion. Camera recovery guidance remains persistent, while routine aiming guidance clears after the first drop; the live status region retains accessibility. Reduced motion disables the brief text entrance. Narrow layouts keep the camera view below the cabinet to leave the claw and toys clear. Star beeps require the visible, active near-ring cue; they stay quiet during pause, dialogs, hidden pages and camera waiting. No downloaded sound assets or fonts are used. [Asset research and performance evidence](archive/2026-09-11-arcade-presentation.md) records the original synthesis decision and primary-source licenses. Physical speaker audibility and comfortable staff conversation still need testing on the released mix; organizer permission for an external speaker is unconfirmed.

The moving star crosses the fixed gold pickup ring at (0.80, 0.22), inside steering bounds, every 5.6 seconds. Its cue includes 550 ms fist hold and 1.05 seconds to contact, but no assumed human reaction delay. The toy moves during descent; the catch resolves from the actual contact pose.

The jackpot countdown invites the player to start a fist hold. While confirmation is progressing, its text says KEEP HOLDING instead of returning to WAIT FOR THE LIGHTS when the start window expires. Opening the hand restores the current countdown. Cue lights, audio and catch timing are unchanged.

Anh's report that it never seemed to enter the aiming circle is unresolved. Current geometry is reachable: the rendered browser suite catches for 200 points and rejects early/late attempts. A deterministic check catches when clenching at the cue centre (4.0 seconds in the orbit), but misses when waiting until the toy is already centred (5.6 seconds). This suggests timing or aiming confusion as a possibility, not a diagnosis. Her exact BUILD, aim position, intended circle and recognition timing are missing. Do not change geometry or difficulty without that evidence.

## Shared scoring, observations and operations

The protected pilot stores names and results centrally. Names are display labels, not verified badge identities, and client-reported catches remain trusted. Each run retains its board and rules through host rotation. Completed turns enter a durable browser outbox and retry without duplicate scores; rank appears only after server acknowledgement. Reload drains completed results and abandons the unfinished physical scene. Existing local boards are never imported.

The staff code grants game/leaderboard access; a separate host code protects rotation and export. Persistent SQLite storage uses one service and one mounted volume. Existing rotation preserves history, but a combined verified-backup/reset workflow is not implemented. See [README](../README.md) for backup, restore and deletion. Do not treat a proposal or test against disposable data as authorization to reset the live board.

Feedback is available during play and from results. Feedback captures category, optional comment, BUILD and coarse game state, with acknowledgement and idempotent retry. Allowlisted observations are retained for 30 days, up to 100,000 events. They exclude camera images, landmarks, names and credentials; comments should omit personal details. A page session is not a unique player, and incomplete sessions alone do not prove a crash.

Runtime camera failures emit fixed diagnostic codes once per failure. Reports count affected page sessions across explicit errors and historical error states without double-counting. The trace that motivated recovery contained an unfinished replay with an error state but no explicit camera-error event. Its cause remains unknown; better reporting and restart access do not establish a hardware or recognition fix.

## Feedback decisions and remaining work

Assess teammate proposals against visitor appeal, first-time clarity, camera reliability, total booth cycle, fair scoring, prize operations and staff conversation. Record adopt/test/defer/reject, rationale and one acceptance check before implementation. Product and prize changes need Harley's decision; teammate messages do not expand implementation scope.

- **Adopted — arcade presentation:** user-directed central timed feedback, less duplicate text and original arcade synthesis. Acceptance: immediate drop/outcome cues, clear claw/targets, persistent recovery and no material measured performance regression. Physical readability and audibility remain to be tested.
- **Adopted — September 14 transition feedback:** Min requested Round 2/3 → Start, and Harley reported slow, unclear miss recovery. Shorten empty delivery and announce the next round before control resumes. Acceptance: no extra click, no aiming time consumed during the cue, no drops during it, exactly three recorded turns. Min also reported improved hand following and intended drops; that does not resolve Harley's separate inaccurate-feel report.
- **Adopted:** one scored journey, explicit camera restart, larger countdown, volume/immediate mute and visible-only star prompts. Acceptance: three acknowledged turns, visible personal rank, same-turn camera recovery and clear optional cues. Automated coverage passes; physical first-time-player acceptance remains open.
- **Test:** intended camera/display with five first-time players; countdown at viewing distance; drop/catch/miss audibility while staff converse. Organizer approval is needed before using an external speaker.
- **Deferred — scoring/prizes:** [Min's guide](https://docs.google.com/document/d/1PT3R84YRxfrgUT9s4QLaKAiYxcl2ycys49ToLx7kS3k/edit?tab=t.0) proposes 20/30/50 item points and 0–19 pen, 20–49 card holder, 50–79 neck pillow, 80+ rabbit. The earlier overlap at 20 is resolved. These values are not the live game's 100/200 points. Three 30-point catches already exceed the proposed top tier. Acceptance before adoption: Harley approves a coherent score/prize mapping using human score distributions and stock, including how real gifts appear after play.
- **Deferred — one play/one gift and badge integration:** Min proposes one play and gift per visitor. A staff-handled camera-failure retry exception and reliable duplicate recognition remain undecided. The supplied Jomablue guide describes Smart Badge tapping, lead tags/notes, synchronization and CSV export, but does not establish a direct game API or stable game-usable identifier. Test whether a second tap shows prior tags immediately and across devices. Played, Gift received and Booth conversation are separate proposed tags, not an implemented integration. Keep contact data in the badge system unless a defined need justifies transfer; do not add typed email or nickname-based enforcement.
- **Adopted — movement music:** Min requested upbeat music during hand control. Quiet original synthesis now plays after the player explicitly enables Sound; no notes are queued ahead. Camera waiting, drops, round announcements, dialogs, host pause, hidden pages, mute and zero volume stop it. Physical testing still needs to confirm that drop cues remain distinct and staff can converse comfortably.
- **Deferred — artwork:** rabbit prize images are available in the guide; balls are a separate suggestion. Compare visitor appeal and catch readability before replacing toys.
- **Deferred — cycle target:** 30–45 seconds per person is not yet demonstrated. Measure five complete cycles including setup, entry, play, delivery and handoff before promising queue throughput.
- **Not implemented:** combined verified backup/start-fresh host flow, badge/replay enforcement, physical-prize inventory, free rigid-body toppling and new environments. The existing September 10 leaderboard plan is only partly delivered; preserve its untracked source until its owner integrates or revises it.

## Live playtest

September 16: Min's new video still showed a red flash in the lower prize compartment after the earlier tray-animation change. The wooden floor and red base had coplanar top faces; the geometry fix separates them, with a regression against the rendered meshes. Confirm the result on her device before closing her visual report. The clip's completed run and visible countdown do not establish physical-camera acceptance.

September 14 staff feedback: the three-turn run saved successfully, but Harley reported inaccurate feel and a slow, unclear transition after a miss. Acceptance did not pass. The transition fix shortens empty delivery and adds a Round → Start cue; it still requires physical replay. Perceived gesture accuracy remains undiagnosed. See [physical-test evidence](archive/2026-09-14-physical-acceptance.md) for the original 11.45-second sequence. This is a staff test, not a completed five-first-time-player study.

All five improvement tracks and movement music plus drop/shelf/completion sounds are deployed for staff testing. The current release includes camera latency improvements, gesture telemetry, hold-progress feedback, confetti, marquee and idle animations, the glossy candy star and runtime cleanup. Physical-camera responsiveness, speaker quality and first-time-player readability still need testing on the intended booth hardware.

## Release evidence and documentation ownership

Historical September 14 baseline release: `05d1f798005c5e426b2699951e707b1d3dfc757d` on main passed [Check and deploy, attempt 2](https://github.com/harley/claw3d/actions/runs/34696040933), including unit/build, sequential booth-browser, shared-session, production Linux container/backup, deployment and authenticated/rendered BUILD checks. The physical-test page also reported `BUILD 05d1f79 · main`. One staff run completed three turns with a saved score and personal rank; this does not close the five-player acceptance target. [Release and physical-test evidence](archive/2026-09-14-physical-acceptance.md).

The GitHub production `RAILWAY_TOKEN` is configured and the automated release completed successfully. Production startup verifies a database snapshot before opening the existing database. Recheck live BUILD before reporting a later release; deployment does not establish physical gesture accuracy or first-time-player acceptance.

README owns setup and the current operator instructions; this file owns current product decisions and acceptance; `docs/archive` owns superseded behavior and historical evidence. Update current instructions when behavior changes, correct resolved assumptions, and move obsolete release narration out of the active guide. Refresh the live source and coordinating task before claiming work is shipped or still waiting. Routine code delivery does not silently approve prize, identity or live-data changes.

Host controls require a separate operator code of at least 8 characters after staff sign-in. The staff access secret retains its 16-character minimum; host login remains rate-limited. Codes are configured on the server and never stored in source.
