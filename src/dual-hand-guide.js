import { projectDropHand } from './hand-workspace.js';

// Player-view shadow: left thumb points right; right thumb points left.
// Mirror inside the SVG so tutorial animation cannot undo the orientation.
const palm = '<path d="M22 35V19q0-5 4-5t4 5v12-18q0-5 4-5t4 5v18-15q0-5 4-5t4 5v17-10q0-5 4-5t4 5v20q0 17-17 17h-3q-8 0-12-8l-9-14q-3-6 3-7 3 0 6 6z"/>';
const icon = (shape, name, role = 'left') => `<svg class="${name}" viewBox="0 0 64 64" aria-hidden="true">${role === 'left' ? `<g transform="translate(64 0) scale(-1 1)">${shape}</g>` : shape}</svg>`;

export function createDualHandGuide() {
  const guide = document.createElement('div'); guide.id = 'dual-hand-guide'; guide.hidden = true;
  guide.setAttribute('aria-hidden', 'true');
  guide.innerHTML = '<span class="dual-guide-instruction"></span><span class="dual-guide-role"></span>';
  const target = document.createElement('div'); target.id = 'dual-drop-target'; target.hidden = true; target.setAttribute('aria-hidden', 'true');
  const cursor = document.createElement('div'); cursor.id = 'dual-palm-cursor'; cursor.hidden = true; cursor.setAttribute('aria-hidden', 'true'); cursor.innerHTML = icon(palm, '', 'right');
  document.body.append(guide, target, cursor);
  return {
    // One-hand play passes its HUD instruction and hold progress; the card sits
    // beside the joystick that hand drives, with no role line.
    update(feedback, targets, visible, oneHand = null) {
      const fresh = !['off', 'loading', 'error', 'delayed', 'blocked', 'accepted', 'slamming'].includes(feedback.kind);
      const single = Boolean(oneHand) && feedback.profile !== 'dual';
      const enabled = visible && targets && (feedback.profile === 'dual' || single) && fresh;
      if (!enabled) {
        for (const element of [guide, target, cursor]) if (!element.hidden) element.hidden = true;
        return;
      }
      target.hidden = cursor.hidden = true;
      const left = feedback.hands?.left, right = feedback.hands?.right;
      const gripping = !single && left?.ready && ['grabbing', 'gripped'].includes(left.grab?.stage);
      const dropping = !single && feedback.controlEnabled && feedback.dropEnabled;
      const stage = single ? (oneHand.progress === null ? 'one-hand' : 'hold') : dropping ? 'drop' : gripping ? 'ready' : left?.ready ? 'grip' : 'acquire';
      guide.dataset.stage = stage;
      if (guide.hidden !== (stage === 'ready')) guide.hidden = stage === 'ready';
      const role = dropping ? 'right' : 'left';
      guide.dataset.hand = single ? 'one' : role;
      guide.style.setProperty('--hold', single && oneHand.progress !== null ? oneHand.progress : 1);
      const anchor = dropping ? targets.drop : targets.stick;
      const cursorPoint = dropping && right?.pointer && !right.outside ? projectDropHand(right.pointer, targets) : null;
      const instruction = single ? oneHand.instruction : stage === 'drop'
        ? right?.pointer && (!right.open || right.closed) ? 'Open your palm'
        : right?.pointer && !right.ready ? 'Hold palm still'
        : right?.grab?.stage === 'resting' ? 'Move palm off DROP'
        : 'Open palm to DROP'
        : stage === 'ready' ? 'Hand ready' : stage === 'grip' ? 'Clench to grip'
        : left?.pointer && !left.outside ? left.open && !left.closed ? 'Hold hand still' : 'Open your hand' : 'Show your hand';
      guide.querySelector('.dual-guide-instruction').textContent = instruction;
      guide.querySelector('.dual-guide-role').textContent = single ? '' : `${role} hand`;

      if (!guide.hidden) {
        const guideWidth = guide.getBoundingClientRect().width;
        const trackingPoint = cursorPoint || anchor;
        const horizontalPoint = role === 'right'
          ? Math.max(trackingPoint.x, anchor.x)
          : Math.min(trackingPoint.x, anchor.x);
        const clearGap = Math.max(78, anchor.radius * 1.35);
        const guideLeft = role === 'right'
          ? horizontalPoint + anchor.radius + clearGap
          : horizontalPoint - anchor.radius - clearGap - guideWidth;
        guide.style.left = `${Math.max(18, Math.min(innerWidth - guideWidth - 18, guideLeft))}px`;
        const guideTop = trackingPoint.y + Math.max(48, anchor.radius * .72);
        guide.style.top = `${Math.max(80, Math.min(innerHeight - guide.offsetHeight - 38, guideTop))}px`;
      }
      if (dropping) {
        target.hidden = false;
        const radius = targets.drop.radius * 1.5;
        Object.assign(target.style, { left: `${targets.drop.x}px`, top: `${targets.drop.y}px`, width: `${radius * 2}px`, height: `${radius * 2}px` });
        if (cursorPoint) {
          cursor.hidden = false;
          Object.assign(cursor.style, { left: `${cursorPoint.x}px`, top: `${cursorPoint.y}px` });
          cursor.dataset.open = String(Boolean(right.open && !right.closed));
        }
      }
    },
  };
}
