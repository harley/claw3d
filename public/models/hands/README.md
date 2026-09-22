# Anatomical cabinet hands

Source: [Immersive Web Input Profiles generic-hand](https://github.com/immersive-web/webxr-input-profiles/tree/f4992299601614adbfefd398dc8e281556bb7444/packages/assets/profiles/generic-hand).
Upstream revision: `f4992299601614adbfefd398dc8e281556bb7444`.
License: MIT, from `packages/assets/LICENSE.md`; retained beside these assets.
Meta documents its contribution at https://developers.meta.com/horizon/documentation/web/webxr-hands/.

`left.glb` and `right.glb` are derived anatomical meshes, not original sculptures.
Blender 5.2.1 adds one Catmull-Clark subdivision and smooth normals while retaining
skin weights. `scripts/art/refine-hands.py` reproduces this export from upstream
files named `left-source.glb` and `right-source.glb`. Four joint influences per
vertex are exported and normalized for standard glTF skinning.

At runtime `src/cabinet-hands.js` normalizes the wrist, reconstructs articulated
finger chains, adds navy sleeve geometry, and applies the grip/strike poses.
It does not use WebXR input or change webcam recognition. Assets are served locally;
there are no runtime third-party model requests. A model load failure leaves the
ordinary joystick and click/gesture controls available and reports a console error.

Design reference: generated three-direction board (human skin, leather gloves,
robot hands), selected human skin with navy sleeves. Prompt: premium first-person
arcade controls; anatomical left grip around cyan balltop, open right palm beside
amber dome; real material response, shared lighting and contact. Generated images
are concept references only. No generated bitmap is used as game geometry.

Physical control references: Sanwa parts catalog https://rs2006.co.jp/e/sanwaseimitsu/Sanwa2019.pdf
and https://www.slagcoin.com/joystick/attributes_brands.html.
