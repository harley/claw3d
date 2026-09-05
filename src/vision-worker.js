import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

let recognizer;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      // ES module workers need the module-aware WASM loader, not importScripts.
      const files = await FilesetResolver.forVisionTasks(data.base + '/vision/wasm', true);
      recognizer = await GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.base + '/vision/gesture_recognizer.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .65, minHandPresenceConfidence: .65, minTrackingConfidence: .65,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  } else if (data.type === 'frame') {
    try {
      const result = recognizer.recognizeForVideo(data.bitmap, data.now);
      self.postMessage({ type: 'result', result, now: data.now });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { data.bitmap.close(); }
  }
};
