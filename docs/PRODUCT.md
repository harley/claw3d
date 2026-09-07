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
- Scores and sessions currently stay in the browser. They are not a verified competition backend.
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

## Next: shared staff playtest

After camera usability meets the current milestone, add a protected HTTPS staff link with name entry and one persistent shared leaderboard. Staff may replay during this pilot; names are display labels, not verified badge identities. Camera frames stay in each browser. See `docs/plans/2026-09-07-1445-feat-camera-staff-playtest-plan.md` for the staged coding plan. Shared scores are a planned change, not available in the current browser-local build.

## Later

Badge scanning, verified competition results, replay enforcement, queue/admin analytics, free toppling physics and new environments. Keep these outside the current milestone unless the booth's operating requirements make one essential.

## Evidence

The first camera-feedback iteration keeps recognition and the controlling-hand highlight visible before play and during delivery, while blocking game actions outside aiming. The preview follows the camera aspect ratio and gives a readable next instruction. Automated regressions cover setup without actions, a fresh clasp after blocked input, and preview alignment. The U1–U3 implementation adds an unscored steering-ring and clasp rehearsal for each new visitor before run creation. Exit Practice returns to setup without spending a turn. Scored aiming still waits for acquired control; accepted delivery completes after input loss.

Camera captures older than 300 ms, out of order, or from a stopped/restarted/hidden camera generation cannot affect control. Owner loss beyond 650 ms releases the track and requires a stable single hand again. Calibration uses a fixed anchor; the highlighted hand is labeled YOU and its neutral point is shown. Developer snapshots expose capture age and rejection reason without recording frames.

The green moving-star cue means bring already-armed hands together, then hold for 650 ms. It leads the actual contact time by that hold plus the 1.05-second anticipation/descent. Hands must first be shown apart; the cue does not include an arbitrary human reaction or convergence time. Use a new shared pilot board for this control version; existing browser-local results are preserved.

Physical first-time-player acceptance remains outstanding. Automated fixtures are integration evidence only: five first-time visitors must still test acquisition within 10 seconds, rehearsal drop within 15 seconds of acquisition, and three turns without coaching, unintended drops or host recovery. Record hesitation, capture-age behavior, lighting/occlusion and strategy for a second attempt against the final BUILD. No physical gesture result is claimed by this implementation.

U1–U3 automated verification: 72 unit tests and all five sequential booth browser suites pass. Additional browser checks exercise both 4:3 and 16:9 camera aspect ratios, a successful retry after denied permission, and the displayed star cue followed by a simulated 650 ms hold. The latter is timing integration evidence, not measured human convergence or recognition delay.

`npm run check` checks unit behavior and the build. `npm run check:booth` also runs camera integration, event flow, carousel, contact and delivery checks. Automated checks do not establish gesture feel or spectator impact. Save local screenshots under `.screenshots/` and summarize physical observations here with the tested commit.
