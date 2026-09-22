import test from 'node:test';
import assert from 'node:assert/strict';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { createMainThreadVision } from '../src/vision-main-thread.js';

FilesetResolver.forVisionTasks = async path => ({ path });
let plan, made, lastOptions;
GestureRecognizer.createFromOptions = async (files, options) => {
  const which = options.baseOptions.delegate;
  made.push(which); lastOptions = options;
  if (plan[which]?.factory) return plan[which].factory();
  if (plan[which]?.createThrows) throw new Error(`${which} create failed`);
  return {
    close() {},
    recognizeForVideo(video, now) {
      if (plan[which]?.recognizeThrows) throw new Error(`${which} inference failed`);
      return { landmarks: [], gestures: [], handedness: [], video, now };
    },
  };
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('main-thread vision falls back to CPU at startup and reads the video element directly', async () => {
  plan = { GPU: { createThrows: true } }; made = [];
  const runtime = await createMainThreadVision('/base'), messages = [];
  runtime.onmessage = message => messages.push(message.data);
  const video = { currentTime: 1 };
  runtime.postMessage({ type: 'frame', video, now: 42 });
  await settle();
  assert.equal(runtime.local, true);
  assert.equal(runtime.delegate, 'CPU');
  assert.deepEqual(made, ['GPU', 'CPU']);
  assert.equal(messages.at(-1).type, 'result');
  assert.equal(messages.at(-1).result.video, video);
  runtime.terminate();
});

test('main-thread vision retries the first failed GPU frame on CPU', async () => {
  plan = { GPU: { recognizeThrows: true } }; made = [];
  const runtime = await createMainThreadVision('/base'), messages = [];
  runtime.onmessage = message => messages.push(message.data);
  runtime.postMessage({ type: 'frame', video: {}, now: 84 });
  await settle();
  assert.deepEqual(made, ['GPU', 'CPU']);
  assert.deepEqual(messages.map(message => message.type), ['delegate', 'result']);
  assert.equal(runtime.delegate, 'CPU');
  runtime.terminate();
});

test('terminating during a slow CPU rebuild closes the late recognizer and emits no late result', async () => {
  let resolveCpu, cpuClosed = 0, cpuInferences = 0, beat;
  const originalSetInterval = globalThis.setInterval, originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = callback => { beat = callback; return 7; };
  globalThis.clearInterval = () => {};
  plan = { GPU: { recognizeThrows: true }, CPU: { factory: () => new Promise(resolve => { resolveCpu = resolve; }) } }; made = [];
  try {
    const runtime = await createMainThreadVision('/base'), messages = [];
    runtime.onmessage = message => messages.push(message.data);
    runtime.postMessage({ type: 'frame', video: {}, now: 126 });
    await settle();
    beat();
    assert.deepEqual(messages.map(message => message.type), ['progress']);
    runtime.terminate();
    resolveCpu({ close: () => cpuClosed++, recognizeForVideo: () => { cpuInferences++; return {}; } });
    await settle();
    assert.equal(cpuClosed, 1);
    assert.equal(cpuInferences, 0);
    assert.deepEqual(messages.map(message => message.type), ['progress']);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('the main-thread runtime shares the recognizer options and hand count', async () => {
  plan = {}; made = [];
  const one = await createMainThreadVision('/base'); one.terminate();
  assert.equal(lastOptions.numHands, 1); assert.equal(lastOptions.minTrackingConfidence, .5);
  const two = await createMainThreadVision('/base', 2); two.terminate();
  assert.equal(lastOptions.numHands, 2);
});
