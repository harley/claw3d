# September 14 team feedback follow-through

Historical source record; current behavior belongs in `docs/PRODUCT.md`.

The signed-in CoderPush Lark group `claw.coderpush.com` was read directly on September 14. Min's 11:23 message reported improved hand following, intended drops and more enjoyable play. She requested a Round 2/3 → Start announcement and upbeat music while controlling the claw. A later message asked whether an update was available. This complements, but does not invalidate, Harley's separate report of inaccurate feel and a slow miss transition.

Harley authorized action in the Codex task **Find actionable team feedback** (`01a09f1f-a53a-7582-a7ba-9c1a439e11cd`). Acknowledgement was sent in Lark and verified in the message history: the transition was being fixed, music was being prepared for local listening, and neither change was yet live.

The existing **Cloud Claw group coordination** six-hour automation was active, but recent runs stopped after finding the CLI user token missing. Native signed-in Lark successfully read the group. The automation now explicitly requires this fallback and a visible monitoring-access failure when both paths fail. Bot authentication does not substitute for Harley's user identity. No credentials or permissions were changed.

The first implementation shortens a miss by retaining lift and return, then bypassing empty release/shelf/reveal phases. The centre announces the upcoming round for 1.3 seconds and START for 0.7 seconds before control resumes. No additional click, score, gesture or aiming time is introduced. The prior 11.45-second interval from MISSED to aiming becomes 5.8 simulation seconds. Physical timing and readability still require a replay.

The music request is a local audition, preserving the earlier listening-test boundary. Prize mapping, badge integration and competition rules remain separate decisions.
