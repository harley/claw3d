export const PERFORMANCE_WINDOW_MS = 5000;

export class PerformanceGovernor {
  constructor({ onChange = () => {}, badWindows = 2, goodWindows = 6 } = {}) {
    Object.assign(this, { onChange, badWindows, goodWindows });
    this.mode = 'full';
    this.source = 'auto';
    this.bad = 0;
    this.good = 0;
  }

  observe({ averageFps, resultHz, results = 0, rejected = 0 }) {
    if (this.source === 'operator') return this.mode;
    const cameraSamples = results + rejected;
    const rejectRate = cameraSamples ? rejected / cameraSamples : 0;
    const slow = averageFps < 24 || (cameraSamples >= 10 && (resultHz < 8 || rejectRate >= .15));
    const healthy = averageFps >= 27 && (!cameraSamples || (resultHz >= 12 && rejectRate < .05));

    if (slow) { this.bad++; this.good = 0; }
    else if (healthy) { this.good++; this.bad = 0; }
    else { this.bad = 0; this.good = 0; }

    if (this.mode === 'full' && this.bad >= this.badWindows) this.setMode('simple');
    else if (this.mode === 'simple' && this.good >= this.goodWindows) this.setMode('full');
    return this.mode;
  }

  setMode(mode, source = 'auto') {
    if (mode === this.mode && source === this.source) return;
    this.mode = mode;
    this.source = source;
    this.bad = 0;
    this.good = 0;
    this.onChange(mode, source);
  }
}
