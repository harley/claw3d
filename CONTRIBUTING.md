# Contributing

Cloud Claw is a camera-controlled arcade for the CoderPush × AWS booth. Work is planned in the pinned tracking issue and flows through small, squash-merged pull requests.

- Read [AGENTS.md](AGENTS.md) for the working agreement (one issue per PR, conventional titles, checks before merge) and [docs/PRODUCT.md](docs/PRODUCT.md) before changing player behaviour.
- `npm ci`, then `npm run check` for unit tests and build; `npm run check:booth` and `npm run test:shared` (sequentially) for anything touching camera, phases, scoring, collisions or the server.
- Synthetic camera tests verify integration, not human recognition. Changes that need a physical decision ship behind a URL flag and carry the `needs-physical-test` label.
- Never commit secrets, camera frames, local scores, dependencies, builds or screenshots.
