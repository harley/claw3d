// Presentation owns the screen target; camera input only receives hit-test results.
export function createJoystickCursor() {
  const root = document.createElement('div');
  root.id = 'joystick-cursor'; root.hidden = true; root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `<svg viewBox="0 0 110 130"><g stroke="#183247" stroke-width="3" stroke-linejoin="round"><path fill="#59e5f2" d="M32 103h48v21H32z"/><path fill="#edfaff" d="M29 58Q20 84 36 105h40q18-13 12-44z"/><g class="glove-fingers" fill="none" stroke="#183247" stroke-width="19" stroke-linecap="round"></g><g class="glove-skin" fill="none" stroke="#edfaff" stroke-width="13" stroke-linecap="round"></g><path class="glove-thumb" fill="none" stroke="#183247" stroke-width="22" stroke-linecap="round"/><path class="glove-thumb-skin" fill="none" stroke="#edfaff" stroke-width="16" stroke-linecap="round"/><path fill="none" stroke="#b7d4e0" d="M43 85l3 10m12-12v12m13-14l-2 12"/></g></svg>`;
  document.body.append(root);
  const outlines = root.querySelector('.glove-fingers'), skin = root.querySelector('.glove-skin');
  for (let i = 0; i < 4; i++) { outlines.insertAdjacentHTML('beforeend', '<path/>'); skin.insertAdjacentHTML('beforeend', '<path/>'); }
  const screen = p => ({ x: Math.max(0, Math.min(1, (p.x - .18) / .64)) * innerWidth, y: Math.max(0, Math.min(1, (p.y - .15) / .70)) * innerHeight });
  let curl = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    canGrab(pointer) {
      if (!pointer || document.getElementById('control-deck').hidden) return false;
      const p = screen(pointer), r = document.querySelector('.stick-base').getBoundingClientRect();
      return p.x >= r.left - 30 && p.x <= r.right + 30 && p.y >= r.top - 30 && p.y <= r.bottom + 30;
    },
    update(feedback, visible, dt) {
      root.hidden = !visible || !feedback.pointer || !['tracking', 'clenching'].includes(feedback.kind);
      if (root.hidden) { curl = 0; return; }
      const stage = feedback.grab?.stage;
      const attached = ['gripped', 'releasing'].includes(stage);
      const target = stage === 'grabbing' ? feedback.progress : stage === 'gripped' ? 1 : stage === 'releasing' ? 1 - feedback.progress : feedback.closed ? .85 : 0;
      curl += (target - curl) * (reduced ? 1 : Math.min(1, dt * 22));
      const p = screen(feedback.pointer), r = document.getElementById('deck-stick').getBoundingClientRect();
      const dock = attached ? 1 : stage === 'grabbing' ? feedback.progress : 0;
      root.style.left = `${p.x + (r.left + r.width / 2 - p.x) * dock}px`;
      root.style.top = `${p.y + (r.top + r.height / 2 - p.y) * dock}px`;
      root.dataset.stage = stage || 'seeking';
      for (let i = 0; i < 4; i++) {
        const x = 33 + i * 15, top = [27, 15, 20, 35][i];
        const d = `M${x} 68 Q${x - 3 * curl} ${top + (43 - top) * curl} ${x + 2 * curl} ${top + (65 - top) * curl}`;
        outlines.children[i].setAttribute('d', d); skin.children[i].setAttribute('d', d);
      }
      const thumb = `M29 82 Q${12 + 21 * curl} ${55 + 4 * curl} ${14 + 48 * curl} ${53 + 24 * curl}`;
      root.querySelector('.glove-thumb').setAttribute('d', thumb); root.querySelector('.glove-thumb-skin').setAttribute('d', thumb);
    }
  };
}
