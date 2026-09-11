import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

let recognizer, files, base, delegate, proven = false;
const create = which => GestureRecognizer.createFromOptions(files, {
  baseOptions: { modelAssetPath: base + '/vision/gesture_recognizer.task', delegate: which },
  runningMode: 'VIDEO', numHands: 2,
  minHandDetectionConfidence: .65, minHandPresenceConfidence: .65, minTrackingConfidence: .65,
});
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      base = data.base;
      // ES module workers need the module-aware WASM loader, not importScripts.
      files = await FilesetResolver.forVisionTasks(base + '/vision/wasm', true);
      try { recognizer = await create('GPU'); delegate = 'GPU'; }
      catch { recognizer = await create('CPU'); delegate = 'CPU'; }
      self.postMessage({ type: 'ready', delegate });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  } else if (data.type === 'frame') {
    // `image` is an ImageBitmap (resize path) or a transferred VideoFrame.
    const image = data.frame ?? data.bitmap;
    try {
      const result = recognizer.recognizeForVideo(image, data.now);
      proven = true;
      self.postMessage({ type: 'result', result, now: data.now });
    } catch (error) {
      // A GPU context can initialise yet fail on first real inference.
      if (delegate === 'GPU' && !proven) {
        // The wasm module may already be dead (e.g. Aborted()); create('CPU')
        // instantiates a fresh one either way.
        try { recognizer.close(); } catch {}
        // The CPU rebuild can outlast the main thread's 7s liveness budget;
        // heartbeat so the watchdog knows the worker is alive, not wedged.
        const beat = setInterval(() => self.postMessage({ type: 'progress' }), 2000);
        try {
          recognizer = await create('CPU'); delegate = 'CPU';
          self.postMessage({ type: 'delegate', delegate });
          const result = recognizer.recognizeForVideo(image, data.now);
          proven = true;
          self.postMessage({ type: 'result', result, now: data.now });
        } catch (retry) { self.postMessage({ type: 'error', message: retry.message }); }
        finally { clearInterval(beat); }
      } else self.postMessage({ type: 'error', message: error.message });
    } finally { image.close(); }
  }
};
