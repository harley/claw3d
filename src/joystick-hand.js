import * as T from 'three';
import { batch, group, mesh } from './arcade-art.js';

const clamp = value => Math.min(1, Math.max(0, Number(value) || 0));

// A glove is feedback for an acquired steering hand, not a new gesture.
// Fixed fingers are merged once; only the glove root moves at runtime.
export class JoystickHand {
  constructor(stick) {
    this.root = group(stick);
    this.glove = group(this.root);
    const ivory = new T.MeshStandardMaterial({ color: '#fff1d7', roughness: .68 });
    const cyan = new T.MeshStandardMaterial({ color: '#36cfdb', roughness: .5 });
    const sphere = new T.SphereGeometry(1, 16, 12);
    const oval = (material, position, scale) => {
      const part = mesh(this.glove, sphere, material, ...position);
      part.scale.set(...scale);
      return part;
    };
    oval(ivory, [.105, .17, .135], [.105, .105, .075]).rotation.z = -.2;
    // Three broad fingers curl around the front and left of the red ball.
    for (const y of [.115, .16, .205]) {
      const curve = new T.CatmullRomCurve3([
        new T.Vector3(.15, y, .12), new T.Vector3(.035, y, .14),
        new T.Vector3(-.075, y, .105), new T.Vector3(-.095, y + .008, .035),
      ]);
      mesh(this.glove, new T.TubeGeometry(curve, 12, .025, 7, false), ivory);
      oval(ivory, [-.095, y + .008, .035], [.025, .025, .025]);
    }
    // Thumb crosses above the fingers; leave the red crown readable.
    const thumb = new T.CatmullRomCurve3([
      new T.Vector3(.17, .215, .12), new T.Vector3(.135, .27, .09),
      new T.Vector3(.055, .277, .072),
    ]);
    mesh(this.glove, new T.TubeGeometry(thumb, 10, .036, 8, false), ivory);
    oval(ivory, [.055, .277, .072], [.036, .036, .036]);
    oval(ivory, [.13, .115, .225], [.075, .068, .11]).rotation.y = .28;
    oval(cyan, [.16, .10, .305], [.088, .074, .064]).rotation.y = .28;
    batch(this.glove);
    sphere.dispose();

    this.haloMaterial = new T.MeshBasicMaterial({ color: '#48e5da', toneMapped: false });
    this.halo = mesh(this.root, new T.TorusGeometry(.19, .009, 5, 48), this.haloMaterial, 0, .022, 0);
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.castShadow = this.halo.receiveShadow = false;
    this.haloCount = this.halo.geometry.index.count;
    this.grip = 0;
    this.mode = 'off';
    this.progress = 0;
    this.root.visible = false;
  }

  update(phase, elapsed, dt, feedback = {}, reducedMotion = false) {
    const accepted = phase === 'anticipate' && !['off', 'blocked', 'paused'].includes(feedback.kind);
    const enabled = phase === 'aim' && feedback.controlEnabled === true;
    const active = enabled && ['tracking', 'clasping'].includes(feedback.kind);
    this.mode = accepted ? 'accepted' : active ? feedback.kind : 'off';
    this.progress = this.mode === 'clasping' ? clamp(feedback.progress) : 0;
    this.root.visible = active || accepted;
    if (!this.root.visible) { this.grip = 0; return; }

    const target = accepted ? 1 - clamp(elapsed / .2) : 1;
    this.grip = reducedMotion ? 1 : T.MathUtils.damp(this.grip, target, 18, Math.max(0, dt));
    this.glove.position.set(.025 * (1 - this.grip), .14 * (1 - this.grip), .16 * (1 - this.grip));
    this.haloMaterial.color.set(this.mode === 'clasping' ? '#ffc14d' : '#48e5da');
    const fraction = this.mode === 'clasping' ? this.progress : 1;
    // Reveal existing triangles rather than allocate geometry during a hold.
    this.halo.geometry.setDrawRange(0, Math.floor(this.haloCount * fraction / 6) * 6);
  }
}
