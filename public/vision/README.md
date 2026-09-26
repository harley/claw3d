# MediaPipe runtime and gesture model

These assets are served locally by Cloud Claw. They are third-party assets, not covered by the project's MIT copyright claim.

## Runtime

`wasm/` contains the six JavaScript/WebAssembly files from [`@mediapipe/tasks-vision` 1.0.1](https://registry.npmjs.org/@mediapipe/tasks-vision/1.0.1), the version pinned in `package-lock.json`. On September 27, 2026, all six files matched the published npm archive byte for byte. They are unmodified. `scripts/prepare-vision.mjs` copies this directory from the installed package.

The package declares Apache-2.0. The upstream [MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) is retained in [LICENSE](LICENSE); existing notices in the distributed files are preserved. Keep this notice and license with redistributed runtime assets. The hand meshes in `public/models/hands` have their own MIT notice and are unrelated to this recognition model.

## Recognition model

`gesture_recognizer.task` is Google's float16 version 1 bundle from the [pinned download](https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task), not a locally trained model. On September 27, 2026, it matched that download byte for byte:

```text
SHA-256 97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482
```

Google's [Gesture Recognizer guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer) links the bundle and its [model card](https://storage.googleapis.com/mediapipe-assets/gesture_recognizer/model_card_hand_gesture_classification_with_faireness_2022.pdf). The bundle contains hand detection, hand landmarks, gesture embedding and canned gesture classification models. It is unmodified. The model card and the downloaded bundle contain no separate model-weight license statement; this notice does not infer a separate weight-license grant from the documentation footer or the JavaScript package's license. The Apache runtime license above is verified; a distinct publisher statement for these weights has not been recorded here.

## Upstream privacy notice

The exact 1.0.1 npm package README includes Google's June 5, 2026 [MediaPipe privacy notice](https://github.com/google-ai-edge/mediapipe#privacy-notice). It distinguishes on-device input processing from performance and utilization metrics sent to Google, and places responsibility for applicable user consent on the integrating application. See also [Google's privacy policy](https://policies.google.com/privacy).

Serving models and WASM locally avoids runtime model-CDN downloads; it does not prove that the library sends no metrics. This documentation review did not measure network traffic or establish which metrics this browser build emits. Cloud Claw's own collection switches and retention policy do not control or describe Google's metrics. Verify the runtime's behavior and the notice/consent requirements before claiming a fully offline deployment or enabling a new public deployment.
