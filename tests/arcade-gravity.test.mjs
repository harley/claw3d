import test from 'node:test';
import assert from 'node:assert/strict';
import { supportHull, supportAt, gravityStep, hangingStep } from '../src/arcade-gravity.js';

// Contract: gravity seeks a supported lower-energy pose, not an arbitrary
// stored tilt. The old contact replay only checked that a pose persisted.
const profile = { hull: supportHull([{x:-.15,y:0},{x:.15,y:0},{x:.15,y:.8},{x:-.15,y:.8}]), cy:.4, inertia:.18, damping:6 };
const settle = angle => {
 let state={angle,velocity:0};
 for(let i=0;i<1200&&!state.sleeping;i++) state=gravityStep(profile,state,1/120);
 return state;
};
test('gravity restores a small lean and topples a body beyond its support',()=>{
 const small=settle(.12), tipped=settle(.8);
 assert.ok(Math.abs(small.angle)<.015, JSON.stringify(small));
 assert.ok(Math.abs(tipped.angle-Math.PI/2)<.015, JSON.stringify(tipped));
 assert.ok(supportAt(profile,tipped.angle).height<supportAt(profile,.8).height);
 assert.ok(Math.abs(tipped.velocity)<.1);
});
test('a held toy swings toward a hanging equilibrium rather than keeping its floor pose',()=>{
 let state={angle:1,velocity:0};
 for(let i=0;i<480;i++)state=hangingStep(state,1/120);
 assert.equal(state.angle,0); assert.equal(state.velocity,0);
});
