# Practice-first staff playtest

Approved September 9, 2026. Ship on the existing protected Railway pilot before recruiting the first five coworkers, then widen toward 100+ before the September 28 demo.

## Acceptance

- Practice is the default. Nickname is optional; a blank name displays Player. Keep the existing warm-up, fist controls, three scored turns and unlimited replays. The host can switch the next player to named event ranking.
- Practice scores never enter the event leaderboard or its run outbox. Event start acknowledgement, immutable rules, retry and exactly-once scoring remain intact.
- A quiet feedback action works before completion and from results. Category plus optional comment attaches to the build, page session and current game state. An accepted drop finishes while a feedback dialog is open. Show saved only after server acknowledgement; keep an uncertain submission's ID and draft during retry.
- Authenticated, same-origin, allowlisted events persist in the existing SQLite volume for at most 30 days, with a hard row cap. Batch and queue limits keep telemetry out of the gameplay critical path. Do not record camera images, landmarks, names, credentials, stacks or arbitrary objects.
- Capture camera start/readiness, control transitions, warm-up, drop trigger, phases, run/turn completion, replay, feedback, coarse frame performance and failure codes. Practice run IDs are local correlation IDs, never ranked run ownership.
- Host-only reporting groups counts by build and mode, includes denominators and bounded recent evidence. A daily agent reviews observations, distinguishes confirmed faults from hypotheses and recommends one useful next action. Unfinished sessions alone are not crashes; synthetic tests and event counts are not human recognition or enjoyment evidence.

## Delivery

Implement on main; run unit/build, sequential booth suites and built shared-session tests. Independently review the changed auth/data boundary and frontend retry/state behavior. Commit and push, take a verified live database backup, deploy the clean commit, then verify authenticated BUILD, default practice, feedback persistence and unchanged ranked data on the live site. Physical camera acceptance remains with the first five coworkers.
