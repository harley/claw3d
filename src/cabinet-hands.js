import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clamp = n => Math.max(0, Math.min(1, n));
const fingers = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
// Grip fit against the deformed GLB triangle surface and the .14-radius ball.
const gripCurl = { 'index-finger': .70, 'middle-finger': .60, 'ring-finger': .65, 'pinky-finger': .975 };
const joints = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];

// Meshes are MIT-licensed WebXR anatomical assets. Only their rendering rig is
// reused: camera acquisition/recognition and event-session scoring stay unchanged.
export class CabinetHands {
  constructor(scene, loader = new GLTFLoader(), { singleHand = false } = {}) {
    this.root = new T.Group(); scene.add(this.root); this.root.visible = false;
    this.singleHand = singleHand; this.mode = 'off'; this.progress = 0;
    this.hands = {}; this.error = null; this.state = 'loading';
    this.ready = Promise.all((singleHand ? ['left'] : ['left', 'right']).map(async role => {
      const gltf = await loader.loadAsync(`/models/hands/${role}.glb`);
      const model = gltf.scene;
      if (this.state === 'error') { disposeModel(model); return; }
      // Attach before validation so every partial model is owned by cleanup.
      this.root.add(model);
      const required = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal',
        ...fingers.flatMap(finger => joints.slice(1, 4).map(joint => `${finger}-${joint}`))];
      for (const name of required) if (!model.getObjectByName(name)) throw new Error(`Hand model is missing ${name}`);
      const wrist = model.getObjectByName('wrist');
      model.updateMatrixWorld(true);
      const inverse = wrist.matrixWorld.clone().invert();
      const normalization = new T.Group(); normalization.applyMatrix4(inverse); normalization.add(model);
      const pivot = new T.Group(); pivot.add(normalization); pivot.scale.setScalar(4.7); this.root.add(pivot);
      // The source uses independent XR joints. Rebuild real finger chains so
      // local flexion propagates to the tips while preserving the bind pose.
      for (const finger of [...fingers, 'thumb']) {
        let parent = wrist;
        for (const joint of joints) {
          const bone = model.getObjectByName(`${finger}-${joint}`);
          if (bone) { parent.attach(bone); parent = bone; }
        }
      }
      this.root.updateMatrixWorld(true);
      const bends = [];
      for (const finger of fingers) for (const [i, joint] of joints.slice(1, 4).entries()) {
        const bone = model.getObjectByName(`${finger}-${joint}`);
        const axis = new T.Vector3(1, 0, 0).applyQuaternion(bone.getWorldQuaternion(new T.Quaternion()).invert());
        bends.push({ bone, rest: bone.quaternion.clone(), axis, amount: [1.12, 1.35, .75][i], grip: gripCurl[finger] });
      }
      const thumb = model.getObjectByName('thumb-metacarpal');
      const thumbAxis = new T.Vector3(0, 1, 0).applyQuaternion(thumb.getWorldQuaternion(new T.Quaternion()).invert());
      const thumbRest = thumb.quaternion.clone();
      const thumbLiftAxis = new T.Vector3(0, 0, 1).applyQuaternion(thumb.getWorldQuaternion(new T.Quaternion()).invert());
      const thumbProx = model.getObjectByName('thumb-phalanx-proximal');
      const thumbProxRest = thumbProx.quaternion.clone();
      const thumbProxAxis = new T.Vector3(0, 1, 0).applyQuaternion(thumbProx.getWorldQuaternion(new T.Quaternion()).invert());
      const skin = new T.MeshPhysicalMaterial({ color: '#c88f6e', roughness: .57, metalness: 0, clearcoat: .08, clearcoatRoughness: .7 });
      const oldMaterials = new Set();
      model.traverse(o => { if (o.isMesh) { for (const m of [].concat(o.material)) oldMaterials.add(m); o.material = skin; o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
      disposeMaterials(oldMaterials);
      // A first-person forearm: a bare wrist, then a folded fabric sleeve that
      // widens toward the player and leaves the frame at its lower edge.
      const sign = role === 'left' ? -1 : 1;
      const path = new T.CatmullRomCurve3([new T.Vector3(0,0,.005), new T.Vector3(sign*.008,-.012,.07), new T.Vector3(sign*.035,-.06,.19), new T.Vector3(sign*.07,-.14,.32), new T.Vector3(sign*.10,-.23,.44)]);
      const segments = 48, sides = 20, length = path.getLength(), cuffAt = .055;
      const geometry = new T.TubeGeometry(path, segments, .026, sides, false);
      const positions = geometry.attributes.position;
      for (let ring=0; ring<=segments; ring++) {
        const t=ring/segments, centre=path.getPointAt(t), along=t*length, sleeved=along > cuffAt ? 1 : 0;
        const forearm = 1 + .55*T.MathUtils.smoothstep(along, .01, .16);
        const folds = sleeved * (.10 + (.06 + .05*Math.sin(along*52)) * Math.exp(-(along-cuffAt)*3));
        for (let j=0;j<=sides;j++) {
          const index=ring*(sides+1)+j, point=new T.Vector3().fromBufferAttribute(positions,index);
          const creases = 1 + .025*sleeved*Math.sin(j/sides*Math.PI*6 + along*30);
          point.sub(centre).multiplyScalar(forearm*(1+folds)*creases).add(centre); positions.setXYZ(index,point.x,point.y,point.z);
        }
      }
      geometry.computeVertexNormals();
      const wristIndices = Math.round(segments*cuffAt/length)*sides*6;
      geometry.addGroup(0, wristIndices, 0); geometry.addGroup(wristIndices, Infinity, 1);
      const sleeve = new T.MeshPhysicalMaterial({ color: '#1d3d5c', roughness: .82, sheen: .8, sheenRoughness: .6, sheenColor: new T.Color('#5f8fbf') });
      const arm = new T.Mesh(geometry, [skin, sleeve]); arm.castShadow = arm.receiveShadow = true; pivot.add(arm);
      const hem = new T.Mesh(new T.TorusGeometry(.0335, .0042, 10, 40), sleeve);
      hem.position.copy(path.getPointAt(cuffAt/length)); hem.quaternion.setFromUnitVectors(new T.Vector3(0,0,1), path.getTangentAt(cuffAt/length));
      hem.castShadow = true; pivot.add(hem);
      this.hands[role] = { pivot, bends, thumb, thumbAxis, thumbRest, thumbLiftAxis, thumbProx, thumbProxRest, thumbProxAxis, curl: 0 };
    })).then(() => { this.state = 'ready'; }).catch(error => {
      this.state = 'error'; this.error = error.message;
      disposeModel(this.root); this.root.clear(); this.hands = {};
      console.error('Cabinet hand assets failed to load', error);
    });
  }

  update(phase, elapsed, dt, feedback, enabled, stick, button, reduced) {
    const single = this.singleHand;
    const active = phase === 'aim' && feedback.controlEnabled && ['tracking', 'clenching'].includes(feedback.kind);
    this.mode = active ? feedback.kind : 'off';
    this.progress = active && feedback.kind === 'clenching' ? clamp(feedback.progress) : 0;
    this.root.visible = this.state === 'ready' && enabled && (single ? active : feedback.profile === 'dual');
    // A paused/modal frame preserves the committed progress but changes kind.
    const slam = Number.isFinite(feedback.slamProgress);
    const contact = phase === 'anticipate' || (phase === 'descend' && elapsed < .16);
    for (const role of ['left', 'right']) {
      const hand = this.hands[role]; if (!hand) continue;
      const evidence = feedback.hands?.[role] || {};
      const fresh = !['delayed','off','error','blocked','accepted'].includes(feedback.kind);
      hand.pivot.visible = this.root.visible && (((phase === 'aim' || role === 'left') && fresh && !!evidence.pointer && ['tracking','clenching','calibrating'].includes(evidence.kind)) || slam || contact);
      if (single) hand.pivot.visible = this.root.visible;
      if (role === 'right' && !slam && !contact) hand.pivot.visible = false;
      // Reflect the fitted left grip as a whole; recognition owns handedness.
      hand.pivot.scale.x = single && feedback.physicalHand === 'right' ? -4.7 : 4.7;
      const left = role === 'left';
      const gripped = single || ['gripped','grabbing'].includes(evidence.grab?.stage) || slam || contact;
      const target = left && gripped ? 1 : .08;
      hand.curl += (target-hand.curl)*(reduced ? 1 : Math.min(1,dt*22));
      hand.thumb.quaternion.copy(hand.thumbRest).multiply(new T.Quaternion().setFromAxisAngle(hand.thumbAxis, (left ? .30 : -.12)*hand.curl));
      // Keep the open thumb above the panel when the cap is fully depressed.
      if (!left) hand.thumb.quaternion.multiply(new T.Quaternion().setFromAxisAngle(hand.thumbLiftAxis, -.35));
      hand.thumbProx.quaternion.copy(hand.thumbProxRest).multiply(new T.Quaternion().setFromAxisAngle(hand.thumbProxAxis, left ? .35*hand.curl : 0));
      for (const bend of hand.bends) bend.bone.quaternion.copy(bend.rest).multiply(new T.Quaternion().setFromAxisAngle(bend.axis,-bend.amount*hand.curl*(left ? bend.grip : 1)));
      if (left) {
        // The grip is rigidly attached to the ball frame, including full tilt.
        // Open/release lifts away before the fingers spread.
        const release = 1-hand.curl;
        stick.updateWorldMatrix(true, false);
        hand.pivot.quaternion.identity().slerp(stick.getWorldQuaternion(new T.Quaternion()), hand.curl);
        const offset = new T.Vector3(0, .244+.10*release, .39+.27*release).applyQuaternion(hand.pivot.quaternion);
        hand.pivot.position.copy(stick.localToWorld(new T.Vector3(0, .205, 0))).add(offset);
      } else {
        const t = clamp(feedback.slamProgress || 0);
        const strike = slam || contact;
        const travel = contact || (reduced && strike) ? 1 : t;
        const lift = !reduced && slam ? (t<.3 ? .26*Math.sin(t/.3*Math.PI/2) : .26*(1-((t-.3)/.7)**2)) : 0;
        // Rest on the inside of DROP, clear of the cabinet's right post.
        // .231 is the measured skin-to-dome support height, including clearance.
        hand.pivot.position.set(button.position.x - .38*(strike ? 1-travel : 1), button.position.y+.231+.10*(strike ? 1-travel : 1)+lift, strike ? 2.10-.13*travel : 2.10);
        hand.pivot.rotation.set(0, 0, 0);
      }
    }
  }
}

function disposeMaterials(materials) {
  const textures = new Set();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

function disposeModel(root) {
  const geometries = new Set(), materials = new Set(), skeletons = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of [].concat(object.material)) materials.add(material);
    if (object.skeleton) skeletons.add(object.skeleton);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  disposeMaterials(materials);
}
