import { cp, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
const destination = 'public/vision';
await mkdir(destination, { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', join(destination, 'wasm'), { recursive: true });
try {
  await access(join(destination, 'gesture_recognizer.task'));
} catch {
  const response = await fetch('https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task');
  if (!response.ok) throw new Error(`Gesture model download failed: ${response.status}`);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(destination, 'gesture_recognizer.task'), new Uint8Array(await response.arrayBuffer()));
}
console.log('Hand tracking runtime and model are available locally. No CDN is used during play.');
