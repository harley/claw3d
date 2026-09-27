import { projectDropHand } from './hand-workspace.js';

// Palm-facing right-hand outline (thumb at viewer's left). Mirror the entire
// outline for an anatomical left hand; never mirror the lettering.
const palm = '<path d="M22 35V19q0-5 4-5t4 5v12-18q0-5 4-5t4 5v18-15q0-5 4-5t4 5v17-10q0-5 4-5t4 5v20q0 17-17 17h-3q-8 0-12-8l-9-14q-3-6 3-7 3 0 6 6z"/>';
const fist = '<path d="M17 36V26q0-5 4-5t4 5v-5q0-5 4-5t4 5v-1q0-5 4-5t4 5v3q0-5 4-5t4 5v18q0 15-15 15h-3q-10 0-14-10l-5-9q-2-5 2-6 3-1 6 5z"/>';
const icon = (shape, name) => `<svg class="${name}" viewBox="0 0 64 64" aria-hidden="true">${shape}</svg>`;

export function createDualHandGuide() {
  const guide = document.createElement('div'); guide.id = 'dual-hand-guide'; guide.hidden = true;
  guide.innerHTML = `<div class="dual-demo">${icon(palm, 'demo-palm')}${icon(fist, 'demo-fist')}</div><span></span>`;
  const target = document.createElement('div'); target.id = 'dual-drop-target'; target.hidden = true; target.setAttribute('aria-hidden', 'true');
  const cursor = document.createElement('div'); cursor.id = 'dual-palm-cursor'; cursor.hidden = true; cursor.setAttribute('aria-hidden', 'true'); cursor.innerHTML = icon(palm, '');
  document.body.append(guide, target, cursor);
  return {
    update(feedback, targets, visible) {
      const fresh = !['off', 'loading', 'error', 'delayed', 'blocked', 'accepted', 'slamming'].includes(feedback.kind);
      const enabled = visible && targets && feedback.profile === 'dual' && fresh;
      guide.hidden = !enabled; target.hidden = cursor.hidden = true;
      if (!enabled) return;
      const left = feedback.hands?.left, right = feedback.hands?.right;
      const gripping = left?.ready && ['grabbing', 'gripped'].includes(left.grab?.stage);
      const dropping = feedback.controlEnabled && feedback.dropEnabled;
      const stage = dropping ? 'drop' : gripping ? 'ready' : left?.ready ? 'grip' : 'acquire';
      guide.dataset.stage = stage;
      const anchor = dropping ? targets.drop : targets.stick;
      guide.style.left = `${Math.max(95, Math.min(innerWidth - 95, anchor.x))}px`;
      guide.style.top = `${Math.max(80, anchor.y - anchor.radius - 18)}px`;
      guide.style.setProperty('--drop-demo-offset', `${anchor.radius - 10}px`);
      guide.querySelector('span').textContent = stage === 'drop'
        ? right?.pointer && (!right.open || right.closed) ? 'Open your right palm'
        : right?.pointer && !right.ready ? 'Hold right palm still'
        : right?.ready && right.target === 'drop' && !right.grab?.armed ? 'Move out, then into DROP' : 'Open right palm to DROP'
        : stage === 'ready' ? 'Left hand ready' : stage === 'grip' ? 'Clench to grip' : 'Show your left hand';
      if (dropping) {
        target.hidden = false;
        const radius = targets.drop.radius * 1.5;
        Object.assign(target.style, { left: `${targets.drop.x}px`, top: `${targets.drop.y}px`, width: `${radius * 2}px`, height: `${radius * 2}px` });
        if (right?.pointer && !right.outside) {
          cursor.hidden = false;
          const point = projectDropHand(right.pointer, targets);
          Object.assign(cursor.style, { left: `${point.x}px`, top: `${point.y}px` });
          cursor.dataset.open = String(Boolean(right.open && !right.closed));
        }
      }
    },
  };
}
