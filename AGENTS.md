# Cloud Claw working agreement

## Product focus

Read `docs/PRODUCT.md` before changing player behavior. The immediate milestone is a short, camera-only booth run that a first-time visitor can finish without coaching. Keep CoderPush and AWS branding, dark arcade styling, the spacious scene and minimal player text.

## Workspace and Git

- Default development folder: `/Users/qron/code/claw3d`. Run the editor, terminal, tests and preview from the same checkout.
- Before editing, inspect `pwd`, `git status --short --branch` and `git worktree list`. Report a mismatch before continuing in another checkout.
- Use trunk-based development: deliver small, verified changes directly to `main`. Use short-lived branches only when isolation helps, and integrate them promptly after checks and agent review. Do not wait for human PR review or optional review bots. Create extra worktrees only for an explicitly separate experiment; identify its owner, branch and port.
- Preserve unrelated changes. Never discard a worktree until unique source, plans and useful evidence are preserved and verified.
- Make a conventional local commit after each verified, coherent change. A checkpoint preserves unfinished work but must say so. Do not claim a checkpoint is production-ready.
- Review the staged diff, including untracked files, before committing. Never commit secrets, camera frames, local scores, dependencies, builds or screenshots.
- Push verified changes to the agreed `origin`; routine integration into `main` is authorized. The agent owns review and integration quality. Use focused review for consequential changes, resolve material findings, and run the applicable checks before integration. PRs are optional records, not a waiting stage. No force pushes; deployment remains within the user's authorized scope. Finish with branch, commit, checks and any outstanding work.

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
