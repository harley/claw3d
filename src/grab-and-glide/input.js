import { OneEuroPoint } from '../one-euro.js';
import { RULES } from './game.js';

// Timestamped recognition evidence is consumed separately from game outcomes.
export class GlideInput {
  constructor(game, options = {}) { this.game = game; this.rules = { ...RULES, ...options }; this.filter = new OneEuroPoint(); this.reset(); }
  reset() { this.lastAt = null; this.valid = false; this.armed = false; this.pending = null; this.uncertainAt = null; this.pose = null; this.offset = { x: 0, y: 0 }; this.filter.reset(); }
  lose() { this.valid = false; this.armed = false; this.pending = null; this.uncertainAt = null; this.pose = null; this.filter.reset(); }
  confirm(kind, at, duration) {
    if (this.pending?.kind !== kind) this.pending = { kind, start: at };
    return at - this.pending.start >= duration;
  }
  sample(evidence, now, reducedMotion = false) {
    const { at, point, open, closed, valid } = evidence;
    const previousAt = this.lastAt;
    if (!valid || !Number.isFinite(at) || at > now || now - at > this.rules.maxGapMs ||
        (previousAt !== null && at <= previousAt) || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || (open && closed)) {
      this.lose(); return;
    }
    if (previousAt !== null && at - previousAt > this.rules.maxGapMs) this.lose();
    this.lastAt = at;
    // Intermediate hand shapes are not loss of ownership. Brief uncertainty
    // freezes pose/time and cancels confirmation without making a normal
    // open-to-fist transition impossible. Sustained uncertainty must rearm.
    if (!open && !closed) {
      this.valid = false; this.pending = null; this.uncertainAt ??= at;
      if (at - this.uncertainAt > this.rules.uncertainMs) this.lose();
      return;
    }
    if (this.uncertainAt !== null && at - this.uncertainAt > this.rules.uncertainMs) this.lose();
    if (this.uncertainAt !== null && this.armed) {
      this.offset = { x: this.game.position.x - (point.x - .5) * 16, y: this.game.position.y - (.5 - point.y) * 10 };
      this.filter.reset();
    }
    this.uncertainAt = null; this.valid = true;
    if (!['position', 'carry'].includes(this.game.phase)) { this.lose(); return; }
    const raw = { x: (point.x - .5) * 16, y: (.5 - point.y) * 10 };
    if (!this.armed) {
      // While carrying, the recognizer first acquires an open hand. Only a fresh
      // confirmed CLOSE rearms cargo; an open reacquisition can never release it.
      const readyPose = this.game.cargo ? closed : open;
      if (!readyPose) { this.pending = null; return; }
      if (this.confirm('rearm', at, this.rules.rearmMs)) {
        this.armed = true; this.pending = null; this.filter.reset(); this.filter.filter(raw, at);
        // Preserve the frozen interaction pose after recovery. Normal play is 1:1.
        this.offset = { x: this.game.position.x - raw.x, y: this.game.position.y - raw.y };
        this.pose = { ...this.game.position };
      }
      return;
    }
    const action = this.game.phase === 'position' ? closed : open;
    if (action) {
      // Freeze the last intentional pose from BEFORE hand-shape change.
      if (this.confirm(this.game.phase === 'position' ? 'grab' : 'release', at, this.game.phase === 'position' ? this.rules.closeMs : this.rules.openMs)) {
        if (this.game.phase === 'position') this.game.grab(); else this.game.release();
        this.pending = null;
        if (this.game.phase === 'carry') {
          this.offset = { x: this.game.position.x - raw.x, y: this.game.position.y - raw.y };
          this.filter.reset(); this.filter.filter(raw, at);
        } else this.lose();
      }
      return;
    }
    // Cancelling a gesture also seeds the locked pose, avoiding a shape-change jump.
    if (this.pending) { this.offset = { x: this.game.position.x - raw.x, y: this.game.position.y - raw.y }; this.filter.reset(); }
    this.pending = null;
    const filtered = this.filter.filter(raw, at);
    this.game.move({ x: filtered.x + this.offset.x, y: filtered.y + this.offset.y }, reducedMotion);
    this.pose = { ...this.game.position };
  }
  tick(now, dt) {
    if (this.lastAt === null || now - this.lastAt > this.rules.maxGapMs) this.lose();
    if (this.valid && this.armed) this.game.tick(Math.min(dt, Math.max(0, (this.rules.maxGapMs - (now - this.lastAt)) / 1000)));
  }
  get progress() { return this.pending && this.lastAt !== null ? Math.min(1, (this.lastAt - this.pending.start) / (this.pending.kind === 'rearm' ? this.rules.rearmMs : this.pending.kind === 'grab' ? this.rules.closeMs : this.rules.openMs)) : 0; }
}
