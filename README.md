# Cloud Claw

A camera-controlled CoderPush × AWS arcade. Players rehearse steering and dropping, then get three scored turns with five 100-point toys and a moving 200-point star. The staff pilot adds a protected shared leaderboard; standalone local play keeps browser-local scores.

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

The Node service serves the built game, camera models and API from one protected origin. All data routes and assets require a staff session. A separate host code unlocks board rotation and export. Codes live only in server environment variables, never in the bundle or repository. Camera frames and landmarks stay in the browser. Names are display labels. Client-reported catches are trusted for this small pilot; server-calculated totals are not anti-cheat.

The server issues a run only after rehearsal. A ranked run waits for that acknowledgement. Each run keeps its board and rule snapshot; host rotation affects new runs, and old in-flight runs finish on the original board. Every completed run is ranked, including repeat names, with tied totals sharing rank. Practice stays unranked and local.

Completed turns enter a browser outbox before being submitted in order. “Score waiting to sync” means no saved rank has been confirmed. The service accepts duplicate identical submissions once and rejects conflicting results. Keep the browser open until saving finishes. Reload replays completed turns, then abandons an unfinished run rather than recreating its physics. Sign in again in the same browser to recover pending scores after session expiry. A private HTTP-only owner cookie persists for 90 days; clearing browser data removes ownership and pending results. Existing standalone scores are never imported.

Run the shared service locally with Node 22.13+ (deployment uses Node 24):

```sh
npm ci
npm run build
# Set STAFF_CODE and HOST_CODE to distinct random secrets of at least 16 characters.
# Keep them in a private shell/environment file outside this repository.
PUBLIC_ORIGIN=http://127.0.0.1:4200 DATA_DIR=.local-data npm start
```

Open `http://127.0.0.1:4200` and enter the staff code. Ordinary `npm run play` remains explicitly browser-local; network failures in the shared service never switch to that board.

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

Enter a leaderboard name, play three turns, then see the total and rank. Each turn has 15 seconds of aiming and the original catch/delivery animation. All turns restock the same six-toy layout and restart the same carousel phase and start over an empty patch. Expiry drops the claw once; there is no random win roll or forced catch. Five stationary toys earn 100 points each. The moving star earns 200 points. Its carousel uses a fixed 5.6-second cycle; aim at the gold pickup ring and time the clasp confirmation for green. The camera cue includes the 650 ms clasp hold plus the 1.05-second contact delay. The star continues moving during descent, then the mechanism brakes for grasping and delivery. Catch resolution uses the actual contact position, with no random success or target snapping. Timing and game feel still need human playtesting.

Start the camera, enter a name, steer with one hand, then clasp both hands and hold to drop. Turns advance automatically after two seconds. The gear button opens the operator panel. There are no keyboard movement or drop controls. Sound starts off and can be enabled explicitly. Reduced motion preserves a stable viewpoint and suppresses decorative celebration.

The operator can pause, reset the current player, select practice for the next player, change rendering quality, start a fresh leaderboard session, and export all sessions as JSON. Practice results are stored but excluded from rankings. Ties share rank. The leaderboard is for fun; rank does not earn an additional physical prize. Session rollover preserves old results and is blocked during an active run. Rules are saved with each run. Upgrading from the first static-prize prototype starts a separate carousel leaderboard; old results and any interrupted run remain available in the export.

Scores and player progress persist in this browser's local storage. Reloading an unfinished run requires the host to resume its uncompleted turn. Completed turns remain scored. Focus loss does not latch an operator pause. Hidden pages suspend gameplay until visible again; missing hands hold only the aiming timer, never an in-flight drop. Storage failures are displayed; export before closing if results are only in memory. Clearing browser data removes local history, so export regularly. This single-browser prototype has no server verification, badge enforcement, queue tracking or physical prize inventory. Staff supervise name entry; player IDs and a nullable badge ID leave room for later scanning. Do not use this local leaderboard as a tamper-resistant competition backend.

Camera controls are required for play. START CAMERA requests access and shows the readiness panel. Hold one hand still until HAND READY appears, then press PLAY to enter a name; CAMERA opens a separate setup dialog with device selection and re-centring. The only active gesture profile is one-hand steering with a two-hand clasp to drop. A missing or stale hand holds aiming and carousel motion. Once a drop starts, hand loss and settings dialogs do not stop delivery. Only the host's explicit PAUSE GAME stops the animation. Camera code and tracking models load only after explicit activation. Frames remain local and are not recorded. Face identification is not implemented. Camera integration is tested with a synthetic video device and the actual inference model; physical gesture feel still needs a booth rehearsal. Geometry and textures are generated locally.

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

The event browser suite uses deterministic camera input events through the real camera adapter to exercise a three-turn run with catches and a miss, repeated drop suppression, restocking, practice exclusion, automatic expiry, pause, reload recovery, session rollover, export, and a narrow viewport. A delivery regression removes hands, dispatches blur and opens camera settings mid-animation. The synthetic camera fixture does not measure recognition accuracy. It saves screenshots to locally ignored `.screenshots/`. Chrome runs headlessly for repeatability; verify game feel and performance on the booth hardware separately. Unit tests cover the active grasp mechanics, carousel interception timing, camera controls and stored session rules. The carousel browser test records a camera-event-driven successful interception, early and late misses, and checks the star’s full orbit against stationary toy mesh bounds.

Development-only inspection is available at `/?inspect=butter&phase=grip` (any toy ID; any animation phase). `window.__littleCloud.snapshot()` exposes read-only diagnostics in development. Production removes both inspection and diagnostics.

For historical context, see [the creative brief and verification record](docs/plans/2026-09-06-2344-feat-little-cloud-arcade-plan.md) for the visual requirements and evidence. No code or assets were copied from the unlicensed Jelly-Baby reference.

The delivery-clearance check samples all eleven transported toys, the tray and courier through outbound and return motion against nearby decorative mesh bounds, with a clearance margin. It also reproduces the former plant obstruction. Delivery remains a guided animation, not a general collision solver.

Finger samples sweep against toy meshes during descent and closing. A blocked descent cannot become a catch. Off-centre contact produces a grounded, damped tilt, constrained by adjacent toy bounds and cabinet walls. This is constrained rocking, not free rigid-body toppling. The contact browser check covers normal and jackpot catches, blocked misses, visible tilt, floor clearance and empty drops.
