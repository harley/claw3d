<!-- Title must be a conventional commit line: type(scope): imperative summary. It becomes the release-note line. -->
Closes #

## Player-visible change
<!-- One or two sentences a booth host would understand. "None" for pure internals. -->

## Evidence
<!-- Before/after numbers (draw calls, frame p95, vision p50/p95, transition seconds), screenshots, or "n/a" with why. -->

## Checks
- [ ] `npm run check` (unit + build)
- [ ] `npm run check:booth` and `npm run test:shared` if camera, phase, scoring, collision or server changed
- [ ] Docs updated (README / docs/PRODUCT.md) if behaviour changed

## Physical validation
- [ ] Not needed for this change
- [ ] Needed; not yet done (label `needs-physical-test`)
- [ ] Done on BUILD `…` with camera/display: …

🤖 Generated with [Claude Code](https://claude.com/claude-code)
