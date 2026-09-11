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

## Current player journey

Camera ready → optional nickname (blank becomes Player) → server-acknowledged start → exactly three scored turns → server-confirmed total and personal rank. The first drop counts. There is no practice toggle or warm-up. Historical practice scores and telemetry remain stored and excluded from event rankings; they are never imported into the shared board.

Failed starts offer retry, sign-in when required or Back, without local scoring fallback. Pending results remain visibly unsaved until acknowledged. Results show their original board and personal rank, including ranks outside the top five. View leaderboard and Your result switch between the board and personal result. Reopening results restores the full score if its animation was interrupted.

Play again selects the previous nickname; Next player opens it blank. Neither creates a run before submission. Replay restarts a stopped camera before name entry. Duplicate names and zero totals remain eligible; equal totals share competition rank. Staff replay is available for testing. Event-day one-play/one-prize enforcement is a separate unresolved policy and must not be implemented using nicknames.

Standalone development is labeled Local preview and keeps scores in that browser. Reloaded legacy local practice runs remain excluded from rankings. An already loaded older client keeps its behavior until refreshed; check BUILD before starting a new playtest.

## Camera control and recovery

One open hand steers; a deliberate fist held for 550 ms locks the drop. Opening early cancels and recentres steering. A second hand, missing/stale capture or blocked input cancels confirmation; reopen before retrying. The central message gives one instruction at a time, the uncropped camera view identifies the controlling hand, and an amber glove ring shows hold progress. Only the current target receives a score tag.

Fresh detections up to 300 ms apart preserve confirmation between captures; only time between closed detections counts toward the hold. Captures older than 300 ms, out of order or from a stopped/restarted/hidden generation cannot control the game. Owner loss beyond 650 ms requires stable single-hand acquisition again. Late but live replies show Tracking delayed; a worker silent for seven seconds stops the camera.

Missing hands, camera setup and feedback dialogs hold aiming but never freeze an accepted drop. Only explicit host pause stops an in-flight drop; hidden pages suspend scene progression until visible. Restart camera appears beside the camera preview on narrow screens and below the cabinet on desktop when a scored turn is waiting on a stopped camera. Restart preserves run identity, turn, earned points and remaining aiming time, then waits for stable hand acquisition. A failed restart opens camera settings for another attempt. There is no automatic retry loop or required page reload.

While the camera starts or runs, submit at most 30 scene draws per second. Mechanics, transforms and contact response retain their update cadence. Stopping the camera restores display-rate rendering. The physical timing evidence behind this cap is preserved in [the historical record](archive/2026-09-11-product-history.md); it does not establish first-time-player acceptance. Camera frames and landmarks are not recorded.

## Countdown, audio and moving star

The same countdown is prominent in the left HUD: 64 px desktop digits, 44 px at 390 px width and 40 px on the smallest layout. The existing final-five-second state adds stronger contrast without animation. Narrow screens keep the timer beside turn/score to limit camera-preview displacement. Active aiming time, expiry/drop behavior and scoring are unchanged.

Sound starts off and requires an explicit Sound-button click. The visible slider cannot activate sound; its default is 50% of the previous level and its maximum is the previous maximum. Mute and zero volume cancel queued notes. Original arcade pitch sweeps, grip pulses, rising catch/falling miss cues and a score arpeggio follow the actual phases. A single bold upper-centre message shows DROP immediately, then GOT IT/MISSED at lift (about 2.1 seconds after acceptance). These messages clear after at most 1.6 seconds; delivery narration and the separate celebration banner are removed. Points still appear only at turn completion. Camera guidance remains persistent, and the live status region retains accessibility. Reduced motion disables the brief text entrance. Narrow layouts keep the camera view below the cabinet to leave the claw and toys clear. Star beeps require the visible, active near-ring cue; they stay quiet during pause, dialogs, hidden pages and camera waiting. No continuous music, downloaded sound assets or fonts are used. [Asset research and performance evidence](archive/2026-09-11-arcade-presentation.md) records the original synthesis decision and primary-source licenses. Physical speaker audibility and comfortable staff conversation still need testing; organizer permission for an external speaker is unconfirmed.

The moving star crosses the fixed gold pickup ring at (0.80, 0.22), inside steering bounds, every 5.6 seconds. Its cue includes 550 ms fist hold and 1.05 seconds to contact, but no assumed human reaction delay. The toy moves during descent; the catch resolves from the actual contact pose.

Anh's report that it never seemed to enter the aiming circle is unresolved. Current geometry is reachable: the rendered browser suite catches for 200 points and rejects early/late attempts. A deterministic check catches when clenching at the cue centre (4.0 seconds in the orbit), but misses when waiting until the toy is already centred (5.6 seconds). This suggests timing or aiming confusion as a possibility, not a diagnosis. Her exact BUILD, aim position, intended circle and recognition timing are missing. Do not change geometry or difficulty without that evidence.

## Shared scoring, observations and operations

The protected pilot stores names and results centrally. Names are display labels, not verified badge identities, and client-reported catches remain trusted. Each run retains its board and rules through host rotation. Completed turns enter a durable browser outbox and retry without duplicate scores; rank appears only after server acknowledgement. Reload drains completed results and abandons the unfinished physical scene. Existing local boards are never imported.

The staff code grants game/leaderboard access; a separate host code protects rotation and export. Persistent SQLite storage uses one service and one mounted volume. Existing rotation preserves history, but a combined verified-backup/reset workflow is not implemented. See [README](../README.md) for backup, restore and deletion. Do not treat a proposal or test against disposable data as authorization to reset the live board.

Something felt wrong is available during play and from results. Feedback captures category, optional comment, BUILD and coarse game state, with acknowledgement and idempotent retry. Allowlisted observations are retained for 30 days, up to 100,000 events. They exclude camera images, landmarks, names and credentials; comments should omit personal details. A page session is not a unique player, and incomplete sessions alone do not prove a crash.

Runtime camera failures emit fixed diagnostic codes once per failure. Reports count affected page sessions across explicit errors and historical error states without double-counting. The trace that motivated recovery contained an unfinished replay with an error state but no explicit camera-error event. Its cause remains unknown; better reporting and restart access do not establish a hardware or recognition fix.

## Feedback decisions and remaining work

Assess teammate proposals against visitor appeal, first-time clarity, camera reliability, total booth cycle, fair scoring, prize operations and staff conversation. Record adopt/test/defer/reject, rationale and one acceptance check before implementation. Product and prize changes need Harley's decision; teammate messages do not expand implementation scope.

- **Adopted — arcade presentation:** user-directed central timed feedback, less duplicate text and original arcade synthesis. Acceptance: immediate drop/outcome cues, clear claw/targets, persistent recovery and no material measured performance regression. Physical readability and audibility remain to be tested.
- **Adopted:** one scored journey, explicit camera restart, larger countdown, volume/immediate mute and visible-only star prompts. Acceptance: three acknowledged turns, visible personal rank, same-turn camera recovery and clear optional cues. Automated coverage passes; physical first-time-player acceptance remains open.
- **Test:** intended camera/display with five first-time players; countdown at viewing distance; drop/catch/miss audibility while staff converse. Organizer approval is needed before using an external speaker.
- **Deferred — scoring/prizes:** [Min's guide](https://docs.google.com/document/d/1PT3R84YRxfrgUT9s4QLaKAiYxcl2ycys49ToLx7kS3k/edit?tab=t.0) proposes 20/30/50 item points and 0–19 pen, 20–49 card holder, 50–79 neck pillow, 80+ rabbit. The earlier overlap at 20 is resolved. These values are not the live game's 100/200 points. Three 30-point catches already exceed the proposed top tier. Acceptance before adoption: Harley approves a coherent score/prize mapping using human score distributions and stock, including how real gifts appear after play.
- **Deferred — one play/one gift and badge integration:** Min proposes one play and gift per visitor. A staff-handled camera-failure retry exception and reliable duplicate recognition remain undecided. The supplied Jomablue guide describes Smart Badge tapping, lead tags/notes, synchronization and CSV export, but does not establish a direct game API or stable game-usable identifier. Test whether a second tap shows prior tags immediately and across devices. Played, Gift received and Booth conversation are separate proposed tags, not an implemented integration. Keep contact data in the badge system unless a defined need justifies transfer; do not add typed email or nickname-based enforcement.
- **Deferred — artwork/music:** rabbit prize images are available in the guide; balls are a separate suggestion. Compare visitor appeal and catch readability before replacing toys. Do not add continuous music without evidence that it helps booth operation.
- **Deferred — cycle target:** 30–45 seconds per person is not yet demonstrated. Measure five complete cycles including setup, entry, play, delivery and handoff before promising queue throughput.
- **Not implemented:** combined verified backup/start-fresh host flow, badge/replay enforcement, physical-prize inventory, free rigid-body toppling and new environments. The existing September 10 leaderboard plan is only partly delivered; preserve its untracked source until its owner integrates or revises it.

## Release evidence and documentation ownership

Last live verification, September 11, 2026: authenticated `/build-info.json` and operator panel both show clean `95751e3` on main at [claw.coderpush.com](https://claw.coderpush.com). Railway deployment `c78bae61-7696-4c3b-9b33-455f052a4e54` succeeded. The served bundle includes immediate drop acceptance, catch/miss text at lift and phase sound effects, alongside the earlier practice removal, volume, larger timer and camera recovery. This is a dated observation; recheck actual live BUILD before reporting deployment status.

For `95751e3`, 95 unit tests/build, all seven sequential booth suites and the built shared-session suite passed. Regressions check early catch/miss text, truthful miss reveal, phase sounds, queued-note mute and no early scoring. The protected live page loaded without browser errors and its operator BUILD matched; no live test score was added. Earlier release evidence is in [the historical record](archive/2026-09-11-product-history.md). Physical-camera accuracy, sound quality and perceived responsiveness still need human testing.

README owns setup and the current operator instructions; this file owns current product decisions and acceptance; `docs/archive` owns superseded behavior and historical evidence. Update current instructions when behavior changes, correct resolved assumptions, and move obsolete release narration out of the active guide. Refresh the live source and coordinating task before claiming work is shipped or still waiting. Routine code delivery does not silently approve prize, identity or live-data changes.
