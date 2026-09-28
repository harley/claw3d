import { HandController as BrowserHandController } from './vision.js';

// Acquisition-only adapter: gesture ownership and scoring remain in the game.
export class HandController extends BrowserHandController {
  constructor(options) {
    super(options);
    this.bridge = globalThis.TomkoNative;
    this.cameraElement = this.video;
    this.video = { videoWidth: 640, videoHeight: 480, srcObject: null };
    this.bridge.onmessage = event => this.receive(JSON.parse(event.data));
    this.summary = { results: 0, accepted: 0, ages: [] };
    this.lastReport = performance.now();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
    this.listCameras();
  }
  send(message) { this.bridge.postMessage(JSON.stringify(message)); }
  async listCameras() {
    this.select.replaceChildren(new Option('Tomko built-in camera · native GPU', 'native'));
    this.select.disabled = true;
  }
  async start() {
    this.stop(false);
    this.starting = true;
    this.offset = null;
    this.summary = { results: 0, accepted: 0, ages: [] };
    this.lastReportResults = this.lastReportAccepted = 0;
    this.lastCapture = this.lastResponseCapture = undefined;
    this.onState({ kind: 'loading', message: 'Starting native camera…' });
    this.send({ type: 'start', generation: this.generation, hands: this.maxHands, jsTime: performance.now() });
    this.startTimeout = setTimeout(() => { if (this.starting) this.fail(new Error('Native camera timed out. Start it again.')); }, 25000);
  }
  stop(announce = true) {
    if (this.bridge) this.send({ type: 'stop', generation: this.generation });
    clearTimeout(this.startTimeout);
    clearInterval(this.clockTimer);
    super.stop(announce);
  }
  setPerformanceMode(mode) { this.performanceMode = mode; return false; }
  receive(message) {
    if (message.generation !== this.generation) return;
    if (message.type === 'clock' && (this.starting || this.running)) {
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
          this.send({ type: 'stats', ...this.summary, ages: undefined,
            deliveredHz: (this.summary.results - (this.lastReportResults ?? 0)) / elapsedSeconds,
            freshHz: (this.summary.accepted - (this.lastReportAccepted ?? 0)) / elapsedSeconds,
            p50: ages[Math.floor(ages.length * .5)], p95: ages[Math.ceil(ages.length * .95)-1],
            generation: this.generation, hands: this.maxHands });
          this.lastReport = performance.now();
          this.lastReportResults = this.summary.results;
          this.lastReportAccepted = this.summary.accepted;
        }
      } finally { this.send({ type: 'ack', generation: this.generation, id: message.id }); }
    } else if (message.type === 'error') this.fail(new Error(message.message));
    else if (message.type === 'paused') this.stop();
  }
}
