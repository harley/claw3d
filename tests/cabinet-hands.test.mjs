import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { CabinetHands } from '../src/cabinet-hands.js';

// Exercise presentation timing without loading a renderer or network assets.
function rig() {
  const hands = Object.create(CabinetHands.prototype);
  hands.root = new T.Group();
  hands.hands = Object.fromEntries(['left','right'].map(role => [role, {
    pivot: new T.Group(), bends: [], curl: 0, thumb: new T.Object3D(),
    thumbRest: new T.Quaternion(), thumbAxis: new T.Vector3(0,1,0)
  }]));
  const stick = new T.Object3D(), button = new T.Object3D();
  stick.position.set(-1.28,1.70,1.44); button.position.set(1.28,1.72,1.44);
  return { hands, step: (progress, kind='slamming', reduced=false, dt=1/60) => {
    hands.update('aim',0,dt,{profile:'dual',kind,slamProgress:progress},true,stick,button,reduced);
    return hands.hands.right.pivot.position.toArray();
  }};
}

test('a committed 3D strike freezes its pose during host pause and survives lost evidence', () => {
  const {hands,step}=rig();
  const position=step(.4);
  assert.deepEqual(step(.4,'blocked',false,0),position);
  assert.equal(hands.hands.right.pivot.visible,true);
  assert.notDeepEqual(step(.8),position);
});

test('reduced motion keeps the palm stationary throughout committed strike', () => {
  const {step}=rig();
  assert.deepEqual(step(.1,'slamming',true),step(.9,'slamming',true));
});
