import * as THREE from 'three';
import {loadModel} from './load-model.mjs';
import {ContactClaw,PRIZE_LAYOUT,FLOOR} from '../src/collision.js';
export async function collisionFixture(){
  const [claw,bunny,pillow,cabinet]=await Promise.all(['claw','bunny','pillow','cabinet'].map(loadModel));
  const prizes=PRIZE_LAYOUT.map(p=>{
    const object=(p.kind==='bunny'?bunny:pillow).clone(true);
    object.position.set(p.x,FLOOR+(p.kind==='pillow'?.48:0),p.z);object.scale.setScalar(p.scale);
    object.rotation.y=p.angle;if(p.kind==='pillow')object.rotation.x=Math.PI/2;
    return{...p,object,rest:object.quaternion.clone(),claimed:false};
  });
  const obstacles=[[-1.30,-.62],[1.32,-.04],[.44,.02]].map(([x,z],i)=>{
    const object=new THREE.Mesh(new THREE.SphereGeometry(.15,24,16));
    object.scale.y=.83;object.position.set(x,FLOOR+.12,z);
    return{id:`capsule-${i}`,object,claimed:false};
  });
  return{claw,prizes,cabinet,contact:new ContactClaw(claw,[...prizes,...obstacles])};
}
