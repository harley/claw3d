import { pinchRatio, joystickAxis, matchHand, clamp } from './mechanics.js';
import { ClaspGesture } from './clasp.js';

const LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

export class HandController {
  constructor({ video, overlay, select, onState, onInput, onStart, onDrop, getPhase, getProfile, onDiagnostic = () => {} }) {
    Object.assign(this, { video, overlay, select, onState, onInput, onStart, onDrop, getPhase, getProfile, onDiagnostic });
    this.running = false;
    this.starting = false;
    this.generation = 0;
    this.lastFrame = 0;
    this.lastResult = 0;
    this.busy = false;
    this.resetOwner();
    this.deviceChange = () => this.listCameras().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      this.lastResult = performance.now();
      this.neutral = null; this.openSince = 0;
      this.clasp.reset();
      this.onInput({ x: 0, z: 0 });
    });
    navigator.mediaDevices?.addEventListener('devicechange', this.deviceChange);
    select.addEventListener('change', () => { if (this.running) this.start(); });
  }

  resetOwner() {
    this.clasp = new ClaspGesture();
    this.owner = null; this.neutral = null; this.candidate = null;
    this.pinchSince = 0; this.openSince = 0; this.lostSince = 0;
    this.input = { x: 0, z: 0 }; this.gripping = false; this.dropArmed = false;
    this.onInput?.(this.input);
  }

  async listCameras(selected) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
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
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs localhost in Chrome or Edge.');
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
      this.onState({ kind: 'loading', message: 'Waking up hand tracking…' });
      this.worker = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
      await new Promise((resolve, reject) => {
        this.initReject = reject;
        const timeout = setTimeout(() => reject(new Error('Hand tracking took too long to load. Try again.')), 25000);
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { clearTimeout(timeout); this.initReject = null; resolve(); }
          else if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); }
        };
        this.worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message || 'Hand tracking could not start.')); };
        this.worker.postMessage({ type: 'init', base: location.origin });
      });
      if (generation !== this.generation) return;
      this.worker.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        this.busy = false;
        if (data.type === 'result') { this.lastResult = performance.now(); this.handle(data.result, data.now); }
        if (data.type === 'error') this.fail(new Error(data.message));
      };
      this.worker.onerror = () => this.fail(new Error('Hand tracking stopped. Start the camera again.'));
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (generation === this.generation) this.fail(new Error('Camera disconnected. Reconnect it, then start again.'));
      }, { once: true });
      this.running = true; this.starting = false; this.lastFrame = -1; this.busy = false;
      this.lastResult = performance.now();
      await this.listCameras(stream.getVideoTracks()[0]?.getSettings().deviceId);
      this.onState({ kind: 'ready', message: 'Show one hand in the camera. Hold it still to begin.' });
      this.timer = setInterval(() => this.frame(), 65);
    } catch (error) {
      if (generation === this.generation) this.fail(error);
      else stream?.getTracks().forEach(t => t.stop());
    }
  }

  fail(error) {
    this.stop(false);
    let message = error.message;
    if (error.name === 'NotAllowedError') message = 'Camera permission is blocked. Allow camera access in your browser, then try again.';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') message = 'That camera is unavailable. Choose another camera and try again.';
    this.onState({ kind: 'error', message });
  }

  stop(announce = true) {
    this.generation++;
    this.running = false; this.starting = false;
    clearInterval(this.timer);
    this.initReject?.(new Error('Camera start cancelled.')); this.initReject = null;
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    this.video.srcObject = null;
    this.resetOwner();
    this.overlay.getContext('2d').clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (announce) this.onState({ kind: 'off', message: 'Camera is off. Keyboard controls are ready.' });
  }

  async frame() {
    if (!this.running) return;
    const now = performance.now();
    if (document.hidden) return;
    if (now - this.lastResult > 650) this.onInput({ x: 0, z: 0 });
    if (now - this.lastResult > 7000) { this.fail(new Error('Camera frames stopped. Start the camera again.')); return; }
    if (this.busy || this.video.readyState < 2 || this.video.currentTime === this.lastFrame) return;
    this.busy = true; this.lastFrame = this.video.currentTime;
    const generation = this.generation;
    try {
      const bitmap = await createImageBitmap(this.video, { resizeWidth: 640, resizeHeight: Math.round(640 * this.video.videoHeight / this.video.videoWidth) });
      if (!this.running || generation !== this.generation) { bitmap.close(); return; }
      this.worker.postMessage({ type: 'frame', bitmap, now }, [bitmap]);
    } catch (error) { if (generation === this.generation) this.fail(error); }
  }

  handle(result, now) {
    const profile=this.getProfile?.();
    const easy = profile === 'palm' || profile === 'clasp';
    const aspect = this.video?.videoWidth && this.video?.videoHeight ? this.video.videoWidth / this.video.videoHeight : 1;
    const hands = result.landmarks.map((landmarks, i) => ({ landmarks,
      center: { x: 1 - (landmarks[0].x + landmarks[9].x) / 2, y: (landmarks[0].y + landmarks[9].y) / 2 },
      handedness: result.handedness[i]?.[0]?.categoryName,
      ratio: pinchRatio(landmarks, aspect),
      pinch: pinchRatio(landmarks, aspect) < (this.gripping ? .80 : .50)
        || (result.gestures[i]?.[0]?.categoryName === 'Closed_Fist' && result.gestures[i][0].score > .70),
      open: result.gestures[i]?.[0]?.categoryName === 'Open_Palm' && result.gestures[i][0].score > .65,
    }));
    this.onDiagnostic?.({ count: hands.length, gesture: result.gestures[0]?.[0]?.categoryName || 'No hand', pinch: hands[0]?.ratio ?? null, milliseconds: performance.now() - now });
    const phase = this.getPhase();
    if (!['idle', 'aim', 'result'].includes(phase)) { this.onInput({ x: 0, z: 0 }); this.draw(hands, null); return; }
    let hand;
    if (!this.owner) {
      // Only a single hand in the central play zone can claim the machine.
      hand = hands.length === 1 ? hands[0] : null;
      if (!hand || hand.center.x < .12 || hand.center.x > .88 || hand.center.y < .12 || hand.center.y > .86) {
        this.pinchSince = 0; this.candidate = null;
        this.onState({ kind: 'ready', message: hands.length > 1 ? 'Two hands detected. Lower one hand to begin.' : easy ? 'Show one hand inside the camera view.' : 'Show one hand. Pinch to grab the joystick.' });
      } else if (hand.pinch || easy) {
        if (this.candidate && (this.candidate.handedness !== hand.handedness || Math.hypot(this.candidate.center.x-hand.center.x,this.candidate.center.y-hand.center.y) > .1)) this.pinchSince = 0;
        this.candidate = hand; this.pinchSince ||= now;
        const progress = clamp((now - this.pinchSince) / 500, 0, 1);
        this.onState({ kind: 'calibrating', message: easy ? 'Hand found. Hold it still for a moment…' : 'Hold that pinch…', progress });
        if (progress === 1) {
          this.owner = { ...hand.center, handedness: hand.handedness };
          this.neutral = { ...hand.center }; this.dropArmed = true; this.gripping = true;
          if (phase !== 'aim') this.onStart('camera');
          this.onState({ kind: 'tracking', message: 'You have it. Move your hand to steer.', progress: 0 });
        }
      } else { this.pinchSince = 0; this.candidate = null; this.onState({ kind: 'ready', message: 'Pinch thumb and finger to grab the joystick.' }); }
      this.draw(hands, hand); return;
    }
    if(profile==='clasp' && phase==='aim'){
      const wasActive=this.clasp.active;
      const clasp=this.clasp.update(hands,this.owner,now,aspect);
      if(clasp.active){
        this.input={x:0,z:0};this.onInput(this.input);this.neutral=null;
        // Follow the existing primary spatial track while the pair converges.
        const primary=hands.map(h=>({h,d:Math.hypot(h.center.x-this.owner.x,h.center.y-this.owner.y)})).sort((a,b)=>a.d-b.d);
        if(primary[0]?.d<.16){this.owner.x=primary[0].h.center.x;this.owner.y=primary[0].h.center.y;}
        this.onState({kind:'clasping',message:clasp.message,progress:clasp.progress});
        this.draw(hands,hands[0]);
        if(clasp.fired)this.onDrop();
        return;
      }
      if(wasActive){this.neutral=null;this.input={x:0,z:0};}
    }
    hand = matchHand(hands, this.owner, this.owner.handedness);
    // Handedness can flip when the wrist turns. An unambiguous, very close
    // continuation is still the same spatial track; an extra hand never is.
    if (!hand && hands.length === 1 && Math.hypot(hands[0].center.x-this.owner.x,hands[0].center.y-this.owner.y) < .08) hand = hands[0];
    if (!hand) {
      this.lostSince ||= now; this.openSince = 0; this.neutral = null;
      this.onInput({ x: 0, z: 0 });
      this.gripping = false;
      this.onState({ kind: 'lost', message: easy ? 'Paused. Bring your hand back to the same area.' : 'Hand lost — paused. Bring your hand back and pinch.' });
      this.draw(hands, null); return;
    }
    if (this.lostSince) this.neutral = null;
    this.lostSince = 0;
    this.owner.x = hand.center.x; this.owner.y = hand.center.y;
    if ((hand.pinch && !hand.open) || easy) {
      this.gripping = true;
      this.neutral ||= { ...hand.center };
      const target = { x: joystickAxis(hand.center.x - this.neutral.x), z: joystickAxis(hand.center.y - this.neutral.y) };
      this.input.x += (target.x - this.input.x) * .5;
      this.input.z += (target.z - this.input.z) * .5;
      this.onInput(this.input); this.openSince = 0; this.dropArmed = true;
      this.onState({ kind: 'tracking', message: profile==='clasp' ? 'Steer with one hand. Bring both hands together to DROP.' : easy ? 'Move gently to steer. Press Space or your DROP button.' : 'Steer gently. Open your palm when you are ready.', progress: 0 });
    } else {
      this.gripping = false;
      this.input = { x: 0, z: 0 }; this.onInput(this.input); this.neutral = null;
      if (hand.open && this.dropArmed) {
        this.openSince ||= now;
        const progress = clamp((now - this.openSince) / 800, 0, 1);
        this.onState({ kind: 'dropping', message: 'Hold your palm open to DROP…', progress });
        if (progress === 1) { this.dropArmed = false; this.openSince = 0; this.onDrop(); }
      } else {
        this.openSince = 0;
        this.onState({ kind: 'tracking', message: 'Pinch again to steer. Open your palm to DROP.', progress: 0 });
      }
    }
    this.draw(hands, hand);
  }

  draw(hands, active) {
    this.overlay.width = 640; this.overlay.height = Math.round(640 * (this.video.videoHeight || 360) / (this.video.videoWidth || 640));
    const height = this.overlay.height;
    const ctx = this.overlay.getContext('2d');
    for (const hand of hands) {
      ctx.strokeStyle = hand === active ? '#d0ed92' : '#faf4dc'; ctx.fillStyle = '#ec805c'; ctx.lineWidth = 2;
      for (const [a,b] of LINKS) {
        ctx.beginPath(); ctx.moveTo((1-hand.landmarks[a].x)*640,hand.landmarks[a].y*height);
        ctx.lineTo((1-hand.landmarks[b].x)*640,hand.landmarks[b].y*height); ctx.stroke();
      }
      for (const p of hand.landmarks) { ctx.beginPath(); ctx.arc((1-p.x)*640,p.y*height,3,0,Math.PI*2); ctx.fill(); }
    }
  }
}
