# Five-track release — September 12, 2026

Historical release evidence; refresh live BUILD before reporting current status.

## Verified release

- Previous live BUILD: `35b3353`; all five tracks were merged but undeployed.
- Deployed clean main `030a7f21b1d79e1ff2af97a0f0d677f4e6206a53`, which contains Track 5 merge `84fd773`.
- Railway deployment: `ebfcd914-aa0e-49ad-8fd2-0a04996916fa`.
- [Exact-commit CI](https://github.com/harley/claw3d/actions/runs/34627861101): unit/build, eight sequential browser suites, shared-session and production Linux container/backup checks passed. Deployment stopped at its missing Railway token.
- Released through the existing authenticated Railway CLI from a git archive of the checked commit, excluding unrelated local changes. No new credentials were created.
- `scripts/verify-release.mjs` verified authenticated build metadata and rendered operator `BUILD 030a7f2 · main`, with no page errors, camera access, player registration or score submission.
- Human camera/latency, sound, display and first-time-player acceptance remain open. Badge integration and physical-prize mapping are not part of this release.

## Superseded September 11 status

The following notes describe the earlier release and are no longer current.

## Local audition

The movement sounds and drop/shelf/completion fanfares are the next local audition requested by the user. They have not been deployed to the staff pilot.

## Release evidence and documentation ownership

The gated main workflow documented in README defines delivery after its production token is configured: sequential automated checks, serialized deployment and authenticated live BUILD plus rendered operator verification. Production startup verifies a database snapshot before opening the existing database. This delivery mechanism does not establish physical gesture accuracy or first-time-player acceptance; tester notifications remain selective and follow live verification.

Last live verification, September 11, 2026: authenticated `/build-info.json` and the operator panel both show clean `35b3353` on main at [claw.coderpush.com](https://claw.coderpush.com). Railway deployment `c1279dce-f4ff-4cc2-ba8d-6480ae1a1c0e` succeeded. The served bundle includes central arcade feedback, original pitch sweeps and reduced duplicate text. This is a dated observation; recheck actual live BUILD before reporting deployment status.

For this runtime, 95 unit tests/build, all eight sequential booth suites and the built shared-session suite passed. The focused review found and resolved short-screen clipping; a strengthened visible-camera-bounds regression also passed. Authenticated live verification found the new messages, removed duplicate banner and no browser errors; no live test score was added. The release verifier needed a null-safe readiness check during login navigation, then passed. [Research, license decisions and performance comparison](2026-09-11-arcade-presentation.md) record unchanged 16.7–16.8 ms p95 frame timing in matched synthetic scenarios and no added runtime assets. Subsequent test/documentation commits do not change the deployed runtime. Physical-camera accuracy, speaker quality and first-time-player readability still need human testing.
