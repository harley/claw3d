import { menuScreenPoint } from './steering.js';
// Only player-facing actions participate. Operator controls never accept gestures.
const actions = {
  idle: ['play', 'mode-one', 'mode-two', 'result-open'],
  resume: ['play'],
  registration: ['register-play', 'register-cancel'],
  final: ['play-again', 'next-player', 'final-leaderboard'],
};
export function createHandMenu({ leftHand = false } = {}) {
  const cursor = document.createElement('div');
  cursor.id = 'hand-cursor'; cursor.hidden = true; cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<svg viewBox="0 0 64 64"><circle class="cursor-track" cx="32" cy="32" r="29"/><circle class="cursor-progress" cx="32" cy="32" r="29"/><path class="cursor-hand" d="M22 35V19q0-5 4-5t4 5v12-18q0-5 4-5t4 5v18-15q0-5 4-5t4 5v17-10q0-5 4-5t4 5v20q0 17-17 17h-3q-8 0-12-8l-9-14q-3-6 3-7 3 0 6 6z"/></svg>';
  const fist = '<path class="cursor-fist" d="M17 36V26q0-5 4-5t4 5v-5q0-5 4-5t4 5v-1q0-5 4-5t4 5v3q0-5 4-5t4 5v18q0 15-15 15h-3q-10 0-14-10l-5-9q-2-5 2-6 3-1 6 5z"/>';
  cursor.querySelector('svg').insertAdjacentHTML('beforeend', fist);
  cursor.insertAdjacentHTML('beforeend', '<span class="cursor-cue">Clench to select</span>');
  const guide = document.createElement('div');
  guide.id = 'menu-guide'; guide.hidden = true;
  guide.innerHTML = `<span class="menu-guide-hand" aria-hidden="true">✋</span><strong>${leftHand ? 'Raise your left hand' : 'Raise your hand'}</strong>`;
  document.body.append(cursor, guide);
  let mode = '', hovered = null, locked = null, holding = false;
  const clearCursor = () => {
    hovered?.classList.remove('hand-hover'); hovered = locked = null; holding = false;
    cursor.hidden = true; cursor.classList.remove('targeting', 'demonstrating', 'clenching');
    cursor.style.setProperty('--hold', 0);
  };
  const clear = () => { clearCursor(); guide.hidden = true; };
  function eligible(id) {
    const button = document.getElementById(id);
    return button && !button.disabled && button.getClientRects().length && !button.hidden ? button : null;
  }
  return {
    update(nextMode, feedback, { showGuide = true } = {}) {
      if (mode !== nextMode) { clear(); mode = nextMode; }
      const valid = actions[mode] && feedback.controlEnabled && ['tracking', 'clenching'].includes(feedback.kind) && feedback.pointer;
      const parent = document.querySelector('dialog[open]') || document.getElementById('arcade');
      if (guide.parentElement !== parent) parent.prepend(guide);
      // Use the adapter's existing freshness/loss state; never infer hand evidence
      // from this illustration or add a second recognition timer.
      guide.hidden = !actions[mode] || !showGuide || !['ready', 'calibrating', 'lost', 'tracking', 'clenching'].includes(feedback.kind);
      guide.classList.toggle('tracked', Boolean(valid));
      guide.setAttribute('aria-hidden', String(guide.hidden || Boolean(valid)));
      if (!valid) { clearCursor(); return; }
      if (cursor.parentElement !== parent) parent.append(cursor);
      if (hovered && eligible(hovered.id) !== hovered) clearCursor();
      cursor.hidden = false;
      const clenching = feedback.kind === 'clenching' && feedback.progress > 0;
      if (clenching && !holding) locked = hovered;
      if (!clenching) {
        locked = null;
        const { x, y } = menuScreenPoint(feedback.pointer, innerWidth, innerHeight);
        cursor.style.left = `${x}px`; cursor.style.top = `${y}px`;
        cursor.style.setProperty('--label-offset', `${Math.max(83 - x, Math.min(0, innerWidth - 83 - x))}px`);
        cursor.classList.toggle('cue-above', y > innerHeight / 2);
        const target = document.elementFromPoint(x, y)?.closest('button');
        const next = actions[mode].map(eligible).find(button => button && button === target) || null;
        if (hovered !== next) { hovered?.classList.remove('hand-hover'); hovered = next; hovered?.classList.add('hand-hover'); }
      }
      holding = clenching;
      cursor.classList.toggle('targeting', Boolean(hovered));
      cursor.classList.toggle('clenching', feedback.kind === 'clenching');
      cursor.classList.toggle('demonstrating', Boolean(hovered) && feedback.kind === 'tracking');
      cursor.style.setProperty('--hold', clenching && locked ? feedback.progress : 0);
    },
    confirm(currentMode, feedback) {
      if (!feedback.controlEnabled || feedback.kind !== 'clenching' || !feedback.pointer) { clear(); return false; }
      if (!holding || !locked || mode !== currentMode || !actions[mode]?.includes(locked.id) || eligible(locked.id) !== locked) return false;
      const target = locked; clear(); target.click(); return true;
    },
    clear,
  };
}
export function generatedName() {
  const animals = [
    ['🦀', ['Coral', 'Pebble', 'Cove']],
    ['🦊', ['Ember', 'Rusty', 'Maple']],
    ['🐻', ['Kuma', 'Chestnut', 'Cocoa']],
    ['🐱', ['Miso', 'Sesame', 'Socks']],
    ['🐰', ['Mochi', 'Clover', 'Taro']],
    ['🦦', ['Ripple', 'River', 'Nori']],
    ['🐧', ['Pip', 'Waddle', 'Pogo']],
    ['🐉', ['Jade', 'Flint', 'Ash']],
  ];
  const values = crypto.getRandomValues(new Uint32Array(2));
  const [emoji, names] = animals[values[0] % animals.length];
  return `${emoji} ${names[values[1] % names.length]}`;
}
