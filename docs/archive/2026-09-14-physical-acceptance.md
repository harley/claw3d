# September 14, 2026 release and physical-test evidence

Historical observation for BUILD `05d1f79`; this record is not a claim about later releases.

## Release

- Exact release SHA: `05d1f798005c5e426b2699951e707b1d3dfc757d`, main.
- [Actions run 34696040933](https://github.com/harley/claw3d/actions/runs/34696040933), attempt 2: success. Includes unit/build, sequential booth-browser, shared-session, production Linux container/backup, deployment and authenticated/rendered BUILD verification.
- GitHub production environment secret listing confirms `RAILWAY_TOKEN` is configured. No credential value was recorded.
- The signed-in physical-test page's DOM contained `BUILD 05d1f79 · main` before play. The operator panel remained behind host authentication; this session did not independently render that panel. Direct JSON navigation was blocked by the in-app browser; authenticated endpoint/rendered verification above comes from the successful release run.

## Physical staff run

A staff tester operated the real camera and reported completion. No synthetic camera input was used. Browser accessibility observations confirmed:

- An explicitly labelled test nickname was used (intentional production test data; identifier omitted from this public record).
- Sound enabled at 50%; camera active and Hand found observed during play.
- Turn 1 progressed to turn 2 without agent recovery.
- Final screen: RUN COMPLETE, three misses (+0 each), total 0, SAVED · RANK #7.
- Board: Cloud Claw · Updated rules.
- No host pause, reset, rotation or production configuration changes were made. The test result remains stored.

## Player feedback and diagnosis

The tester reported inaccurate-feeling control and a slow, unclear transition after a miss. This run is not an acceptance pass. The most concrete obstacle is the wait and unclear state after a miss; perceived control accuracy remains unresolved.

Source inspection explains a built-in delay: `src/arcade-mechanics.js` sends misses through the same lift (1.8 s), transfer (2 s), release (0.55 s), delivery (3.8 s) and reveal (1.3 s) phases as catches. `src/arcade.js` adds a 2 s result wait before the next turn. From the MISSED cue at lift entry, this totals 11.45 s of simulation time before the next aiming phase, excluding tracking reacquisition, hidden-page suspension or frame delays. The HUD expires MISSED after 1.6 s and supplies no central text during transfer/release/delivery/reveal. The next turn resets camera control and waits for acquisition again.

These source facts support the reported slow, unclear transition; they are not measured wall-clock timing or a diagnosis of recognition accuracy. A focused next change should shorten the empty-claw miss sequence and make the handoff back to control clear, preserving catch delivery, three turns and one score per turn. Re-test the same physical scenario before tuning gestures or difficulty. No gameplay code changed in this session.

## Acceptance still open

The session confirms completion and saving, not a full acceptance pass. Await player observations for intended camera/display, acquisition within 10 seconds, setup/tracking delay, gameplay duration, hesitation, unintended drops/freezes, cue readability, speaker audibility and what to try differently. No timing measurement was captured; chat timestamps must not be treated as gameplay duration. The tester was staff, not established as a first-time player. Five first-time-player sessions remain the product target.

The next iteration should address the diagnosed miss transition. Three misses alone do not establish a difficulty or hand-recognition defect.

## Earlier camera-contention evidence — September 9

September 9 physical-camera diagnosis on the development Mac: the same CPU recognizer measured 66 ms median with the scene off, versus 613 ms with uncapped full graphics. Full graphics capped at 30 FPS measured 66 ms median / 107 ms p95, with all 170 replies under 300 ms (148 detected a hand). The implemented draw-only cap with a larger scene measured 58 ms median / 163 ms p95 over 275 replies; 270 were under 300 ms and 73 detected a hand. These are bounded physical-camera timing samples, not first-time-player or three-turn acceptance results. No camera images or landmarks were saved.
