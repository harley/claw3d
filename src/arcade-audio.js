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

// Collection preview: a restrained wind-up, then a deliberately larger payoff.
// All voices use the existing master/mute and cancellation lifecycle. These
// original phrases end before the next aiming turn and never choose a result.
export function playCollectionCue(audio, kind) {
  const n = (...args) => audio.note(...args);
  const chord = (frequencies, delay, duration, level = .016) => frequencies.forEach(f => n(f, duration, delay, 'triangle', f, level));
  if (kind === 'anticipate') {
    n(92, .20, 0, 'sine', 45, .08);
    n(880, .22, 0, 'square', 110, .018);
  } else if (kind === 'descend') {
    [220, 196, 165].forEach((f, i) => n(f, .14, i * .19, 'triangle', f * .75, .016));
  } else if (kind === 'grip') {
    n(85, .18, 0, 'sine', 42, .07);
    // A rising, unresolved pair builds tension without announcing a catch.
    chord([220, 233], .15, .23, .012);
    chord([294, 311], .43, .24, .014);
  } else if (kind === 'ordinary' || kind === 'perfect') {
    n(110, .32, 0, 'sine', 55, .10);
    chord([262, 330, 392], .02, .38, .025);
    const melody = kind === 'perfect' ? [523, 659, 784, 1047, 1319, 1568] : [392, 523, 659, 784];
    melody.forEach((f, i) => n(f, i === melody.length - 1 ? .40 : .15, .12 + i * .12, 'square', f, .018));
    if (kind === 'perfect') {
      n(165, .40, .42, 'triangle', 165, .024);
      chord([523, 659, 784], .72, .48, .020);
    }
  } else if (kind === 'touch') {
    // A gentle acknowledgement for real contact, distinct from a caught toy.
    n(262, .16, 0, 'triangle', 262, .022);
    n(330, .24, .15, 'triangle', 330, .018);
  } else if (kind === 'miss') {
    n(90, .20, 0, 'sine', 38, .09);
    [330, 247, 165].forEach((f, i) => n(f, .24, i * .18, 'sawtooth', f * .78, .021));
    n(110, .25, .42, 'triangle', 73, .025);
  } else if (kind === 'release') {
    n(740, .10, 0, 'sine', 740, .012);
  } else if (kind === 'deliver') {
    chord([392, 523, 659], 0, .32, .012);
  }
}
