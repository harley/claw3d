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

## Shared staff pilot

Play at **https://claw.coderpush.com** using the existing staff access code. Practice is the default: nickname optional, one warm-up, three scored turns and unlimited replays. Practice scores do not enter event rankings. Use “Something felt wrong” during play or from results to send feedback. Host controls require the separate host code; uncheck Practice mode to rank the next named player.

The Node service serves the built game, camera models and API from one protected origin. All data routes and assets require a staff session. A separate host code unlocks board rotation and export. Codes live only in server environment variables, never in the bundle or repository. Camera frames and landmarks stay in the browser. Names are display labels. Client-reported catches are trusted for this small pilot; server-calculated totals are not anti-cheat.

The fist-control release starts a fresh shared board under `camera-fist-hold-550-v2`; previous boards and scores remain in the host export. Pending old runs keep their original rules and board.

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

The protected pilot stores bounded playtest observations in `playtest_events`, a separate table in the existing `/data/pilot.sqlite`. A random page-session UUID, build commit, practice/event mode and elapsed time describe each observation. Camera readiness, control/phase changes, drops, completions, bounded performance samples and fixed error categories help identify where players hesitate. Historical practice observations do not create leaderboard runs or scores; the current client records event mode only. These are client-reported observations, not proof of physical gesture accuracy.

The collector does not send camera frames, landmarks, player names, credentials or raw error messages/stacks. Feedback records one category (`controls`, `unexpected_drop`, `unfair_miss`, `stuck` or `other`) and an optional comment of at most 500 characters. Comments contain whatever the player chooses to write; keep them within the staff review process.

`POST /api/playtest` requires a staff session and the configured page origin. Its envelope is `{ sessionId, build, events }`, with 1–20 events per request and a 64 KiB request limit. Each event has `{ id, type, mode, elapsedMs, runId?, data? }`: both IDs are UUIDs, build is 7–12 lowercase hexadecimal characters, mode is `practice` or `event`, and elapsed time is bounded to seven days. Data fields and event types are allowlisted. Feedback requires `data.category`; `data.comment` is optional. Successful responses return `{ accepted: [eventId, ...] }`, including exact retries. Reusing an ID with conflicting data rejects the entire batch with 409. Telemetry has its own 60-request/minute bucket, separate from score writes.

The live table retains a rolling 30-day window and at most 100,000 events, evicting oldest observations first. Cleanup runs on startup, reads, writes and hourly while idle. Report reads always exclude expired observations. The cap bounds observation rows, not the whole score database or its physical file size; SQLite can reuse freed pages. Existing database backups also include observations and comments, so the pilot's backup retention and deletion rules apply to those copies.

Hosts can read `GET /api/host/playtest?since=2026-09-09T00:00:00.000Z`. Without `since`, the report covers the last 24 hours. It includes the newest 500 events and, separately, the newest 100 feedback events so control noise cannot hide comments. `truncated` and `feedbackTruncated` flag omitted rows. Counts cover all matching retained observations, with event type/mode/category totals and up to 40 build-and-mode cohorts containing session counts, starts, completions and performance aggregates; `cohortsTruncated` flags omitted cohorts. `cameraFailureSessions` counts distinct page sessions with either a `camera_error` event or a historical `control_state: error`, both overall and per cohort; these two signals must not be added together as separate failures. Runtime error codes distinguish worker timeout/error, camera disconnection, frame capture failure and tracking startup failure, without raw error text. Times refer to server receipt, while `elapsedMs` is relative to the page session. No ownership or authentication IDs are returned.

For a daily review from an authorized shell on the service, read the same report without obtaining or printing a host code:

```sh
node server/playtest-report.js /data/pilot.sqlite
# Or select an explicit UTC start:
node server/playtest-report.js /data/pilot.sqlite 2026-09-09T00:00:00.000Z
```

This command opens the existing SQLite file read-only. It does not create a database, rotate a board or modify scores. Review practice and event cohorts separately, cite the build, and use reported friction to choose a small next playtest improvement.

### Hosting and build identity

Railway project `claw3d`, service `staff-pilot`, one instance with `/data` on a persistent volume. The Docker build needs `BUILD_COMMIT`, `BUILD_BRANCH`, and `BUILD_DIRTY=false` from the exact clean commit being deployed. Runtime needs `NODE_ENV=production`, `PORT=4200`, `DATA_DIR=/data`, `PUBLIC_ORIGIN` equal to the exact HTTPS origin, and the two secrets. The service refuses production startup without the actual Railway volume mount. SQLite uses WAL and transactional writes. Do not scale this pilot to multiple instances.

Before release, run `npm run check`, `npm run check:booth`, and `npm run test:shared` sequentially. Compare the protected `/build-info.json` and operator BUILD with the release commit. Deployment uses `railway up` against the explicit project/service/environment; the local preview remains available independently. A `/healthz` response only proves that the process is available, not that the camera or game is accepted.

### Export, backup, restore and removal

Host controls export all boards and interrupted runs as JSON. This export omits authentication material. Treat exports as staff data and store them privately. There is no browser import of local scores.

Before a release, create a consistent SQLite snapshot in the mounted volume using a new filename:

```sh
node server/backup.js /data/pilot.sqlite /data/pilot-backup-YYYYMMDD-HHMM.sqlite
```

Download that snapshot through Railway volume files or a protected operator channel. It includes private authentication records as well as scores: restrict access and never commit it. The backup helper uses `VACUUM INTO` and verifies integrity. Enable Railway volume backups in the project dashboard if longer retention is needed.

To restore: stop the service, keep a backup of the current database, copy the verified snapshot to `/data/pilot.sqlite`, remove only the stopped database's `pilot.sqlite-wal` and `pilot.sqlite-shm` sidecars, then restart. Verify the old board and totals through authenticated requests. Never replace a live database. The automated shared test opens a disposable restored copy and verifies both clients’ completed runs.

Rollback uses the prior compatible application deployment with the same mounted volume; do not reset the database. The first shared release has no earlier shared build, so take it offline if rollback is needed before a compatible successor exists. Browser-local preview cannot read shared scores.

Keep pilot names/results only until the host ends the pilot. Removal requires stopping the service, deleting the pilot database/volume and any Railway snapshots, and deleting private downloaded exports/backups. Host board rotation preserves history and is not deletion. Rotate both secrets if access should be revoked; existing sessions last up to 12 hours unless their session rows are cleared by the operator while preserving scores.

## Event play (standalone local mode)

Practice is also the local default. Open the operator gear and uncheck Practice mode to use event ranking.

Enter a leaderboard name, play three turns, then see the total and rank. Each turn has 15 seconds of aiming and the original catch/delivery animation. All turns restock the same six-toy layout and restart the same carousel phase and start over an empty patch. Expiry drops the claw once; there is no random win roll or forced catch. Five stationary toys earn 100 points each. The moving star earns 200 points. Its carousel uses a fixed 5.6-second cycle; aim at the gold pickup ring and time the fist confirmation for green. The camera cue includes the 550 ms fist hold plus the 1.05-second contact delay. The star continues moving during descent, then the mechanism brakes for grasping and delivery. Catch resolution uses the actual contact position, with no random success or target snapping. Timing and game feel still need human playtesting.

Start the camera, enter a name, steer with one hand, then clench that hand into a fist and hold briefly to drop (open to cancel). Turns advance automatically after two seconds. The gear button opens the operator panel. There are no keyboard movement or drop controls. Sound starts off and can be enabled explicitly. Reduced motion preserves a stable viewpoint and suppresses decorative celebration.

The operator can pause, reset the current player, change rendering quality, start a fresh leaderboard session, and export all sessions as JSON. Historical practice results remain stored but excluded from rankings. New standalone runs are labeled Local preview. Ties share rank. The leaderboard is for fun; rank does not earn an additional physical prize. Session rollover preserves old results and is blocked during an active run. Rules are saved with each run. Upgrading from the first static-prize prototype starts a separate carousel leaderboard; old results and any interrupted run remain available in the export.

Scores and player progress persist in this browser's local storage. Reloading an unfinished run requires the host to resume its uncompleted turn. Completed turns remain scored. Focus loss does not latch an operator pause. Hidden pages suspend gameplay until visible again; missing hands hold only the aiming timer, never an in-flight drop. Storage failures are displayed; export before closing if results are only in memory. Clearing browser data removes local history, so export regularly. This single-browser prototype has no server verification, badge enforcement, queue tracking or physical prize inventory. Staff supervise name entry; player IDs and a nullable badge ID leave room for later scanning. Do not use this local leaderboard as a tamper-resistant competition backend.

Camera controls are required for play. START CAMERA requests access and shows the readiness panel. Hold one open hand still until “You’re ready” appears, then press Play to enter a name; CAMERA opens a separate setup dialog with device selection and re-centring. The only active gesture profile is one-hand steering with a fist clench to drop. A missing or stale hand holds aiming and carousel motion. Once a drop starts, hand loss and settings dialogs do not stop delivery. Only the host's explicit PAUSE GAME stops the animation. Camera code and tracking models load only after explicit activation. Frames remain local and are not recorded. Face identification is not implemented. Camera integration is tested with a synthetic video device and the actual inference model; physical gesture feel still needs a booth rehearsal. Geometry and textures are generated locally.

## Implementation

- `src/arcade-mechanics.js`: deterministic state machine, aiming limits, independent finger support and curated assortment.
- `src/arcade-art.js`: original procedural toys, fabric grain, wood grain, smooth jelly geometry and face details.
- `src/arcade-scene.js`: cabinet, articulated claw, carriage, prize hatch, courier, gallery and material-specific performances.
- `src/event-session.js`: versioned rules and local scoring/presentation.
- `src/session-api.js`: shared run requests, persistent turn outbox and acknowledgement state.
- `server/database.js`: transactional SQLite runs, turns, board snapshots and ranking.
- `server/index.js`: same-origin access protection, ownership, host authorization and static serving.
- `src/arcade.js` and `src/arcade.css`: camera-driven event flow, compact presentation, bounded loading/error states and reduced motion.

Grasping uses authored ellipsoid support envelopes and a guided animation. The jelly wave, cushion compression and trailing ears are expressive approximations, not a general soft-body or rigid-body solver. The couriers and glass are simplified miniature mechanisms. Human booth-camera acceptance remains outstanding. The shared pilot is a testing environment, not event-readiness evidence.

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

The event browser suite uses deterministic camera input events through the real camera adapter to exercise a three-turn run with catches and a miss, repeated drop suppression, restocking, optional nickname, automatic expiry, pause, reload recovery, session rollover, export, and a narrow viewport. A delivery regression removes hands, dispatches blur and opens camera settings mid-animation. The synthetic camera fixture does not measure recognition accuracy. It saves screenshots to locally ignored `.screenshots/`. Chrome runs headlessly for repeatability; verify game feel and performance on the booth hardware separately. Unit tests cover the active grasp mechanics, carousel interception timing, camera controls and stored session rules. The carousel browser test records a camera-event-driven successful interception, early and late misses, and checks the star’s full orbit against stationary toy mesh bounds.

Development-only inspection is available at `/?inspect=butter&phase=grip` (any toy ID; any animation phase). `window.__littleCloud.snapshot()` exposes read-only diagnostics in development. Production removes both inspection and diagnostics.

For historical context, see [the creative brief and verification record](docs/plans/2026-09-06-2344-feat-little-cloud-arcade-plan.md) for the visual requirements and evidence. No code or assets were copied from the unlicensed Jelly-Baby reference.

The delivery-clearance check samples all eleven transported toys, the tray and courier through outbound and return motion against nearby decorative mesh bounds, with a clearance margin. It also reproduces the former plant obstruction. Delivery remains a guided animation, not a general collision solver.

Finger samples sweep against toy meshes during descent and closing. A blocked descent cannot become a catch. Off-centre contact produces a grounded, damped tilt, constrained by adjacent toy bounds and cabinet walls. This is constrained rocking, not free rigid-body toppling. The contact browser check covers normal and jackpot catches, blocked misses, visible tilt, floor clearance and empty drops.
