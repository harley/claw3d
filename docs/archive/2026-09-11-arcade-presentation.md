# Arcade presentation research and verification — September 11, 2026

## Decision

The approved presentation iteration replaces the bottom action panel and separate celebration banner with one upper-centre arcade announcement. The clear area above the claw keeps the contact and targets visible. The desktop headline uses the system monospace font, cream/gold lettering and a hard red shadow. Narrow layouts move the uncropped camera preview below the cabinet. No downloaded font, image, model or graphics library is needed.

DROP appears immediately on acceptance. GOT IT or MISSED appears at lift. Outcome announcements expire after 1.6 seconds; empty transfer/release messages leave the scene clear. Points appear only after turn completion. Camera guidance remains visible until the state changes. Reduced motion disables the brief scale entrance. The live status region remains available to assistive technology. There is no second celebration banner or visible duplicate turn heading.

## Primary asset research and licenses

Web search and source inspection succeeded before implementation:

- [Kenney Digital Audio](https://kenney.nl/assets/digital-audio): 60 digital effects; the publisher explicitly lists [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Eligible for use, but no files were imported: tailored phase timing can be achieved with the existing synthesizer without another download/decode path.
- [jsfxr](https://sfxr.me/): the primary generator documents square/saw/sine/noise waves, envelopes, pitch effects and unrestricted commercial use of generated effects. Used as a design reference for a compact arcade sound palette, not as a library or copied preset.

Selected implementation: original Web Audio square-wave drop sweeps, stepped descent, short grip pulses, rising catch arpeggio, falling miss and score melody. A 5 ms attack softens clicks. No third-party audio, code, fonts or visual assets were copied. Third-party runtime asset transfer added: **0 bytes**. Existing explicit activation, volume scaling, zero-volume and mute cancellation remain.

The camera-active 30 FPS draw cap and mechanics/input cadence are unchanged. Synthetic integration checks cannot establish human recognition, perceived responsiveness or speaker quality. First-time-player and booth-speaker acceptance remain open.

## Verification

95 unit tests/build and all eight sequential booth suites passed, including the new presentation regression. A focused read-only agent review found short-screen clipping; the fix reserves 740px of page height on narrow displays and tests camera/restart bounds at 390×620. Short screens scroll vertically. An initial suite was invalidated by a source reload during editing; the complete clean rerun passed.

Comparable measurement: Chrome headless, 1440×900, sound on, synthetic camera through the real adapter; four seconds aiming plus four seconds dropping, three fresh pages per version, with no concurrent browser tests. The baseline was 23f08a6. Frame samples measure requestAnimationFrame cadence with real WebGL rendering and synthetic camera input, not physical-camera inference.

| Measure | Before | After |
| --- | ---: | ---: |
| Mean frame interval, three runs | 16.63–16.66 ms | 16.63–16.64 ms |
| p95 frame interval | 16.7–16.8 ms | 16.7–16.8 ms |
| Frames over 33.4 ms | 0 | 0 |
| Built initial page transfer, three resources | 202,257 bytes | 202,171 bytes |
| Single cold local preview ready sample | 620 ms | 574 ms |
| Added third-party runtime assets | — | 0 bytes |

The loading sample covers the initial page; camera models are lazy and unchanged. One local loading sample is not evidence of a real-world speed improvement. These samples show no material frame regression in the measured scenario. The render cap and mechanics/input update implementation are unchanged. Raw local measurements are retained in ignored .local-data; screenshots are in ignored .screenshots.

The built shared-session suite passed: protected frontend, two named three-turn runs, lost-response/reload retry exactly once, tied ranks, host gate and backup restoration. Live deployment verification is recorded in PRODUCT.md.
