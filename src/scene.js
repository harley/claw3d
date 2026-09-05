import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {placePrize} from './prizes.js';
import {ContactClaw,FLOOR,HIGH,OPEN,CLAW_SCALE,PRIZE_LAYOUT,sampleClawPose,samplePrizePose} from './collision.js';

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
    this.scene.environmentIntensity = .27;
    room.dispose(); pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 70);
    this.cameraHome = new THREE.Vector3(4.6, 4.2, 9.4);
    this.lookHome = new THREE.Vector3(0, 2.30, 0);
    this.camera.position.copy(this.cameraHome);
    this.camera.lookAt(this.lookHome);
    this.currentLook = this.lookHome.clone();
    this.scene.add(new THREE.HemisphereLight(0xe7e4dc, 0x32352f, 1.15));
    const key = new THREE.DirectionalLight(0xfff5e6, 1.65);
    key.position.set(-3, 8, 5); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -4, near: .5, far: 20 });
    key.shadow.mapSize.set(2048, 2048); key.shadow.normalBias = .025; key.shadow.bias = -.0001;
    key.shadow.radius = 4; this.scene.add(key); this.key = key;
    const rim = new THREE.DirectionalLight(0xc3d5e0, .65); rim.position.set(4,5,-3);this.scene.add(rim);
    const bounce = new THREE.PointLight(0xfff1d7, 1.4, 5);bounce.position.set(0,3.4,.5);this.scene.add(bounce);
    const redBounce=new THREE.PointLight(0xff7247, .8, 6);redBounce.position.set(-2,1.5,1.7);this.scene.add(redBounce);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({ color: 0x181b23, roughness:.94,metalness:0 }));
    ground.rotation.x=-Math.PI/2;ground.position.y=.003;ground.receiveShadow=true;this.scene.add(ground);
    this.buildArcadeRoom();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1,1),.045,.2,2.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.prizes = []; this.position = { x:-.85,z:.12 }; this.phase = 'idle'; this.phaseTime = 0;
    this.observer = new ResizeObserver(() => this.resize());this.observer.observe(canvas.parentElement);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  buildArcadeRoom() {
    const steel=new THREE.MeshStandardMaterial({color:0x141923,roughness:.36,metalness:.55});
    const wall=new THREE.Mesh(new THREE.BoxGeometry(40,10,.1),steel);wall.position.set(0,4,-5);this.scene.add(wall);
    // Real floor joints give scale without a decorative web-page background.
    const floorGrid=new THREE.GridHelper(40,32,0x30323b,0x292c35);floorGrid.position.y=.006;
    floorGrid.material.transparent=true;floorGrid.material.opacity=.55;this.scene.add(floorGrid);
  }

  buildNeighbours(cabinet,claw,bunny,pillow){
    for(const [x,z,yaw,tint] of [[-4.5,-1.9,.10,0x4f7773],[4.9,-2.4,-.13,0xa48550]]){
      const bank=new THREE.Group(),shell=cabinet.clone(true);bank.add(shell);
      const head=claw.clone(true);head.scale.setScalar(CLAW_SCALE);head.position.set(.2,HIGH,-.25);bank.add(head);
      const cable=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.22,8),new THREE.MeshStandardMaterial({color:0x656863,roughness:.7}));cable.position.set(.2,4.1,-.25);bank.add(cable);
      for(const x of [-1.37,1.37]){const rail=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,2.10),cable.material);rail.position.set(x,4.19,0);bank.add(rail);}
      const crossbar=new THREE.Mesh(new THREE.BoxGeometry(2.92,.09,.12),cable.material);crossbar.position.set(0,4.14,-.25);bank.add(crossbar);
      const carriage=new THREE.Mesh(new THREE.BoxGeometry(.4,.13,.35),cable.material);carriage.position.set(.2,4.08,-.25);bank.add(carriage);
      for(const data of PRIZE_LAYOUT){const item=placePrize((data.kind==='bunny'?bunny:pillow).clone(true),data,FLOOR);bank.add(item.object);}
      // Batch the real manufactured cabinet and plush geometry into static
      // material groups. Background machines have the same construction.
      bank.updateWorldMatrix(true,true);
      const batches=new Map();
      bank.traverse(mesh=>{
        if(!mesh.isMesh)return;
        const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
        // The imported GLB primitives each have one material.
        if(materials.length!==1)return;
        const material=materials[0];let batch=batches.get(material);
        if(!batch){
          const muted=material.clone();muted.envMapIntensity=.2;muted.emissiveIntensity*=.32;
          if(muted.name.includes('Racing red'))muted.color.setHex(tint);
          batch={material:muted,geometries:[]};batches.set(material,batch);
        }
        const source=mesh.geometry,g=new THREE.BufferGeometry();
        for(const attr of ['position','normal','uv'])if(source.attributes[attr])g.setAttribute(attr,source.attributes[attr].clone());
        if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(source.attributes.position.count*2),2));
        if(source.index)g.setIndex(source.index.clone());g.applyMatrix4(mesh.matrixWorld);
        if(g.index){batch.geometries.push(g.toNonIndexed());g.dispose();}else batch.geometries.push(g);
      });
      const display=new THREE.Group();
      for(const {material,geometries} of batches.values()){
        const mesh=new THREE.Mesh(mergeGeometries(geometries,false),material);mesh.receiveShadow=true;mesh.userData.background=true;display.add(mesh);geometries.forEach(g=>g.dispose());
      }
      const glass=new THREE.Mesh(new THREE.BoxGeometry(3.18,3.06,2.27),new THREE.MeshStandardMaterial({color:0xc4d2cf,transparent:true,opacity:.025,roughness:.8,depthWrite:false}));glass.position.y=2.74;glass.userData.background=true;display.add(glass);
      display.position.set(x,0,z);display.rotation.y=yaw;this.scene.add(display);
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
    this.claw.scale.setScalar(CLAW_SCALE);
    for(const data of PRIZE_LAYOUT){
      const prize=placePrize((data.kind==='bunny'?bunny.scene:pillow.scene).clone(true),data,FLOOR);
      this.scene.add(prize.object);this.prizes.push(prize);
    }
    this.buildNeighbours(cabinet.scene,claw.scene,bunny.scene,pillow.scene);
    this.contact=new ContactClaw(this.claw,this.prizes);this.field=this.contact.field;
    const steel=new THREE.MeshStandardMaterial({color:0xdce6ef,metalness:.55,roughness:.48});
    const teal=new THREE.MeshStandardMaterial({color:0x18202b,metalness:.15,roughness:.65});
    for(const x of [-1.37,1.37]) {
      const rail=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,2.10),steel);rail.position.set(x,4.19,0);this.scene.add(rail);
    }
    this.crossbar=new THREE.Mesh(new THREE.BoxGeometry(2.92,.09,.12),steel);this.crossbar.position.y=4.14;this.scene.add(this.crossbar);
    this.carriage=new THREE.Mesh(new THREE.BoxGeometry(.4,.13,.35),teal);this.carriage.position.y=4.08;this.scene.add(this.carriage);
    this.cable=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,1,12),teal);this.scene.add(this.cable);
    this.target=new THREE.Group();this.scene.add(this.target);
    const ringMaterial=new THREE.MeshBasicMaterial({color:0xffcf53,transparent:true,opacity:.94,depthWrite:false});
    const ring=new THREE.Mesh(new THREE.RingGeometry(.252,.272,64),ringMaterial);ring.rotation.x=-Math.PI/2;this.target.add(ring);this.ringMaterial=ringMaterial;
    for(const rotation of [0,Math.PI/2]) {
      const bar=new THREE.Mesh(new THREE.BoxGeometry(.13,.003,.007),ringMaterial);bar.rotation.y=rotation;this.target.add(bar);
    }
    // Thin reflective door glass keeps the prizes visible while showing the enclosure.
    const glass=new THREE.MeshPhysicalMaterial({color:0xbce3ff,metalness:0,roughness:.3,transparent:true,opacity:.018,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:.2});
    for(const x of [-1.66,1.66]) {
      const pane=new THREE.Mesh(new THREE.PlaneGeometry(2.27,3.06),glass);pane.rotation.y=Math.PI/2;pane.position.set(x,2.74,0);this.scene.add(pane);
    }
    const frontGlass=new THREE.Mesh(new THREE.PlaneGeometry(3.15,3.00),glass);frontGlass.position.set(0,2.79,1.185);this.scene.add(frontGlass);
    const reflection=new THREE.MeshBasicMaterial({color:0xd0e8ff,transparent:true,opacity:.016,depthWrite:false,side:THREE.DoubleSide});
    for(const [x,width] of [[-1.31,.025],[1.16,.065]]) {
      const shine=new THREE.Mesh(new THREE.PlaneGeometry(width,2.92),reflection);shine.position.set(x,2.79,1.192);shine.rotation.z=-.10;this.scene.add(shine);
    }
    this.scene.traverse(object=>{if(object.isMesh && object!==this.target && object.material!==glass){object.castShadow=!object.userData.background;object.receiveShadow=true;}});
    // Target indicators and shadow receiver must not themselves cast shadows.
    this.target.traverse(o=>{o.castShadow=false;o.receiveShadow=false;});
    this.ready=true;this.resize();this.update(0,.016,{phase:'idle',position:this.position});
  }

  resize() {
    const { width,height }=this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;
    this.composer?.setSize(width,height);
    // Frame the full cabinet above the control deck, including in a narrow app panel.
    const visibleHeight=Math.max(6.7,5.7/this.camera.aspect);
    this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(visibleHeight/(2*this.cameraHome.distanceTo(this.lookHome))));
    this.camera.setViewOffset(width,height,0,height*.07,width,height);
    this.camera.updateProjectionMatrix();
  }

  beginDrop(prize,position) {
    this.plan=this.contact.plan(position,prize);
    this.caught=this.plan.prize;
    return this.caught;
  }

  reset() {
    for(const p of this.prizes) {
      p.object.visible=true;p.claimed=false;p.object.position.set(p.x,p.baseY,p.z);p.object.quaternion.copy(p.rest);p.object.scale.setScalar(p.scale);
    }
    this.caught=null;this.plan=null;this.contact.reset();
  }

  update(now,dt,game) {
    if(!this.ready)return;
    const {phase,elapsed=0}=game;const p=game.position;
    this.cabinetStick.rotation.z=-(game.controlInput?.x||0)*.22;
    this.cabinetStick.rotation.x=(game.controlInput?.z||0)*.22;
    this.cabinetDrop.position.y=this.cabinetDropY-(phase==='descend'?.035:0);
    const safe=this.contact.clamp(p);this.position=safe;
    const sampled=this.plan && !['idle','aim'].includes(phase)?sampleClawPose(this.plan,phase,elapsed):{...safe,y:HIGH,angles:[OPEN,OPEN,OPEN]};
    let {x,y,z,angles}=sampled;
    if(phase==='idle') {
      const idle=this.contact.clamp({x:-.36+Math.sin(now*.35)*.35,z:-.05+Math.cos(now*.35)*.18});x=idle.x;z=idle.z;
    }
    this.claw.position.set(x,y,z);
    this.claw.rotation.z=0;
    this.fingers.forEach((finger,i)=>finger.object.quaternion.copy(finger.rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angles[i])));
    this.crossbar.position.z=z;this.carriage.position.x=x;this.carriage.position.z=z;
    const cableTop=4.13,cableBottom=y+.28*CLAW_SCALE;
    this.cable.position.set(x,(cableTop+cableBottom)/2,z);this.cable.scale.y=Math.max(.005,cableTop-cableBottom);
    this.target.position.set(x,FLOOR+.016,z);this.target.visible=['aim','idle'].includes(phase);
    this.ringMaterial.color.setHex(game.aligned?0x72ffad:0xffcf53);
    this.target.scale.setScalar(phase==='idle'?1+Math.sin(now*2)*.04:1);
    if(this.caught && ['lift','travel','release','settle','result'].includes(phase)) {
      const prizePose=samplePrizePose(this.plan,{x,y,z},phase,elapsed);
      this.caught.object.position.copy(prizePose.position);
      this.caught.object.quaternion.copy(prizePose.quaternion);
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
