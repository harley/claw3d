# Cloud Claw

A camera-controlled miniature arcade with an original enamel cabinet and eleven collectible toys: three bunnies, two capybaras, two cloud cushions, two jelly stars and two vinyl robots. A small courier lift carries each catch to its own place on the wooden gallery.

## Working agreement

Develop in `/Users/qron/code/claw3d` on a named feature branch. The active player experience is camera-only. Read [the product focus](docs/PRODUCT.md) and [agent working rules](AGENTS.md) before changing behavior. The earlier prototype is preserved on `checkpoint/camera-only-prototype`.

## Play locally

```sh
npm ci
npm run play
```

Open **http://127.0.0.1:4197**. `npm run play` rebuilds before starting, so a restart cannot silently serve an older build. Keep that terminal running. The preview stays stable during source edits; restart and refresh to update it. `npm run preview` uses the same command and port.

Open the operator gear to see the build commit, branch and whether it contains uncommitted changes. `/build-info.json` contains the same identity and build time. Rebuild after committing so the preview identifies the tested commit.

For development, run `npm run dev` and open **http://127.0.0.1:4196**.

## Event play

Enter a leaderboard name, play three turns, then see the total and rank. Each turn has 15 seconds of aiming and the original catch/delivery animation. All turns restock the same six-toy layout and restart the same carousel phase and start over an empty patch. Expiry drops the claw once; there is no random win roll or forced catch. Five stationary toys earn 100 points each. The moving star earns 200 points. Its carousel uses a fixed 5.6-second cycle; aim at the gold pickup ring and time the clasp confirmation for green. The cue leads contact by the fixed 1.05-second descent delay. The star continues moving during descent, then the mechanism brakes for grasping and delivery. Catch resolution uses the actual contact position, with no random success or target snapping. Timing and game feel still need human playtesting.

Start the camera, enter a name, steer with one hand, then clasp both hands and hold to drop. Turns advance automatically after two seconds. The gear button opens the operator panel. There are no keyboard movement or drop controls. Sound starts off and can be enabled explicitly. Reduced motion preserves a stable viewpoint and suppresses decorative celebration.

The operator can pause, reset the current player, select practice for the next player, change rendering quality, start a fresh leaderboard session, and export all sessions as JSON. Practice results are stored but excluded from rankings. Ties share rank. The leaderboard is for fun; rank does not earn an additional physical prize. Session rollover preserves old results and is blocked during an active run. Rules are saved with each run. Upgrading from the first static-prize prototype starts a separate carousel leaderboard; old results and any interrupted run remain available in the export.

Scores and player progress persist in this browser's local storage. Reloading an unfinished run requires the host to resume its uncompleted turn. Completed turns remain scored. Focus loss does not latch an operator pause. Hidden pages suspend gameplay until visible again; missing hands hold only the aiming timer, never an in-flight drop. Storage failures are displayed; export before closing if results are only in memory. Clearing browser data removes local history, so export regularly. This single-browser prototype has no server verification, badge enforcement, queue tracking or physical prize inventory. Staff supervise name entry; player IDs and a nullable badge ID leave room for later scanning. Do not use this local leaderboard as a tamper-resistant competition backend.

Camera controls are required for play. START CAMERA requests access and shows the readiness panel. Hold one hand still until HAND READY appears, then press PLAY to enter a name; CAMERA opens a separate setup dialog with device selection and re-centring. The only active gesture profile is one-hand steering with a two-hand clasp to drop. A missing or stale hand holds aiming and carousel motion. Once a drop starts, hand loss and settings dialogs do not stop delivery. Only the host's explicit PAUSE GAME stops the animation. Camera code and tracking models load only after explicit activation. Frames remain local and are not recorded. Face identification is not implemented. Camera integration is tested with a synthetic video device and the actual inference model; physical gesture feel still needs a booth rehearsal. Geometry and textures are generated locally.

## Implementation

- `src/arcade-mechanics.js`: deterministic state machine, aiming limits, independent finger support and curated assortment.
- `src/arcade-art.js`: original procedural toys, fabric grain, wood grain, smooth jelly geometry and face details.
- `src/arcade-scene.js`: cabinet, articulated claw, carriage, prize hatch, courier, gallery and material-specific performances.
- `src/event-session.js`: versioned rules, player runs, scoring, persistence validation and leaderboard sessions.
- `src/arcade.js` and `src/arcade.css`: camera-driven event flow, compact presentation, bounded loading/error states and reduced motion.

Grasping uses authored ellipsoid support envelopes and a guided animation. The jelly wave, cushion compression and trailing ears are expressive approximations, not a general soft-body or rigid-body solver. The couriers and glass are simplified miniature mechanisms. Booth hardware validation and deployment remain outside this iteration.

## Verify

```sh
npm run check          # unit tests + production build
npm run check:booth    # also starts/stops a dev server and runs all browser suites
# Or run one targeted browser suite with npm run dev already running:
npm run test:browser
npm run test:clearance
npm run test:carousel
npm run test:camera
npm run test:contact
```

The event browser suite uses deterministic camera input events through the real camera adapter to exercise a three-turn run with catches and a miss, repeated drop suppression, restocking, practice exclusion, automatic expiry, pause, reload recovery, session rollover, export, and a narrow viewport. A delivery regression removes hands, dispatches blur and opens camera settings mid-animation. The synthetic camera fixture does not measure recognition accuracy. It saves screenshots to locally ignored `.screenshots/`. Chrome runs headlessly for repeatability; verify game feel and performance on the booth hardware separately. Unit tests also cover all original grasp mechanics, carousel interception timing and stored session rules. The carousel browser test records a camera-event-driven successful interception, early and late misses, and checks the star’s full orbit against stationary toy mesh bounds.

Development-only inspection is available at `/?inspect=butter&phase=grip` (any toy ID; any animation phase). `window.__littleCloud.snapshot()` exposes read-only diagnostics in development. Production removes both inspection and diagnostics.

For historical context, see [the creative brief and verification record](docs/plans/2026-09-06-2344-feat-little-cloud-arcade-plan.md) for the visual requirements and evidence. No code or assets were copied from the unlicensed Jelly-Baby reference.

The delivery-clearance check samples all eleven transported toys, the tray and courier through outbound and return motion against nearby decorative mesh bounds, with a clearance margin. It also reproduces the former plant obstruction. Delivery remains a guided animation, not a general collision solver.

Finger samples sweep against toy meshes during descent and closing. A blocked descent cannot become a catch. Off-centre contact produces a grounded, damped tilt, constrained by adjacent toy bounds and cabinet walls. This is constrained rocking, not free rigid-body toppling. The contact browser check covers normal and jackpot catches, blocked misses, visible tilt, floor clearance and empty drops.
