// Presentation owns the screen target; camera input only receives hit-test results.
export function createJoystickCursor(getTargets = () => null, onDrop = () => {}) {
  const root = document.createElement('div');
  root.id = 'joystick-cursor'; root.hidden = true; root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `<svg viewBox="0 0 110 130"><g stroke="#183247" stroke-width="3" stroke-linejoin="round"><path fill="#59e5f2" d="M32 103h48v21H32z"/><path fill="#edfaff" d="M29 58Q20 84 36 105h40q18-13 12-44z"/><g class="glove-fingers" fill="none" stroke="#183247" stroke-width="19" stroke-linecap="round"></g><g class="glove-skin" fill="none" stroke="#edfaff" stroke-width="13" stroke-linecap="round"></g><path class="glove-thumb" fill="none" stroke="#183247" stroke-width="22" stroke-linecap="round"/><path class="glove-thumb-skin" fill="none" stroke="#edfaff" stroke-width="16" stroke-linecap="round"/><path fill="none" stroke="#b7d4e0" d="M43 85l3 10m12-12v12m13-14l-2 12"/></g></svg>`;
  document.body.append(root);
  const outlines = root.querySelector('.glove-fingers'), skin = root.querySelector('.glove-skin');
  for (let i = 0; i < 4; i++) { outlines.insertAdjacentHTML('beforeend', '<path/>'); skin.insertAdjacentHTML('beforeend', '<path/>'); }
  const screen = p => ({ x: Math.max(0, Math.min(1, (p.x - .18) / .64)) * innerWidth, y: Math.max(0, Math.min(1, (p.y - .15) / .70)) * innerHeight });
  const button = document.createElement('button');
  button.id = 'machine-drop'; button.hidden = true; button.setAttribute('aria-label', 'Drop claw');
  button.addEventListener('click', onDrop); document.body.append(button);
  let curl = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    targetAt(pointer) {
      const targets = getTargets();
      if (!pointer || !targets || button.hidden) return {};
      const p = screen(pointer), { stick, drop } = targets;
      const overTarget = Math.hypot(p.x - stick.x, p.y - stick.y) < stick.radius;
      const overDrop = Math.hypot((p.x - drop.x) / drop.radius, (p.y - drop.y) / drop.radius) < 1;
      const aboveDrop = Math.abs(p.x - drop.x) < drop.radius && p.y < drop.y - drop.radius && p.y > drop.y - drop.radius - innerHeight * .20;
      return { overTarget, overDrop, aboveDrop };
    },
    update(feedback, visible, dt) {
      const targets = getTargets();
      button.hidden = !visible || !targets;
      if (targets) {
        const d = targets.drop;
        Object.assign(button.style, { left: `${d.x - d.radius}px`, top: `${d.y - d.radius}px`, width: `${d.radius * 2}px`, height: `${d.radius * 2}px` });
      }
      root.hidden = !visible || !feedback.pointer || !['tracking', 'clenching'].includes(feedback.kind);
      if (root.hidden) { curl = 0; return; }
      const stage = feedback.grab?.stage;
      const attached = stage === 'gripped';
      const target = stage === 'grabbing' ? feedback.progress : stage === 'gripped' ? 1 : stage === 'pressing' ? feedback.progress : feedback.closed ? .85 : 0;
      curl += (target - curl) * (reduced ? 1 : Math.min(1, dt * 22));
      const p = screen(feedback.pointer), anchor = stage === 'pressing' ? targets.drop : targets.stick;
      const dock = attached ? 1 : ['grabbing', 'pressing'].includes(stage) ? feedback.progress : 0;
      root.style.left = `${p.x + (anchor.x - p.x) * dock}px`;
      root.style.top = `${p.y + (anchor.y - p.y) * dock}px`;
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
