# Cloud Claw working agreement

## Product focus

Read `docs/PRODUCT.md` before changing player behavior. The immediate milestone is a short, camera-only booth run that a first-time visitor can finish without coaching. Keep CoderPush and AWS branding, dark arcade styling, the spacious scene and minimal player text.

## Workspace and Git

- Default development folder: `/Users/qron/code/claw3d`. Run the editor, terminal, tests and preview from the same checkout.
- Before editing, inspect `pwd`, `git status --short --branch` and `git worktree list`. Report a mismatch before continuing in another checkout.
- Work flows through pull requests, one GitHub issue per PR, squash-merged. Pick the next unclaimed item from the pinned tracking issue in priority order (P0 before P1 before P2), add the `in-progress` label and assign yourself before starting, and open the PR early as a draft. Branch names: `<type>/<issue-number>-<slug>`. Create extra worktrees only for an explicitly separate experiment; identify its owner, branch and port.
- The PR title is a conventional-commit line (`type(scope): imperative summary`); it becomes the squash commit and the release-note line, so write it for a booth host. Fill in the PR template: player-visible change, evidence, checks run, physical-validation status. Label the PR with its batch label so release notes group correctly.
- Arm `gh pr merge --squash --auto` as soon as the PR is complete; the `main` ruleset lands it the moment its required checks are green, without anyone watching. (A merge queue needs an organisation-owned repository; until then PRs merge independently and only a real textual conflict needs a rebase.) Do not run the full `check:booth` locally before every PR: run the unit tests and only the browser suites you touched, and let CI run the rest. Use focused review (or `/code-review`) for consequential changes and resolve material CodeRabbit findings; the rest can follow up. Keep PRs small enough to review in one sitting, but bundle changes that touch the same files into one PR rather than serial PRs that rebase on each other.
- Every push to `main` deploys after checks and publishes a GitHub Release whose notes list the merged PRs since the previous production release. Changes that need a physical decision ship behind a URL flag with the `needs-physical-test` label; the decision and the tested BUILD are recorded in `docs/PRODUCT.md`.
- Preserve unrelated changes. Never discard a worktree until unique source, plans and useful evidence are preserved and verified.
- Make a conventional local commit after each verified, coherent change. A checkpoint preserves unfinished work but must say so. Do not claim a checkpoint is production-ready.
- Review the staged diff, including untracked files, before committing. Never commit secrets, camera frames, local scores, dependencies, builds or screenshots. No force pushes; deployment remains within the user's authorized scope.
- Other agents (ChatGPT Codex, Claude workflows) work the same queue. Do not start an item labelled `in-progress` by someone else; if two PRs touch the same file, the later one rebases.

## Small engineering loops

- State the player-visible problem and one acceptance criterion before implementing. Fix one observed problem per iteration; avoid unrelated redesign or speculative abstractions.
- Inspect existing modules and tests first. Extend the active implementation rather than starting another scene or input system. Active entry: `index.html` -> `src/arcade.js`.
- Camera adapter owns input. Event session owns player identity and scoring. Mechanics owns game phases; scene/contact modules own rendering and contact response. Keep these responsibilities clear.
- Keep input loss separate from explicit host pause. Hands leaving the view must not freeze an accepted drop. Preserve exactly three scored turns and one score per turn.
- Add a regression for meaningful failures. Use targeted checks while editing, `npm run check` before committing, and `npm run check:booth` for camera, phase, scoring or collision changes.
- Run browser suites sequentially: concurrent WebGL instances distort timing tests. Synthetic camera tests verify integration, not human recognition accuracy.
- Verify the operator BUILD value after rebuilding the preview. Record physical-camera playtest results against that commit; do not label synthetic input as physical validation.
- Keep reusable decisions in `docs/PRODUCT.md`, setup in README, and historic experiments in `docs/archive`. Do not make the conversation the only record.

## Keep documentation and delivery status current

- Update README and docs/PRODUCT.md whenever behavior changes. Remove contradictory current instructions and resolved assumptions; move superseded decisions and release evidence to docs/archive with a clear historical label.
- Before reporting shipped or unshipped work, compare current main with the authenticated live BUILD and refresh relevant coordinating-task status. Refresh actual tester messages before selecting another feedback-driven change. Separate deployed functionality, unfinished proposals and physical acceptance.
