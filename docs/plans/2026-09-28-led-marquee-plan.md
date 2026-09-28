# LED marquee and cloud framing

Status: selected and implemented locally. Owner selected the centred layout with lime START! on September 28. Merge and deployment are outside this task’s authorization.

## Outcome

Make the cabinet banner a readable LED sign that carries the existing round countdown. Keep the cloud fully visible and the claw and prizes large. A first-time visitor should see when play begins without a separate announcement covering the gameplay area.

Primary acceptance: at the intended booth viewport, the entire cloud and marquee fit below the HUD, every cue is optically centred and readable from the playing position, and control starts exactly when the existing preparation sequence ends.

## Evidence and limits

Inspected checkout: `069623a`, supplied screenshot dated September 28, PRODUCT, CONTRIBUTING, arcade scene, art, HUD and stylesheet. No live deployment or physical-camera inspection was performed.

- The cream insert is centred at world Y 4.946; CLAW is at 4.965. The text helper centres a font baseline, rather than its visible ink bounds. Both explain the apparent upward offset.
- The scene canvas starts below the HUD. The screenshot clips the cloud exactly at that boundary. The close camera uses a fixed look target and aspect-ratio adjustment, without a cloud-safe framing constraint.
- Existing HUD code identifies eligible countdown cues and excludes pause, dialogs and recovery. The scene already accepts a presentation object. Reuse these paths.
- Generated concepts explore appearance only. Their HUD numbers are preserved reference data, not a proposed countdown state. They do not prove framing, timing or recognition accuracy.

## Visual decision

Three image concepts accompany this plan: a single centred countdown, round context beside the countdown, and a centred start cue with short side lights. Prefer the single-message layout: the top HUD already identifies the turn, and the sign has limited height. The owner selected the single-message layout with the third concept’s lime START! colour.

Visual review: the second and third displayed generated images still clip the cloud at the HUD boundary despite the prompt. Reject that part of those mocks. The first provides the useful headroom reference. All three brighten the bulbs beyond the source; keep bulb brightness restrained in the implementation so it does not compete with the cue. Generated images are exploratory references, not exact geometry specifications.

Retain the red shell, slim brass trim, cloud geometry and existing CoderPush/AWS branding. Replace only the cream insert and painted lettering with a recessed near-black display. Use faint inactive dots, bright cyan countdown digits and lime START!; keep warm bulbs secondary. No scrolling text, scanline flicker, continuous flashing or required bloom. Idle CLAW should be noticeably quieter than the countdown.

Centre visible glyph bounds both vertically and horizontally. Start with 15% vertical inset on each side, allowing a small optical adjustment after a rendered comparison. Use a thick pixel font or a readable glyph mask sampled onto the dot grid. Dots are a surface treatment, not thousands of individual meshes. The longest cue must fit without becoming smaller than booth-readable text.

The cloud needs a measurable safe area: target at least 12 CSS pixels or 2% of scene height, whichever is larger, above its visible top. First tune framing/look target with projected bounds. Compare prize size against the current view; target no more than 5% reduction. If both constraints cannot fit, try lowering the decorative finial slightly before widening the entire game. Do not accept a cropped cloud or a substantially smaller playfield merely to match a generated image.

## Presentation contract

| State | LED content | Other presentation |
| --- | --- | --- |
| Idle / ordinary aiming | Quiet CLAW | Existing HUD and guidance |
| First-turn preparation | ROUND 1, then 3, 2, 1, START! | One visible countdown surface |
| Catch transition | Existing next-round sequence, with START! replacing visible PLAY! | Preserve shorter timing |
| Miss transition | Move only the existing eligible round/start cues to the sign | Keep MISSED and its reason together in their existing surface; no added 3-2-1 |
| Controller unavailable | Quiet CLAW; no stale digit | Existing recovery instruction wins |
| Host pause, dialog, hidden page | No active countdown on sign | Existing pause/dialog behavior and sound suppression |
| Resume / reacquisition | Reflect authoritative cue immediately | Preserve existing freeze/restart rules |

Keep ROUND 1 at 0.7 seconds, each digit at 1 second and the final start cue at 0.3 seconds. Steering, drop and aiming clock remain inactive through the cue. START! replaces visible PLAY! copy consistently, including its accessible announcement; it does not rename gameplay phases or change scheduling. Physical review must specifically check whether 0.3 seconds is readable; any timing change is a separate decision.

Keep exactly three scored turns, one score per turn and the current sound cues. Keep a DOM live region even when the visual countdown moves into WebGL. Do not announce both DOM and canvas versions. If the sign cannot meet a readable minimum at a supported small viewport, use the existing central countdown there and suppress the sign cue, ensuring only one visible version.

## Implementation sequence

1. Refresh checkout status and existing ownership before code work. Select a concept, then capture the existing full game at representative wide and narrow viewports. The supplied crop cannot establish whole-screen balance.
2. In `src/arcade-scene.js`, replace the static label/insert with one owned dynamic canvas texture and a display plane outside the static batch. Keep geometry dimensions close to the current insert. Draw only when content/style changes; reuse resources and dispose them with the scene. Keep readable output with bloom off and simple quality enabled.
3. In `src/arcade-hud.js` and `src/arcade.js`, derive one semantic presentation cue from the existing eligibility and timing logic, and pass it to the scene. Do not read text back from the DOM, duplicate timers or infer countdown solely from mechanics phase. Update central visibility and accessible copy from the same cue.
4. Adjust close framing and verify the cloud, panel, claw travel, prize bed and delivery view together. Check attract-to-play transitions, camera punch, aspect changes and reduced motion. Retain a static cue under reduced motion; any normal pulse stays within the display and runs once per cue.
5. Update the Arcade count-in and player-copy sections of `docs/PRODUCT.md` after implementation. Remove superseded descriptions of the central panel; do not duplicate the new behavior across documents.

## Verification

Use existing owner suites rather than a new generic visual framework:

- Extend HUD unit coverage for the shared cue and precedence. Credible failure: a stale 1 or START! remains visible after tracking loss or pause. Existing CSS-class assertions alone cannot prove the scene receives the same cue.
- Extend `tests/arcade-presentation.browser.mjs` for the actual scene cue, single visible countdown, final cue/control handoff, loss/reacquisition, pause and reduced motion. Reuse existing phase/scoring tests; add only missing wiring assertions.
- Extend `tests/arcade-layout.browser.mjs` with projected cloud and sign bounds across existing supported viewports. Pair bounds with screenshots: numeric bounds alone do not establish readable dots, glyph centring or contrast.
- Render at 1440x900, 1920x1080, 1366x768, a supported narrow portrait size and the short-landscape breakpoint. Compare full scenes, not only the banner crop. Save screenshots in locally ignored `.screenshots/`.
- Run `npm run check` and affected browser suites sequentially before a code commit, per CONTRIBUTING. Verify texture updates do not occur on every animation frame and the change adds no extra full-scene rendering pass.
- On the actual camera/display, observe a first-time player read the count-in, begin aiming and finish three turns. Record BUILD, display, camera and observation separately from automated results. Test from the actual playing distance; a screenshot is not physical acceptance.

Before claiming completion: verify optical centring, whole cloud, no meaningful loss of prize scale, single countdown surface, accessible announcement, preserved timing and no stale cue after interruption. Code delivery, deployment and physical acceptance are separate outcomes.

## Scope and next decision

This plan does not add score effects, prize logic, identity changes, a second scene or a new input system. Implementation is authorized in the existing game. Merge and deployment remain outside scope. Physical readability must be checked on the intended booth display.
