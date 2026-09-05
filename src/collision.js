import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MeshBVH} from 'three-mesh-bvh';
import {clamp,ease} from './mechanics.js';

export const FLOOR=1.19;
export const HIGH=3.78;
export const OPEN=.45;
export const INTERIOR={minX:-1.565,maxX:1.565,minZ:-1.025,maxZ:1.165,minY:FLOOR,maxY:4.32};
export const CHUTE={x:-.98,z:.39};
export const PRIZE_LAYOUT=[
  {id:'bunny-1',kind:'bunny',x:-.88,z:-.48,angle:.09,scale:.76},
  {id:'bunny-2',kind:'bunny',x:0,z:.45,angle:-.13,scale:.72},
  {id:'bunny-3',kind:'bunny',x:.87,z:-.48,angle:-.18,scale:.74},
  {id:'bunny-4',kind:'bunny',x:0,z:-.48,angle:.20,scale:.71},
  {id:'pillow-1',kind:'pillow',x:.93,z:.48,angle:-.15,scale:1},
];
const axis=new THREE.Vector3(0,0,1);
const q=new THREE.Quaternion();

export function geometryCollider(root,accept=()=>true){
  root.updateWorldMatrix(true,true);
  const inverse=root.matrixWorld.clone().invert(),pieces=[];
  root.traverse(mesh=>{
    if(!mesh.isMesh||!accept(mesh))return;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',mesh.geometry.getAttribute('position').clone());
    if(mesh.geometry.index)geometry.setIndex(mesh.geometry.index.clone());
    geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
    if(geometry.index){pieces.push(geometry.toNonIndexed());geometry.dispose();}else pieces.push(geometry);
  });
  const geometry=mergeGeometries(pieces,false);pieces.forEach(p=>p.dispose());
  geometry.computeBoundingBox();geometry.boundsTree=new MeshBVH(geometry,{targetLeafSize:8});
  return{root,geometry,box:geometry.boundingBox,worldBox:new THREE.Box3()};
}
export function colliderBox(collider){
  collider.root.updateWorldMatrix(true,false);
  return collider.worldBox.copy(collider.box).applyMatrix4(collider.root.matrixWorld);
}
export function overlap(a,b){
  if(!colliderBox(a).intersectsBox(colliderBox(b)))return false;
  return b.geometry.boundsTree.intersectsGeometry(a.geometry,b.root.matrixWorld.clone().invert().multiply(a.root.matrixWorld));
}
const inWalls=box=>box.min.x>=INTERIOR.minX && box.max.x<=INTERIOR.maxX && box.min.z>=INTERIOR.minZ && box.max.z<=INTERIOR.maxZ && box.min.y>=INTERIOR.minY && box.max.y<=INTERIOR.maxY;

export class ContactClaw {
  constructor(claw,prizes){
    this.root=claw.clone(true);this.root.position.set(0,HIGH,0);this.root.rotation.set(0,0,0);
    this.fingers=[0,1,2].map(i=>{const root=this.root.getObjectByName(`Finger_${i}`);return{root,rest:root.quaternion.clone(),collider:geometryCollider(root)};});
    const belongsToFinger=mesh=>{for(let p=mesh;p;p=p.parent)if(this.fingers.some(f=>f.root===p))return true;return false;};
    this.hub=geometryCollider(this.root,mesh=>!belongsToFinger(mesh));
    this.prizes=prizes.map(prize=>{const root=prize.object.clone(true);root.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(root,true);return{prize,root,rest:root.position.clone(),rotation:root.quaternion.clone(),collider:geometryCollider(root),center:box.getCenter(new THREE.Vector3()).sub(root.position),landingY:.365+box.getSize(new THREE.Vector3()).z/2};});
    this.pose({x:0,y:HIGH,z:0,angles:[OPEN,OPEN,OPEN]});
    const box=new THREE.Box3().makeEmpty();for(const part of this.parts())box.union(colliderBox(part));
    this.field={minX:INTERIOR.minX-box.min.x+.012,maxX:INTERIOR.maxX-box.max.x-.012,minZ:INTERIOR.minZ-box.min.z+.012,maxZ:INTERIOR.maxZ-box.max.z-.012};
  }
  parts(){return[this.hub,...this.fingers.map(f=>f.collider)];}
  pose(pose){
    this.root.position.set(pose.x,pose.y,pose.z);
    this.fingers.forEach((f,i)=>f.root.quaternion.copy(f.rest).multiply(q.setFromAxisAngle(axis,pose.angles[i])));
    this.root.updateWorldMatrix(true,true);
  }
  hit(part,ignore=null){
    if(!inWalls(colliderBox(part)))return{kind:'wall'};
    for(const target of this.prizes)if(target!==ignore&&!target.prize.claimed&&overlap(part,target.collider))return{kind:'prize',target};
    return null;
  }
  anyHit(ignore=null){for(const part of this.parts()){const hit=this.hit(part,ignore);if(hit)return hit;}return null;}
  clamp(position){return{x:clamp(position.x,this.field.minX,this.field.maxX),z:clamp(position.z,this.field.minZ,this.field.maxZ)};}
  reset(){for(const p of this.prizes){p.root.position.copy(p.rest);p.root.quaternion.copy(p.rotation);p.root.updateWorldMatrix(true,true);}}

  plan(position,candidate){
    this.reset();
    const start=this.clamp(position),target=this.clamp(candidate||position);
    let pose={...target,y:HIGH,angles:[OPEN,OPEN,OPEN]},reason='No secure grip.';
    this.pose(pose);
    // At travel height every open finger is above the prize pile. Descent uses
    // <=8 mm steps, smaller than the thinnest claw tube, and leaves the last clear pose.
    for(let y=HIGH-.008;y>=FLOOR+.80;y-=.008){
      const next={...pose,y};this.pose(next);
      if(this.anyHit())break;
      pose=next;
    }
    this.pose(pose);
    const low=pose.y,angles=[...pose.angles],contacts=[];
    for(let i=0;i<3;i++){
      for(let angle=OPEN-.012;angle>=.015;angle-=.012){
        const next=[...angles];next[i]=angle;this.pose({...pose,angles:next});
        const hit=this.hit(this.fingers[i].collider);
        if(hit){contacts[i]=hit;break;}angles[i]=angle;
      }
      this.pose({...pose,angles});
    }
    const supported=this.prizes.find(p=>p.prize===candidate && contacts.filter(c=>c?.target===p).length>=2);
    let caught=supported||null;
    const offset=caught?low-caught.rest.y:0;
    const offsetX=caught?caught.rest.x-target.x:0,offsetZ=caught?caught.rest.z-target.z:0;
    const destination=this.clamp({x:CHUTE.x-offsetX,z:CHUTE.z-offsetZ});
    if(caught){
      // Validate the whole carried prize, not just the claw or its centre.
      // A blocked lift/transfer is a miss instead of a prize tunnelling through.
      for(let i=0;i<=140;i++){
        const t=i/140;
        const y=t<.5?THREE.MathUtils.lerp(low,HIGH,t*2):HIGH;
        const x=t<.5?target.x:THREE.MathUtils.lerp(target.x,destination.x,(t-.5)*2);
        const z=t<.5?target.z:THREE.MathUtils.lerp(target.z,destination.z,(t-.5)*2);
        caught.root.position.set(x+offsetX,y-offset,z+offsetZ);this.pose({x,y,z,angles});
        const box=colliderBox(caught.collider);
        if(!inWalls(box)||this.prizes.some(p=>p!==caught&&!p.prize.claimed&&overlap(caught.collider,p.collider))||this.anyHit(caught)){
          reason='The prize cannot clear its neighbours.';caught=null;break;
        }
      }
    }
    this.reset();
    // A failed grip reverses its contact-limited closing path before rising.
    const plan={start,target,low,angles,destination,prize:caught?.prize??null,offset: caught?offset:0,offsetX,offsetZ,center:caught?.center.clone(),landingY:caught?.landingY,reason:caught?'Secure grip.':reason,contacts:contacts.map(c=>c?.target?.prize.id||c?.kind||null)};
    this.pose({x:start.x,y:HIGH,z:start.z,angles:[OPEN,OPEN,OPEN]});
    return plan;
  }
}

export function sampleClawPose(plan,phase,elapsed){
  const {start,target,low,angles:closed,destination}=plan;
  let x=target.x,z=target.z,y=HIGH,angles=[OPEN,OPEN,OPEN];
  if(phase==='descend'){
    const alignment=ease(elapsed/.35);x=THREE.MathUtils.lerp(start.x,target.x,alignment);z=THREE.MathUtils.lerp(start.z,target.z,alignment);
    y=THREE.MathUtils.lerp(HIGH,low,ease((elapsed-.35)/1.25));
  }else if(phase==='grip'){
    y=low;const closure=plan.prize?ease(elapsed/.75):elapsed<.45?ease(elapsed/.45):1-ease((elapsed-.45)/.30);
    angles=closed.map(a=>THREE.MathUtils.lerp(OPEN,a,closure));
  }else if(phase==='lift'){
    y=THREE.MathUtils.lerp(low,HIGH,ease(elapsed/1.8));if(plan.prize)angles=closed;
  }else{
    const t=phase==='travel'?ease(elapsed/1.7):1;
    x=THREE.MathUtils.lerp(target.x,destination.x,t);z=THREE.MathUtils.lerp(target.z,destination.z,t);
    if(plan.prize)angles=closed.map(a=>phase==='release'?THREE.MathUtils.lerp(a,OPEN,ease(elapsed/.55)):['settle','result'].includes(phase)?OPEN:a);
  }
  return{x,y,z,angles};
}

export function samplePrizePose(plan,claw,phase,elapsed){
  const position=new THREE.Vector3(claw.x+plan.offsetX,claw.y-plan.offset,claw.z+plan.offsetZ);
  const quaternion=plan.prize.rest.clone();
  if(phase==='settle'||phase==='result'){
    const t=phase==='result'?1:clamp(elapsed/2,0,1),fall=clamp(t/.70,0,1),exit=ease((t-.70)/.30);
    const tip=ease((fall-.40)/.50)*Math.PI/2;
    const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),tip);
    const centerOffset=plan.center.clone().applyQuaternion(rotation);
    const startY=HIGH-plan.offset+plan.center.y;
    const centerY=THREE.MathUtils.lerp(startY,plan.landingY,fall*fall);
    quaternion.copy(rotation).multiply(plan.prize.rest);
    position.set(plan.destination.x+plan.offsetX+plan.center.x-centerOffset.x,centerY-centerOffset.y,THREE.MathUtils.lerp(THREE.MathUtils.lerp(plan.destination.z+plan.offsetZ+plan.center.z,.55,ease((fall-.30)/.35)),1.86,exit)-centerOffset.z);
  }
  return{position,quaternion};
}
