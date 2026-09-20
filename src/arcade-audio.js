// Original finite synthesized cues. Sound preference and browser activation are separate.
// A suspended context never accumulates notes for a later burst.
export function createArcadeAudio({ onChange = () => {}, enabledByDefault = false } = {}) {
  let enabled = enabledByDefault, volume = .5, context = null, master = null, activation = 0;
  const activeNotes = new Map();
  function silence() {
    for (const [oscillator, gain] of activeNotes) { oscillator.stop(); oscillator.disconnect(); gain.disconnect(); }
    activeNotes.clear();
  }
  function apply() {
    if (master) master.gain.setValueAtTime(enabled ? volume : 0, context.currentTime);
    if (!enabled || !volume) silence();
  }
  function note(frequency, duration = .12, delay = 0, type = 'square', endFrequency = frequency, level = .025) {
    if (!enabled || !volume || !master || context.state !== 'running') return;
    try {
      const t = context.currentTime + delay, oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, t);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
      gain.gain.setValueAtTime(.001, t); gain.gain.linearRampToValueAtTime(level, t + .005);
      gain.gain.exponentialRampToValueAtTime(.001, t + duration);
      oscillator.connect(gain); gain.connect(master); activeNotes.set(oscillator, gain);
      oscillator.onended = () => { activeNotes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(t); oscillator.stop(t + duration);
      return () => {
        if (!activeNotes.delete(oscillator)) return;
        oscillator.stop(); oscillator.disconnect(); gain.disconnect();
      };
    } catch { enabled = false; apply(); onChange(); }
  }
  // Original major-key fanfares; every phrase is finite.
  function fanfare(kind) {
    const scores = {
      drop: [587, 740, 880, 1175, 880, 1175],
      shelf: [587, 740, 880, 740, 988, 1175, 1480, 1175],
      complete: [587, 587, 740, 880, 1175, 988, 1175, 1480, 1760],
    };
    const melody = scores[kind], beat = kind === 'drop' ? .13 : .22;
    melody.forEach((frequency, i) => {
      const duration = i === melody.length - 1 ? .5 : beat * .85;
      note(frequency, duration, i * beat, 'square', frequency, .014);
      if (i % 2 === 0) note(i % 4 ? 220 : 147, beat * 1.6, i * beat, 'triangle', i % 4 ? 220 : 147, .007);
    });
  }
  function unlock() {
    if (!enabled) return;
    const current = ++activation;
    try {
      context ??= new AudioContext();
      if (!master) { master = context.createGain(); master.connect(context.destination); }
      context.onstatechange = () => onChange();
      context.resume().then(() => { if (current === activation) onChange(); }).catch(() => onChange());
    } catch { enabled = false; }
    apply(); onChange();
  }
  function toggle() {
    enabled = !enabled;
    if (enabled) unlock();
    else { ++activation; apply(); onChange(); }
    note(523);
  }
  function setVolume(value) { volume = value; apply(); onChange(); }
  return { note, fanfare, silence, toggle, unlock, setVolume, get ready() { return Boolean(context && context.state === 'running'); }, get enabled() { return enabled; }, get volume() { return volume; } };
}
