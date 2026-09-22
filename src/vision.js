import { handCameraGuide, drawHandCameraGuide } from './hand-camera-guide.js';
import { pinchRatio, joystickAxis, matchHand } from './mechanics.js';
import { clamp } from './arcade-mechanics.js';
import {FistDrop,fistEvidence} from './fist.js';
import { DualHandControls } from './dual-hand-controls.js';
import { GrabRelease } from './grab-release.js';
import { OneEuroPoint } from './one-euro.js';
import { absoluteTarget, ABSOLUTE_RANGE, ABSOLUTE_LEAD_MS } from './steering.js';

export const CAPTURE_MAX_AGE = 300;
export const OWNER_LOSS_GRACE = 650;

const LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

export class HandController {
  constructor({ video, overlay, select, onState, onInput, onStart, onDrop, getPhase, onDiagnostic = () => {}, onGesture, getControlProfile = () => 'hold-drop', getControlTarget = () => ({}), maxHands = 1, holdMs, steering = 'relative' }) {
    Object.assign(this, { video, overlay, select, onState, onInput, onStart, onDrop, getPhase, onDiagnostic, onGesture, getControlProfile, getControlTarget, maxHands, holdMs, steering });
    this.running = false;
    this.starting = false;
    this.generation = 0;
    this.lastFrame = 0;
    this.lastResult = 0;
    this.busy = false;
    this.resetOwner();
    this.deviceChange = () => this.listCameras().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      this.visibilityCutoff = performance.now(); this.lastActivity = this.visibilityCutoff;
      this.resetOwner();
      this.onInput({ x: 0, z: 0 });
    });
    navigator.mediaDevices?.addEventListener('devicechange', this.deviceChange);
    select.addEventListener('change', () => { if (this.running) this.start(); });
  }

  resetOwner() {
    this.fist?.reset('blocked'); // a discarded mid-hold still reports its cancellation
    this.fist = new FistDrop((name, cause) => this.onGesture?.(name, cause), this.holdMs ? { holdMs: this.holdMs, decay: true } : undefined);
    this.grab = new GrabRelease();
    this.dual = new DualHandControls();
    this.pointer = new OneEuroPoint();
    this.owner = null; this.neutral = null; this.candidate = null;
    this.pinchSince = 0; this.lostSince = 0;
    this.input = { x: 0, z: 0 };
    this.onInput?.(this.input);
    this.dualFeedback = null;
    if (this.controlProfile === 'dual' && this.overlay) this.draw([], null);
  }

  async listCameras(selected) {
    const generation = this.generation;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    if (generation !== this.generation) return;
    const value = selected || this.select.value;
    this.select.replaceChildren(...devices.map((device, index) => {
      const option = document.createElement('option'); option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`; return option;
    }));
    if (devices.some(d => d.deviceId === value)) this.select.value = value;
    this.select.disabled = this.starting || devices.length < 2;
  }

  async start() {
    this.stop(false);
    const generation = ++this.generation;
    this.starting = true;
    this.onState({ kind: 'loading', message: 'Starting your camera…' });
    let stream, failureCode = 'camera_unavailable';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost in Chrome or Edge.');
      const deviceId = this.select.value;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 30 },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      } });
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (generation !== this.generation) return;
      failureCode = 'tracking_init_error';
      this.onState({ kind: 'loading', message: 'Waking up hand tracking…' });
      this.worker = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
      const workerResult = await new Promise((resolve, reject) => {
        this.initReject = reject;
        const timeout = setTimeout(() => reject(new Error('Hand tracking took too long to load. Try again.')), 25000);
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { clearTimeout(timeout); this.initReject = null; this.delegate = data.delegate; resolve(); }
          else if (data.type === 'main_thread_required') { clearTimeout(timeout); this.initReject = null; resolve(data.type); }
          // A worker can expose OffscreenCanvas yet still fail while MediaPipe
          // constructs its internal canvas (observed as `document is not
          // defined` on affected WebKit). The page runtime is the compatibility
          // recovery for any completed worker-initialization failure.
          else if (data.type === 'error') { clearTimeout(timeout); this.initReject = null; resolve('main_thread_required'); }
        };
        this.worker.onerror = () => { clearTimeout(timeout); this.initReject = null; resolve('main_thread_required'); };
        this.worker.postMessage({ type: 'init', base: location.origin, maxHands: this.maxHands });
      });
      if (workerResult === 'main_thread_required') {
        this.worker.terminate();
        this.worker = null;
        if (!await this.useMainThreadVision(generation, location.origin)) return;
      }
      if (generation !== this.generation) return;
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        // Rebuild notices keep the liveness watchdog fed without releasing the
        // busy latch: the retried frame is still in flight inside the worker.
        if (data.type === 'progress') { this.lastActivity = performance.now(); return; }
        if (data.type === 'delegate') { this.lastActivity = performance.now(); this.demoteCapture(generation, data.delegate); return; }
        this.busy = false;
        if (data.type === 'result') this.acceptResult(data.result, data.now, generation);
        if (data.type === 'error') this.fail(new Error(data.message), 'worker_error');
      };
      this.worker.onerror = () => { if (generation === this.generation) this.fail(new Error('Hand tracking stopped. Start the camera again.'), 'worker_error'); };
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (generation === this.generation) this.fail(new Error('Camera disconnected. Reconnect it, then start again.'), 'camera_disconnected');
      }, { once: true });
      this.running = true; this.starting = false; this.lastFrame = -1; this.busy = false;
      this.lastResult = performance.now(); this.lastActivity = this.lastResult; this.lastCapture = -Infinity; this.lastResponseCapture = -Infinity; this.lastFreshReceipt = this.lastResult;
      await this.listCameras(stream.getVideoTracks()[0]?.getSettings().deviceId);
      if (generation !== this.generation || !this.running) return;
      this.onState({ kind: 'ready', message: 'Show one hand in the camera. Hold it still to begin.' });
      // ?capture=N forces main-thread bitmap capture at that width (A/B testing
      // resolution or escaping the stream path). Default: zero-copy VideoFrame
      // transfer when available, then requestVideoFrameCallback pacing, then a
      // plain timer. The timer always runs as the staleness/liveness watchdog.
      const requested = Number(new URLSearchParams(location.search).get('capture'));
      this.captureLocked = requested >= 160 && requested <= 1280;
      this.captureWidth = this.captureLocked ? Math.round(requested) : 0;
      this.captureDriver = 'timer';
      // The WebKit compatibility runtime reads the page's video element and is
      // deliberately timer-paced. A CPU worker recognizer was tuned on the
      // resized bitmap path; only the GPU worker gets full-resolution frames.
      this.configureCapture(generation);
      // The timer is the always-on staleness/liveness watchdog; with a
      // dedicated capture driver active its ticks supervise without capturing.
      this.timer = setInterval(() => this.frame(), 65);
    } catch (error) {
      if (generation === this.generation) this.fail(error, failureCode);
      else stream?.getTracks().forEach(t => t.stop());
    }
  }

  async useMainThreadVision(generation, base) {
    const create = this.createMainThreadVision || (async origin => {
      const runtime = await import('./vision-main-thread.js');
      return runtime.createMainThreadVision(origin, this.maxHands);
    });
    const runtime = await create(base);
    // Camera stop/switch can win while WebKit is loading the model. Do not
    // attach or leak the late runtime into the newer camera generation.
    if (generation !== this.generation) { runtime.terminate(); return false; }
    this.worker = runtime;
    this.delegate = runtime.delegate;
    return true;
  }

  fail(error, code = 'camera_unavailable') {
    this.stop(false);
    let message = error.message;
    if (error.name === 'NotAllowedError') { code = 'permission_denied'; message = 'Camera permission is blocked. Allow camera access in your browser, then try again.'; }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') { code = 'no_camera'; message = 'That camera is unavailable. Choose another camera and try again.'; }
    if (error.name === 'NotReadableError') code = 'camera_busy';
    this.onState({ kind: 'error', message, code });
  }

  stop(announce = true) {
    this.generation++;
    this.running = false; this.starting = false;
    clearInterval(this.timer);
    this.initReject?.(new Error('Camera start cancelled.')); this.initReject = null;
    this.frameReader?.cancel().catch(() => {}); this.frameReader = null; this.captureDriver = null;
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.video.srcObject = null;
    this.resetOwner();
    this.overlay.getContext('2d').clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (announce) this.onState({ kind: 'off', message: 'Camera is off. Start it again to play.' });
  }

  supervise(now) {
    if (!this.running) return false;
    if (document.hidden) return false;
    if (now - this.lastResult > CAPTURE_MAX_AGE) {
      this.onInput({ x: 0, z: 0 });
      // Stop stale steering immediately. A still-running inference must not
      // erase consecutive fresh detections merely because capture is older.
      if (now - (this.lastFreshReceipt ?? this.lastResult) > CAPTURE_MAX_AGE) this.delayTracking();
      if (now - this.lastResult > OWNER_LOSS_GRACE) this.resetOwner();
    }
    if (now - (this.lastActivity ?? this.lastResult) > 7000) { this.fail(new Error('Hand tracking stopped responding. Start the camera again.'), 'worker_timeout'); return false; }
    return true;
  }

  async frame(now = performance.now(), paced = false) {
    if (!this.supervise(now)) return;
    // When a dedicated driver paces capture, the watchdog timer must not also
    // grab frames — it would double-capture behind the driver's back.
    if (!paced && this.captureDriver && this.captureDriver !== 'timer') return;
    if (this.busy || this.video.readyState < 2 || this.video.currentTime === this.lastFrame) return;
    this.busy = true; this.lastFrame = this.video.currentTime;
    const generation = this.generation;
    if (this.worker.local) {
      this.worker.postMessage({ type: 'frame', video: this.video, now });
      return;
    }
    const width = this.captureWidth || 640;
    try {
      const bitmap = await createImageBitmap(this.video, { resizeWidth: width, resizeHeight: Math.round(width * this.video.videoHeight / this.video.videoWidth) });
      if (!this.running || generation !== this.generation) { bitmap.close(); return; }
      this.worker.postMessage({ type: 'frame', bitmap, now }, [bitmap]);
    } catch (error) { if (generation === this.generation) this.fail(error, 'capture_error'); }
  }

  paceVideoFrames(generation) {
    const token = this.paceToken;
    this.video.requestVideoFrameCallback(() => {
      if (!this.running || generation !== this.generation || this.captureDriver !== 'rvfc' || token !== this.paceToken) return;
      this.frame(performance.now(), true);
      this.paceVideoFrames(generation);
    });
  }

  configureCapture(generation = this.generation) {
    if (!this.running) return;
    this.frameReader?.cancel().catch(() => {}); this.frameReader = null;
    this.paceToken = {};
    this.captureDriver = 'timer';
    if (!this.worker || this.worker.local) {
      this.onDiagnostic?.({ delegate: this.delegate, driver: this.captureDriver, captureWidth: this.captureWidth || 640 });
      return;
    }
    const track = this.stream?.getVideoTracks()[0];
    // Zero-copy frames stay on in simple mode; the capture width only sizes bitmap fallbacks.
    if (!this.captureLocked && this.delegate !== 'CPU' && typeof MediaStreamTrackProcessor === 'function' && track) {
      try { this.frameReader = new MediaStreamTrackProcessor({ track }).readable.getReader(); this.captureDriver = 'stream'; }
      catch { this.frameReader = null; }
    }
    if (this.captureDriver !== 'stream' && typeof this.video.requestVideoFrameCallback === 'function') this.captureDriver = 'rvfc';
    this.onDiagnostic?.({ delegate: this.delegate, driver: this.captureDriver, captureWidth: this.captureWidth || (this.captureDriver === 'stream' ? 0 : 640) });
    if (this.captureDriver === 'stream') this.readFrames(generation);
    if (this.captureDriver === 'rvfc') this.paceVideoFrames(generation);
  }

  setPerformanceMode(mode) {
    if (this.captureLocked) return false;
    const width = mode === 'simple' ? 320 : 0;
    if (width === this.captureWidth) return false;
    this.captureWidth = width;
    // A streaming capture is unaffected by bitmap width; do not interrupt it.
    if (this.captureDriver !== 'stream') this.configureCapture();
    else this.onDiagnostic?.({ delegate: this.delegate, driver: this.captureDriver, captureWidth: 0 });
    return true;
  }

  // The worker abandoned the GPU mid-session: record the flip and stop feeding
  // full-resolution VideoFrames to a CPU recognizer.
  demoteCapture(generation, delegate) {
    this.delegate = delegate;
    this.onDiagnostic?.({ delegate });
    if (delegate !== 'CPU' || this.captureDriver !== 'stream') return;
    this.configureCapture(generation);
  }

  // Chrome path: VideoFrames stream straight from the camera track and transfer
  // to the worker with no main-thread resize. Reading while busy drains the
  // queue so inference always sees the freshest frame.
  async readFrames(generation) {
    const reader = this.frameReader;
    while (this.running && generation === this.generation && reader === this.frameReader) {
      let frame = null;
      try { ({ value: frame } = await reader.read()); } catch { /* cancelled or track ended */ }
      if (!frame) return;
      if (!this.running || generation !== this.generation || this.busy || document.hidden) { frame.close(); continue; }
      this.busy = true;
      this.worker.postMessage({ type: 'frame', frame, now: performance.now() }, [frame]);
    }
  }

  acceptResult(result, capturedAt, generation, receivedAt = performance.now()) {
    if (!this.running || generation !== this.generation) return false;
    const age = receivedAt - capturedAt;
    const reason = !Number.isFinite(capturedAt) || age < 0 ? 'invalid capture'
      : capturedAt <= (this.visibilityCutoff ?? -Infinity) ? 'hidden capture'
      : capturedAt <= (this.lastResponseCapture ?? this.lastCapture ?? -Infinity) ? 'out of order'
      : age > CAPTURE_MAX_AGE ? 'over age' : null;
    this.onDiagnostic?.({ captureAge: age, rejected: reason });
    // A late response proves the worker is alive, but cannot control the game.
    if (!reason || reason === 'over age') {
      this.lastActivity = receivedAt; this.lastResponseCapture = capturedAt;
    }
    if (reason) {
      this.fist.reset('stale'); this.grab.reset(); this.dual.reset(); this.onInput({ x: 0, z: 0 });
      this.dualFeedback = null;
      if (this.controlProfile === 'dual') this.draw([], null);
      if (reason === 'over age') this.delayTracking();
      return false;
    }
    if (capturedAt - (this.lastCapture ?? capturedAt) > OWNER_LOSS_GRACE) this.resetOwner();
    this.lastCapture = capturedAt; this.lastResult = capturedAt; this.lastFreshReceipt = receivedAt;
    this.handle(result, capturedAt);
    return true;
  }

  delayTracking() {
    this.fist.reset('stale'); this.grab.reset(); this.dual.reset();
    // Reacquisition after delayed results must seed a fresh neutral, just like
    // a missing hand. Otherwise its changed position immediately steers.
    this.neutral = null; this.input = { x: 0, z: 0 };
    this.onInput(this.input);
    this.dualFeedback = null;
    if (this.controlProfile === 'dual') this.draw([], null);
    this.onState({ kind: 'delayed', message: 'Tracking is slow. Keep your hand steady while it catches up.', progress: 0 });
  }

  // Menus retain hold-to-select. Gameplay may opt into the local grab profile.
  handle(result, now) {
    const aspect = this.video?.videoWidth && this.video?.videoHeight ? this.video.videoWidth / this.video.videoHeight : 1;
    const hands = result.landmarks.map((landmarks, i) => ({ landmarks,
      fist: fistEvidence(landmarks,result.gestures[i]?.[0]?.categoryName,result.gestures[i]?.[0]?.score,aspect),
      center: { x: 1 - (landmarks[0].x + landmarks[9].x) / 2, y: (landmarks[0].y + landmarks[9].y) / 2 },
      handedness: result.handedness[i]?.[0]?.categoryName,
      // Tasks GestureRecognizer labels the anatomical hand on raw frames.
      // Mirror cursor x above, not identity; the legacy Hands API differed.
      physicalHand: result.handedness[i]?.[0]?.categoryName === 'Left' ? 'left' : result.handedness[i]?.[0]?.categoryName === 'Right' ? 'right' : null,
      handednessScore: result.handedness[i]?.[0]?.score ?? 0,
      ratio: pinchRatio(landmarks, aspect),
    }));
    this.onDiagnostic?.({ count: hands.length, gesture: result.gestures[0]?.[0]?.categoryName || 'No hand', pinch: hands[0]?.ratio ?? null, milliseconds: performance.now() - now });
    const phase = this.getPhase();
    const profile = this.getControlProfile?.() || 'hold-drop';
    const acceptsInput = ['idle', 'aim', 'result'].includes(phase);
    // Recognition stays visible during setup and delivery. Only game permission
    // enables actions; a held gesture cannot carry across that boundary.
    if (this.acceptedInput !== acceptsInput || this.controlProfile !== profile) {
      this.fist.reset(); this.grab.reset(); this.dual.reset(); this.controlProfile = profile;
      this.neutral = null; this.input = { x: 0, z: 0 };
      this.acceptedInput = acceptsInput;
    }
    if (profile === 'dual') {
      if (!acceptsInput) {
        this.dual.reset(); this.input = { x: 0, z: 0 }; this.onInput(this.input);
        this.dualFeedback = { kind: 'blocked', profile, controlEnabled: false, hands: {} };
      } else {
        const state = this.dual.update(hands, now, (point, role, origin) => this.getControlTarget?.(point, role, origin) || {});
        this.input = state.input; this.onInput(this.input);
        if (state.fired) {
          const accepted = this.onDrop() !== false;
          state.kind = accepted ? 'accepted' : 'tracking';
          if (!accepted) this.dual.right.gesture.reset();
        }
        this.dualFeedback = { ...state, profile, handCount: hands.length, controlEnabled: true };
      }
      this.onState(this.dualFeedback);
      this.draw(hands, null); return;
    }
    const sendInput = input => this.onInput(acceptsInput ? input : { x: 0, z: 0 });
    const report = state => this.onState({ ...state, profile, handCount: hands.length, controlEnabled: acceptsInput,
      pointer: hands.length === 1 && hand && this.owner && ['tracking', 'clenching'].includes(state.kind) ? { ...hand.center } : null });
    let hand;
    if (!this.owner) {
      // Only a single hand in the central play zone can claim the machine.
      hand = hands.length === 1 ? hands[0] : null;
      if (!hand || hand.center.x < .12 || hand.center.x > .88 || hand.center.y < .12 || hand.center.y > .86) {
        this.pinchSince = 0; this.candidate = null;
        report({ kind: 'ready', message: hands.length > 1 ? 'Lower one hand to begin.' : 'Show one hand inside the camera view.' });
      } else if (!hand.fist.closed) {
        if (this.candidate && (this.candidate.handedness !== hand.handedness || Math.hypot(this.candidate.center.x-hand.center.x,this.candidate.center.y-hand.center.y) > .1)) { this.pinchSince = 0; this.candidate = null; }
        this.candidate ||= hand; this.pinchSince ||= now;
        const progress = clamp((now - this.pinchSince) / 500, 0, 1);
        report({ kind: 'calibrating', message: 'Hold your hand still for a moment…', progress });
        if (progress === 1) {
          this.owner = { ...hand.center, handedness: hand.handedness };
          this.neutral = { ...hand.center };
          if (acceptsInput && phase !== 'aim') this.onStart('camera');
          report({ kind: 'tracking', message: acceptsInput ? 'Move your hand to steer.' : 'Hand ready.', progress: 0 });
        }
      } else { this.pinchSince = 0; this.candidate = null; this.onState({ kind: 'ready', message: 'Open your hand to begin.' }); }
      sendInput({ x: 0, z: 0 });
      this.draw(hands, this.owner ? hand : null); return;
    }
    if (this.lostSince && now - this.lostSince >= OWNER_LOSS_GRACE) {
      this.resetOwner();
      report({ kind: 'ready', message: 'Show one hand and hold still to regain control.' });
      this.draw(hands, null); return;
    }
    hand = matchHand(hands, this.owner, this.owner.handedness);
    // Handedness can flip when the wrist turns. An unambiguous, very close
    // continuation is still the same spatial track; an extra hand never is.
    if (!hand && hands.length === 1 && Math.hypot(hands[0].center.x-this.owner.x,hands[0].center.y-this.owner.y) < .08) hand = hands[0];
    if (!hand) {
      this.lostSince ||= now; this.neutral = null; this.fist.reset('hand_lost'); this.grab.reset();
      sendInput({ x: 0, z: 0 });
      report({ kind: 'lost', message: 'Bring one hand back to the same area.' });
      this.draw(hands, null); return;
    }
    if (this.lostSince) this.neutral = null;
    this.lostSince = 0;
    this.owner.x = hand.center.x; this.owner.y = hand.center.y;
    if (phase === 'aim' && profile === 'grab-release') {
      const target = this.getControlTarget?.(hand.center) || {};
      const grip = this.grab.update({ ...hand.fist, visible: hands.length === 1,
        point: hand.center, ...target }, now);
      this.input = { x: 0, z: 0 };
      if (grip.grabbed) { this.pointer.reset(); this.neutral = null; }
      if (grip.steering) {
        const point = this.pointer.filter(hand.center, now);
        this.neutral ||= { ...point };
        this.input = { x: joystickAxis(point.x - this.neutral.x), z: joystickAxis(point.y - this.neutral.y) };
      } else this.neutral = null;
      sendInput(this.input);
      let kind = hands.length !== 1 ? 'lost' : ['grabbing', 'pressing'].includes(grip.stage) ? 'clenching' : 'tracking';
      if (grip.fired) {
        const accepted = this.onDrop() !== false;
        if (!accepted) { this.grab.reset(); grip.stage = 'seeking'; grip.armed = false; }
        kind = accepted ? 'accepted' : 'tracking';
      }
      // Pose drives artwork only; it never contributes to gesture timing.
      report({ kind, progress: grip.progress, grab: grip, target: target.overDrop ? 'drop' : target.overTarget ? 'stick' : '',
        closed: hand.fist.closed, open: hand.fist.open,
        message: grip.stage === 'gripped' ? 'Move your fist to steer. Open to let go.' : 'Open your hand, reach the joystick and clench to grab.' });
      this.draw(hands, hand); return;
    }
    if (phase === 'aim') {
      const fist=this.fist.update({...hand.fist,visible:hands.length===1},now);
      if(fist.active){
        this.input={x:0,z:0};sendInput(this.input);this.neutral=null;
        if (fist.fired) {
          const accepted = this.onDrop() !== false;
          if (!accepted) this.fist.reset();
          report({kind: accepted ? 'accepted' : 'tracking', message: accepted ? 'Drop accepted · watch the claw.' : 'Open your hand to try again.', progress: accepted ? 1 : 0});
        } else report({kind:'clenching',message:'Hold your fist to drop. Open to cancel.',progress:fist.progress});
        this.draw(hands,hand);return;
      }
      // A fist shown before arming never steers or drops the claw.
      if(hand.fist.closed){this.input={x:0,z:0};sendInput(this.input);this.neutral=null;report({kind:'clenching',message:hands.length>1?'Lower your other hand. Open, then clench to drop.':'Open your hand first, then clench to drop.',progress:0});this.draw(hands,hand);return;}
    }
    // One-euro on the hand centre: still hands stay planted, fast moves land
    // without the trailing lag of the old fixed lerp. A fresh grab discards
    // filter state so neutral seeds at the true hand position and steering
    // starts at exactly zero — never at the filter's convergence residue.
    if (!this.neutral) this.pointer.reset();
    const point = this.pointer.filter(hand.center, now);
    this.neutral ||= { ...point };
    if (this.steering === 'absolute') {
      // Point, don't nudge: the predicted hand offset is the claw's target.
      const lead = this.pointer.predict(ABSOLUTE_LEAD_MS) || point;
      const offset = { x: lead.x - this.neutral.x, y: lead.y - this.neutral.y };
      this.input = { x: clamp(offset.x / ABSOLUTE_RANGE.x, -1, 1), z: clamp(offset.y / ABSOLUTE_RANGE.y, -1, 1), target: absoluteTarget(offset) };
    } else {
      this.input = { x: joystickAxis(point.x - this.neutral.x), z: joystickAxis(point.y - this.neutral.y) };
    }
    sendInput(this.input);
    report({ kind: 'tracking', message: !acceptsInput ? 'Hand ready.' : 'Steer with an open hand. Clench your fist and hold to drop.', progress: 0 });
    this.draw(hands, hand);
  }

  draw(hands, active) {
    // Resizing a canvas clears it and resets context state; only do that when
    // the aspect actually changed, and clear explicitly otherwise.
    const height = Math.round(640 * (this.video.videoHeight || 360) / (this.video.videoWidth || 640));
    const ctx = this.overlay.getContext('2d');
    if (this.overlay.width !== 640 || this.overlay.height !== height) { this.overlay.width = 640; this.overlay.height = height; }
    else ctx.clearRect(0, 0, 640, height);
    if (this.controlProfile === 'dual') {
      const guides = ['left', 'right'].map(role => handCameraGuide(role, this.dualFeedback, this.dual[role].origin));
      drawHandCameraGuide(ctx, 640, height, guides);
      for (const guide of guides) {
        this.overlay.dataset[guide.role] = guide.state;
      }
    } else { delete this.overlay.dataset.left; delete this.overlay.dataset.right; }
    if (this.neutral && active) {
      ctx.strokeStyle = '#abd3ff'; ctx.lineWidth = 2;
      const x = this.neutral.x * 640, y = this.neutral.y * height;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(active.center.x * 640, active.center.y * height); ctx.stroke();
    }
    for (const hand of hands) {
      const roleView = this.dualFeedback?.hands?.[hand.physicalHand];
      const roleGuide = this.controlProfile === 'dual' && handCameraGuide(hand.physicalHand === 'left' ? 'left' : 'right', this.dualFeedback);
      const recognized = roleGuide && roleView?.ready && !roleView.outside && roleGuide.state !== 'inactive' &&
        hand.handednessScore >= .75 && Math.hypot(hand.center.x - roleView.pointer.x, hand.center.y - roleView.pointer.y) < .001;
      ctx.globalAlpha = this.controlProfile === 'dual' && !recognized ? .28 : 1;
      if (this.controlProfile === 'dual' && hand.physicalHand && hand.handednessScore >= .75) {
        ctx.fillStyle = recognized ? roleGuide.color : '#a2aab6'; ctx.font = 'bold 24px sans-serif';
        ctx.fillText(hand.physicalHand === 'left' ? 'L' : 'R', hand.center.x * 640 + 14, hand.center.y * height);
      }
      if (hand === active) { ctx.fillStyle = '#66ffb3'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('YOU', hand.center.x * 640 + 14, hand.center.y * height); }
      ctx.strokeStyle = recognized ? roleGuide.color : hand === active ? '#d0ed92' : '#faf4dc'; ctx.fillStyle = recognized ? roleGuide.color : '#ec805c'; ctx.lineWidth = 2;
      for (const [a,b] of LINKS) {
        ctx.beginPath(); ctx.moveTo((1-hand.landmarks[a].x)*640,hand.landmarks[a].y*height);
        ctx.lineTo((1-hand.landmarks[b].x)*640,hand.landmarks[b].y*height); ctx.stroke();
      }
      for (const p of hand.landmarks) { ctx.beginPath(); ctx.arc((1-p.x)*640,p.y*height,3,0,Math.PI*2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
}
