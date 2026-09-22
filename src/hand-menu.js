import { menuScreenPoint } from './steering.js';
// Only player-facing actions participate. Operator controls never accept gestures.
const actions = {
  idle: ['play', 'mode-one', 'mode-two', 'result-open'],
  resume: ['play'],
  registration: ['register-play', 'register-cancel'],
  final: ['play-again', 'next-player', 'final-leaderboard'],
};
export function createHandMenu() {
  const cursor = document.createElement('div');
  cursor.id = 'hand-cursor'; cursor.hidden = true; cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<svg viewBox="0 0 64 64"><circle class="cursor-track" cx="32" cy="32" r="29"/><circle class="cursor-progress" cx="32" cy="32" r="29"/><path class="cursor-hand" d="M22 35V19q0-5 4-5t4 5v12-18q0-5 4-5t4 5v18-15q0-5 4-5t4 5v17-10q0-5 4-5t4 5v20q0 17-17 17h-3q-8 0-12-8l-9-14q-3-6 3-7 3 0 6 6z"/></svg>';
  document.body.append(cursor);
  let mode = '', hovered = null, locked = null, holding = false;
  const clear = () => { hovered?.classList.remove('hand-hover'); hovered = locked = null; holding = false; cursor.hidden = true; };
  function eligible(id) {
    const button = document.getElementById(id);
    return button && !button.disabled && button.getClientRects().length && !button.hidden ? button : null;
  }
  return {
    update(nextMode, feedback) {
      if (mode !== nextMode) { clear(); mode = nextMode; }
      const valid = actions[mode] && feedback.controlEnabled && ['tracking', 'clenching'].includes(feedback.kind) && feedback.pointer;
      if (!valid) { clear(); return; }
      const parent = document.querySelector('dialog[open]') || document.body;
      if (cursor.parentElement !== parent) parent.append(cursor);
      cursor.hidden = false;
      const clenching = feedback.kind === 'clenching' && feedback.progress > 0;
      if (clenching && !holding) locked = hovered;
      if (!clenching) {
        locked = null;
        const { x, y } = menuScreenPoint(feedback.pointer, innerWidth, innerHeight);
        cursor.style.left = `${x}px`; cursor.style.top = `${y}px`;
        const target = document.elementFromPoint(x, y)?.closest('button');
        const next = actions[mode].map(eligible).find(button => button && button === target) || null;
        if (hovered !== next) { hovered?.classList.remove('hand-hover'); hovered = next; hovered?.classList.add('hand-hover'); }
      }
      holding = clenching;
      cursor.classList.toggle('targeting', Boolean(hovered));
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
