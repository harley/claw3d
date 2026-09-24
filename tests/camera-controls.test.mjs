import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraControls } from '../src/camera-controls.js';
import { HandController } from '../src/vision.js';

async function withCamera(run) {
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const startBefore = HandController.prototype.start;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener() {}, hidden: false } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { addEventListener() {} } } });
  let controller;
  HandController.prototype.start = async function () {
    controller = this;
    this.running = true; this.generation = 1;
    this.lastCapture = this.lastResponseCapture = -Infinity;
  };
  try {
    const controls = await createCameraControls({
      video: { videoWidth: 640, videoHeight: 360 },
      overlay: { width: 640, height: 360, getContext: () => ({ clearRect() {} }) },
      select: { addEventListener() {} },
      onChange() {}, canControl: () => true, onDrop: () => false,
    });
    await controls.start();
    await run({ controls, controller });
  } finally {
    HandController.prototype.start = startBefore;
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore); else delete globalThis.document;
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore); else delete globalThis.navigator;
  }
}

test('camera rollup includes delayed replies without changing accepted-only latency or input', async () => {
  await withCamera(({ controls, controller }) => {
    let handled = 0;
    controller.handle = () => { handled++; controller.onDiagnostic({ milliseconds: 20 }); };
    assert.equal(controller.acceptResult({}, 980, 1, 1000), true);
    controller.onState({ kind: 'tracking' });
    controller.onInput({ x: 1, z: 1 });
    assert.deepEqual(controls.input, { x: 1, z: 1 });
    assert.equal(controller.acceptResult({}, 1200, 1, 2000), false);
    assert.equal(handled, 1, 'late reply cannot reach recognition or drop handling');
    assert.deepEqual(controls.input, { x: 0, z: 0 }, 'late reply clears steering');
    const expected = { results: 1, rejected: { 'over age': 1 }, latencyP50Ms: 20, latencyP95Ms: 20,
      captureToReceiptP50Ms: 20, captureToReceiptP95Ms: 800 };
    assert.deepEqual(controls.visionStats(), expected);
    assert.deepEqual(controls.adaptationStats(), expected, 'governor window drains independently');
    assert.deepEqual(controls.visionStats(), { results: 0, rejected: {}, latencyP50Ms: null, latencyP95Ms: null,
      captureToReceiptP50Ms: null, captureToReceiptP95Ms: null });

    assert.equal(controller.acceptResult({}, 5000, 1, 5020), true);
    assert.equal(controller.acceptResult({}, 6000, 1, 6800), false);
    assert.equal(controller.acceptResult({}, 7000, 1, 7900), false);
    const next = controls.visionStats();
    assert.equal(next.captureToReceiptP50Ms, 800, 'each response contributes once');
    assert.equal(next.captureToReceiptP95Ms, 900);
    assert.equal(next.results, 1);
    assert.equal(next.rejected['over age'], 2);
  });
});

test('camera rollup keeps an all-rejected tail and excludes invalid timing', async () => {
  await withCamera(({ controls, controller }) => {
    assert.equal(controller.acceptResult({}, 1000, 1, 1800), false);
    assert.equal(controller.acceptResult({}, 1900, 1, 2700), false);
    controller.visibilityCutoff = 3000;
    assert.equal(controller.acceptResult({}, 2900, 1, 3100), false); // hidden
    controller.visibilityCutoff = undefined;
    assert.equal(controller.acceptResult({}, 1800, 1, 3200), false); // out of order
    assert.equal(controller.acceptResult({}, NaN, 1, 3300), false);
    assert.equal(controller.acceptResult({}, 3400, 1, 3300), false); // negative age
    assert.equal(controller.acceptResult({}, 3500, 1, Infinity), false);
    assert.equal(controller.acceptResult({}, 3600, 2, 3700), false); // previous camera
    const sample = controls.visionStats();
    assert.equal(sample.results, 0);
    assert.deepEqual(sample.rejected, { 'over age': 2, 'hidden capture': 1, 'out of order': 1, 'invalid capture': 3 });
    assert.equal(sample.latencyP50Ms, null);
    assert.equal(sample.captureToReceiptP50Ms, 800);
    assert.equal(sample.captureToReceiptP95Ms, 800);

    assert.equal(controller.acceptResult({}, 4000, 1, 104001), false);
    assert.deepEqual(controls.visionStats(), { results: 0, rejected: { 'over age': 1 }, latencyP50Ms: null, latencyP95Ms: null,
      captureToReceiptP50Ms: 60000, captureToReceiptP95Ms: 60000 });
    assert.equal(controls.visionStats().captureToReceiptP50Ms, null, 'drain resets the percentile window');
  });
});

test('camera receipt-delay sample storage remains bounded', async () => {
  await withCamera(({ controls, controller }) => {
    for (let age = 1; age <= 2001; age++) controller.onDiagnostic({ captureToReceiptMs: age });
    const sample = controls.visionStats();
    assert.equal(sample.captureToReceiptP50Ms, 1000);
    assert.equal(sample.captureToReceiptP95Ms, 1900);
  });
});
