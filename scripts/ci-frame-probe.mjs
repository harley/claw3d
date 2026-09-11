// Temporary diagnosis: distinguish display scheduling from WebGL work.
import { chromium } from 'playwright';
for (const options of [
  { name: 'headless', headless: true },
  { name: 'headless-unlimited', headless: true, args: ['--disable-frame-rate-limit'] },
  { name: 'headed', headless: false },
]) {
  const { name, ...launch } = options;
  const browser = await chromium.launch(launch);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.setContent('<!doctype html><html><body>Frame probe</body></html>');
    for (const webgl of [false, true]) {
      const result = await page.evaluate(webgl => new Promise(resolve => {
        let gl, renderer = null;
        if (webgl) {
          const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = 900; document.body.append(canvas);
          gl = canvas.getContext('webgl2');
          if (!gl) { resolve({ webgl: 'unavailable' }); return; }
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
        }
        const start = performance.now(); let frames = 0, stopped = false;
        const tick = () => { if (stopped) return; frames++; if (gl) { gl.clearColor(.2, .3, .4, 1); gl.clear(gl.COLOR_BUFFER_BIT); } requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        setTimeout(() => { stopped = true; resolve({ frames, fps: frames * 1000 / (performance.now() - start), visible: document.visibilityState, renderer }); }, 3000);
      }), webgl);
      console.log('[DEBUG-ci-frames]', JSON.stringify({ name, webgl, ...result }));
    }
  } finally { await browser.close(); }
}
