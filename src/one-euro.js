// One-euro filter (Casiez et al. 2012): jitter-free when still, tight when moving.
// Tuned for normalized hand coordinates arriving at camera result rate.
const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

class OneEuroAxis {
  constructor(minCutoff, beta, dCutoff) { Object.assign(this, { minCutoff, beta, dCutoff, value: null, slope: 0 }); }
  filter(raw, dt) {
    if (this.value === null || dt <= 0) { this.value = raw; this.slope = 0; return raw; }
    const slope = (raw - this.value) / dt;
    this.slope += (slope - this.slope) * alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.slope);
    this.value += (raw - this.value) * alpha(cutoff, dt);
    return this.value;
  }
}

export class OneEuroPoint {
  constructor({ minCutoff = 1.2, beta = 12, dCutoff = 1.5 } = {}) {
    this.x = new OneEuroAxis(minCutoff, beta, dCutoff);
    this.y = new OneEuroAxis(minCutoff, beta, dCutoff);
    this.last = 0;
  }
  reset() { this.x.value = null; this.y.value = null; this.last = 0; }
  filter(point, now) {
    // A long gap means a fresh track: snap to the new position instead of
    // dragging the cursor across the interruption.
    const dt = this.last && now - this.last < 300 ? (now - this.last) / 1000 : 0;
    this.last = now;
    return { x: this.x.filter(point.x, dt), y: this.y.filter(point.y, dt) };
  }
  // Where the hand will be `ms` from the last sample, from the filtered slope.
  // Covers capture-to-control latency; null until a sample exists.
  predict(ms) {
    if (this.x.value === null) return null;
    return { x: this.x.value + this.x.slope * ms / 1000, y: this.y.value + this.y.slope * ms / 1000 };
  }
}
