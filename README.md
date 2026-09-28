# Claw

A camera-controlled CoderPush × AWS arcade. Choose an editable animal-emoji name, steer the claw and play three scored turns. Catch toys for 100 points or the star for 200, with up to 50 speed points per catch. The shared staff pilot adds a protected leaderboard; local play keeps scores in your browser.

## Requirements

- Node.js **22.13.0 or newer**, as declared in [package.json](package.json).
- A webcam and a browser with camera access and WebGL support. Use desktop Chrome for the booth playtest; recognition and performance still need validation on the intended hardware.
- Camera access requires localhost or HTTPS and browser permission.

## Run locally

From your current checkout:

```sh
npm ci
npm run play
```

Open **http://127.0.0.1:4197** and keep the terminal running. This command builds before serving; restart it and refresh the page to pick up changes. `npm run preview` does the same.

For development with live updates, run `npm run dev` and open **http://127.0.0.1:4196**. Use the same checkout for editing, tests and preview.

## How to play

1. Allow camera access. Use **📷** to select or re-centre the camera if needed.
2. Choose **1 Hand** or **2 Hands** before PLAY. The selector works in local and shared play and locks during a run.
3. Use one open hand and hold a fist to select menu buttons in either mode; gameplay follows the selected profile. START confirms your editable name; these menu buttons also accept clicks.
4. In **1 Hand** mode, steer with an open hand and clench and hold to drop. In **2 Hands** mode, show the left hand open, then clench to grip and steer; bring your open right palm into the highlighted DROP area. Start with the left hand only; the right-hand guide appears after grip. Brief detection gaps stop movement and drops; returning the same closed left hand promptly keeps its grip. After longer loss, reopen and grip again.
5. Finish three scored turns and view your result. The first drop counts; there is no practice round.

Gameplay uses camera controls; keyboard aiming and dropping are not supported.

Use **🔊 / 🔇** to toggle sound. If TAP FOR SOUND appears, click or press a key to unlock browser audio. The gear opens operator controls and BUILD identity. Detailed controls, scoring and optional experiments belong in [PRODUCT](docs/PRODUCT.md).

## Local and shared play

Public play at [claw.coderpush.com](https://claw.coderpush.com) needs no login. Keep or edit a generated name, play three turns, and compare your saved rank. **Next player** is the primary result action. See [Hanoi event setup](docs/OPERATIONS.md#public-play-and-hanoi-event-setup) for the 29 September booth browser.

| | Local preview | Shared staff pilot |
| --- | --- | --- |
| Open | `npm run play` | [claw.coderpush.com](https://claw.coderpush.com/) for players; [/staff](https://claw.coderpush.com/staff) with the host code for event setup |
| Scores | This browser only; control modes have separate boards | Server-confirmed total and rank; both modes share the fun leaderboard |
| Reload during a run | CONTINUE preserves completed turns and restarts the unfinished turn | Syncs completed turns and abandons the unfinished attempt |
| Operator access | Gear panel | Separate host code for protected controls |

Keep the shared page open while a score waits to sync. Sign in again in the same browser after session expiry to recover pending scores. Clearing browser data removes local history and pending results; local scores are never imported into the shared board.

For shared-server setup, exports, score recovery, backup, restore and release verification, see the [operations guide](docs/OPERATIONS.md).

## Privacy and limitations

The public [privacy page](https://claw.coderpush.com/privacy) explains camera processing, public names/results, diagnostics and browser storage.

Camera frames and landmarks stay in the browser and are not recorded. The shared service's connection policy blocks external MediaPipe metric uploads; local development and static previews do not inherit that server policy. See the [runtime provenance](public/vision/README.md) and [connection-policy details](docs/OPERATIONS.md#playtest-observations-and-feedback). The shared pilot stores display names, results, bounded playtest observations and voluntary feedback; see [collection and retention](docs/OPERATIONS.md#playtest-observations-and-feedback).

Names are display labels. Client-reported catches are trusted, so server scoring is not anti-cheat. Badge enforcement, physical-prize inventory and the event-day one-play/one-gift policy are not implemented. The shared pilot is a testing environment; physical recognition, comfort and first-time usability remain open acceptance checks.

## Development and contributing

Follow [CONTRIBUTING](CONTRIBUTING.md) for branches, pull requests and the testing policy. [AGENTS](AGENTS.md) defines scope and safeguards for agents. [PRODUCT](docs/PRODUCT.md) owns current behavior, design constraints and unresolved decisions; [docs/archive](docs/archive) holds useful historical evidence.

## License and asset credits

Project code is licensed under [MIT](LICENSE). The CoderPush/AWS names and event presentation identify this project's booth context; the code license does not grant trademark rights or imply endorsement of forks. This project retains its existing event presentation. Reusers should use their own branding unless separately authorized by the relevant owner. This repository does not contain an AWS trademark authorization record.

Third-party hand meshes retain their [MIT license and provenance](public/models/hands/README.md). The [MediaPipe runtime and recognition model notice](public/vision/README.md) records the exact distributed versions, sources and verification limits. [Audio provenance](docs/archive/2026-09-11-arcade-presentation.md) records the original synthesis decision.


Public documentation retains dated technical evidence, public source links and upstream copyright credits. Staff identities, production test nicknames and internal document links are not needed to explain that evidence. Historical records are dated snapshots, not current deployment or acceptance claims.

## Android offline app

The Android app bundles this same game and uses native GPU hand tracking. On macOS or Linux, install Java 17 and Android SDK 35, run `npm ci`, then `npm run android:build`. Set `ANDROID_HOME` or an ignored `android/local.properties` SDK path. Output APKs, checksums and source metadata are under `android/build/distributions/`. See [Android distribution](docs/OPERATIONS.md#android-distribution) for signing, versions and updates.

Test builds use `com.coderpush.cloudclaw.test`; signed releases use `com.coderpush.cloudclaw`. Both install separately from the experimental `com.coderpush.tomkogame` app. Scores stay in each app; there is no automatic migration. The game needs no internet while playing. Physical Tomko acceptance is still pending.
