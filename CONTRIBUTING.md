# Contributing

Cloud Claw is a camera-controlled arcade for the CoderPush × AWS booth. Start with the [local setup](README.md#run-locally), [agent safeguards](AGENTS.md) and, for behavior changes, [product contract](docs/PRODUCT.md).

## Scope and branches

Follow the requested scope. A question, review or proposal does not require claiming an issue or publishing a change. For repository changes, use one GitHub issue per PR and a branch named `<type>/<issue-number>-<slug>` in your current checkout.

When asked to choose work from the pinned tracking issue, select an unclaimed item in priority order (P0, P1, P2). For the selected or explicitly requested issue, assign yourself and add `in-progress` before implementation. Do not take work claimed by someone else. If GitHub authentication fails, ask for guidance.

Keep PRs focused and small enough to review in one sitting. Bundle related edits to the same files. When overlapping work causes a conflict, the later PR rebases; never force-push or discard unrelated changes.

## Testing policy

Run `npm run check` (unit tests and production build) before committing a coherent change. During editing, use targeted checks and add a regression for meaningful failures.

For camera, phase, scoring, collision or rendering changes, also run the affected browser suites locally. For shared-session or server changes, run `npm run test:shared` after building. Run browser suites sequentially: concurrent WebGL instances distort timing tests. Documentation-only edits need link and policy checks, not browser or physical-camera tests.

```sh
npm run check
# Start npm run dev in another terminal for an affected suite, for example:
npm run test:camera
# After a build, for shared-session/server changes:
npm run test:shared
```

The full release gate runs in [CI](.github/workflows/release.yml): `npm run check:booth`, then `npm run test:shared`, plus the production Linux container/backup check. Full local `check:booth` is optional unless explicitly requested or needed to investigate a failure. It owns a temporary dev server on port 4196, so stop your dev server first. The [browser runner](scripts/check-browser.mjs) is the authoritative suite list; individual suites also run as `node tests/<suite>.browser.mjs` against the dev server.

Synthetic tests verify integration, not human recognition or booth-machine performance. Changes needing a physical decision stay behind a URL flag and carry `needs-physical-test`; record the decision, tested BUILD and hardware in PRODUCT. Screenshots belong in locally ignored `.screenshots/` and must not be committed.

## Delivery

Review the staged diff, including intended new files, then make a conventional commit for each verified coherent change. Preserve unfinished work as an explicit checkpoint. Never commit secrets, camera frames, scores, dependencies or generated builds.

Open PRs ready for review unless a draft is explicitly requested. Use the [PR template](.github/pull_request_template.md), link the issue and apply its batch label. Titles use `type(scope): imperative summary` and become the squash commit and release-note line; write them for a booth host. Use focused review for consequential changes and resolve material CodeRabbit findings.

For work authorized for merge and delivery, enable squash auto-merge once the PR is complete (`gh pr merge --squash --auto`). Review readiness alone does not authorize merge. Do not bypass required checks. Main deploys after its release checks and publishes a GitHub Release; verify authenticated and rendered live BUILD before reporting deployment, following [OPERATIONS](docs/OPERATIONS.md#hosting-and-build-identity).

Update the document that owns the changed fact, with summaries or links elsewhere only as needed. Keep implementation, deployment and physical acceptance distinct in the handoff.
