import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ease, clamp } from './mechanics.js';

const FLOOR = 1.19;
const HIGH = 3.27;
const mix = THREE.MathUtils.lerp;

export class ClawScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    this.renderer.setClearColor(0x080a10, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .87;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080a10);
    this.scene.fog = new THREE.FogExp2(0x080a10, .055);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .6;
    room.dispose(); pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 70);
    this.cameraHome = new THREE.Vector3(4.6, 4.2, 9.4);
    this.lookHome = new THREE.Vector3(0, 2.05, 0);
    this.camera.position.copy(this.cameraHome);
    this.camera.lookAt(this.lookHome);
    this.currentLook = this.lookHome.clone();
    this.scene.add(new THREE.HemisphereLight(0xcde4ff, 0x171522, .85));
    const key = new THREE.DirectionalLight(0xfff7ed, 2.0);
    key.position.set(-3, 8, 5); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -4, near: .5, far: 20 });
    key.shadow.mapSize.set(2048, 2048); key.shadow.normalBias = .025; key.shadow.bias = -.0001;
    key.shadow.radius = 4; this.scene.add(key); this.key = key;
    const rim = new THREE.DirectionalLight(0x83c6ff, 1.8); rim.position.set(4,5,-3);this.scene.add(rim);
    const bounce = new THREE.PointLight(0xe4f2ff, 6, 5);bounce.position.set(0,3.4,.5);this.scene.add(bounce);
    const redBounce=new THREE.PointLight(0xff183c, 8, 6);redBounce.position.set(-2,1.5,1.7);this.scene.add(redBounce);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({ color: 0x181b23, roughness:.3,metalness:.5 }));
    ground.rotation.x=-Math.PI/2;ground.position.y=.003;ground.receiveShadow=true;this.scene.add(ground);
    this.buildArcadeRoom();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1,1),.12,.22,2.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.prizes = []; this.position = { x:-.85,z:.12 }; this.phase = 'idle'; this.phaseTime = 0;
    this.observer = new ResizeObserver(() => this.resize());this.observer.observe(canvas.parentElement);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  buildArcadeRoom() {
    const steel=new THREE.MeshStandardMaterial({color:0x141923,roughness:.36,metalness:.55});
    const black=new THREE.MeshStandardMaterial({color:0x04070c,roughness:.22,metalness:.25});
    const wall=new THREE.Mesh(new THREE.BoxGeometry(40,10,.1),steel);wall.position.set(0,4,-5);this.scene.add(wall);
    // Real floor joints give scale without a decorative web-page background.
    const floorGrid=new THREE.GridHelper(40,32,0x30323b,0x292c35);floorGrid.position.y=.006;
    floorGrid.material.transparent=true;floorGrid.material.opacity=.55;this.scene.add(floorGrid);
    for(const [x,color] of [[-5,0xff2446],[5,0x32c0ed]]) {
      const bank=new THREE.Group();bank.position.set(x,0,-1.65);bank.rotation.y=x>0?-.16:.16;
      this.scene.add(bank);
      const glow=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:3,roughness:.25});
      const part=(w,h,d,px,py,pz,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(px,py,pz);bank.add(m);return m;};
      part(2.8,1.1,2.4,0,.55,0,steel);part(2.8,2.7,.1,0,2.45,-1.15,black);
      for(const xx of [-1.32,1.32]) {part(.12,2.9,.15,xx,2.50,1.10,steel);part(.025,2.67,.02,xx,2.50,1.19,glow);}
      part(2.9,.55,2.5,0,4.02,0,steel);part(2.7,.20,.025,0,4.03,1.265,glow);
      part(2.9,.035,.03,0,1.15,1.24,glow);part(.85,.40,.03,-.7,.6,1.22,black);
      for(let i=0;i<8;i++) {
        const ball=new THREE.Mesh(new THREE.SphereGeometry(.26,16,12),new THREE.MeshStandardMaterial({color:i%2?0x648cba:0xba6479,roughness:.9}));
        ball.position.set((i%4-.5)*.50-.5,1.3+Math.floor(i/4)*.25,(i%3)*.38-.6);bank.add(ball);
      }
      const pool=new THREE.PointLight(color,18,9);pool.position.set(x,2,0);this.scene.add(pool);
    }
  }

  async load() {
    const loader = new GLTFLoader();
    const [cabinet,bunny,pillow,claw] = await Promise.all(['cabinet','bunny','pillow','claw'].map(name=>loader.loadAsync(`/models/${name}.glb`)));
    this.machine = cabinet.scene;this.scene.add(this.machine);
    this.cabinetStick=this.machine.getObjectByName('Cabinet_joystick');
    this.cabinetDrop=this.machine.getObjectByName('Cabinet_drop_button');
    this.cabinetDropY=this.cabinetDrop.position.y;
    this.claw = claw.scene;this.scene.add(this.claw);
    this.fingers = [0,1,2].map(i=> { const object = this.claw.getObjectByName(`Finger_${i}`);return {object,rest:object.quaternion.clone()}; });
    this.bunnyTemplate=bunny.scene;
    const layout = [
      {id:'bunny-1',kind:'bunny',x:-.85,z:.12,angle:.09,scale:.76},
      {id:'bunny-2',kind:'bunny',x:0,z:.52,angle:-.13,scale:.72},
      {id:'bunny-3',kind:'bunny',x:.72,z:-.50,angle:-.18,scale:.74},
      {id:'bunny-4',kind:'bunny',x:-.83,z:-.52,angle:.20,scale:.71},
      {id:'pillow-1',kind:'pillow',x:.95,z:.50,angle:-.15,scale:1},
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
    const steel=new THREE.MeshStandardMaterial({color:0xdce6ef,metalness:.95,roughness:.2});
    const teal=new THREE.MeshStandardMaterial({color:0x18202b,metalness:.6,roughness:.26});
    for(const x of [-1.37,1.37]) {
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,2.10),steel);rail.position.set(x,3.69,0);this.scene.add(rail);
    }
    this.crossbar=new THREE.Mesh(new THREE.BoxGeometry(2.92,.09,.12),steel);this.crossbar.position.y=3.64;this.scene.add(this.crossbar);
    this.carriage=new THREE.Mesh(new THREE.BoxGeometry(.4,.13,.35),teal);this.carriage.position.y=3.58;this.scene.add(this.carriage);
    this.cable=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,1,12),teal);this.scene.add(this.cable);
    this.target=new THREE.Group();this.scene.add(this.target);
    const ringMaterial=new THREE.MeshBasicMaterial({color:0xffcf53,transparent:true,opacity:.94,depthWrite:false});
    const ring=new THREE.Mesh(new THREE.RingGeometry(.252,.272,64),ringMaterial);ring.rotation.x=-Math.PI/2;this.target.add(ring);this.ringMaterial=ringMaterial;
    for(const rotation of [0,Math.PI/2]) {
      const bar=new THREE.Mesh(new THREE.BoxGeometry(.13,.003,.007),ringMaterial);bar.rotation.y=rotation;this.target.add(bar);
    }
    // Thin reflective door glass keeps the prizes visible while showing the enclosure.
    const glass=new THREE.MeshPhysicalMaterial({color:0xbce3ff,metalness:.15,roughness:.05,transparent:true,opacity:.055,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:1.5});
    for(const x of [-1.66,1.66]) {
      const pane=new THREE.Mesh(new THREE.PlaneGeometry(2.27,2.56),glass);pane.rotation.y=Math.PI/2;pane.position.set(x,2.49,0);this.scene.add(pane);
    }
    const frontGlass=new THREE.Mesh(new THREE.PlaneGeometry(3.15,2.50),glass);frontGlass.position.set(0,2.54,1.185);this.scene.add(frontGlass);
    const reflection=new THREE.MeshBasicMaterial({color:0xd0e8ff,transparent:true,opacity:.055,depthWrite:false,side:THREE.DoubleSide});
    for(const [x,width] of [[-1.31,.025],[1.16,.065]]) {
      const shine=new THREE.Mesh(new THREE.PlaneGeometry(width,2.42),reflection);shine.position.set(x,2.54,1.192);shine.rotation.z=-.10;this.scene.add(shine);
    }
    this.scene.traverse(object=>{if(object.isMesh && object!==this.target && object.material!==glass){object.castShadow=true;object.receiveShadow=true;}});
    // Target indicators and shadow receiver must not themselves cast shadows.
    this.target.traverse(o=>{o.castShadow=false;o.receiveShadow=false;});
    this.ready=true;this.resize();this.update(0,.016,{phase:'idle',position:this.position});
  }

  resize() {
    const { width,height }=this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;
    this.composer?.setSize(width,height);
    // Frame the full cabinet above the control deck, including in a narrow app panel.
    const visibleHeight=Math.max(6.05,5.7/this.camera.aspect);
    this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(visibleHeight/(2*this.cameraHome.distanceTo(this.lookHome))));
    this.camera.setViewOffset(width,height,0,height*.07,width,height);
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
    this.cabinetStick.rotation.z=-(game.controlInput?.x||0)*.22;
    this.cabinetStick.rotation.x=(game.controlInput?.z||0)*.22;
    this.cabinetDrop.position.y=this.cabinetDropY-(phase==='descend'?.035:0);
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
    this.ringMaterial.color.setHex(game.aligned?0x72ffad:0xffcf53);
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
    this.renderer.info.reset();
    this.composer.render();
  }

  setQuality(high) {this.renderer.setPixelRatio(high?Math.min(devicePixelRatio,1.65):1);this.composer.setPixelRatio(this.renderer.getPixelRatio());this.bloom.enabled=high;this.key.shadow.mapSize.set(high?2048:1024,high?2048:1024);this.key.shadow.map?.dispose();this.key.shadow.map=null;this.resize();}
}
