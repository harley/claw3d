import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { recognizerOptions } from './recognizer-options.js';

// Compatibility runtime for WebKit browsers that cannot give MediaPipe an
// OffscreenCanvas inside a worker. It mirrors the worker message surface so the
// camera controller keeps one result/failure path. Detection is paced by the
// controller's existing 65 ms timer and uses a bounded canvas from its video.
export async function createMainThreadVision(base, maxHands = 1, preferredDelegate = 'GPU') {
  const files = await FilesetResolver.forVisionTasks(base + '/vision/wasm');
  const create = which => GestureRecognizer.createFromOptions(files, recognizerOptions(base, which, maxHands));
  let recognizer, delegate, proven = false, stopped = false, rebuildTimer = null, canvas, context;
  if (preferredDelegate === 'CPU') { recognizer = await create('CPU'); delegate = 'CPU'; }
  else {
    try { recognizer = await create('GPU'); delegate = 'GPU'; }
    catch { recognizer = await create('CPU'); delegate = 'CPU'; }
  }
  const capture = data => {
    if (!data.captureWidth) return data.video;
    const width = Math.min(data.video.videoWidth, data.captureWidth);
    const height = Math.round(width * data.video.videoHeight / data.video.videoWidth);
    if (!canvas) { canvas = document.createElement('canvas'); context = canvas.getContext('2d', { alpha: false }); }
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.drawImage(data.video, 0, 0, width, height);
    return canvas;
  };

  const runtime = {
    local: true,
    delegate,
    onmessage: null,
    onerror: null,
    postMessage(data) {
      if (stopped || data.type !== 'frame') return;
      queueMicrotask(async () => {
        if (stopped) return;
        try {
          const image = capture(data);
          let result;
          try {
            result = recognizer.recognizeForVideo(image, data.now);
            proven = true;
          } catch (error) {
            if (delegate !== 'GPU' || proven) throw error;
            try { recognizer.close(); } catch {}
            // Match the worker liveness contract during a slow CPU rebuild.
            // Progress never clears the controller's busy latch for this frame.
            rebuildTimer = setInterval(() => {
              if (!stopped) runtime.onmessage?.({ data: { type: 'progress' } });
            }, 2000);
            const cpu = await create('CPU');
            if (stopped) { try { cpu.close(); } catch {} return; }
            recognizer = cpu; delegate = runtime.delegate = 'CPU';
            runtime.onmessage?.({ data: { type: 'delegate', delegate } });
            result = recognizer.recognizeForVideo(image, data.now);
            proven = true;
            clearInterval(rebuildTimer); rebuildTimer = null;
          }
          if (!stopped) runtime.onmessage?.({ data: { type: 'result', result, now: data.now } });
        } catch (error) {
          if (!stopped) runtime.onmessage?.({ data: { type: 'error', message: error.message } });
        } finally {
          clearInterval(rebuildTimer); rebuildTimer = null;
        }
      });
    },
    terminate() {
      stopped = true;
      clearInterval(rebuildTimer); rebuildTimer = null;
      try { recognizer.close(); } catch {}
      if (canvas) { canvas.width = canvas.height = 0; canvas = context = null; }
    },
  };
  return runtime;
}
