import { CanvasTexture, SRGBColorSpace } from 'three';

// A single reusable texture: redraw only at cue boundaries, never per frame.
// Sampling visible ink (not the font's baseline) keeps every word centred.
export function createMarqueeDisplay() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 112;
  const ctx = canvas.getContext('2d');
  const mask = document.createElement('canvas');
  mask.width = canvas.width; mask.height = canvas.height;
  const ink = mask.getContext('2d', { willReadFrequently: true });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const display = { texture, text: null, update };

  function update(cue) {
    const text = cue || 'CLAW';
    if (text === display.text) return;
    display.text = text;
    ink.clearRect(0, 0, mask.width, mask.height);
    ink.font = '900 112px Arial, sans-serif';
    const metrics = ink.measureText(text);
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const scale = Math.min(80 / height, 900 / width);
    ink.save();
    ink.translate(canvas.width / 2, canvas.height / 2);
    ink.scale(scale, scale);
    ink.fillStyle = '#fff';
    ink.fillText(text, (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2, (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    ink.restore();
    const pixels = ink.getImageData(0, 0, mask.width, mask.height).data;
    ctx.fillStyle = '#080e14'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const color = cue ? text === 'GO!' ? '#b4ef52' : '#32d4f5' : '#467681';
    for (let y = 4; y < canvas.height; y += 8) {
      for (let x = 4; x < canvas.width; x += 8) {
        const lit = pixels[(y * canvas.width + x) * 4 + 3] > 100;
        ctx.fillStyle = lit ? color : '#141e25';
        ctx.shadowColor = color; ctx.shadowBlur = lit && cue ? 5 : 0;
        ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    texture.needsUpdate = true;
  }
  update(null);
  return display;
}
