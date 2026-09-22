# Cloud Claw working agreement

## Scope and evidence

- Follow the requested task. Questions, reviews and documentation audits do not authorize queue work, implementation, merge or deployment. Use the queue only when asked to choose the next item; follow [CONTRIBUTING](CONTRIBUTING.md) for delivery.
- With a checkout, inspect `pwd`, `git status --short --branch` and `git worktree list` before editing. Keep editor, terminal, tests and preview in that checkout; report mismatches before switching. Without shell access, record the repository, exact commit and sources inspected; do not imply commands ran.
- Preserve unrelated changes and other agents' work. Create an extra worktree only for an explicitly separate experiment, identifying its owner, branch and port. Never discard a worktree until unique source, plans and useful evidence are preserved and verified.

## Product and code boundaries

- Read [PRODUCT](docs/PRODUCT.md) before changing player behavior. Keep CoderPush and AWS branding, dark arcade styling, the spacious scene and minimal player text. The milestone is a short camera-only run a first-time visitor can finish without coaching.
- State the observed problem and one acceptance criterion. Make a focused change; avoid unrelated redesign and speculative abstractions.
- Inspect existing modules and tests first. Extend the active entry, `index.html` → `src/arcade.js`, rather than creating a second scene or input system.
- Camera adapter owns input; event session owns identity and scoring; mechanics owns phases; scene/contact modules own rendering and contact response.
- Keep input loss separate from explicit host pause. Hands leaving view must not freeze an accepted drop. Preserve exactly three scored turns and one score per turn.

## Validation and safety

- Follow the single [testing policy](CONTRIBUTING.md#testing-policy). Add a regression for meaningful failures. Synthetic camera tests establish integration, never human recognition accuracy.
- Rebuild previews after committing and verify the operator BUILD. Record physical-camera results against the tested commit and camera/display; do not present synthetic results as physical validation.
- Review the staged diff and intended new files before each conventional commit. Never commit secrets, camera frames, local scores, dependencies, builds or screenshots. Preserve unfinished work with an explicitly labelled checkpoint; do not call it production-ready. No force pushes.
- Code quality does not grant merge or deployment authority. Apply the [delivery workflow](CONTRIBUTING.md#delivery) only within the user's authorized scope.

## Documentation and reporting

- Each fact has one authoritative home: README for getting started, CONTRIBUTING for workflow and testing, PRODUCT for current behavior and decisions, OPERATIONS for service procedures, and `docs/archive` for useful historical evidence. Update the owning document; adjust other summaries or links only when needed. Delete obsolete task narration instead of archiving it wholesale.
- Before claiming deployed or pending production status, compare current main with authenticated live BUILD and rendered operator BUILD using [OPERATIONS](docs/OPERATIONS.md#hosting-and-build-identity), and refresh relevant coordinating-task status. State any unavailable evidence explicitly.
- Refresh actual tester messages before choosing a feedback-driven change. Report code delivery, deployment and physical acceptance separately. Routine delivery does not authorize prize, identity or live-data changes.
