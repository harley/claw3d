import test from 'node:test';
import assert from 'node:assert/strict';
import { handInZone, handOffset, inHandRange, projectHandWorkspace } from '../src/hand-workspace.js';
const targets={stick:{x:200,y:600,radius:32},drop:{x:800,y:610,radius:26},bounds:{left:0,right:1000,top:0,bottom:700}};
test('separate physical areas have a neutral centre gap',()=>{
 for(const role of ['left','right'])assert.equal(handInZone({x:.5,y:.5},role),false);
 assert.equal(handInZone({x:.3,y:.5},'left'),true);assert.equal(handInZone({x:.7,y:.5},'right'),true);
 assert.equal(handInZone({x:.7,y:.5},'left'),false);assert.equal(handInZone({x:.3,y:.5},'right'),false);
});
test('relative mapping keeps independent neutral positions and bounded visuals',()=>{
 assert.deepEqual(handOffset({x:.25,y:.4},{x:.25,y:.4}),{x:0,y:0});
 assert.equal(inHandRange(handOffset({x:.25,y:.7},{x:.25,y:.4})),false);
 for(const role of ['left','right']){
  const center=projectHandWorkspace({x:0,y:0},role,targets),control=role==='left'?targets.stick:targets.drop;
  assert.equal(center.x,control.x);assert.equal(center.y,control.y);
  for(const x of [-5,5])for(const y of [-5,5]){
   const p=projectHandWorkspace({x,y},role,targets);
   assert.ok(role==='left'?p.x<500:p.x>500);assert.ok(p.y>=40&&p.y<=665);
  }
 }
});
