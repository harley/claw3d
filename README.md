# CoderPush Cloud Claw

A local 3D arcade game for the CoderPush silver booth at AWS Cloud & AI Day Hanoi, 29 September 2026. Original cabinet, bunny, travel pillow, and jointed claw assets are made in Blender. The laptop runs the game and camera; the booth monitor connects over HDMI.

## Play

```sh
npm install
npm run assets
npm run build
npm run play
```

Open **http://localhost:4184** in Chrome or Edge. All game assets and hand-tracking models are served from this laptop. After installation and asset preparation, playing does not need internet access.

This stable playtest does not reload during code edits. After an update, run `npm run build` and refresh the browser. For development with automatic reloading, use `npm run dev` at **http://localhost:4183**.

- **Camera (easy default):** click Start camera and allow camera access. The camera panel opens so you can frame your hand. Show one relaxed hand in the central camera area and hold still for half a second. Move your hand relative to that neutral position to steer; return it to the centre to stop moving. Press Space, Enter, or the programmable DROP button to drop. The panel includes a re-centre button.
- **Air joystick (optional):** choose this profile in the camera panel. Hold a thumb/index pinch or a loose fist to grab the virtual joystick. Keep holding and move relative to the neutral position. Release to stop moving; pinch again to re-centre. Hold an open palm for 0.8 seconds to DROP. Pinch recognition has separate entry/release thresholds so a small change in finger spacing does not repeatedly lose control.
- **Keyboard:** click Try with keyboard, then use arrows or WASD. Hold Shift for fine movement. Space or Enter drops. A round has 30 seconds of aiming, followed by the grab and return sequence.
- **Mouse/touch:** drag the circular joystick and click DROP.
- **Programmable keypad:** open the gear panel and choose Map a DROP key, then press the desired button. This mapping is saved locally. A knob configured to emit left/right arrow key pulses moves the claw horizontally. USB knob protocols and vendor-specific configuration are not implemented.
- **Camera choice:** the gear panel lists available cameras after permission. Start with the laptop camera; select the BRIO when connected. The app does not silently switch to a different camera during a round.
- **Operator controls:** gear panel provides camera stop/start, camera selection, keyboard-only mode, key mapping, round reset, and lower rendering quality. Sound starts muted. The top-right button requests fullscreen.

Camera frames stay in the local browser. They are neither uploaded nor recorded. Hand inference runs in a Web Worker, separate from rendering. A missing or stale hand stops movement; tracking loss pauses the aiming timer until control returns or the operator uses manual controls. Similar nearby hands are treated as ambiguous. This is spatial hand tracking, not identity recognition, so a busy booth needs a marked one-player area and physical rehearsal.

## Art

Open `art/cloud-claw.blend` in Blender to inspect the editable scene. Regenerate it and the browser models with:

```sh
npm run models
```

The command uses `/Applications/Blender.app/Contents/MacOS/Blender`. Geometry and fabric textures are authored in `scripts/build-assets.py`; no Blender add-ons are needed. The artwork is a stylized interpretation of the user-supplied bunny, pillow, and booth references, not a dimensional scan or approved sponsor booth drawing.

## Current game rules and boundaries

- A drop must align with one of five hero prizes. The target ring turns green when a prize is within the capture area.
- This version uses **assisted arcade grasping**, not soft-body cloth simulation. Small alignment offsets are corrected during descent. The claw then closes, carries the prize, and releases it at the chute. There is no random success roll or hidden release.
- Decorative small capsules are not catchable in this first build.
- A new round restocks the virtual machine. There is no real inventory tracking or prize reservation yet. Result screens identify this as a local playtest.
- Badge scanning, contact capture, and physical prize handover remain staff operations. They are not implemented in this game.
- The booth policy is real prizes while stock lasts, with staff substitution. A later event configuration must keep displayed prizes and substitutions aligned with actual stock.

## Verify

```sh
npm test
npm run build
```

Tests cover capture boundaries, steering bounds, hand ownership, calibration, deliberate DROP, tracking loss, re-grabbing, handedness changes, relaxed pinch continuity, and easy-mode steering. Browser and build checks cannot prove physical hand feel, TV performance, or BRIO performance. Rehearse those on the actual devices.

### Physical playtest — 5 September 2026

The first laptop-camera gesture test was unreliable. After fixing handedness-flip interruptions and pinch-release jitter, we made relaxed-hand steering with a physical DROP button the default. The user retested that mode and confirmed: “Yes, this is more reliable.” Keep that mode as the starting experience. The optional pinch/open-palm profile still needs separate physical validation. The BRIO, programmable keypad, booth monitor, and crowded booth conditions remain untested.

## Agreed direction

The experience should help staff start relevant business conversations. Several people will staff the booth, so game development prioritizes visual quality and approachable camera interaction. The reference booth is 2 × 2 m with a 43-inch HDMI TV; the exact organizer build may differ. First-person play remains one player at a time, with small gestures inside that footprint.

Primary technical references: [Blender glTF export](https://docs.blender.org/manual/en/dev/addons/scene_gltf2.html), [MediaPipe web hand tracking](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js), and [Three.js renderer](https://threejs.org/docs/pages/WebGLRenderer.html).
