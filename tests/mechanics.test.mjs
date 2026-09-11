import test from 'node:test';
import assert from 'node:assert/strict';
import { pinchRatio, joystickAxis, matchHand } from '../src/mechanics.js';

test('joystick has a steady neutral zone and clamps its travel',()=>{
  assert.equal(joystickAxis(.01),0);assert.equal(joystickAxis(-.01),0);
  assert.equal(joystickAxis(.34),1);assert.equal(joystickAxis(-.34),-1);
});

test('a pinch uses palm-relative scale, not distance from the camera',()=>{
  const landmarks=Array.from({length:21},()=>({x:0,y:0}));
  landmarks[5]={x:0,y:0};landmarks[17]={x:.2,y:0};landmarks[4]={x:0,y:.1};landmarks[8]={x:.03,y:.1};
  assert.equal(pinchRatio(landmarks),.15);
  assert.equal(pinchRatio(landmarks.map(p=>({x:p.x*2,y:p.y*2}))),.15);
  assert.equal(pinchRatio(Array.from({length:21},()=>({x:0,y:0}))),Infinity);
});

test('hand ownership rejects other handedness, distant hands, and ambiguous matches',()=>{
  const owner={x:.5,y:.5};const hand={center:{x:.52,y:.51},handedness:'Right'};
  assert.equal(matchHand([hand],owner,'Right'),hand);
  assert.equal(matchHand([hand],owner,'Left'),null);
  assert.equal(matchHand([{...hand,center:{x:.9,y:.9}}],owner,'Right'),null);
  assert.equal(matchHand([hand,{...hand,center:{x:.55,y:.51}}],owner,'Right'),null);
});
