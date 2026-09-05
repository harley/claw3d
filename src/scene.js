import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ease, clamp } from './mechanics.js';

const FLOOR = 1.19;
const HIGH = 3.27;
const mix = THREE.MathUtils.lerp;

export class ClawScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    this.renderer.setClearColor(0xe6e9dc, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .6;
    room.dispose(); pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 70);
    this.cameraHome = new THREE.Vector3(6.4, 5.3, 10.3);
    this.lookHome = new THREE.Vector3(0, 1.92, 0);
    this.camera.position.copy(this.cameraHome);
    this.camera.lookAt(this.lookHome);
    this.currentLook = this.lookHome.clone();
    this.scene.add(new THREE.HemisphereLight(0xfff7e5, 0x87957b, 1.3));
    const key = new THREE.DirectionalLight(0xfff7e8, 2);
    key.position.set(-3, 8, 5); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -4, near: .5, far: 20 });
    key.shadow.mapSize.set(2048, 2048); key.shadow.normalBias = .025; key.shadow.bias = -.0001;
    key.shadow.radius = 4; this.scene.add(key); this.key = key;
    const rim = new THREE.DirectionalLight(0xcfe7da, 1.4); rim.position.set(4,5,-3);this.scene.add(rim);
    const bounce = new THREE.PointLight(0xffc4a3, 2, 5);bounce.position.set(0,2.6,.2);this.scene.add(bounce);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({ color: 0x536248, opacity:.18 }));
    ground.rotation.x=-Math.PI/2;ground.position.y=.003;ground.receiveShadow=true;this.scene.add(ground);
    this.prizes = []; this.position = { x:-.85,z:.12 }; this.phase = 'idle'; this.phaseTime = 0;
    this.observer = new ResizeObserver(() => this.resize());this.observer.observe(canvas.parentElement);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async load() {
    const loader = new GLTFLoader();
    const [cabinet,bunny,pillow,claw] = await Promise.all(['cabinet','bunny','pillow','claw'].map(name=>loader.loadAsync(`/models/${name}.glb`)));
    this.machine = cabinet.scene;this.scene.add(this.machine);
    this.claw = claw.scene;this.scene.add(this.claw);
    this.fingers = [0,1,2].map(i=> { const object = this.claw.getObjectByName(`Finger_${i}`);return {object,rest:object.quaternion.clone()}; });
    this.bunnyTemplate=bunny.scene;
    const layout = [
      {id:'bunny-1',kind:'bunny',x:-.85,z:.12,angle:.09,scale:.76},
      {id:'bunny-2',kind:'bunny',x:0,z:.52,angle:-.13,scale:.72},
      {id:'bunny-3',kind:'bunny',x:.87,z:.50,angle:-.28,scale:.74},
      {id:'bunny-4',kind:'bunny',x:-.83,z:-.52,angle:.20,scale:.71},
      {id:'pillow-1',kind:'pillow',x:.58,z:-.50,angle:-.15,scale:1},
    ];
    for(const data of layout) {
      const object=(data.kind==='bunny'?bunny.scene:pillow.scene).clone(true);
      const baseY=FLOOR+(data.kind==='pillow'?.48:0);
      object.position.set(data.x,baseY,data.z);object.scale.setScalar(data.scale);
      object.rotation.y=data.angle;
      if(data.kind==='pillow')object.rotation.x=Math.PI/2;
      this.scene.add(object);
      this.prizes.push({...data,object,baseY,rest:object.quaternion.clone(),catchRadius:data.kind==='bunny'?.245:.29,hubOffset:data.kind==='bunny'?data.scale*1.62:1.14,claimed:false});
    }
    // Small capsules make the bed feel plentiful without obscuring the five catchable hero prizes.
    const capsuleMaterial=new THREE.MeshStandardMaterial({color:0xd0dfa8,roughness:.42,metalness:.13});
    for(const [x,z,c] of [[-.14,-.63,0xacbaca],[1.30,-.44,0xd5c29d],[-1.28,-.08,0xb8cad1],[.42,.08,0xc3c995]]) {
      const material=capsuleMaterial.clone();material.color.setHex(c);
      const capsule=new THREE.Mesh(new THREE.SphereGeometry(.15,24,16),material);capsule.scale.y=.83;capsule.position.set(x,FLOOR+.12,z);capsule.castShadow=true;this.scene.add(capsule);
      const seam=new THREE.Mesh(new THREE.TorusGeometry(.15,.007,8,40),new THREE.MeshStandardMaterial({color:0xf5ebd2,roughness:.65}));seam.rotation.x=Math.PI/2;seam.position.copy(capsule.position);this.scene.add(seam);
    }
    const steel=new THREE.MeshStandardMaterial({color:0xbac4b7,metalness:.85,roughness:.3});
    const teal=new THREE.MeshStandardMaterial({color:0x284c49,metalness:.4,roughness:.3});
    for(const x of [-1.37,1.37]) {
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,2.10),steel);rail.position.set(x,3.69,0);this.scene.add(rail);
    }
    this.crossbar=new THREE.Mesh(new THREE.BoxGeometry(2.92,.09,.12),steel);this.crossbar.position.y=3.64;this.scene.add(this.crossbar);
    this.carriage=new THREE.Mesh(new THREE.BoxGeometry(.4,.13,.35),teal);this.carriage.position.y=3.58;this.scene.add(this.carriage);
    this.cable=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,1,12),teal);this.scene.add(this.cable);
    this.target=new THREE.Group();this.scene.add(this.target);
    const ringMaterial=new THREE.MeshBasicMaterial({color:0xe87954,transparent:true,opacity:.88,depthWrite:false});
    const ring=new THREE.Mesh(new THREE.RingGeometry(.252,.272,64),ringMaterial);ring.rotation.x=-Math.PI/2;this.target.add(ring);this.ringMaterial=ringMaterial;
    for(const rotation of [0,Math.PI/2]) {
      const bar=new THREE.Mesh(new THREE.BoxGeometry(.13,.003,.007),ringMaterial);bar.rotation.y=rotation;this.target.add(bar);
    }
    // Glass only at the sides: its quiet reflections preserve an unobstructed aiming view.
    const glass=new THREE.MeshPhysicalMaterial({color:0xe7f5df,metalness:0,roughness:.12,transparent:true,opacity:.06,side:THREE.DoubleSide,depthWrite:false});
    for(const x of [-1.66,1.66]) {
      const pane=new THREE.Mesh(new THREE.PlaneGeometry(2.27,2.56),glass);pane.rotation.y=Math.PI/2;pane.position.set(x,2.49,0);this.scene.add(pane);
    }
    this.scene.traverse(object=>{if(object.isMesh && object!==this.target && object.material!==glass){object.castShadow=true;object.receiveShadow=true;}});
    // Target indicators and shadow receiver must not themselves cast shadows.
    this.target.traverse(o=>{o.castShadow=false;o.receiveShadow=false;});
    this.ready=true;this.resize();this.update(0,.016,{phase:'idle',position:this.position});
  }

  resize() {
    const { width,height }=this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;
    // Reserve screen space below the machine for the physical-looking control deck.
    this.camera.fov = width/height < 1.08 ? 40 : 35;
    this.camera.setViewOffset(width,height,0,height*.065,width,height);
    this.camera.updateProjectionMatrix();
  }

  beginDrop(prize) {
    this.caught=prize;this.dropStart={...this.position};this.prizeRest=prize?.object.position.clone();
    this.travelStart=null;
  }

  reset() {
    for(const p of this.prizes) {
      p.object.visible=true;p.claimed=false;p.object.position.set(p.x,p.baseY,p.z);p.object.quaternion.copy(p.rest);p.object.scale.setScalar(p.scale);
    }
    this.caught=null;this.dropStart=null;
  }

  update(now,dt,game) {
    if(!this.ready)return;
    const {phase,elapsed=0}=game;const p=game.position;
    this.position=p;
    let x=p.x,z=p.z,y=HIGH,openness=.45;
    const targetX=this.caught?.x ?? this.dropStart?.x ?? x;
    const targetZ=this.caught?.z ?? this.dropStart?.z ?? z;
    const low=FLOOR+(this.caught?.hubOffset??.91);
    const chute={x:-1.02,z:.90};
    if(phase==='descend') {
      const t=ease(elapsed/1.6);x=mix(this.dropStart.x,targetX,t);z=mix(this.dropStart.z,targetZ,t);y=mix(HIGH,low,t);
    } else if(phase==='grip') {
      x=targetX;z=targetZ;y=low;openness=mix(.45,.015,ease(elapsed/.75));
    } else if(phase==='lift') {
      x=targetX;z=targetZ;y=mix(low,HIGH,ease(elapsed/1.8));openness=.015;
    } else if(['travel','release','settle','result'].includes(phase)) {
      const t=phase==='travel'?ease(elapsed/1.7):1;
      x=mix(targetX,chute.x,t);z=mix(targetZ,chute.z,t);
      openness=phase==='release'?mix(.015,.45,ease(elapsed/.55)):['settle','result'].includes(phase)?.45:.015;
    }
    if(phase==='idle') {
      x=-.36+Math.sin(now*.35)*.35;z=-.15+Math.cos(now*.35)*.22;y+=Math.sin(now*1.2)*.023;
    }
    this.claw.position.set(x,y,z);
    this.claw.rotation.z=['lift','travel'].includes(phase)&&!this.reducedMotion?Math.sin(now*4)*.025:0;
    for(const finger of this.fingers) finger.object.quaternion.copy(finger.rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),openness));
    this.crossbar.position.z=z;this.carriage.position.x=x;this.carriage.position.z=z;
    const cableTop=3.51,cableBottom=y+.28;
    this.cable.position.set(x,(cableTop+cableBottom)/2,z);this.cable.scale.y=Math.max(.005,cableTop-cableBottom);
    this.target.position.set(x,FLOOR+.016,z);this.target.visible=['aim','idle'].includes(phase);
    this.ringMaterial.color.setHex(game.aligned?0x729748:0xe87954);
    this.target.scale.setScalar(phase==='idle'?1+Math.sin(now*2)*.04:1);
    if(this.caught) {
      const prize=this.caught;
      if(['lift','travel','release'].includes(phase)) {
        const offset=prize.hubOffset-(prize.baseY-FLOOR);
        prize.object.position.set(x,y-offset,z);
        const swing=this.reducedMotion?0:Math.sin(now*5)*.045;
        prize.object.quaternion.copy(prize.rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),swing));
      } else if(['settle','result'].includes(phase)) {
        if(phase==='settle') {
          const t=clamp(elapsed/1.05,0,1), fall=clamp(t/.73,0,1), exit=ease((t-.73)/.27);
          prize.object.position.set(x,mix(HIGH-prize.hubOffset+(prize.baseY-FLOOR),.54,fall*fall),mix(chute.z,1.42,exit));
          prize.object.quaternion.copy(prize.rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),ease((t-.45)/.35)*Math.PI/2));
          prize.object.scale.setScalar(prize.scale*mix(1,.7,ease((t-.45)/.4)));
          if(t>.97)prize.object.visible=false;
        } else prize.object.visible=false;
      }
    }
    for(let i=0;i<this.prizes.length;i++) {
      const prize=this.prizes[i];
      if(prize===this.caught || prize.kind!=='bunny')continue;
      const time=this.reducedMotion?0:now;
      const head=prize.object.getObjectByName('Head');
      if(head)head.rotation.z=Math.sin(time*.8+i*1.7)*.035;
      for(const [side,sign] of [['Left',-1],['Right',1]]) {
        const ear=prize.object.getObjectByName(side+'_Ear');
        if(ear)ear.rotation.z=sign*.23+Math.sin(time*1.8+i)*.04;
      }
      const paw=prize.object.getObjectByName('Left_Arm');
      if(paw)paw.rotation.z=(phase==='idle' && i===0 && !this.reducedMotion)?-.20+Math.max(0,Math.sin(time*.6))*.3:0;
    }
    // A restrained push-in after the drop; stable camera while the player aims.
    const cinematic=['grip','lift','travel'].includes(phase)&&!this.reducedMotion;
    const desired=this.cameraHome.clone().multiplyScalar(cinematic?.94:1);
    this.camera.position.lerp(desired,1-Math.exp(-dt*2));
    this.currentLook.lerp(this.lookHome,1-Math.exp(-dt*3));this.camera.lookAt(this.currentLook);
    this.renderer.render(this.scene,this.camera);
  }

  setQuality(high) {this.renderer.setPixelRatio(high?Math.min(devicePixelRatio,1.65):1);this.key.shadow.mapSize.set(high?2048:1024,high?2048:1024);this.key.shadow.map?.dispose();this.key.shadow.map=null;this.resize();}
}
