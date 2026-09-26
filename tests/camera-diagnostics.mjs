// Bounded lifecycle metadata only: never copy images, landmarks or results.
export async function cameraDiagnostics(page, { stallGPU = false } = {}) {
  const workerEvents = [];
  page.on('console', message => {
    if (message.text().startsWith('CAMERA_WORKER ') && workerEvents.length < 64) workerEvents.push(message.text());
  });
  await page.route('**/src/vision-worker.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    // Observe entry/exit around the synchronous inference, not just messages
    // arriving at the page. A stuck GPU call cannot send the exit record.
    const traced = source.replaceAll('recognizer.recognizeForVideo(image, data.now)', 'traceInference(image, data.now)');
    await route.fulfill({ response, body: traced + `
let traceCount = 0, qualityStall = false;
self.addEventListener('message', ({ data }) => { if (data.type === 'test-quality-stall') qualityStall = true; });
function traceInference(image, now) {
  const record = traceCount++ < 4 || qualityStall;
  const log = stage => console.debug('CAMERA_WORKER ' + JSON.stringify({ stage, now, delegate, at: performance.now() }));
  if (record) log('inference-enter');
  if (delegate === 'GPU' && (${JSON.stringify(stallGPU)} === true || qualityStall)) { while (true) {} }
  // The post-quality fault needs a responsive worker before the fault, even
  // on runners whose GPU stalls on its very first inference. Only this test
  // fixture supplies empty pre-fault results; replacement CPU inference is real.
  if (${JSON.stringify(stallGPU)} === 'after-quality' && delegate === 'GPU') return { landmarks: [], handedness: [], gestures: [] };
  try { const result = recognizer.recognizeForVideo(image, now); if (record) log('inference-return'); return result; }
  catch (error) { if (record) log('inference-throw'); throw error; }
}
` });
  });
  await page.addInitScript(() => {
    const events = window.cameraLifecycle = [];
    const record = (stage, details = {}) => {
      if (events.length < 64) events.push({ stage, at: performance.now(), ...details });
    };
    window.recordCameraLifecycle = record;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); record('worker-create'); window.cameraTestWorker = this;
        let replies = 0;
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'result' || replies++ < 4) record('worker-receive', { type: data.type, capturedAt: data.now, delegate: data.delegate });
        });
        this.addEventListener('error', () => record('worker-error'));
        this.sent = 0;
      }
      postMessage(data, ...args) {
        if (data.type !== 'frame' || this.sent++ < 4) record('worker-send', { type: data.type, capturedAt: data.now });
        return super.postMessage(data, ...args);
      }
      terminate() { record('worker-terminate'); return super.terminate(); }
    };
    document.addEventListener('visibilitychange', () => record('visibility', { hidden: document.hidden }));
  });
  return async () => {
    console.log('CAMERA_LIFECYCLE ' + JSON.stringify(await page.evaluate(() => window.cameraLifecycle).catch(() => [])));
    for (const event of workerEvents) console.log(event);
  };
}

export async function traceController(page) {
  await page.evaluate(async () => {
    const { HandController } = await import('/src/vision.js');
    const configure = HandController.prototype.configureCapture;
    HandController.prototype.configureCapture = function (...args) {
      window.cameraControllerState = () => ({ busy: this.busy, delegate: this.delegate,
        receivedResult: this.receivedResult, lastActivity: this.lastActivity, lastResponseCapture: this.lastResponseCapture,
        frameAge: this.busy ? performance.now() - this.lastSent : null });
      return configure.apply(this, args);
    };
    for (const method of ['fail', 'stop']) {
      const original = HandController.prototype[method];
      HandController.prototype[method] = function (...args) {
        window.recordCameraLifecycle(method, { code: method === 'fail' ? args[1] : undefined,
          busy: this.busy, running: this.running, driver: this.captureDriver, delegate: this.delegate,
          lastSent: this.lastSent, lastActivity: this.lastActivity, lastResult: this.lastResult,
          lastResponseCapture: this.lastResponseCapture, generation: this.generation, hidden: document.hidden });
        return original.apply(this, args);
      };
    }
  });
}
