# Cloud Claw assessment: performance, gameplay, wow (2026-09-22)

Status: assessment only, no code changed. Written against `main` at `59d64ed`, which is the verified live BUILD (GitHub run 35686476212, deploy job verified `BUILD 59d64ed · main` at 04:29 UTC). Event: AWS Cloud & AI Day Hanoi, 29 September 2026 (7 days).

Evidence used: five parallel source audits (gesture pipeline, rendering, mechanics/state/server, docs history, tests/CI), a scripted synthetic 3-turn playthrough on the dev server with screenshots and timing, render statistics from the DEV snapshot, and the CI logs. Synthetic input is not physical validation; every gameplay claim below still needs the booth laptop, TV and camera.

## 1. Mental model

Boot: `index.html` → `src/arcade.js` (538 dense lines, module-scope globals, all DOM handlers, the frame loop, camera lifecycle, telemetry). It constructs `ArcadeScene` (procedural three.js diorama, ~270 draw calls, ~400K triangles idle), loads the local store, then auto-starts the camera.

Input pipeline: `getUserMedia` 960×540@30 → zero-copy `MediaStreamTrackProcessor` frames → worker running MediaPipe GestureRecognizer (GPU, CPU fallback, `numHands: 2`, all confidences 0.65) → structured-clone results at 15–30 Hz → `HandController.handle()` (ownership: one open hand held still 500 ms; 1€ filter on the hand centre; steering = displacement from a seeded neutral → `joystickAxis` → a velocity, integrated by `move()` at 0.85 units/s over a 2.36×1.4 field). Fist = classifier OR geometric test, 200 ms open arming, 550 ms hold, cancelled by 130 ms uncertainty, 300 ms gap, or any second hand.

Mechanics (`arcade-mechanics.js`): deterministic phase table (anticipate .20, descend .85, grip .85, lift 1.45, transfer 1.45, release .45, deliver 2.65, reveal .90). `planGrab` is the only judge: nearest toy within 0.24, three analytic finger contacts on an ellipse envelope, centre of mass inside the contact triangle, neighbour veto. No randomness. The star rides a 5.6 s carousel; the catch is re-evaluated at the descend→grip boundary against actual positions. `arcade-contact.js` casts BVH rays to make the stop look right and can only veto, never grant.

Presentation: `scene.update()` runs simulation and draw in one call each rAF; draw is capped to 30 Hz whenever the camera is active. HUD update runs every frame and triggers phase sounds (synth Web Audio, no samples). Three control modes (hold-drop, grab-release, dual) are threaded as booleans through HUD, scene, glove and telemetry.

Session: local store in `localStorage` (three separate boards keyed by mode) or the shared pilot (per-turn outbox → Node server → SQLite with immutable rule snapshots, staff/host cookies, rate limits, pre-deploy DB snapshot).

Delivery: push to main → macOS runner, 196 unit tests + 13 headed-Chromium browser suites + Linux container check (~8 min) → `railway up` → Playwright logs into production and asserts the operator panel BUILD matches the SHA. Feature branches never deploy.

## 2. Constraints worth preserving

- Camera-only play, exactly three scored turns, one score per turn, no practice mode (removed deliberately after tester confusion).
- Deterministic, skill-based catches: no win rolls, no snapping, contact module may reject but never manufacture a win.
- Privacy: frames and landmarks never leave the browser; telemetry is allowlisted on both client and server; no names or raw errors in telemetry.
- Input loss ≠ host pause; an accepted drop is never frozen by hand loss, dialogs or blur.
- Capture gates (300 ms max age, out-of-order, hidden generation, 650 ms owner grace) and "fist before arming never drops".
- Anatomical Left/Right labels from the Tasks recognizer are used as-is (a regression fixture exists).
- Rules-version change rotates the board; boards are never deleted; single service instance on one volume.
- Verified-deploy gate (BUILD check on the rendered operator panel); browser suites run sequentially.
- Branding, dark arcade look, minimal in-game text.

## 3. Biggest weaknesses and bottlenecks

Control (the gate, per the project's own docs): the one physical staff run on record (14 Sep) scored 0/3 with "didn't feel accurate"; nothing since has been physically validated. Structural motion latency is ~100–160 ms best case (sensor → inference → zero-order hold → 30 Hz draw), and intent-to-descent is ~0.9 s (200 ms arm + 550 ms hold + 200 ms anticipate). Every hold is cancellable by a single 130 ms "uncertain" run. Any second hand in frame (a bystander) kills tracking. Steering is velocity-based, so precision aiming means nudging a claw that takes ~2.8 s to cross the bed. The 30 Hz draw cap is unconditional while the camera runs, so the game animates at 30 fps during play regardless of headroom.

Pacing: ~50–58% of an in-run minute is passive. Miss → next aim 8.5 s (outcome is known internally at 1.9 s). Catch → next aim 12.5 s. Round announce 3.7 s every turn, unskippable. The claw returns to the chute corner every turn (~2.3 s and ~17 speed points burned before the first decision).

Difficulty shape: one 200-point star, catchable once; after that only stationary 100s. Fixed layout, zero variation between runs.

Feedback: the player is never told why they missed although `plan.stop` knows (`toy`/`neighbour`/`bed`/`platform`/`mesh-contact`). Status is blank for ~5.5 s of every catch. The prize tag (instant-drop outcome) and the jackpot cue (when to start clenching) use different lead times, which reads as contradictory. Hold feedback lives in three places.

Wow: no bloom, static lighting (marquee bulbs are unlit dots), no reflections, no shake/hit-stop, idle screen is a small diorama in a large navy void (the first thing a passer-by sees on a 43" TV).

Rendering cost: 2048² shadow map re-rendered every frame with every static decoration casting; 8–15 forced layouts per frame from control-target projection interleaved with style writes; allocation-heavy contact solver (up to 9 retries × 2 `Box3.setFromObject`); simulation runs at display rate (144 Hz panels) while draw is capped; "simple" quality mode disables the zero-copy capture path and adds main-thread bitmap work exactly when the machine is struggling; governor only observes while the camera runs.

Loading: 837 KB single JS chunk (three + game); 950 KB of skinned hand GLBs fetched, parsed and re-rigged for every default player although they only render under `?controls=dual`.

## 4. Highest-leverage opportunities

Performance
1. Make the 30 Hz draw cap governor-driven instead of unconditional (the evidence for it predates the worker+GPU path). Measure on the booth laptop.
2. Static shadow map: `shadowMap.autoUpdate=false`, mark dirty on phase/toy changes, cast only from claw/toys/hands, tighten the light frustum to the cabinet in close view.
3. Publish control targets once per frame from the scene; cache the canvas rect on resize; no layout reads inside the vision callback.
4. One-hand profile: `numHands: 1`, `minTrackingConfidence`/presence 0.5; request 640×360 from the camera so "simple" mode keeps the stream path.
5. Interpolate/extrapolate input between results using the 1€ slope; stop censoring >300 ms results out of the latency telemetry.
6. Lazy-load hand GLBs only for dual mode; `manualChunks` for three.
7. Hoist allocations in `rock()`/`resolve()`, precompute id maps, fixed-step the contact solve.

Gameplay
1. Try absolute "your hand is the claw" mapping (calibrated box → claw position, 1€ + prediction, rate-limited) behind a flag and A/B it physically against the joystick mapping. This is the single largest feel lever and it is a ~10-line change in `vision.js`.
2. Shorten the hold to ~300 ms with decaying credit instead of zeroing on uncertainty; keep arming.
3. Miss path: outcome known at grip end → short lift → result in ~2.5 s; round announce ~1.2 s; catch delivery ~1.2 s.
4. Start each turn at the bed centre or the last drop position.
5. Say why the miss happened during lift (from `plan.stop`); near-miss detection is computable from the support test.
6. Keep the timing mechanic alive: after the star is caught, a second moving target or a slower second orbit; an assist ramp on the cue window after consecutive misses.
7. Bystander tolerance falls out of `numHands: 1`; keep the single-hand rule for acquisition, drop it for retention.

Wow
1. Selective bloom on marquee/glow/confetti/signals; a real light behind the marquee that follows the chase state; rim light tinted by aim/miss/catch.
2. Camera punch + 80 ms hit-stop at grip; 3D score pop at lift; second confetti wave at reveal; DROP slam thump.
3. Attract mode: close view with slow camera drift, faster marquee chase, "show your hand" demo, filling the TV.
4. Reflective floor and a lamp light shaft.
5. Finale composed with the actual caught toys and confirmed rank.

## 5. Architectural debt

- `arcade.js` god module; 30+ globals; the frame loop mixes sim, telemetry, HUD, scene, glove and DOM tag positioning.
- Four control modes as booleans threaded through 14 HUD branches and the frame loop; three copies of the steering block; three feedback shapes.
- Render/sim coupling: `scene.update` mutates `game.plan` via the contact module; the 30 Hz cap exists because draw and sim cannot be separated.
- Phase order is `Object.keys(PHASES)`; inserting a phase silently changes the miss shortcut.
- HUD update emits audio; HUD reads camera input and `document.hidden`.
- Telemetry schema duplicated client/server (already divergent: 600 vs 750 caps).
- Two mirrored recognizer runtimes (worker/main-thread) with copy-pasted options.
- Docs lag code: PRODUCT.md and README still describe the cabinet/dual work as a local experiment awaiting comparison; it merged to main this morning. Only an archived doc carries the event date.

## 6. Proposed sequence

Quick wins (this week, each a small verified commit): docs sync; adaptive draw cap; static shadows; layout-thrash fix; numHands 1 + confidence 0.5; lazy GLB; miss/announce/delivery shortening; claw start position; miss reason; hold credit decay. Freeze two-hand mode behind its flag for the event.

Physical loop (needs the booth laptop, TV, camera; 2–3 sessions): absolute mapping A/B; hold length; latency extrapolation; uncensored latency telemetry; five uncoached first-time players.

Wow pass (after control passes physically): bloom + reactive lights, shake/hit-stop, attract mode, floor reflection, finale.

Deeper (after the event): ControlProfile interface + single steering class; split ArcadeScene into sim and renderer; explicit phase list; scoring context for combos/tiers; shared telemetry schema; declarative HUD.
