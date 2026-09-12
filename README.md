# Cloud Claw

A camera-controlled CoderPush × AWS arcade. Players enter an optional nickname, then get three scored turns with five 100-point toys and a moving 200-point star. The staff pilot adds a protected shared leaderboard; standalone local play keeps browser-local scores.

## Working agreement

Develop in `/Users/qron/code/claw3d` on `main`, with small verified commits. The active player experience is camera-only. Read [the product focus](docs/PRODUCT.md) and [agent working rules](AGENTS.md) before changing behavior. The earlier prototype is preserved on `checkpoint/camera-only-prototype`; its inactive runtime, Blender model exports and legacy collision checks have been removed from the active checkout.

## Play locally

```sh
npm ci
npm run play
```

Open **http://127.0.0.1:4197**. `npm run play` rebuilds before starting, so a restart cannot silently serve an older build. Keep that terminal running. The preview stays stable during source edits; restart and refresh to update it. `npm run preview` uses the same command and port.

Open the operator gear to see the build commit, branch and whether it contains uncommitted changes. `/build-info.json` contains the same identity and build time. Rebuild after committing so the preview identifies the tested commit.

For development, run `npm run dev` and open **http://127.0.0.1:4196**.

Camera capture normally streams frames zero-copy to the tracking worker on Chrome. Appending `?capture=640` (any width 160–1280) forces the older main-thread bitmap capture at that width — useful for A/B testing recognition accuracy at 320 vs 640 px at booth distance, or as an escape hatch from the stream path. The DEV-only diagnostic (operator snapshot `handCamera.diagnostic`) reports the active `delegate` (GPU/CPU) and capture `driver` alongside per-result latency.

## Shared staff pilot

Verified September 12: live BUILD `030a7f2` includes all five improvement tracks and expanded arcade sounds. Reload before testing. Real-camera feel, sound and booth-display acceptance remain open; see [release evidence](docs/archive/2026-09-12-five-track-release.md). Automatic deployment still awaits its GitHub production Railway token; this release used the existing authenticated CLI.

Play at **https://claw.coderpush.com** using the existing staff access code. Start the camera, enter an optional nickname, then play exactly three scored turns and receive a server-confirmed total and rank. The first drop counts; there is no practice mode or warm-up. Staff can replay for testing. Use “Something felt wrong” during play or from results to send feedback. Host controls require the separate host code. Event-day one-play/one-gift policy and badge integration remain undecided; see [current product decisions](docs/PRODUCT.md).

The Node service serves the built game, camera models and API from one protected origin. All data routes and assets require a staff session. A separate host code unlocks board rotation and export. Codes live only in server environment variables, never in the bundle or repository. Camera frames and landmarks stay in the browser. Names are display labels. Client-reported catches are trusted for this small pilot; server-calculated totals are not anti-cheat.

The active rules version is `camera-fist-hold-550-v2`. A rules-version change starts a separate board while preserving previous boards and scores in host export. Pending old runs keep their original rules and board. Audio, countdown and camera-recovery updates do not change these rules or reset the board.

After camera setup and optional nickname entry (blank becomes Player), gameplay waits for the server to issue a run. The first drop is scored turn one; there is no warm-up or practice choice. Each run keeps its board and rule snapshot; host rotation affects new runs, and old in-flight runs finish on the original board. Every completed event run is ranked, including repeat names, with tied totals sharing rank. Failed starts offer retry or Back without local fallback. Results show pending/error until acknowledgement, then the personal rank and original board, with a View leaderboard action and Your result to return. Play again selects the previous nickname; Next player opens it blank. Both wait for submission before creating a new attempt. Historical practice data remains excluded and is never imported.

Completed event turns enter a browser outbox before being submitted in order. “Score waiting to sync” means no saved rank has been confirmed. The service accepts duplicate identical submissions once and rejects conflicting results. Keep the browser open until saving finishes. Reload replays completed turns, then abandons an unfinished run rather than recreating its physics. Sign in again in the same browser to recover pending scores after session expiry. A private HTTP-only owner cookie persists for 90 days; clearing browser data removes ownership and pending results. Existing standalone scores are never imported.

Run the shared service locally with Node 22.13+ (deployment uses Node 24):

```sh
npm ci
npm run build
# Set STAFF_CODE and HOST_CODE to distinct random secrets of at least 16 characters.
# Keep them in a private shell/environment file outside this repository.
PUBLIC_ORIGIN=http://127.0.0.1:4200 DATA_DIR=.local-data npm start
```

Open `http://127.0.0.1:4200` and enter the staff code. Ordinary `npm run play` remains explicitly browser-local; network failures in the shared service never switch to that board.

### Playtest observations and feedback

The protected pilot stores bounded playtest observations in `playtest_events`, a separate table in the existing `/data/pilot.sqlite`. A random page-session UUID, build commit, practice/event mode and elapsed time describe each observation. Camera readiness, control/phase changes, the gesture funnel (`hold_start`, `hold_cancelled` with its cause, `drop`, `time_to_control`), drops, completions, bounded performance samples — including vision latency percentiles, result rate and capture-reject counts — and fixed error categories help identify where players hesitate. Historical practice observations do not create leaderboard runs or scores; the current client records event mode only. These are client-reported observations, not proof of physical gesture accuracy.

The collector does not send camera frames, landmarks, player names, credentials or raw error messages/stacks. Feedback records one category (`controls`, `unexpected_drop`, `unfair_miss`, `stuck` or `other`) and an optional comment of at most 500 characters. Comments contain whatever the player chooses to write; keep them within the staff review process.

`POST /api/playtest` requires a staff session and the configured page origin. Batches are atomic and idempotent: an exact retry is accepted again, and reusing an event ID with conflicting data rejects the whole batch with 409. Event types, data fields, enums and numeric bounds are allowlisted in `server/playtest.js` — extend that allowlist when adding telemetry, so unexpected data can never reach storage. Telemetry rate limiting is separate from score writes.

The live table retains a rolling 30-day window and at most 100,000 events, evicting oldest observations first. Cleanup runs on startup, reads, writes and hourly while idle. Report reads always exclude expired observations. The cap bounds observation rows, not the whole score database or its physical file size; SQLite can reuse freed pages. Existing database backups also include observations and comments, so the pilot's backup retention and deletion rules apply to those copies.

Hosts can read `GET /api/host/playtest?since=2026-09-09T00:00:00.000Z` (default: last 24 hours). Feedback events are listed separately from the newest events so control noise cannot hide comments, and every truncation is flagged. Build-and-mode cohorts aggregate the acceptance-target metrics: gesture funnel counts by type, vision latency (`visionP50Ms`, `worstVisionP95Ms`), and control acquisition (`averageAcquisitionMs`, `worstAcquisitionMs` from `time_to_control`). `cameraFailureSessions` counts distinct page sessions across a `camera_error` event or a historical `control_state: error`; these two signals must not be added together as separate failures. Reports carry no ownership or authentication IDs and no raw error text; times refer to server receipt, while `elapsedMs` is relative to the page session.

For a daily review from an authorized shell on the service, read the same report without obtaining or printing a host code:

```sh
node server/playtest-report.js /data/pilot.sqlite
# Or select an explicit UTC start:
node server/playtest-report.js /data/pilot.sqlite 2026-09-09T00:00:00.000Z
```

This command opens the existing SQLite file read-only. It does not create a database, rotate a board or modify scores. Review practice and event cohorts separately, cite the build, and use reported friction to choose a small next playtest improvement.

### Hosting and build identity

Railway project `claw3d`, service `staff-pilot`, one instance with `/data` on a persistent volume. The Docker build needs `BUILD_COMMIT`, `BUILD_BRANCH`, and `BUILD_DIRTY=false` from the exact clean commit being deployed. Runtime needs `NODE_ENV=production`, `PORT=4200`, `DATA_DIR=/data`, `PUBLIC_ORIGIN` equal to the exact HTTPS origin, and the two secrets. The service refuses production startup without the actual Railway volume mount. SQLite uses WAL and transactional writes. Do not scale this pilot to multiple instances.

Pushes to `main` run [Check and deploy](.github/workflows/release.yml): a Linux production-container startup/backup check and macOS `npm run check:booth` (unit tests, build and eight sequential browser suites), followed by `npm run test:shared`. Only a passing main run can deploy the checked commit to Railway. Pull requests run the same checks without production credentials or deployment. Hosted browser checks use lockfile-pinned, headed Playwright Chromium on standard macOS runners to access their virtual Metal GPU. The headless shell used software rendering at about 1 FPS, too slow for interactive phase checks. All original assertions, full graphics quality, screenshots and video remain active. macOS consumes more Actions minutes. These checks do not establish physical camera accuracy or booth-machine performance. Feature branches never deploy. A manual workflow run on main repeats the same gates.

Production deployments are serialized; a queued commit that main has superseded is skipped. Build identity is set from the checked SHA with `--skip-deploys`, then `railway up --ci` uploads that source. The follow-up probe waits for authenticated `/build-info.json`, opens the rendered operator panel and verifies the same clean main BUILD without starting the camera, submitting scores or recording playtest telemetry. A `/healthz` response alone is not release proof. GitHub marks failures in the run and uses the account's configured Actions notifications; Min's testing messages remain a separate, selective follow-up after verified releases.

Setup: the GitHub `production` environment holds `RAILWAY_TOKEN`, a Railway project token scoped to the pilot's production environment. Keep Railway's direct GitHub source disconnected so it cannot bypass the check gate. Project/service/environment IDs are explicit in the workflow; staff and host codes are read in memory from Railway only during verification. Never store an account-wide Railway token in GitHub. Restrict the production environment to `main`.

If a release fails, inspect the Actions run and Railway deployment before retrying: a CLI failure can leave a deployment running. Re-run the workflow on current main, or revert the offending change on main to deploy a fix through the same checks. A manual emergency rollback must select a compatible previous application deployment and preserve the database. A successful smoke check does not replace physical-camera acceptance. The local preview remains independent.

### Export, backup, restore and removal

Host controls export all boards and interrupted runs as JSON. This export omits authentication material. Treat exports as staff data and store them privately. There is no browser import of local scores.

Each production deployment creates an integrity-checked SQLite snapshot in `/data/release-backups/<commit>-<deployment>.sqlite` before opening the database. The first deployment has no database to back up. Restarts of that deployment reuse the same verified snapshot; a redeploy or rollback gets a fresh snapshot (a fresh startup snapshot is used if Railway supplies no deployment ID); a failed backup stops startup. Snapshots preserve committed WAL data and are never overwritten or automatically deleted. They contain private authentication records as well as scores; include them in the pilot's retention/deletion process and monitor volume usage. They protect application rollback, not loss of the volume itself.

For a separate manual snapshot, use a new filename:

```sh
node server/backup.js /data/pilot.sqlite /data/pilot-backup-YYYYMMDD-HHMM.sqlite
```

Download that snapshot through Railway volume files or a protected operator channel. It includes private authentication records as well as scores: restrict access and never commit it. The backup helper uses `VACUUM INTO` and verifies integrity. Enable Railway volume backups in the project dashboard if longer retention is needed.

To restore: stop the service, keep a backup of the current database, copy the verified snapshot to `/data/pilot.sqlite`, remove only the stopped database's `pilot.sqlite-wal` and `pilot.sqlite-shm` sidecars, then restart. Verify the old board and totals through authenticated requests. Never replace a live database. The automated shared test opens a disposable restored copy and verifies both clients’ completed runs.

Rollback uses a verified compatible prior application deployment with the same mounted volume; do not reset the database. Check that the selected build preserves current rules and data contracts before rollback. Browser-local preview cannot read shared scores.

Keep pilot names/results only until the host ends the pilot. Removal requires stopping the service, deleting the pilot database/volume and any Railway snapshots, and deleting private downloaded exports/backups. Host board rotation preserves history and is not deletion. Rotate both secrets if access should be revoked; existing sessions last up to 12 hours unless their session rows are cleared by the operator while preserving scores.

## Event play (standalone local mode)

Standalone mode uses the same optional-nickname, three-scored-turn journey and is labeled Local preview. Scores and ranks stay in this browser; there is no practice toggle or warm-up.

Gameplay, gesture, scoring, audio and presentation decisions live in [docs/PRODUCT.md](docs/PRODUCT.md); they apply identically here. Standalone specifics: each turn has 15 seconds of aiming, turns advance automatically after two seconds, there are no keyboard movement or drop controls, and the gear button opens the operator panel. Timing and game feel still need human playtesting.

The operator can pause, reset the current player, change rendering quality, start a fresh leaderboard session, and export all sessions as JSON. Historical practice results remain stored but excluded from rankings. New standalone runs are labeled Local preview. Ties share rank. The leaderboard is for fun; rank does not earn an additional physical prize. Session rollover preserves old results and is blocked during an active run. Rules are saved with each run. Upgrading from the first static-prize prototype starts a separate carousel leaderboard; old results and any interrupted run remain available in the export.

Scores and player progress persist in this browser's local storage. Reloading an unfinished run requires the host to resume its uncompleted turn. Completed turns remain scored. Focus loss does not latch an operator pause. Hidden pages suspend gameplay until visible again; missing hands hold only the aiming timer, never an in-flight drop. Storage failures are displayed; export before closing if results are only in memory. Clearing browser data removes local history, so export regularly. This single-browser prototype has no server verification, badge enforcement, queue tracking or physical prize inventory. Staff supervise name entry; player IDs and a nullable badge ID leave room for later scanning. Do not use this local leaderboard as a tamper-resistant competition backend.

Camera controls are required for play. START CAMERA requests access and shows the readiness panel. Hold one open hand still until “You’re ready” appears, then press Play to enter a name; CAMERA opens a separate setup dialog with device selection and re-centring. The only gesture system is one-hand steering with a fist clench to drop; the unused pinch/palm/clasp profiles were removed from the codebase. A missing or stale hand holds aiming and carousel motion. Once a drop starts, hand loss and settings dialogs do not stop delivery. Only the host's explicit PAUSE GAME stops the animation. Camera code and tracking models load only after explicit activation. Frames remain local and are not recorded. Face identification is not implemented. Camera integration is tested with a synthetic video device and the actual inference model; physical gesture feel still needs a booth rehearsal. Geometry and textures are generated locally. [Arcade asset research and verification](docs/archive/2026-09-11-arcade-presentation.md) records the source/license review and performance comparison.

Player headlines use clean white lettering and a compact dark backing so the headline and supporting instruction remain legible over the cabinet.

## Implementation

- `src/arcade-mechanics.js`: deterministic state machine, aiming limits, independent finger support and curated assortment.
- `src/arcade-art.js`: original procedural toys, fabric grain, wood grain, smooth candy-star geometry and face details.
- `src/arcade-scene.js`: cabinet, articulated claw, carriage, prize hatch, courier, gallery and material-specific performances.
- `src/event-session.js`: versioned rules and local scoring/presentation.
- `src/session-api.js`: shared run requests, persistent turn outbox and acknowledgement state.
- `server/database.js`: transactional SQLite runs, turns, board snapshots and ranking.
- `server/index.js`: same-origin access protection, ownership, host authorization and static serving.
- `src/arcade.js` and `src/arcade.css`: camera-driven event flow, compact presentation, bounded loading/error states and reduced motion.

Grasping uses authored ellipsoid support envelopes and a guided animation. The star squish wave, cushion compression and trailing ears are expressive approximations, not a general soft-body or rigid-body solver. The couriers and glass are simplified miniature mechanisms. Human booth-camera acceptance remains outstanding. The shared pilot is a testing environment, not event-readiness evidence.

## Verify

```sh
npm run check          # unit tests + production build
npm run check:booth    # also starts/stops a dev server and runs all local browser suites
npm run test:shared    # built frontend + temporary shared server and isolated browsers
# Or run one targeted browser suite with npm run dev already running:
npm run test:browser
npm run test:clearance
npm run test:carousel
npm run test:camera
npm run test:contact
```

The browser suites drive deterministic camera events through the real adapter (the `tests/` files enumerate exact coverage). Two constraints matter beyond what the code shows: the synthetic camera fixture verifies integration, never recognition accuracy — game feel and performance must be verified on booth hardware separately — and suites must run sequentially because concurrent WebGL instances distort timing tests. Screenshots land in locally ignored `.screenshots/`.

Development-only inspection is available at `/?inspect=butter&phase=grip` (any toy ID; any animation phase). `window.__littleCloud.snapshot()` exposes read-only diagnostics in development. Production removes both inspection and diagnostics.

For historical context, see [the creative brief and verification record](docs/plans/2026-09-06-2344-feat-little-cloud-arcade-plan.md) for the visual requirements and evidence. No code or assets were copied from the unlicensed Jelly-Baby reference.

Two intentional physics limits to preserve: delivery is a guided animation, not a general collision solver (the clearance check guards it against decorative meshes, including the former plant obstruction), and off-centre contact is constrained rocking, not free rigid-body toppling. A blocked descent cannot become a catch.
