import test from 'node:test';
import assert from 'node:assert/strict';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

// The worker shares this module instance, so replacing the statics stubs it.
// Each test imports the worker with a unique query string for fresh module state.
FilesetResolver.forVisionTasks = async () => ({});
let plan, made, posted, lastOptions;
GestureRecognizer.createFromOptions = async (files, options) => {
  const which = options.baseOptions.delegate;
  made.push(which); lastOptions = options;
  const behavior = () => plan[which] ?? {};
  if (behavior().createThrows) throw new Error(`${which} create failed`);
  return {
    closed: 0, which,
    close() { this.closed++; if (behavior().closeThrows) throw new Error('module already dead'); },
    recognizeForVideo(image, now) {
      if (behavior().recognizeThrows) throw new Error(`${which} inference exploded`);
      return { gestures: [], handedness: [], landmarks: [], now };
    },
  };
};

let imports = 0;
async function boot(scenario) {
  plan = scenario; made = []; posted = [];
  globalThis.OffscreenCanvas = class {};
  globalThis.self = { postMessage: message => posted.push(message) };
  await import(`../src/vision-worker.js?case=${imports++}`);
  await self.onmessage({ data: { type: 'init', base: '/x' } });
  return { made, posted };
}

test('a worker without OffscreenCanvas requests the main-thread compatibility runtime', async () => {
  plan = {}; made = []; posted = [];
  delete globalThis.OffscreenCanvas;
  globalThis.self = { postMessage: message => posted.push(message) };
  await import(`../src/vision-worker.js?case=${imports++}`);
  await self.onmessage({ data: { type: 'init', base: '/x' } });
  assert.deepEqual(posted, [{ type: 'main_thread_required' }]);
  assert.deepEqual(made, [], 'MediaPipe must not initialize in an incompatible worker');
});
const frame = () => {
  const image = { closed: 0, close() { this.closed++; } };
  return self.onmessage({ data: { type: 'frame', bitmap: image, now: 123 } }).then(() => image);
};

test('GPU init failure falls back to CPU before reporting ready', async () => {
  await boot({ GPU: { createThrows: true } });
  assert.deepEqual(made, ['GPU', 'CPU']);
  assert.deepEqual(posted.at(-1), { type: 'ready', delegate: 'CPU' });
});

test('a startup replacement initializes CPU directly without revisiting the stalled GPU', async () => {
  plan = {}; made = []; posted = [];
  globalThis.OffscreenCanvas = class {};
  globalThis.self = { postMessage: message => posted.push(message) };
  await import(`../src/vision-worker.js?case=${imports++}`);
  await self.onmessage({ data: { type: 'init', base: '/x', delegate: 'CPU' } });
  assert.deepEqual(made, ['CPU']);
  assert.deepEqual(posted.at(-1), { type: 'ready', delegate: 'CPU' });
  await frame();
  assert.equal(posted.at(-1).type, 'result');
});

test('first-inference GPU failure rebuilds on CPU, announces the flip and answers the same frame', async () => {
  await boot({ GPU: { recognizeThrows: true, closeThrows: true } });
  assert.deepEqual(posted.at(-1), { type: 'ready', delegate: 'GPU' });
  const image = await frame();
  assert.deepEqual(made, ['GPU', 'CPU'], 'CPU recognizer recreated after first-inference failure');
  assert.equal(image.closed, 1, 'frame image closed exactly once');
  const kinds = posted.map(m => m.type);
  assert.ok(kinds.includes('delegate'), 'delegate flip announced to the main thread');
  assert.equal(posted.find(m => m.type === 'delegate').delegate, 'CPU');
  const result = posted.at(-1);
  assert.equal(result.type, 'result');
  assert.equal(result.now, 123);
});

test('a failed CPU retry reports one error and still closes the frame once', async () => {
  await boot({ GPU: { recognizeThrows: true }, CPU: { recognizeThrows: true } });
  const image = await frame();
  assert.equal(image.closed, 1);
  assert.equal(posted.at(-1).type, 'error');
  assert.equal(posted.filter(m => m.type === 'error').length, 1);
});

test('after a proven GPU frame a later failure is an error, never a silent delegate switch', async () => {
  await boot({});
  await frame();
  assert.equal(posted.at(-1).type, 'result');
  plan.GPU = { recognizeThrows: true };
  const image = await frame();
  assert.equal(image.closed, 1);
  assert.deepEqual(made, ['GPU'], 'no CPU recreate after the delegate proved itself');
  assert.equal(posted.at(-1).type, 'error');
});

test('the worker asks the model for one hand unless dual play requests two, at the shared confidences', async () => {
  await boot({});
  assert.equal(lastOptions.numHands, 1);
  assert.deepEqual([lastOptions.minHandDetectionConfidence, lastOptions.minHandPresenceConfidence, lastOptions.minTrackingConfidence], [.65, .5, .5]);
  plan = {}; made = []; posted = [];
  globalThis.OffscreenCanvas = class {};
  globalThis.self = { postMessage: message => posted.push(message) };
  await import(`../src/vision-worker.js?case=${imports++}`);
  await self.onmessage({ data: { type: 'init', base: '/x', maxHands: 2 } });
  assert.equal(lastOptions.numHands, 2);
});
