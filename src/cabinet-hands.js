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
  constructor(scene, loader = new GLTFLoader()) {
    this.root = new T.Group(); scene.add(this.root); this.root.visible = false;
    this.hands = {}; this.error = null;
    this.ready = Promise.all(['left', 'right'].map(async role => {
      const gltf = await loader.loadAsync(`/models/hands/${role}.glb`);
      const model = gltf.scene, wrist = model.getObjectByName('wrist');
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
      model.traverse(o => { if (o.isMesh) { o.material = skin; o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
      // A continuous tapered forearm, curved toward the player, with cuff ribs.
      const sleeve = new T.MeshStandardMaterial({ color: '#162e43', roughness: .94 });
      const points = [new T.Vector3(0,0,.005),new T.Vector3(role==='left'?-.012:.012,-.01,.09),new T.Vector3(role==='left'?-.055:.055,-.06,.23),new T.Vector3(role==='left'?-.11:.11,-.14,.42)];
      const curve = new T.CatmullRomCurve3(points);
      const geometry = new T.TubeGeometry(curve, 32, .027, 16, false);
      const positions = geometry.attributes.position;
      for (let ring=0; ring<=32; ring++) {
        const t=ring/32, centre=curve.getPointAt(t);
        const width=1 + .30*t + .025*Math.sin(t*75)*Math.exp(-t*7);
        for(let j=0;j<=16;j++) {
          const index=ring*17+j, point=new T.Vector3().fromBufferAttribute(positions,index);
          point.sub(centre).multiplyScalar(width).add(centre); positions.setXYZ(index,point.x,point.y,point.z);
        }
      }
      geometry.computeVertexNormals();
      const arm = new T.Mesh(geometry, sleeve); arm.castShadow = arm.receiveShadow = true; pivot.add(arm);
      for (let i=0;i<6;i++) {
        const cuff = new T.Mesh(new T.TorusGeometry(.0275, .0014, 6, 32), sleeve);
        cuff.position.z = .008 + i*.003; cuff.castShadow = true; pivot.add(cuff);
      }
      this.hands[role] = { pivot, bends, thumb, thumbAxis, thumbRest, thumbLiftAxis, thumbProx, thumbProxRest, thumbProxAxis, curl: 0 };
    })).catch(error => { this.error = error.message; console.error('Cabinet hand assets failed to load', error); });
  }

  update(phase, elapsed, dt, feedback, enabled, stick, button, reduced) {
    this.root.visible = enabled && feedback.profile === 'dual';
    // A paused/modal frame preserves the committed progress but changes kind.
    const slam = Number.isFinite(feedback.slamProgress);
    const contact = phase === 'anticipate' || (phase === 'descend' && elapsed < .16);
    for (const role of ['left', 'right']) {
      const hand = this.hands[role]; if (!hand) continue;
      const evidence = feedback.hands?.[role] || {};
      const fresh = !['delayed','off','error','blocked','accepted'].includes(feedback.kind);
      hand.pivot.visible = this.root.visible && ((phase === 'aim' && fresh && !!evidence.pointer && ['tracking','clenching','calibrating'].includes(evidence.kind)) || slam || contact);
      const left = role === 'left';
      const gripped = ['gripped','grabbing'].includes(evidence.grab?.stage) || slam || contact;
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
