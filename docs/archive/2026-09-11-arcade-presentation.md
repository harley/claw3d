# Arcade asset provenance — September 11, 2026

Historical source review for the original synthesized audio. Current presentation belongs in [PRODUCT](../PRODUCT.md); third-party hand models have their own [provenance and license](../../public/models/hands/README.md).

## Primary asset research and licenses

Web search and source inspection succeeded before implementation:

- [Kenney Digital Audio](https://kenney.nl/assets/digital-audio): 60 digital effects; the publisher explicitly lists [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Eligible for use, but no files were imported: tailored phase timing can be achieved with the existing synthesizer without another download/decode path.
- [jsfxr](https://sfxr.me/): the primary generator documents square/saw/sine/noise waves, envelopes, pitch effects and unrestricted commercial use of generated effects. Used as a design reference for a compact arcade sound palette, not as a library or copied preset.

Selected implementation: original Web Audio square-wave drop sweeps, stepped descent, short grip pulses, rising catch arpeggio, falling miss and score melody. A 5 ms attack softens clicks. No third-party audio, code, fonts or visual assets were copied. Third-party runtime asset transfer added: **0 bytes**. Existing explicit activation, volume scaling, zero-volume and mute cancellation remain.
