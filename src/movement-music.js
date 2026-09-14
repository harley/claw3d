// Local audition: original, quiet eighth-note melody while camera control is active.
// No timer runs outside the animation loop and no phrase is queued ahead.
export function createMovementMusic(audio) {
  const melody = [523, 659, 784, 659, 587, 698, 880, 698, 659, 784, 988, 784, 587, 698, 784, 587];
  let beat = 0, remaining = 0, cancellations = [];
  function stop() {
    cancellations.forEach(cancel => cancel?.());
    cancellations = []; beat = 0; remaining = 0;
  }
  function update(active, dt) {
    if (!active || !audio.enabled || !audio.volume) { stop(); return; }
    remaining -= dt;
    if (remaining > 0) return;
    cancellations.forEach(cancel => cancel?.());
    const frequency = melody[beat % melody.length];
    cancellations = [audio.note(frequency, .18, 0, 'triangle', frequency, .009)];
    if (beat % 2 === 0) {
      const bass = [131, 147, 165, 147][Math.floor(beat / 4) % 4];
      cancellations.push(audio.note(bass, .16, 0, 'triangle', bass, .004));
    }
    beat++; remaining = .22;
  }
  return { update, stop };
}
