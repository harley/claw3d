import { HAND_ZONES, HAND_RANGE } from './hand-workspace.js';

// Presentation only: use accepted role evidence, never a raw detection, to
// claim that a control is ready. Windows follow the actual control workspace.
export function handCameraGuide(role, feedback, origin) {
  const hand = feedback?.hands?.[role], stage = hand?.grab?.stage;
  const enabled = feedback?.controlEnabled && !['delayed', 'blocked', 'off', 'error'].includes(feedback.kind);
  const held = role === 'left' && stage === 'gripped';
  const zone = { ...HAND_ZONES[role], minY: .12, maxY: .88 };
  if (held) { zone.minX = .02; zone.minY = .02; zone.maxY = .98; }
  else if (origin) {
    zone.minX = Math.max(zone.minX, origin.x - HAND_RANGE.x);
    zone.maxX = Math.min(zone.maxX, origin.x + HAND_RANGE.x);
    zone.minY = Math.max(zone.minY, origin.y - HAND_RANGE.y);
    zone.maxY = Math.min(zone.maxY, origin.y + HAND_RANGE.y);
  }
  let state = 'open', label = 'OPEN', icon = 'palm';
  if (!enabled) { state = 'inactive'; label = ''; icon = ''; }
  else if (hand?.outside) { state = 'return'; label = 'RETURN'; }
  else if (!hand?.ready) { if (hand?.pointer && !hand.closed) label = 'HOLD'; }
  else if (role === 'left') {
    if (feedback.dropEnabled) { state = 'active'; label = 'MOVE'; icon = 'move'; }
    else if (stage === 'grabbing' || hand.grab?.armed) { state = 'grip'; label = 'GRIP'; icon = 'fist'; }
  } else if (!feedback.dropEnabled) { state = 'inactive'; label = 'WAIT'; icon = ''; }
  else if (hand.grab?.armed) {
    state = 'active'; label = stage === 'charging' ? `HOLD ${Math.max(1, Math.ceil(3 * (1 - hand.grab.progress)))}s` : 'READY'; icon = 'palm';
  }
  const color = state === 'inactive' ? '#718096' : state === 'active' ? '#66ffb3' : role === 'left' ? '#59e5f2' : '#ffcf65';
  return { role, zone, state, label, icon, color };
}

function drawGesture(ctx, icon, x, y, size, role) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 100 * (role === 'left' ? -1 : 1), size / 100);
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
  if (icon === 'move') {
    ctx.moveTo(-35, 0); ctx.lineTo(35, 0); ctx.moveTo(0, -35); ctx.lineTo(0, 35);
    for (let i = 0; i < 4; i++) { ctx.moveTo(25, -10); ctx.lineTo(35, 0); ctx.lineTo(25, 10); ctx.rotate(Math.PI / 2); }
  } else if (icon === 'fist') {
    ctx.roundRect(-29, -23, 58, 58, 13);
    for (const x of [-14, 0, 14]) { ctx.moveTo(x, -21); ctx.lineTo(x, -4); }
    ctx.moveTo(-27, 5); ctx.lineTo(8, 5); ctx.quadraticCurveTo(21, 5, 18, 18); ctx.lineTo(-12, 18);
  } else {
    ctx.moveTo(-25, 31); ctx.lineTo(-43, 0); ctx.quadraticCurveTo(-46, -12, -36, -10);
    ctx.lineTo(-23, 5); ctx.lineTo(-23, -30); ctx.quadraticCurveTo(-23, -42, -12, -34);
    ctx.lineTo(-12, -8); ctx.lineTo(-12, -42); ctx.quadraticCurveTo(-7, -52, 0, -42);
    ctx.lineTo(0, -9); ctx.lineTo(0, -37); ctx.quadraticCurveTo(7, -46, 12, -35);
    ctx.lineTo(12, -7); ctx.lineTo(12, -24); ctx.quadraticCurveTo(23, -33, 25, -20);
    ctx.lineTo(25, 15); ctx.quadraticCurveTo(25, 30, 15, 39); ctx.lineTo(-17, 39); ctx.closePath();
  }
  ctx.stroke(); ctx.restore();
}

export function drawHandCameraGuide(ctx, width, height, guides) {
  ctx.save();
  ctx.fillStyle = 'rgba(20, 26, 36, .78)'; ctx.fillRect(0, 0, width, height);
  for (const guide of guides) {
    const { zone, state, color, role, label, icon } = guide;
    const x = zone.minX * width, y = zone.minY * height;
    const w = (zone.maxX - zone.minX) * width, h = (zone.maxY - zone.minY) * height;
    ctx.clearRect(x, y, w, h);
    ctx.fillStyle = state === 'inactive' ? 'rgba(20,26,36,.48)' : state === 'active' ? 'rgba(102,255,179,.08)' : 'rgba(10,20,30,.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = state === 'active' ? 4 : 2;
    ctx.setLineDash(['open', 'return'].includes(state) ? [8, 7] : []);
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    // Opaque caption strips stay readable over a bright or busy camera image.
    ctx.fillStyle = '#101b28'; ctx.fillRect(x + 2, y + 2, w - 4, 34);
    ctx.fillRect(x + 2, y + h - 33, w - 4, 31);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = `bold ${Math.min(24, (w - 16) / 5)}px Arial`;
    ctx.fillText(role === 'left' ? 'L  MOVE' : 'R  DROP', x + w / 2, y + 26);
    ctx.fillText(label, x + w / 2, y + h - 10);
    if (icon) {
      ctx.globalAlpha = state === 'active' ? .5 : .85;
      drawGesture(ctx, icon, x + w / 2, y + h / 2, Math.max(24, Math.min(100, w * .48, h - 76)), role);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
