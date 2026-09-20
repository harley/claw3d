// Camera evidence only. Missing/uncertain tracking is never a release gesture.
export const GRAB_MS = 150;
export const RELEASE_MS = 150;
const OPEN_MS = 200;
const MAX_GAP_MS = 300;
const UNCERTAIN_MS = 130;

export class GrabRelease {
  constructor() { this.reset(); }
  reset() {
    this.stage = 'seeking'; this.armed = false; this.openMs = 0;
    this.heldMs = 0; this.releaseMs = 0; this.last = null;
    this.previous = ''; this.uncertainAt = null;
  }
  update({ open = false, closed = false, visible = true, overTarget = false }, now) {
    const gap = this.last === null ? 0 : now - this.last;
    if (!visible || gap < 0 || gap > MAX_GAP_MS) {
      this.reset(); this.last = now;
      return this.read();
    }
    this.last = now;
    if (this.stage === 'fired') return this.read();
    const evidence = closed ? 'closed' : open ? 'open' : 'uncertain';
    const dt = evidence === this.previous ? gap : 0;
    const previousStage = this.stage;
    let grabbed = false, fired = false;
    if (evidence === 'uncertain') {
      this.uncertainAt ??= now;
      this.releaseMs = 0;
      if (now - this.uncertainAt > UNCERTAIN_MS) {
        this.reset(); this.last = now;
      }
      this.previous = evidence;
      return this.read(); // Freeze immediately; do not count uncertain frames.
    }
    if (this.uncertainAt !== null && now - this.uncertainAt > UNCERTAIN_MS) {
      this.reset(); this.last = now;
    }
    this.uncertainAt = null;
    if (this.stage === 'seeking' || this.stage === 'grabbing') {
      if (open && !closed) {
        this.stage = 'seeking'; this.heldMs = 0;
        this.openMs += dt;
        if (this.openMs >= OPEN_MS) this.armed = true;
      } else if (closed && this.armed && overTarget) {
        this.stage = 'grabbing'; this.heldMs += dt;
        if (this.heldMs >= GRAB_MS) { this.stage = 'gripped'; grabbed = true; }
      } else {
        // A fist formed elsewhere cannot sweep onto the stick and grab it.
        this.reset(); this.last = now;
      }
    } else if (this.stage === 'gripped' || this.stage === 'releasing') {
      if (open && !closed) {
        this.stage = 'releasing'; this.releaseMs += dt;
        if (this.releaseMs >= RELEASE_MS) { this.stage = 'fired'; fired = true; }
      } else if (closed) {
        this.stage = 'gripped'; this.releaseMs = 0;
        // Reseed steering after an interrupted release or uncertain evidence.
        grabbed = previousStage === 'releasing' || this.previous === 'uncertain';
      }
    }
    this.previous = evidence;
    return { ...this.read(), grabbed, fired };
  }
  read() {
    return { stage: this.stage, armed: this.armed, grabbed: false, fired: false,
      steering: this.stage === 'gripped' && this.previous === 'closed',
      progress: Math.min(1, this.stage === 'grabbing' ? this.heldMs / GRAB_MS : this.stage === 'releasing' ? this.releaseMs / RELEASE_MS : 0) };
  }
}
