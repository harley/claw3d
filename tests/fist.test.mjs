import test from 'node:test';
import assert from 'node:assert/strict';
import {FistDrop,fistEvidence} from '../src/fist.js';
import {HandController} from '../src/vision.js';

function landmarks(folded=0,dx=0){
  const points=Array.from({length:21},()=>({x:.5+dx,y:.5,z:0}));
  points[0].y=.66;
  for(const [i,m] of [5,9,13,17].entries()){
    const x=.44+i*.04+dx;
    points[m]={x,y:.51};points[m+1]={x,y:.43};points[m+2]={x,y:.38};
    points[m+3]={x,y:i<folded?.57:.32};
  }
  return points;
}
const open={open:true},closed={closed:true};
function arm(g){for(let t=1000;t<=1260;t+=65)g.update(open,t);assert.equal(g.armed,true);}
test('folded fingers recognize a fist without requiring a particular thumb pose',()=>{
  assert.equal(fistEvidence(landmarks(4),'None').closed,true);
  const loose=landmarks(3);loose[20].y=.44;
  assert.equal(fistEvidence(loose,'None').closed,true);
  assert.equal(fistEvidence(landmarks(3),'Pointing_Up',.9).closed,false);
  assert.equal(fistEvidence(landmarks(1),'None').closed,false);
  assert.equal(fistEvidence(landmarks(0),'None').open,true);
  assert.equal(fistEvidence(landmarks(2),'Closed_Fist',.9).closed,true);
  assert.equal(fistEvidence(landmarks(2),'Closed_Fist',.3).closed,false);
});
test('a fist needs an open hand first and a sustained hold, and fires only once',()=>{
  for (const intervals of [Array(17).fill(33), Array(9).fill(65), [33, 90, 120, 45, 200, 61, 1], [275, 275]]) {
    const g = new FistDrop();
    for (let t = 100; t < 1000; t += 65) assert.equal(g.update(closed, t).fired, false);
    g.reset(); arm(g);
    let time = 1325;
    assert.equal(g.update(closed, time).fired, false, 'open-to-closed time earns no hold credit');
    for (const [index, gap] of intervals.entries()) {
      time += gap;
      assert.equal(g.update(closed, time).fired, index === intervals.length - 1,
        `hold at ${time - 1325} ms with intervals ${intervals}`);
    }
    for (let i = 0; i < 16; i++) assert.equal(g.update(closed, time += 65).fired, false, 'one drop per hold');
  }
});
test('opening cancels a pending fist without carrying hold time into the next attempt',()=>{
  const g=new FistDrop();arm(g);
  for(let t=1325;t<=1585;t+=65)g.update(closed,t);
  assert.equal(g.update(open,1650).active,false);
  assert.equal(g.update(closed,1715).progress,0);
});
test('uncertain frames do not advance the hold and a long loss requires rearming',()=>{
  const g=new FistDrop();arm(g);g.update(closed,1325);const held=g.held;
  assert.equal(g.update({},1390).progress,held/550);
  assert.equal(g.update(closed,1455).progress,held/550);
  assert.equal(g.update(closed,1800).active,false);
  for(let t=1865;t<2900;t+=65)assert.equal(g.update(closed,t).fired,false);
});
test('another hand or disappearance cancels the fist confirmation',()=>{
  for(const evidence of [{visible:false},{}]){
    const g=new FistDrop();arm(g);g.update(closed,1325);
    for(let t=1390;t<=1650;t+=65)g.update(evidence,t);
    assert.equal(g.held,0);assert.equal(g.update(closed,1715).fired,false);
  }
});

function controller(){
  const c=Object.create(HandController.prototype),events={drops:0,starts:0,inputs:[],states:[]};
  let phase='idle';c.getPhase=()=>phase;
  c.onInput=input=>events.inputs.push({...input});c.onState=state=>events.states.push(state);
  c.onDrop=()=>events.drops++;c.onStart=()=>{events.starts++;phase='aim';};c.draw=()=>{};c.resetOwner();
  return{c,events,setPhase:value=>{phase=value;}};
}
function result(folded=0,dx=0){return{landmarks:[landmarks(folded,dx)],handedness:[[{categoryName:'Right'}]],gestures:[[{categoryName:'None',score:0}]]};}
function claim(c){c.handle(result(),1000);c.handle(result(),1520);for(let t=1585;t<=1845;t+=65)c.handle(result(),t);}
test('camera steering freezes during fist confirmation and drops once',()=>{
  const{c,events}=controller();claim(c);assert.equal(events.starts,1);
  c.handle(result(0,-.06),1910);assert.ok(events.inputs.at(-1).x>0);
  for(let t=1975;t<=2560;t+=65){c.handle(result(4,-.06),t);assert.deepEqual(events.inputs.at(-1),{x:0,z:0});}
  assert.equal(events.drops,1);c.handle(result(4,-.06),2625);assert.equal(events.drops,1);
});
test('opening after a partial fist recentres the joystick without a jump',()=>{
  const{c,events}=controller();claim(c);
  c.handle(result(0,-.06),1910);c.handle(result(4,-.06),1975);c.handle(result(4,-.07),2040);
  c.handle(result(0,-.07),2105);assert.deepEqual(events.inputs.at(-1),{x:0,z:0});assert.equal(events.drops,0);
  c.handle(result(0,-.12),2170);assert.ok(events.inputs.at(-1).x>0);
});
test('an already closed hand cannot claim the machine',()=>{
  const{c,events}=controller();for(let t=1000;t<3000;t+=65)c.handle(result(4),t);
  assert.equal(events.starts,0);assert.equal(events.drops,0);
});


test('two-hand clasp cannot trigger the fist profile and interrupts its hold',()=>{
  const {c,events}=controller();claim(c);
  const pair=(dx)=>{
    const frame=result(0),other=result(0,dx);
    frame.landmarks.push(other.landmarks[0]);frame.handedness.push([{categoryName:'Left'}]);frame.gestures.push(other.gestures[0]);
    return frame;
  };
  for(let t=1910;t<2300;t+=65)c.handle(pair(.3),t);
  for(let t=2300;t<3400;t+=65)c.handle(pair(.09),t);
  assert.equal(events.drops,0);
  for(let t=3400;t<4000;t+=65)c.handle(result(4),t);
  assert.equal(events.drops,0,'second hand requires open-hand rearming');
});

test('blocked input clears fist arming and requires reopening in the next turn',()=>{
  const {c,events,setPhase}=controller();claim(c);
  c.handle(result(4),1910);c.handle(result(4),1975);
  setPhase('blocked');for(let t=2040;t<2500;t+=65)c.handle(result(4),t);
  assert.deepEqual(events.inputs.at(-1),{x:0,z:0});
  setPhase('aim');for(let t=2560;t<3400;t+=65)c.handle(result(4),t);
  assert.equal(events.drops,0);
  for(let t=3400;t<3730;t+=65)c.handle(result(),t);
  for(let t=3790;t<4500;t+=65)c.handle(result(4),t);
  assert.equal(events.drops,1);
});

test('rejected fist drop reports no acceptance and cannot retry until reopened',()=>{
  const {c,events}=controller();claim(c);let attempts=0;
  c.onDrop=()=>{attempts++;return false;};
  for(let t=1910;t<2570;t+=65)c.handle(result(4),t);
  assert.equal(attempts,1);assert.notEqual(events.states.at(-1).kind,'accepted');
  for(let t=2560;t<3400;t+=65)c.handle(result(4),t);
  assert.equal(attempts,1);
  for(let t=3400;t<3730;t+=65)c.handle(result(),t);
  c.onDrop=()=>{attempts++;return true;};
  for(let t=3790;t<=4375;t+=65)c.handle(result(4),t);
  assert.equal(attempts,2);assert.equal(events.states.at(-1).kind,'accepted');
});

test('rejected capture cancels an armed fist even when fresh frames follow quickly',()=>{
  const {c,events}=controller();claim(c);
  c.handle(result(4),1910);c.handle(result(4),1975);
  Object.assign(c,{running:true,generation:1,lastCapture:1975,lastResult:1975});
  assert.equal(c.acceptResult(result(4),1900,1,2040),false);
  for(let t=2040;t<2900;t+=65)c.acceptResult(result(4),t,1,t+10);
  assert.equal(events.drops,0);assert.equal(c.fist.armed,false);
});

test('a returning closed detection after prolonged uncertainty clears old hold time',()=>{
  const g=new FistDrop();arm(g);g.update(closed,1325);g.update({},1390);g.update({},1455);
  assert.equal(g.update(closed,1585).progress,0);
});

test('fresh 4 FPS detections retain a deliberate hold between capture-age sweeps', async()=>{
  const {c,events}=controller(), originalDocument=globalThis.document;
  globalThis.document={hidden:false};
  Object.assign(c,{running:true,busy:true,generation:1,lastCapture:-Infinity,lastResult:1000,lastActivity:1000});
  try {
    for(let t=1000;t<=2250;t+=250){
      assert.equal(c.acceptResult(result(),t,1,t+200),true);
      await c.frame(t+325);
      assert.deepEqual(events.inputs.at(-1),{x:0,z:0},'stale steering is still neutral');
    }
    assert.ok(c.owner);assert.equal(c.fist.armed,true);
    for(let t=2500;t<=3500;t+=250){
      c.acceptResult(result(4),t,1,t+200);
      await c.frame(t+325);
    }
    assert.equal(events.drops,1);
  } finally {globalThis.document=originalDocument;}
});

test('slow detections count only time between closed frames, never the open-to-fist interval',()=>{
  const g=new FistDrop();
  g.update(open,1000);g.update(open,1250);g.update(open,1500);
  assert.equal(g.update(closed,1750).progress,0);
  assert.equal(g.update(closed,2000).fired,false);
  assert.equal(g.update(closed,2250).fired,false);
  assert.equal(g.update(closed,2500).fired,true);
});

test('the gesture funnel reports hold_start once and precise cancellation causes',()=>{
  const events=[];const signal=(name,cause)=>events.push(cause?`${name}:${cause}`:name);
  const g=new FistDrop(signal);arm(g);
  g.update(closed,1325);g.update(closed,1390);
  assert.deepEqual(events,['hold_start']);
  g.update(open,1455);
  assert.deepEqual(events,['hold_start','hold_cancelled:opened']);
  events.length=0;arm2(g,1520);
  g.update(closed,1845);g.update(closed,1910);
  for(let t=1975;t<=2170;t+=65)g.update({},t);
  assert.deepEqual(events,['hold_start','hold_cancelled:uncertain_reset']);
  events.length=0;arm2(g,2235);
  g.update(closed,2560);g.update(closed,2625);
  g.update(closed,3000);
  assert.deepEqual(events,['hold_start','hold_cancelled:frame_gap']);
  events.length=0;arm2(g,3065);
  g.update(closed,3390);g.update(closed,3455);
  g.update({closed:true,visible:false},3520);
  assert.deepEqual(events,['hold_start','hold_cancelled:hand_lost']);
  events.length=0;arm2(g,3585);
  g.update(closed,3910);g.update(closed,3975);
  g.reset();
  assert.deepEqual(events,['hold_start','hold_cancelled:blocked']);
  events.length=0;arm2(g,4040);
  g.update(closed,4365);g.update(closed,4430);
  g.reset('stale');
  assert.deepEqual(events,['hold_start','hold_cancelled:stale']);
});
function arm2(g,from){for(let t=from;t<=from+260;t+=65)g.update(open,t);assert.equal(g.armed,true);}

test('a fired hold never reports a cancellation and signals never change recognition',()=>{
  const events=[];
  const g=new FistDrop((name,cause)=>events.push(cause?`${name}:${cause}`:name));
  const silent=new FistDrop();
  arm(g);arm(silent);
  const results=[],silents=[];
  for(let t=1325;t<=1910;t+=65){results.push(g.update(closed,t));silents.push(silent.update(closed,t));}
  assert.deepEqual(results,silents);
  assert.equal(results.at(-1).fired,true);
  assert.deepEqual(events,['hold_start']);
  g.reset();
  assert.deepEqual(events,['hold_start'],'an accepted drop is not a cancellation');
});

test('a throwing signal callback never alters recognition or leaves state behind',()=>{
  const g=new FistDrop(()=>{throw new Error('telemetry down');});
  const silent=new FistDrop();
  arm(g);arm(silent);
  const results=[],silents=[];
  for(let t=1325;t<=1910;t+=65){results.push(g.update(closed,t));silents.push(silent.update(closed,t));}
  assert.deepEqual(results,silents);
  assert.equal(results.at(-1).fired,true);
  g.reset();
  assert.equal(g.held,0);assert.equal(g.armed,false);
});

test('a second visible hand prevents claiming the machine',()=>{
  const{c,events}=controller();
  const two=result(),other=result(0,.2);
  two.landmarks.push(other.landmarks[0]);two.handedness.push([{categoryName:'Left'}]);two.gestures.push(other.gestures[0]);
  for(let t=1000;t<2600;t+=65)c.handle(two,t);
  assert.equal(events.starts,0);
  assert.deepEqual(events.inputs.at(-1)??{x:0,z:0},{x:0,z:0});
});

test('a single-frame handedness flip keeps the same spatial hand steering',()=>{
  const{c,events}=controller();claim(c);
  const frame=result(0,-.05);frame.handedness[0][0].categoryName='Left';
  c.handle(frame,1910);
  assert.notEqual(events.states.at(-1).kind,'lost');
  assert.ok(events.inputs.at(-1).x>0);
});

test('losing the hand zeroes steering immediately while deflected',()=>{
  const{c,events}=controller();claim(c);
  c.handle(result(0,-.06),1910);assert.ok(events.inputs.at(-1).x>0);
  c.handle({landmarks:[],handedness:[],gestures:[]},1975);
  assert.deepEqual(events.inputs.at(-1),{x:0,z:0});
  assert.equal(events.states.at(-1).kind,'lost');
});

test('a flagged shorter hold fires at its own length and bleeds credit instead of zeroing on uncertainty',()=>{
  const g=new FistDrop(undefined,{holdMs:300,decay:true});arm(g);
  g.update(closed,1325);
  let fired=false;for(let t=1390;t<=1650&&!fired;t+=65)fired=g.update(closed,t).fired;
  assert.equal(fired,true,'300 ms of consecutive closed frames fires');
  const d=new FistDrop(undefined,{holdMs:300,decay:true});arm(d);
  for(let t=1325;t<=1520;t+=65)d.update(closed,t);
  const before=d.held;assert.ok(before>=180);
  assert.ok(d.update({},1585).progress<before/300,'an uncertain frame costs credit');
  assert.ok(d.held>0,'one uncertain frame does not cancel');
  const resumed=d.update(closed,1650);assert.ok(resumed.active&&resumed.progress>0,'closing again continues from the remaining credit');
  const signals=[];const z=new FistDrop((n,c)=>signals.push(c||n),{holdMs:300,decay:true});arm(z);
  z.update(closed,1325);z.update(closed,1390);
  for(let t=1455;t<=1780;t+=65)z.update({},t);
  assert.equal(z.held,0);assert.ok(signals.includes('uncertain_reset'),'credit that bleeds to nothing reports the cancel once');
  assert.equal(signals.filter(s=>s==='uncertain_reset').length,1);
});
test('the default profile is unchanged: 550 ms, uncertainty zeroes after 130 ms',()=>{
  const g=new FistDrop();assert.equal(g.holdMs,550);assert.equal(g.decay,false);
});
