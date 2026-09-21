import { handOffset, projectHandWorkspace } from './hand-workspace.js';
// Presentation owns the screen target; camera input only receives hit-test results.
function createGlove(id, screen) {
  const root = document.createElement('div');
  root.id = id; root.className = 'joystick-cursor'; root.hidden = true; root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `<svg viewBox="0 0 110 130"><g stroke="#183247" stroke-width="3" stroke-linejoin="round"><path class="glove-forearm" fill="#2385aa" d="M34 108L8 310Q55 327 104 310L78 108Z"/><path fill="#59e5f2" d="M32 103h48v21H32z"/><path fill="#edfaff" d="M29 58Q20 84 36 105h40q18-13 12-44z"/><g class="glove-fingers" fill="none" stroke="#183247" stroke-width="19" stroke-linecap="round"></g><g class="glove-skin" fill="none" stroke="#edfaff" stroke-width="13" stroke-linecap="round"></g><path class="glove-thumb" fill="none" stroke="#183247" stroke-width="22" stroke-linecap="round"/><path class="glove-thumb-skin" fill="none" stroke="#edfaff" stroke-width="16" stroke-linecap="round"/><path fill="none" stroke="#b7d4e0" d="M43 85l3 10m12-12v12m13-14l-2 12"/></g></svg>`;
  // Dorsal view: the thumb sits behind the palm, never across the knuckles.
  root.insertAdjacentHTML('beforeend', `<svg class="dorsal-art" viewBox="0 0 110 130"><defs>
    <linearGradient id="${id}-skin" gradientUnits="userSpaceOnUse" x1="20" y1="55" x2="90" y2="75"><stop stop-color="#b97854"/><stop offset=".38" stop-color="#f3c7a5"/><stop offset=".72" stop-color="#e9b38c"/><stop offset="1" stop-color="#c58b65"/></linearGradient>
    <linearGradient id="${id}-sleeve"><stop stop-color="#133f55"/><stop offset=".48" stop-color="#347f97"/><stop offset="1" stop-color="#17485f"/></linearGradient>
  </defs>
  <path class="curved-arm" fill="url(#${id}-sleeve)" stroke="#102c3d" stroke-width="2" d="M39 107 C34 143 49 165 73 190 C93 212 103 242 101 270 L137 270 C137 231 118 199 96 177 C75 155 72 133 72 107Z"/>
  <path fill="url(#${id}-skin)" stroke="#a56d4e" stroke-width="1.5" d="M40 86 L39 115 Q55 123 73 115 L71 84Z"/>
  <path class="dorsal-thumb" fill="url(#${id}-skin)" stroke="#a56d4e" stroke-width="1.5"/>
  <g class="dorsal-fingers" fill="none" stroke="url(#${id}-skin)" stroke-width="15" stroke-linecap="round"></g>
  <path class="dorsal-palm" fill="url(#${id}-skin)" stroke="#a56d4e" stroke-width="1.3" d="M27 54 Q29 45 40 47 L78 48 Q88 52 87 65 L79 87 Q73 100 69 104 L42 104 Q30 89 27 73Z"/>
  <g class="knuckle-lines" fill="none" stroke="#b97d5b" stroke-width="1.5" stroke-linecap="round"><path d="M35 58q4-3 8 0m5-3q4-3 8 0m6 0q4-3 8 0m4 5q4-3 8 0"/><path stroke="#ffe1c5" stroke-width="2" d="M43 70q2 14 7 20m11-21q-1 13 2 19"/></g>
  <path fill="url(#${id}-sleeve)" stroke="#102c3d" stroke-width="2" d="M37 108 Q55 114 75 108 L76 119 Q55 126 36 118Z"/>
  </svg>`);
  document.body.append(root);
  const outlines = root.querySelector('.glove-fingers'), skin = root.querySelector('.glove-skin');
  for (let i = 0; i < 4; i++) { outlines.insertAdjacentHTML('beforeend', '<path/>'); skin.insertAdjacentHTML('beforeend', '<path/>'); }
  const dorsal = root.querySelector('.dorsal-art');
  for (let i = 0; i < 4; i++) dorsal.querySelector('.dorsal-fingers').insertAdjacentHTML('beforeend', '<path/>');
  let curl = 0;
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  return { update(feedback, visible, dt, targets, role = null) {
      const reduced = motionPreference.matches, left = role === 'left', dual = Boolean(role);
      root.classList.toggle('dorsal-hand', dual);
      root.classList.toggle('has-forearm', left);
      const slam = feedback.grab?.stage === 'slamming';
      const contact = slam && feedback.slamProgress >= 1;
      dorsal.style.transform = `scaleX(${left ? -1 : 1}) rotate(${reduced ? 0 : slam ? -8 * Math.sin(Math.PI * feedback.slamProgress) : left ? -8 : -5}deg) scaleY(${contact && !reduced ? .91 : 1})`;
      root.querySelector('svg').style.transform = left ? 'scaleX(-1)' : '';
      root.hidden = !visible || !feedback.pointer || !['tracking', 'clenching', 'calibrating', 'slamming'].includes(feedback.kind);
      if (root.hidden) { curl = 0; return; }
      const stage = feedback.grab?.stage;
      const slamming = stage === 'slamming', charging = stage === 'charging';
      const attached = stage === 'gripped';
      const target = slamming || charging ? 0 : stage === 'grabbing' ? feedback.progress : stage === 'gripped' ? 1 : stage === 'pressing' ? feedback.progress : feedback.closed ? .85 : 0;
      curl += (target - curl) * (reduced ? 1 : Math.min(1, dt * 22));
      root.style.width = `${dual ? Math.max(60, Math.min(left ? 102 : 112, (left ? targets.stick.radius * 2 : targets.drop.radius * 2.7))) : attached ? Math.max(44, Math.min(65, targets.stick.radius * 1.35)) : Math.min(stage === 'pressing' ? 55 : 65, Math.max(44, targets.drop.radius * 1.6))}px`;
      root.style.height = 'auto';
      root.style.opacity = feedback.outside ? '.35' : '1';
      const p = feedback.workspace ? projectHandWorkspace(feedback.workspace, left ? 'left' : 'right', targets) : screen(feedback.pointer), anchor = stage === 'pressing' ? targets.drop : targets.stick;
      const dock = attached ? 1 : ['grabbing', 'pressing'].includes(stage) ? feedback.progress : 0;
      root.style.left = `${p.x + (anchor.x - p.x) * dock}px`;
      const rightDocked = role === 'right';
      const hover = Math.min(14, targets.drop.radius * .3);
      const t = Math.max(0, Math.min(1, feedback.slamProgress || 0));
      // A short wrist lift, accelerating palm strike and contact compression.
      const lift = t < .3 ? hover + targets.drop.radius * .8 * Math.sin(t / .3 * Math.PI / 2)
        : (hover + targets.drop.radius * .8) * (1 - ((t - .3) / .7) ** 2);
      const top = rightDocked ? targets.drop.y - (slamming ? reduced ? 0 : lift : hover)
        : p.y + (anchor.y + (attached ? dual ? 5 : 10 : 0) - p.y) * dock;
      root.style.top = `${top}px`;
      if (rightDocked) root.style.left = `${targets.drop.x + targets.drop.radius * .6 * (slamming ? reduced ? 0 : 1 - t : 1)}px`;
      root.dataset.stage = stage || 'seeking';
      for (let i = 0; i < 4; i++) {
        const x = 33 + i * 15, top = [27, 15, 20, 35][i];
        const d = `M${x} 68 Q${x - 3 * curl} ${top + (43 - top) * curl} ${x + 2 * curl} ${top + (65 - top) * curl}`;
        outlines.children[i].setAttribute('d', d); skin.children[i].setAttribute('d', d);
      }
      for (let i = 0; i < 4; i++) {
        const x = 35 + i * 14, tip = [30, 21, 25, 36][i];
        dorsal.querySelector('.dorsal-fingers').children[i].setAttribute('d', `M${x} 62 Q${x - 2 * curl} ${tip + (43 - tip) * curl} ${x} ${tip + (56 - tip) * curl}`);
      }
      dorsal.querySelector('.dorsal-thumb').setAttribute('d', `M31 62 Q${14 + 8 * curl} ${45 + 8 * curl} ${17 + 9 * curl} ${63 + 9 * curl} L29 88 Q37 91 40 81Z`);
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
      left.update(dual ? feedback.hands?.left || {} : feedback, visible && fresh && !!targets, dt, targets, dual ? 'left' : null);
      right.update(feedback.kind === 'slamming' ? { ...feedback.hands?.right, pointer: feedback.hands?.right?.pointer || { x: .75, y: .5 }, kind: 'slamming', grab: { stage: 'slamming' }, slamProgress: feedback.slamProgress } : feedback.hands?.right || {}, visible && fresh && dual && !!targets, dt, targets, 'right');
    }
  };
}
