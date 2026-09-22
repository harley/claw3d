# Claw3D: reusable game, independent themes and event presets

Status: proposed implementation plan, not implemented behavior.
Owner: Harley. Planning contributor: ChatGPT.
Tracking: [#68](https://github.com/harley/claw3d/issues/68).
Reviewed baseline: `5353b08a90cb660888c81b0d9ff37af3ecd05416` on 2026-09-22.

## Decision and product promise

Build one reusable browser game, not an AWS-specific application with a second generic fork, and not a general-purpose game engine.

Proposed public promise: **A 3D claw arcade you control with your hands, play in your browser, and remix for your own event.**

Camera control and a believable, skill-based catch remain the distinctive experience. A useful open-source release needs three clear paths: play it, customize it, and contribute to it. More configuration alone does not make the project interesting.

The first product milestone is deliberately small: a neutral Claw3D experience and an AWS Cloud Day experience, built from the same source. A contributor can change branding and supported visual tokens without editing gesture recognition, physics, scoring, authentication, or deployment code.

This proposal does not retune the game or replace the current booth plan. It does not change production access, publish staff data, introduce new control modes, or migrate existing scores. The current behavior contract remains in [PRODUCT.md](../PRODUCT.md) until each implementation slice updates it deliberately.

## What exists, and what must become independent

The repository is now public and GitHub identifies its license as MIT. The [README](../../README.md) still introduces a CoderPush x AWS arcade and a protected staff pilot. The application already has browser-local play and an optional shared service; do not build those a second time.

[arcade.js](../../src/arcade.js) coordinates mode selection, the session and application wiring. [arcade-hud.js](../../src/arcade-hud.js) and [arcade-scene.js](../../src/arcade-scene.js) own presentation. [event-session.js](../../src/event-session.js) already supplies versioned score rules. [The release workflow](../../.github/workflows/release.yml) deploys the checked main build to the existing staff service.

Recheck current main and open PRs before implementation: several agents work this repository. This document's source baseline is not a claim about the latest deployed build or the completion of other issues.

## Four separate configuration concerns

| Concern | Owns | Must not own |
| --- | --- | --- |
| Theme | App and event labels, approved logos, cabinet branding, color/material tokens, optional licensed decorative assets | Catch logic, scoring, gesture thresholds, authentication, storage namespaces, telemetry destinations |
| Gameplay definition | Rules version, turn count, aiming budget, points, layout/content identity, restocking and assistance policy | Sponsor names, production credentials, CSS |
| Control profile | Available input method, acquisition/confirmation behavior, mode-specific instructions, input-policy version | Event branding, server authorization, authority to merge boards |
| Deployment settings | Standalone versus shared adapter, selected preset, origin, private credentials, database, telemetry policy | Secret values in browser configuration or user-selectable authority |

An **experience preset** composes approved theme, gameplay and control IDs with public presentation preferences. It contains no secret values. Deployment selects which presets and capabilities are allowed.

For example, conceptually, not as a supported API yet:

```json
{
  "id": "aws-cloud-day",
  "themeId": "aws-cloud-day",
  "gameplayId": "existing-booth-rules",
  "controlProfileId": "existing-approved-one-hand"
}
```

The same AWS appearance can run locally for a demo or with the protected shared adapter for an event. Likewise, a neutral theme does not imply that authentication is disabled. A browser query parameter must never grant access to a different backend, enable a prohibited input mode, or change a shared run's rules.

## Keep the first theme contract small

Start with application/header/dialog titles, sponsor labels, cabinet text, and a bounded set of existing CSS and scene-material tokens. Keep core controls, recovery guidance, privacy notices and required attribution accurate and available.

Use repository-owned, reviewable theme data and asset identifiers. Validate field types, lengths, supported colors and asset references. Insert user-facing text as text, not raw HTML. Do not load JavaScript, arbitrary CSS, remote configuration, or arbitrary model URLs supplied through a query parameter. A future import/editor system needs its own security design.

Do not confuse a skin with gameplay content. A new toy mesh can change support envelopes, contact, visibility and difficulty. In the first release, themes recolor or relabel the existing validated geometry. New prize families and cabinet geometry belong in reviewed content packs with asset provenance, dimensions and collision/clearance tests, not in a free-form logo/color file.

Theme changes must preserve readable cues, contrast, recovery actions and reduced-motion behavior. The code license does not settle every third-party asset or brand permission: preserve each asset's existing notice and document the scope of reusable code versus example branding.

## Implementation shape: add seams, not a new framework

Keep the existing modules and build system. Introduce only the configuration modules needed by the next slice. Suggested destinations, not a mandatory file migration:

```text
src/config/experience.js          resolve and validate effective public settings
src/themes/default.js            neutral appearance
src/themes/aws-cloud-day.js      AWS event appearance
src/presets/default.js           neutral standalone experience
src/presets/aws-cloud-day.js     event composition, no secrets
public/themes/                   reviewed optional theme assets
server/                          existing protected shared service
```

Keep gesture recognition in the camera layer, deterministic catches in mechanics/contact, scores in event-session, and presentation in scene/HUD. Pass resolved settings into these boundaries rather than scattering `if AWS` checks through them. Do not introduce an abstract plugin platform, an entity-component system, a new frontend framework, or a monorepo for this work.

A theme can be edited in one place. It need not be possible to change every parameter at runtime. Begin with build-time or trusted startup selection from an allowlist; consider an idle-screen theme switcher only after both presets work. Do not switch active runs.

## Migration rules that protect the booth

**Pin the existing staff deployment to the AWS preset before changing any default.** The default public/local build can become neutral only after this pin has shipped and been verified. An explicitly configured invalid event preset should fail clearly, not silently serve the generic theme.

Keep the current three-turn booth experience, supported input policy, local/shared restocking differences and score behavior unchanged during extraction. Later generic games may vary them through approved versioned gameplay definitions. Theme extraction is not the place to introduce a new hold duration, a practice round, extra turns, or difficulty assistance.

Do not rename legacy storage keys, rule IDs or outbox keys as a cosmetic cleanup. Preserve existing boards, pending submissions and interrupted runs. New generic histories should have explicit experience/event isolation without erasing or silently importing old histories.

Leaderboard compatibility must describe the actual challenge: rules version, layout/content version, restock/assistance policy and allowed input policy where they affect comparability. Changing points is not the only way to change difficulty. A cosmetic theme must not silently create a new scoring regime; a substantive gameplay change must not mix into an incompatible board merely because the point values stayed the same.

Shared runs retain server-selected, immutable definitions. The client may report its theme for diagnostics, but must not submit a modified rule object as authority. Neither public-demo scores nor client-selected modes are imported into the event board.

Do not reuse the staff production origin for untrusted fork previews or the unauthenticated public demo. Keep demo storage and telemetry separate from staff sessions. Preserve the existing authenticated BUILD check, backup behavior, required CI and deployment ordering; do not alter that release workflow casually while extracting branding.

## One verified change per commit

A coherent commit can contain implementation, its regression tests and the documentation for that change. It is not one commit per file. Inspect the diff, validate the applicable behavior, commit, push, then inspect CI before treating the change as ready. No force pushes or unrelated edits.

Use one short-lived branch and PR per owned issue, following [AGENTS.md](../../AGENTS.md). Do not start an issue claimed by another agent. Preserve the repository's squash-merge policy. This planning PR remains a draft; it neither enables auto-merge nor changes the running game.

The following are ordered slices, not an instruction to execute the whole list in one session. Split a slice further when the diff cannot be reviewed comfortably.

| Slice | Deliverable | Proof before integration |
| --- | --- | --- |
| 0. Plan | This document only | One-file diff; checked source references; no runtime or deployment changes |
| 1. Extract current branding | Put current AWS copy/tokens behind a small resolved appearance contract; initially bind one coherent surface, then the remaining HTML/HUD/scene surfaces | Existing appearance and behavior preserved; token validation and affected browser assertions; no new theme default |
| 2. Pin the event | Explicit AWS preset selection for the existing deployment, retaining current gameplay and shared access | Protected app has expected branding/preset plus exact clean BUILD; no public exposure or score migration |
| 3. Add the neutral preset | Neutral Claw3D appearance; default standalone/public build no longer requires event identity | Both presets build and boot; no AWS event copy on generic player surfaces; no changes to historical scores; event still pinned |
| 4. Prove customization | A minimal third-party-style example and short theme guide using only the supported contract | New theme works without changing core source; same scripted actions produce the same outcomes under cosmetic themes |
| 5. Public showcase | Separate static demo, clear camera activation, honest local score labels, useful README and contribution paths | Fresh-browser play without AWS account or staff code; no staff API requests, server telemetry or private data; permission-denial recovery checked |
| 6. Broaden rules/input only when needed | Configurable turn counts or alternative inputs as separate gameplay/profile work | Versioned compatibility, golden score tests and recovery tests; no silent mixing with event boards; physical acceptance for gesture changes |

Slices 1 and 2 may interleave, but slice 2 must finish before changing the standalone default in slice 3. A docs-only or appearance-only PR does not establish physical-camera acceptance. Automated validation must still cover the affected preset/mode combinations and current required CI.

## Acceptance matrix

- Neutral standalone: starts without server secrets, uses local scores, and makes no staff-service requests.
- AWS standalone: event branding with local-only scoring and an honest local label.
- AWS shared: existing protected session, server-confirmed totals, host authorization, retry/outbox, backup and BUILD verification preserved.
- Invalid or overridden settings: unknown configured IDs fail clearly; shared deployment ignores or rejects unauthorized browser overrides.
- Cosmetic theme change: deterministic outcomes and rule snapshots remain unchanged; the selected theme stays fixed during a run.
- Asset failure and viewport changes: useful recovery, readable controls, reduced motion, and unchanged valid hit areas. New content geometry must pass its own clearance tests.

Build tests must include generated HTML metadata and initial loading/error screens, not only JavaScript after hydration. Verify both the public build and the protected server-served build; exercising only the development server misses packaging and injected-setting mistakes.

## Make the project worth using, not just configurable

Lead with a playable demonstration of the hand-control moment and a short visual explanation. Document ordinary webcam/browser requirements and measured limitations rather than implying recognition works equally well on every device.

Give visitors three obvious routes: **Play**, **Make your own theme**, **Contribute**. The customization example should achieve a visibly different result without changing game logic. Put booth schedules, deployment administration and operational runbooks in a dedicated AWS/event guide rather than at the top of the general README.

Preserve CoderPush credit in the project story and notices without forcing an AWS event banner onto every downstream game. Keep the existing license and model notices; audit any additional community asset before including it.

Prioritize clear controls, legible catches and a finale showing the player's actual prizes. Do not delay a usable public release for bloom, a theme marketplace, arbitrary model imports, cloud accounts, global rankings, multiplayer, or a universal game SDK.

Optional later work: a separately selected keyboard/pointer accessibility/demo profile. Do not silently substitute it into an official camera-control challenge or claim it is already supported.

## Reuse the existing queue

Coordinate config extraction with #11 and cue semantics with #22. Use #10 for mode-accurate help, #13 for hand-asset loading, #12 for turn-controller extraction when needed, #35 for HUD boundaries, #36 for telemetry definitions, and #37 for later rules-driven turn counts. Do not turn combos or assistance into dependencies of theming.

#33 can support the public finale. #39 and #42 cover preview/open-source foundations; verify their actual implementation and remaining checks before duplicating them. The current booth queue is #43. This plan adds a product direction, not another competing copy of that queue or an automatic reprioritization of other agents.

## Public-repository and privacy checks

The public demo should request camera access after an explicit Play/Enable camera action, explain that processing stays in the browser, and leave remote telemetry off by default. Preserve the existing event startup policy until a separate event change is tested. No frames or landmarks may be sent in telemetry or committed as fixtures without deliberate provenance/privacy review.

Treat fork PR code as untrusted. Builds/tests must not receive production or preview-provider secrets; never run fork code in a privileged `pull_request_target` job. Any privileged publisher must treat build artifacts as untrusted data, deploy only static output to an isolated preview origin, and validate the originating repository, PR and commit before publishing. Do not assume a private-repository workflow remains safe merely because it still runs after a visibility change.

Keep secrets server-side. Vite's `VITE_*` values are exposed in the client bundle; putting a staff code into a theme, preset, public config file or client environment variable would publish it.

Reference guidance: [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use), [securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), and [Vite environment variables](https://vite.dev/guide/env-and-mode).

## Release outcome

Call the first reusable release ready when a new developer can run the neutral game, create a distinct theme using the guide without touching core logic, and separately run the AWS preset with the existing protected event behavior intact. Report that evidence and the verified build identities. A plan, a passing unit test, or an open PR is not a deployed product.
