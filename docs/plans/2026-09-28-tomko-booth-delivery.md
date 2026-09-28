---
artifact_contract: ce-unified-plan/v1
product_contract_source: authorized-android-handoff
execution: code
created_at: 2026-09-28
---
# Tomko booth Android candidate

## Goal Capsule

Deliver a versioned offline Android candidate for the September 29 booth using the existing shared game and PR #183. The current prototype completed one-hand play but felt delayed; the integrated branch also has a failing built-camera fixture. Tonight establishes source, packaging and integration correctness. The owner performs physical acceptance with the Tomko at 07:00 Asia/Ho_Chi_Minh.

The handoff and PRODUCT govern behavior; CONTRIBUTING governs verification. Update PR #183 without merging or deploying the website. Preserve prototype app data. Do not connect to the unattended TV.

## Product Contract

R1. Preserve shared scoring, exactly three turns, separate one/two-hand boards, branding, sounds and celebration. No new game or USB driver stack.

R2. Camera choices must reflect CameraX inventory. Hidden preview must not bind a Preview use case. Restart/switch clears stale acquisition, not scores or accepted drops.

R3. Keep the 300 ms analyzer-entry-to-consumption freshness bound. Label diagnostics honestly; sensor capture age is unavailable without a verified timebase. Never save/upload frames.

R4. Existing Export saves a snapshot of the current mode via Android's document picker, including camera-off export. Report cancellation/failure; never erase scores or claim success before closing the file.

R5. Permission, background and renderer failure stop acquisition safely and offer an explicit recovery action. No automatic gameplay input after return.

## Planning Contract

Retain index → arcade, native-vision acquisition adapter, CameraX/MediaPipe and the bounded two-inflight/latest queue. Use a small native bridge dispatcher so export and tracking coexist. Validate camera IDs against current inventory. Preview changes restart acquisition with a new generation. Keep bitmap ownership straightforward until device profiling justifies pooling; do not risk native image lifetime for an unmeasured optimization.

Use a bounded export payload and request ID tied to page lifetime. Write on a separate I/O executor. Do not put export contents in logs. Keep test-package distribution usable tonight; permanent release signing and an independent key backup require an owner-controlled destination. Do not fabricate a backed-up release identity.

## Implementation Units

U1. Repair built-camera fixture routing in tests/camera-fixture.mjs and tests/shared-session.browser.mjs; pass through shared chunks and prove the fixture instantiated. Run shared suites.

U2. Extend src/native-vision.js and Android MainActivity acquisition/operator behavior: real inventory, preview use-case selection, explicit lifecycle recovery, bounded interval diagnostics. Tests cover stale generation, selection and interval boundaries; preserve queue tests.

U3. Route src/arcade.js local export through a shared native bridge dispatcher and Android CreateDocument. Tests cover >4 KB data, camera-off operation, cancellation/failure, concurrent requests and response routing. Update owning docs.

U4. Increment Android version, run final gates, review consequential changes, commit/push, rebuild clean APK and verify exact packaged BUILD/checksum. Update PR evidence and OPERATIONS morning runbook. Release signing remains explicit if no owner-backed key exists.

## Verification Contract

Run npm run check, npm run test:shared, node scripts/check-browser.mjs --only camera,arcade sequentially for browser work. Android build includes JVM tests and lint. Run npm run test:offline against the final assembled APK; assert both native metadata and web operator BUILD match the source. Review current PR comments and checks. No synthetic result establishes physical recognition or Android restart persistence.

Physical gate: exact APK/BUILD; actual camera inventory/orientation; three turns per mode; deliberate fist/drop and loss/reacquisition; accepted drop completes after hands leave; preview off/on same-workload rates; permission/retry, background/restart, renderer recovery; Wi-Fi off; force-stop/reboot and same-key upgrade retain scores; export readable current-mode JSON; sustained first-time-player run without coaching. Stop booth acceptance on binding/GPU failure, incorrect orientation, predominantly stale input, or an unfinishable run.

## Definition of Done

PR has passing affected checks and a clean versioned APK with SHA256/source metadata. OPERATIONS records installation, data boundaries and the 7am physical checklist. Document physical acceptance as pending until the owner tests the actual hardware. A permanent signed release additionally requires a protected signing key and verified independent backup; test APK completion does not imply that step completed.
