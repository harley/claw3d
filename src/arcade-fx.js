import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Light that reacts to play. These are pure so the HUD-free scene logic is testable.
export const RIM_COLORS = Object.freeze({ base: '#dceee3', aligned: '#7dffb8', catch: '#ffd27a', miss: '#ff8a8a' });
// Which rim colour the machine should be leaning toward right now.
export function rimColorFor({ phase, aligned = false, prize = false }) {
  if (phase === 'aim') return aligned ? RIM_COLORS.aligned : RIM_COLORS.base;
  if (['lift', 'transfer', 'release', 'deliver', 'reveal'].includes(phase)) return prize ? RIM_COLORS.catch : RIM_COLORS.miss;
  return RIM_COLORS.base;
}
// Marquee light intensity for a lit-pattern key (see ArcadeScene.updateMarquee): the
// bulbs are unlit dots, so the light behind them is what makes the cabinet glow.
export function marqueeGlowFor(key) {
  if (key.startsWith('j')) return key.endsWith('0') || key.endsWith('s') ? 4.5 : .4;
  if (key.startsWith('d')) return 2.4;
  if (key.startsWith('i')) return 1.4;
  return .7;
}

// Selective bloom: only objects on BLOOM_LAYER (marquee bulbs, carousel signals,
// confetti) bleed; everything else is rendered black for the bloom pass, then
// the ordinary frame is composited with the glow. Costs two extra scene passes,
// so it is opt-in and the governor's simple mode bypasses it.
export const BLOOM_LAYER = 1;
export function createBloom(renderer, scene, camera, { strength = .9, radius = .45, threshold = 0 } = {}) {
  const layer = new T.Layers(); layer.set(BLOOM_LAYER);
  const dark = new T.MeshBasicMaterial({ color: '#000000' }); const saved = new Map();
  const size = renderer.getSize(new T.Vector2());
  const renderScene = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(size.clone(), strength, radius, threshold);
  const bloomComposer = new EffectComposer(renderer); bloomComposer.renderToScreen = false;
  bloomComposer.addPass(renderScene); bloomComposer.addPass(bloomPass);
  const mix = new ShaderPass(new T.ShaderMaterial({
    uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }',
  }), 'baseTexture');
  mix.needsSwap = true;
  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(renderScene); finalComposer.addPass(mix); finalComposer.addPass(new OutputPass());
  const darken = object => { if ((object.isMesh || object.isLine) && !layer.test(object.layers)) { saved.set(object, object.material); object.material = dark; } };
  const restore = object => { const material = saved.get(object); if (material) { object.material = material; saved.delete(object); } };
  return {
    render() {
      const background = scene.background; scene.background = null;
      scene.traverse(darken); bloomComposer.render(); scene.traverse(restore);
      scene.background = background; finalComposer.render();
    },
    setSize(width, height) { bloomComposer.setSize(width, height); finalComposer.setSize(width, height); },
  };
}
