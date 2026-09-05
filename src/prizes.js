import {Box3} from 'three';

// Ground every pose from its mesh, so leaning or lying prizes never float.
export function placePrize(object,data,floor){
  object.scale.setScalar(data.scale);
  object.rotation.set((data.kind==='pillow'&&data.upright?Math.PI/2:0)+(data.lean||0),data.angle||0,data.roll||0);
  object.position.set(data.x,0,data.z);
  object.position.y=floor-new Box3().setFromObject(object,true).min.y+.006;
  return{...data,object,baseY:object.position.y,rest:object.quaternion.clone(),catchRadius:data.kind==='bunny'?.20:.23,claimed:false};
}
