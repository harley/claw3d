# Operations guide

This guide owns shared-service setup, score recovery, deployment verification, feedback review and data retention. For local play, see [README](../README.md); for player behavior and acceptance, see [PRODUCT](PRODUCT.md).

## Shared service

The Node service serves the built game, camera models and API from one protected origin. All data routes and assets require a staff session. A separate host code unlocks board rotation and export. Codes live only in server environment variables, never in the bundle or repository. Camera frames and landmarks stay in the browser. Names are display labels. Client-reported catches are trusted for this small pilot; server-calculated totals are not anti-cheat.

Runs retain the score and control rules issued at creation. See [PRODUCT](PRODUCT.md#player-choice-and-shared-controls) for the supported control modes and [speed scoring](PRODUCT.md#hands-free-menus-and-speed-scoring). Rules upgrades and host rotation preserve previous boards and scores in host export; pending runs finish on their original board.

After camera setup and generated editable callsign selection, gameplay waits for the server to issue a run. The first drop is scored turn one; there is no warm-up or practice choice. Each run keeps its board and rule snapshot; host rotation affects new runs, and old in-flight runs finish on the original board. Every completed event run is ranked, including repeat names, with tied totals sharing rank. Failed starts offer retry or Back without local fallback. Results show pending/error until acknowledgement, then the personal rank and original board, with a View leaderboard action and Your result to return. Play again selects the previous nickname; Next player generates a new callsign. Both wait for submission before creating a new attempt. Historical practice data remains excluded and is never imported.

Completed event turns enter a browser outbox before being submitted in order. “Score waiting to sync” means no saved rank has been confirmed. The service accepts duplicate identical submissions once and rejects conflicting results. Keep the browser open until saving finishes. Reload replays completed turns, then abandons an unfinished run rather than recreating its physics. Sign in again in the same browser to recover pending scores after session expiry. A private HTTP-only owner cookie persists for 90 days; clearing browser data removes ownership and pending results. Existing standalone scores are never imported.

Use the [Node requirement and installation steps](../README.md#requirements). The deployment image uses Node 24. To run the shared service locally:

```sh
npm ci
npm run build
# Set STAFF_CODE to a secret of at least 16 characters.
# Set HOST_CODE to a distinct operator code of at least 8 characters.
# Keep them in a private shell/environment file outside this repository.
PUBLIC_ORIGIN=http://127.0.0.1:4200 DATA_DIR=.local-data npm start
```

Open `http://127.0.0.1:4200` and enter the staff code. Ordinary `npm run play` remains explicitly browser-local; network failures in the shared service never switch to that board.

## Playtest observations and feedback

The protected pilot stores bounded playtest observations in `playtest_events`, a separate table in the existing `/data/pilot.sqlite`. A random page-session UUID, build commit, practice/event mode and elapsed time describe each observation. Camera readiness, control/phase changes, the gesture funnel (`hold_start`, `hold_cancelled` with its cause, `drop`, `time_to_control`), drops, completions, bounded performance samples — including vision latency percentiles, result rate and capture-reject counts — and fixed error categories help identify where players hesitate. Historical practice observations do not create leaderboard runs or scores; the current client records event mode only. These are client-reported observations, not proof of physical gesture accuracy.

`visionP50Ms` and `visionP95Ms` retain their historical meaning: capture to completion of the accepted-result handler, sampled only when a response passes the input gate. `captureToReceiptP50Ms` and `captureToReceiptP95Ms` measure capture to main-thread receipt for accepted and over-age responses in the current camera generation. They include the delayed tail even if a 30-second window has no accepted results. Hidden, out-of-order, negative or non-finite, and previous-generation responses do not enter these percentiles. Each window keeps at most 2,000 samples and reports at most 60,000 ms. `resultHz` still counts accepted results; rejection counters and the separate five-second rendering governor are unchanged. Host reports group by build and mode, average reported p50 values and show the highest reported p95; they do not pool individual frames or mix earlier builds into the new measure.

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

## Hosting and build identity

Railway project `claw3d`, service `staff-pilot`, one instance with `/data` on a persistent volume. The Docker build needs `BUILD_COMMIT`, `BUILD_BRANCH`, and `BUILD_DIRTY=false` from the exact clean commit being deployed. Runtime needs `NODE_ENV=production`, `PORT=4200`, `DATA_DIR=/data`, `PUBLIC_ORIGIN` equal to the exact HTTPS origin, and the two secrets. The service refuses production startup without the actual Railway volume mount. SQLite uses WAL and transactional writes. Do not scale this pilot to multiple instances.

Pushes to `main` run [Check and deploy](../.github/workflows/release.yml): a Linux production-container startup/backup check, macOS unit/build checks, four macOS [browser-suite shards](../scripts/check-browser.mjs) and a separate shared-session browser check. Each shard runs its assigned suites sequentially on its own standard macOS runner; the aggregate `Unit, build and browser checks` status requires every shard and the other checks to succeed. Only a passing main run can deploy the checked commit to Railway. Pull requests run the same checks without production credentials or deployment. Hosted browser checks use lockfile-pinned, headed Playwright Chromium on standard macOS runners to access their virtual Metal GPU. The headless shell used software rendering at about 1 FPS, too slow for interactive phase checks. All original assertions, full graphics quality, screenshots and video remain active. macOS consumes more Actions minutes. These checks do not establish physical camera accuracy or booth-machine performance. Feature branches never deploy. A manual workflow run on main repeats the same gates.

Production deployments are serialized. A run deploys when its commit is newer than the live build (the `BUILD_COMMIT` Railway variable set by the previous deploy); a run that finishes after a newer commit has already deployed is skipped, but a commit is never skipped merely because another merged while its checks were running. Build identity is set from the checked SHA with `--skip-deploys`, then `railway up --ci` uploads that source. The follow-up probe waits for authenticated `/build-info.json`, opens the rendered operator panel and verifies the same clean main BUILD without starting the camera, submitting scores or recording playtest telemetry. A `/healthz` response alone is not release proof. GitHub marks failures in the run and uses the account's configured Actions notifications. Tester follow-up remains separate from automated release verification.

Setup: the GitHub `production` environment holds `RAILWAY_TOKEN`, a Railway project token scoped to the pilot's production environment. Keep Railway's direct GitHub source disconnected so it cannot bypass the check gate. Project/service/environment IDs are explicit in the workflow; staff and host codes are read in memory from Railway only during verification. Never store an account-wide Railway token in GitHub. Restrict the production environment to `main`.

If a release fails, inspect the Actions run and Railway deployment before retrying: a CLI failure can leave a deployment running. Re-run the workflow on current main, or revert the offending change on main to deploy a fix through the same checks. A manual emergency rollback must select a compatible previous application deployment and preserve the database. A successful smoke check does not replace physical-camera acceptance. The local preview remains independent.

## Export, backup, restore and removal

Host controls export all boards and interrupted runs as JSON. This export omits authentication material. Treat exports as staff data and store them privately. There is no browser import of local scores.

Each production deployment creates an integrity-checked SQLite snapshot in `/data/release-backups/<commit>-<deployment>.sqlite` before opening the database. The first deployment has no database to back up. Restarts of that deployment reuse the same verified snapshot; a redeploy or rollback gets a fresh snapshot (a fresh startup snapshot is used if Railway supplies no deployment ID); a failed backup stops startup. Snapshots preserve committed WAL data and are never overwritten or automatically deleted. They contain private authentication records as well as scores; include them in the pilot's retention/deletion process and monitor volume usage. They protect application rollback, not loss of the volume itself.

For a separate manual snapshot, use a new filename:

```sh
node server/backup.js /data/pilot.sqlite /data/pilot-backup-YYYYMMDD-HHMM.sqlite
```

Download that snapshot through Railway volume files or a protected operator channel. It includes private authentication records as well as scores: restrict access and never commit it. The backup helper uses `VACUUM INTO` and verifies integrity. Check the project's available volume-backup options if longer retention is needed.

To restore: stop the service, keep a backup of the current database, copy the verified snapshot to `/data/pilot.sqlite`, remove only the stopped database's `pilot.sqlite-wal` and `pilot.sqlite-shm` sidecars, then restart. Verify the old board and totals through authenticated requests. Never replace a live database. The automated shared test opens a disposable restored copy and verifies both clients’ completed runs.

Rollback uses a verified compatible prior application deployment with the same mounted volume; do not reset the database. Check that the selected build preserves current rules and data contracts before rollback. Browser-local preview cannot read shared scores.

Keep pilot names/results only until the host ends the pilot. Removal requires stopping the service, deleting the pilot database/volume and any Railway snapshots, and deleting private downloaded exports/backups. Host board rotation preserves history and is not deletion. Rotate both secrets if access should be revoked; existing sessions last up to 12 hours unless their session rows are cleared by the operator while preserving scores.
