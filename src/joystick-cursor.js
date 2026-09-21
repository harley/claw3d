import { handOffset, projectHandWorkspace } from './hand-workspace.js';
// Presentation owns the screen target; camera input only receives hit-test results.
function createGlove(id, screen) {
  const root = document.createElement('div');
  root.id = id; root.className = 'joystick-cursor'; root.hidden = true; root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `<svg viewBox="0 0 110 130"><g stroke="#183247" stroke-width="3" stroke-linejoin="round"><path class="glove-forearm" fill="#2385aa" d="M34 108L8 310Q55 327 104 310L78 108Z"/><path fill="#59e5f2" d="M32 103h48v21H32z"/><path fill="#edfaff" d="M29 58Q20 84 36 105h40q18-13 12-44z"/><g class="glove-fingers" fill="none" stroke="#183247" stroke-width="19" stroke-linecap="round"></g><g class="glove-skin" fill="none" stroke="#edfaff" stroke-width="13" stroke-linecap="round"></g><path class="glove-thumb" fill="none" stroke="#183247" stroke-width="22" stroke-linecap="round"/><path class="glove-thumb-skin" fill="none" stroke="#edfaff" stroke-width="16" stroke-linecap="round"/><path fill="none" stroke="#b7d4e0" d="M43 85l3 10m12-12v12m13-14l-2 12"/></g></svg>`;
  document.body.append(root);
  const outlines = root.querySelector('.glove-fingers'), skin = root.querySelector('.glove-skin');
  for (let i = 0; i < 4; i++) { outlines.insertAdjacentHTML('beforeend', '<path/>'); skin.insertAdjacentHTML('beforeend', '<path/>'); }
  let curl = 0;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  return { update(feedback, visible, dt, targets, left = false) {
      const reduced = motionPreference.matches;
      root.classList.toggle('has-forearm', left);
      root.querySelector('svg').style.transform = left ? 'scaleX(-1)' : '';
      root.hidden = !visible || !feedback.pointer || !['tracking', 'clenching', 'calibrating', 'slamming'].includes(feedback.kind);
      if (root.hidden) { curl = 0; return; }
      const stage = feedback.grab?.stage;
      const slamming = stage === 'slamming', charging = stage === 'charging';
      const attached = stage === 'gripped';
      const target = slamming || charging ? 0 : stage === 'grabbing' ? feedback.progress : stage === 'gripped' ? 1 : stage === 'pressing' ? feedback.progress : feedback.closed ? .85 : 0;
      curl += (target - curl) * (reduced ? 1 : Math.min(1, dt * 22));
      root.style.width = `${attached ? Math.max(44, Math.min(65, targets.stick.radius * 1.35)) : Math.min(stage === 'pressing' ? 55 : 65, Math.max(44, targets.drop.radius * 1.6))}px`;
      root.style.height = 'auto';
      root.style.opacity = feedback.outside ? '.35' : '1';
      const p = feedback.workspace ? projectHandWorkspace(feedback.workspace, left ? 'left' : 'right', targets) : screen(feedback.pointer), anchor = stage === 'pressing' ? targets.drop : targets.stick;
      const dock = attached ? 1 : ['grabbing', 'pressing'].includes(stage) ? feedback.progress : 0;
      root.style.left = `${p.x + (anchor.x - p.x) * dock}px`;
      root.style.top = `${slamming ? targets.drop.y - (reduced ? 0 : (feedback.slamProgress < .35 ? 30 + 55 * Math.sin(feedback.slamProgress / .35 * Math.PI / 2) : 85 * (1 - ((feedback.slamProgress - .35) / .65) ** 2)) * Math.min(1, innerHeight / 800)) : charging ? targets.drop.y - 30 : p.y + (anchor.y + (attached ? 10 : 0) - p.y) * dock}px`;
      if (slamming || charging) root.style.left = `${targets.drop.x}px`;
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

export function createJoystickCursor(getTargets = () => null, onDrop = () => {}) {
  const screen = p => ({ x: Math.max(0, Math.min(1, (p.x - .18) / .64)) * innerWidth, y: Math.max(0, Math.min(1, (p.y - .15) / .70)) * innerHeight });
  const button = document.createElement('button');
  button.id = 'machine-drop'; button.hidden = true; button.setAttribute('aria-label', 'Drop claw');
  button.addEventListener('click', onDrop); document.body.append(button);
  const left = createGlove('joystick-cursor', screen);
  const right = createGlove('right-hand-cursor', screen);
  return {
    targetAt(pointer, role, origin) {
      const targets = getTargets();
      if (!pointer || !targets || button.hidden) return {};
      const p = role ? projectHandWorkspace(handOffset(pointer, origin), role, targets) : screen(pointer), { stick, drop } = targets;
      const overTarget = Math.hypot(p.x - stick.x, p.y - stick.y) < stick.radius;
      const overDrop = Math.hypot((p.x - drop.x) / drop.radius, (p.y - drop.y) / drop.radius) < 1;
      const aboveDrop = Math.abs(p.x - drop.x) < drop.radius && p.y < drop.y - drop.radius && p.y > drop.y - drop.radius - innerHeight * .20;
      const nearDrop = role === 'right' && Math.hypot(p.x - drop.x, p.y - drop.y) < drop.radius * 1.5;
      return { overTarget, overDrop, aboveDrop, nearDrop };
    },
    update(feedback, visible, dt) {
      const targets = getTargets();
      button.hidden = !visible || !targets;
      if (targets) {
        const d = targets.drop;
        button.dataset.ready = String(Boolean(d.ready));
        const pressing = feedback.profile === 'dual' ? feedback.controlEnabled && feedback.kind === 'clenching' && feedback.grab?.stage === 'charging' : feedback.profile === 'grab-release' ? feedback.grab?.stage === 'pressing' : feedback.kind === 'clenching';
        button.dataset.charging = String(feedback.profile === 'dual' && pressing);
        button.style.setProperty('--hold', pressing ? feedback.progress || 0 : 0);
        Object.assign(button.style, { left: `${d.x - d.radius}px`, top: `${d.y - d.radius}px`, width: `${d.radius * 2}px`, height: `${d.radius * 2}px` });
      }
      const dual = feedback.profile === 'dual';
      const fresh = !['delayed', 'off', 'error', 'blocked', 'accepted'].includes(feedback.kind);
      left.update(dual ? feedback.hands?.left || {} : feedback, visible && fresh && !!targets, dt, targets, dual);
      right.update(feedback.kind === 'slamming' ? { ...feedback.hands?.right, pointer: feedback.hands?.right?.pointer || { x: .75, y: .5 }, kind: 'slamming', grab: { stage: 'slamming' }, slamProgress: feedback.slamProgress } : feedback.hands?.right || {}, visible && fresh && dual && !!targets, dt, targets);
    }
  };
}
