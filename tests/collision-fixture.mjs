import {loadModel} from './load-model.mjs';
import {ContactClaw,PRIZE_LAYOUT,FLOOR} from '../src/collision.js';
import {placePrize} from '../src/prizes.js';
export async function collisionFixture(){
  const [claw,bunny,pillow,cabinet]=await Promise.all(['claw','bunny','pillow','cabinet'].map(loadModel));
  const prizes=PRIZE_LAYOUT.map(p=>placePrize((p.kind==='bunny'?bunny:pillow).clone(true),p,FLOOR));
  return{claw,prizes,cabinet,contact:new ContactClaw(claw,prizes)};
}
