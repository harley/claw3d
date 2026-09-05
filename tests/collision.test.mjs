import test from 'node:test';
import {Box3} from 'three';
import assert from 'node:assert/strict';
import {collisionFixture} from './collision-fixture.mjs';
import {geometryCollider,colliderBox,preciseColliderBox,overlap,sampleClawPose,samplePrizePose,HIGH,OPEN,INTERIOR,FLOOR} from '../src/collision.js';

const {contact,cabinet,prizes}=await collisionFixture();
const cabinetCollider=geometryCollider(cabinet);
const phases={descend:1.6,grip:.75,lift:1.8,travel:1.7,release:.55,settle:2,result:0};

test('the complete open claw clears the back wall and glass at all travel limits',()=>{
  for(const x of [contact.field.minX,0,contact.field.maxX])for(const z of [contact.field.minZ,0,contact.field.maxZ]){
    contact.pose({x,y:HIGH,z,angles:[OPEN,OPEN,OPEN]});
    for(const part of contact.parts()){
      const box=colliderBox(part);
      assert.ok(box.min.x>=INTERIOR.minX&&box.max.x<=INTERIOR.maxX);
      assert.ok(box.min.z>=INTERIOR.minZ&&box.max.z<=INTERIOR.maxZ);
      assert.equal(overlap(part,cabinetCollider),false,`cabinet at ${x}, ${z}`);
    }
  }
});

for(const prize of prizes)test(`${prize.id}: real meshes clear every frame from descent to full-size collection`,()=>{
  const plan=contact.plan(prize,prize);
  assert.equal(plan.prize?.id,prize.id,plan.reason);
  assert.ok(plan.contacts.filter(id=>id===prize.id).length>=2,'two distinct fingers support the same prize');
  const target=contact.prizes.find(p=>p.prize===prize);
  for(const [phase,duration] of Object.entries(phases)){
    contact.reset();
    const frames=Math.ceil(duration*60);
    for(let frame=0;frame<=frames;frame++){
      const elapsed=frames?duration*frame/frames:0,pose=sampleClawPose(plan,phase,elapsed);
      contact.pose(pose);
      if(['lift','travel','release','settle','result'].includes(phase)){
        const carried=samplePrizePose(plan,pose,phase,elapsed);
        target.root.position.copy(carried.position);target.root.quaternion.copy(carried.quaternion);
      }
      const where=`${phase} ${elapsed.toFixed(3)}s`;
      for(const part of contact.parts()){
        assert.equal(overlap(part,cabinetCollider),false,`claw/cabinet ${where}`);
        for(const item of contact.prizes)assert.equal(overlap(part,item.collider),false,`claw/${item.prize.id} ${where}`);
      }
      assert.equal(overlap(target.collider,cabinetCollider),false,`carried prize/cabinet ${where}`);
      for(const item of contact.prizes)if(item!==target)assert.equal(overlap(target.collider,item.collider),false,`prize/${item.prize.id} ${where}`);
      assert.equal(target.root.scale.x,prize.scale,'delivery keeps the original scale');
    }
  }
  const end=new Box3().setFromObject(target.root,true);
  assert.ok(end.min.y>=.352&&end.max.y<.96,'prize rests above the metal collection tray');
  assert.ok(end.min.z>1.30,'the full prize exits the outlet');
  assert.ok(end.max.z<2.43,'the full prize fits on the tray');
});

test('unawarded drops stop against toys and reverse without penetrating them',()=>{
  for(const position of [{x:0,z:0},{x:contact.field.minX,z:contact.field.minZ},{x:contact.field.maxX,z:contact.field.maxZ},{x:-1,z:.40}]){
    const plan=contact.plan(position,null);assert.equal(plan.prize,null);
    for(const [phase,duration] of Object.entries(phases)){
      contact.reset();
      for(let frame=0;frame<=Math.ceil(duration*40);frame++){
        contact.pose(sampleClawPose(plan,phase,Math.min(duration,frame/40)));
        for(const part of contact.parts()){
          assert.equal(overlap(part,cabinetCollider),false,`${phase}: cabinet`);
          for(const item of contact.prizes)assert.equal(overlap(part,item.collider),false,`${phase}: ${item.prize.id}`);
        }
      }
    }
  }
});

test('an empty drop reaches the bed with the actual finger tips, including at the back row',()=>{
  prizes.forEach(p=>p.claimed=true);
  try{
    for(const z of [contact.field.minZ,0,contact.field.maxZ]){
      const plan=contact.plan({x:0,z},null);assert.equal(plan.stop,'bed');
      contact.pose(sampleClawPose(plan,'descend',1.6));
      const gap=Math.min(...contact.parts().map(p=>preciseColliderBox(p).min.y))-FLOOR;
      assert.ok(gap>=.005&&gap<.013,`tips should reach the bed, gap=${gap}`);
      for(const part of contact.parts())assert.equal(overlap(part,cabinetCollider),false);
    }
  }finally{prizes.forEach(p=>p.claimed=false);contact.reset();}
});

test('every posed prize rests on the bed and stays separate from the other prizes',()=>{
  contact.reset();
  for(const item of contact.prizes){
    const gap=preciseColliderBox(item.collider).min.y-FLOOR;
    assert.ok(gap>.004&&gap<.008,`${item.prize.id} rests on the bed`);
    for(const other of contact.prizes)if(item!==other)assert.equal(overlap(item.collider,other.collider),false,`${item.prize.id}/${other.prize.id}`);
  }
});
