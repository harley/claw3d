// Only deliberate contact with DROP fires. Releasing the stick is always safe.
export const GRAB_MS = 150;
export const PRESS_MS = 150;
const OPEN_MS = 200, MAX_GAP_MS = 300, UNCERTAIN_MS = 130;
export class GrabRelease {
  constructor() { this.reset(); }
  reset() {
    this.stage = 'seeking'; this.armed = false; this.openMs = 0; this.heldMs = 0;
    this.last = null; this.previous = ''; this.uncertainAt = null;
    this.slam = null; this.point = null;
  }
  update({ open = false, closed = false, visible = true, overTarget = false, overDrop = false, aboveDrop = false, point }, now) {
    const gap = this.last === null ? 0 : now - this.last;
    if (!visible || gap < 0 || gap > MAX_GAP_MS) { this.reset(); this.last = now; return this.read(); }
    this.last = now;
    if (this.stage === 'fired') return this.read();
    const evidence = closed ? 'closed' : open ? 'open' : 'uncertain';
    const dt = evidence === this.previous ? gap : 0;
    if (evidence === 'uncertain') {
      this.uncertainAt ??= now; this.slam = null; this.point = null;
      if (now - this.uncertainAt > UNCERTAIN_MS) { this.reset(); this.last = now; }
      this.previous = evidence; return this.read();
    }
    if (this.uncertainAt !== null && now - this.uncertainAt > UNCERTAIN_MS) { this.reset(); this.last = now; }
    this.uncertainAt = null;
    let grabbed = false, fired = false;
    if (this.stage === 'gripped') {
      if (open && !closed) { this.reset(); this.last = now; } // Let go, never drop.
      else grabbed = this.previous === 'uncertain';
    } else if (open && !closed) {
      this.stage = 'seeking'; this.heldMs = 0; this.openMs += dt;
      if (this.openMs >= OPEN_MS) this.armed = true;
      // Arm above the button, then cross onto it quickly. Hover, sideways
      // sweeps, a reacquired hand and an isolated low sample cannot slam.
      if (this.armed && point && aboveDrop && !this.slam) this.slam = { y: point.y, at: now };
      if (this.slam && (now - this.slam.at > 350 || (!aboveDrop && !overDrop))) this.slam = null;
      if (this.slam && overDrop && point && this.point && gap > 0) {
        fired = point.y - this.slam.y >= .035 && (point.y - this.point.y) / (gap / 1000) >= .6;
        this.slam = null;
      }
    } else if (closed && this.armed && (overTarget || overDrop)) {
      this.slam = null;
      const next = overDrop ? 'pressing' : 'grabbing';
      // The target locks on the first closed observation.
      if (this.previous === 'closed' && this.stage !== next) { this.reset(); this.last = now; }
      else {
        this.stage = next; this.heldMs += dt;
        if (this.heldMs >= (overDrop ? PRESS_MS : GRAB_MS)) {
          if (overDrop) fired = true;
          else { this.stage = 'gripped'; grabbed = true; }
        }
      }
    } else { this.reset(); this.last = now; }
    if (fired) this.stage = 'fired';
    this.previous = evidence; this.point = point ? { ...point } : null;
    return { ...this.read(), grabbed, fired };
  }
  read() {
    return { stage: this.stage, armed: this.armed, grabbed: false, fired: false,
      steering: this.stage === 'gripped' && this.previous === 'closed',
      progress: ['grabbing', 'pressing'].includes(this.stage) ? Math.min(1, this.heldMs / GRAB_MS) : 0 };
  }
}
