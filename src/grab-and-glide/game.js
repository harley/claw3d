// All outcomes use the same screen-plane geometry as the renderer. No scene or network dependencies.
export const RULES = Object.freeze({ seconds: 15, attempts: 3, closeMs: 180, openMs: 220, rearmMs: 260, maxGapMs: 300 });
export const TRAY = Object.freeze({ x: 3.85, y: -.8, halfX: 1.05, halfY: 1.3 });
export const GATE = Object.freeze({ x: .1, y: 1.7, halfX: .22, gap: .82, thickness: .18 });
export const TOYS = Object.freeze([
  { id: 'bear', name: 'Honey', x: -3.65, y: 1.6, radius: .52, aperture: .82, value: 100, color: '#e6a054' },
  { id: 'bunny', name: 'Mochi', x: -3.65, y: -.15, radius: .55, aperture: .85, value: 100, color: '#f1bbb0' },
  { id: 'star', name: 'Little star', x: -3.65, y: -1.85, radius: .32, aperture: .46, value: 200, color: '#ffc65c' },
]);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
// Swept circle against each visible rail, conservatively expanded at its corners.
function intersects(a, b, box, radius) {
  let lo = 0, hi = 1;
  for (const axis of ['x', 'y']) {
    const d = b[axis] - a[axis], min = box[axis] - box[axis === 'x' ? 'halfX' : 'halfY'] - radius;
    const max = box[axis] + box[axis === 'x' ? 'halfX' : 'halfY'] + radius;
    if (Math.abs(d) < 1e-9) { if (a[axis] < min || a[axis] > max) return false; }
    else { const t1 = (min - a[axis]) / d, t2 = (max - a[axis]) / d; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
  }
  return lo <= hi;
}
export class GlideGame {
  constructor() { this.reset(); }
  reset() {
    this.phase = 'menu'; this.toys = TOYS.map(t => ({ ...t, state: 'available' }));
    this.position = { x: -1.8, y: -.2 }; this.cargo = null; this.results = []; this.score = 0;
    this.remaining = RULES.seconds; this.gate = 'available'; this.event = null; this.sequence = 0;
  }
  start() { this.reset(); this.next(); }
  next() {
    if (this.results.length >= RULES.attempts) { this.phase = 'result'; return; }
    this.phase = 'position'; this.remaining = RULES.seconds; this.gate = 'available'; this.gateEntered = false;
    this.cargo = null; this.event = null;
  }
  emit(kind, extra = {}) { this.event = { kind, sequence: ++this.sequence, ...extra }; }
  target() {
    return this.toys.find(t => t.state === 'available' && Math.hypot(t.x - this.position.x, t.y - this.position.y) + t.radius <= t.aperture) || null;
  }
  grab() {
    if (this.phase !== 'position') return;
    const toy = this.target();
    if (!toy) { this.finish('miss'); return; }
    this.cargo = { id: toy.id, x: toy.x, y: toy.y, offsetX: toy.x - this.position.x, offsetY: toy.y - this.position.y };
    toy.state = 'held'; this.phase = 'carry'; this.emit('grab');
  }
  move(point, reducedMotion = false) {
    if (!['position', 'carry'].includes(this.phase)) return;
    const next = { x: clamp(point.x, -4.8, 4.8), y: clamp(point.y, -2.6, 2.6) };
    if (this.cargo) {
      const previous = { x: this.cargo.x, y: this.cargo.y };
      // Small authored deformation, never latency on the claw. Included in collision geometry.
      const swayX = reducedMotion ? 0 : clamp((this.position.x - next.x) * .15, -.07, .07);
      const swayY = reducedMotion ? 0 : clamp((this.position.y - next.y) * .15, -.07, .07);
      this.cargo.x = next.x + this.cargo.offsetX + swayX; this.cargo.y = next.y + this.cargo.offsetY + swayY;
      this.checkGate(previous, this.cargo);
    }
    this.position = next;
  }
  checkGate(a, b) {
    if (this.gate === 'failed') return;
    const r = this.toys.find(t => t.id === this.cargo.id).radius;
    for (const sign of [-1, 1]) {
      if (intersects(a, b, { x: GATE.x, y: GATE.y + sign * (GATE.gap + GATE.thickness / 2), halfX: GATE.halfX, halfY: GATE.thickness / 2 }, r)) {
        this.gate = 'failed'; this.emit('contact'); return;
      }
    }
    const left = GATE.x - GATE.halfX - r, right = GATE.x + GATE.halfX + r;
    if (a.x <= left && b.x > left) {
      const y = a.y + (b.y - a.y) * (left - a.x) / (b.x - a.x);
      this.gateEntered = Math.abs(y - GATE.y) + r <= GATE.gap;
    }
    if (this.gateEntered && b.x >= right) { this.gate = 'clean'; this.gateEntered = false; this.emit('gate'); }
    if (b.x <= left) this.gateEntered = false;
  }
  canBank() {
    if (!this.cargo) return false;
    const r = this.toys.find(t => t.id === this.cargo.id).radius;
    return Math.abs(this.cargo.x - TRAY.x) + r <= TRAY.halfX && Math.abs(this.cargo.y - TRAY.y) + r <= TRAY.halfY;
  }
  release() { if (this.phase === 'carry') this.finish(this.canBank() ? 'bank' : 'drop'); }
  tick(seconds) {
    if (!['position', 'carry'].includes(this.phase)) return;
    this.remaining = Math.max(0, this.remaining - seconds);
    if (this.remaining === 0) this.finish('timeout');
  }
  finish(kind) {
    if (!['position', 'carry'].includes(this.phase)) return;
    const toy = this.cargo && this.toys.find(t => t.id === this.cargo.id);
    const points = kind === 'bank' ? toy.value + (this.gate === 'clean' ? 50 : 0) : 0;
    if (toy) { toy.state = kind === 'bank' ? 'banked' : 'dropped'; toy.x = this.cargo.x; toy.y = this.cargo.y; }
    this.score += points; this.results.push({ kind, toy: toy?.id || null, points, bonus: points && this.gate === 'clean' ? 50 : 0 });
    this.phase = 'outcome'; this.emit(kind, { points });
  }
}
