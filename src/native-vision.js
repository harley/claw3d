import { HandController as BrowserHandController } from './vision.js';
import { nativeBridge } from './native-bridge.js';

// Acquisition-only adapter: gesture ownership and scoring remain in the game.
export class HandController extends BrowserHandController {
  constructor(options) {
    super(options);
    this.bridge = nativeBridge();
    this.canConfigureCamera = options.canConfigureCamera || (() => false);
    this.cameraElement = this.video;
    this.video = { videoWidth: 640, videoHeight: 480, srcObject: null };
    this.bridge.subscribe(message => this.receive(message));
    this.summary = { results: 0, accepted: 0, ages: [] };
    this.lastReport = performance.now();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
    this.listCameras();
  }
  // Android owns the framing preview. The hidden web canvas has no native UI consumers;
  // inherited recognition still supplies all game/hand feedback through its callbacks.
  draw() {}
  send(message) { this.bridge.send(message); }
  async listCameras() {
    this.send({ type: 'cameras', generation: this.generation });
  }
  async start() {
    // An internal camera switch replaces acquisition while the game's
    // original await still waits for a usable camera. Explicit stop cancels it.
    const previous = this.pendingStart;
    this.pendingStart = null;
    this.stop(false);
    let resolve;
    const pending = previous || { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
    this.pendingStart = pending;
    this.starting = true;
    this.offset = null;
    this.summary = { results: 0, accepted: 0, ages: [] };
    this.lastReportResults = this.lastReportAccepted = 0;
    this.lastCapture = this.lastResponseCapture = undefined;
    this.onState({ kind: 'loading', message: 'Starting native camera…' });
    this.startTimeout = setTimeout(() => { if (this.starting) this.fail(new Error('Native camera timed out. Start it again.')); }, 25000);
    try { this.send({ type: 'start', generation: this.generation, hands: this.maxHands, cameraId: this.select.value, applyPreview: this.canConfigureCamera?.() === true, jsTime: performance.now() }); }
    catch (error) { this.fail(error); }
    return pending.promise;
  }
  stop(announce = true) {
    if (this.bridge) this.send({ type: 'stop', generation: this.generation });
    clearTimeout(this.startTimeout);
    clearInterval(this.clockTimer);
    super.stop(announce);
    this.pendingStart?.resolve(); this.pendingStart = null;
  }
  setPerformanceMode(mode) { this.performanceMode = mode; return false; }
  receive(message) {
    if (message.generation !== this.generation) return;
    if (message.type === 'cameras') {
      const cameras = Array.isArray(message.cameras) ? message.cameras : [];
      const selected = message.selected || this.select.value;
      this.select.replaceChildren(...cameras.map(camera => new Option(camera.label, camera.id)));
      if (cameras.some(camera => camera.id === selected)) this.select.value = selected;
      this.select.disabled = cameras.length < 2;
    } else if (message.type === 'clock' && (this.starting || this.running)) {
      // Conservatively includes request transit; never erase delivery delay.
      const candidate = message.jsTime - message.nativeTime;
      if (Number.isFinite(candidate)) this.offset = this.offset === null ? candidate : Math.max(this.offset, candidate);
    } else if (message.type === 'ready' && this.starting && Number.isFinite(this.offset)) {
      clearTimeout(this.startTimeout);
      this.running = true; this.starting = false; this.delegate = 'GPU';
      this.lastReport = performance.now();
      this.lastResult = this.lastFreshReceipt = this.lastActivity = performance.now();
      this.onDiagnostic({ delegate: 'GPU', driver: 'native', width: 640, height: 480 });
      this.onState({ kind: 'ready', message: 'Hold your open hand in view.' });
      this.clockTimer = setInterval(() => this.send({ type: 'sync', generation: this.generation, jsTime: performance.now() }), 1000);
      this.timer = setInterval(() => {
        if (!this.running) return;
        this.supervise(performance.now());
        if (performance.now() - this.lastActivity > 7000) this.fail(new Error('Native tracking stopped responding. Restart the camera.'));
      }, 100);
      this.pendingStart?.resolve(); this.pendingStart = null;
    } else if (message.type === 'result') {
      try {
        if (!this.running || document.hidden || !Number.isFinite(this.offset)) return;
        this.video.videoWidth = message.width; this.video.videoHeight = message.height;
        const capturedAt = message.capturedAt + this.offset;
        const accepted = this.acceptResult(message.result, capturedAt, this.generation);
        this.summary.results++; this.summary.accepted += Number(accepted);
        this.summary.ages.push(performance.now() - capturedAt);
        if (this.summary.ages.length > 2000) this.summary.ages.shift();
        if (performance.now() - this.lastReport > 5000) {
          const ages = [...this.summary.ages].sort((a,b) => a-b);
          const elapsedSeconds = (performance.now() - this.lastReport) / 1000;
          this.send({ type: 'stats', ...this.summary, ages: undefined, rejected: this.summary.results - this.summary.accepted, ageBasis: 'analyzer-entry',
            deliveredHz: (this.summary.results - (this.lastReportResults ?? 0)) / elapsedSeconds,
            freshHz: (this.summary.accepted - (this.lastReportAccepted ?? 0)) / elapsedSeconds,
            p50: ages[Math.floor(ages.length * .5)], p95: ages[Math.ceil(ages.length * .95)-1],
            generation: this.generation, hands: this.maxHands });
          this.lastReport = performance.now();
          this.lastReportResults = this.summary.results;
          this.lastReportAccepted = this.summary.accepted;
          this.summary.ages = [];
        }
      } finally { this.send({ type: 'ack', generation: this.generation, id: message.id }); }
    } else if (message.type === 'error') this.fail(new Error(message.message));
    else if (message.type === 'paused') this.stop();
  }
}
