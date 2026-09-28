import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController } from '../src/native-vision.js';

function fixture() {
  const c = Object.create(HandController.prototype), messages=[], handled=[];
  Object.assign(c, {generation: 7, running:true, starting:false, offset:100,
    video:{}, getPhase:()=> 'blocked', onInput:()=>{}, onState:()=>{}, onDiagnostic:()=>{},
    summary:{results:0,accepted:0,ages:[]},lastReport:performance.now(),
    send:m=>messages.push(m),handle:(result,time)=>handled.push(time),draw:()=>{},
  });
  c.resetOwner();
  return {c,messages,handled};
}
const result=(at,extra={})=>({type:'result',generation:7,id:1,capturedAt:at-100,width:640,height:480,result:{landmarks:[],gestures:[],handedness:[]},...extra});

test('native delivery includes transit time and retains the 300ms rejection',()=>{
  globalThis.document={hidden:false};const {c,messages,handled}=fixture();
  c.receive(result(performance.now()-400));
  assert.equal(handled.length,0);assert.equal(c.summary.accepted,0);assert.equal(messages.at(-1).type,'ack');
  c.receive(result(performance.now()-120,{id:2}));assert.equal(handled.length,1);assert.equal(c.summary.accepted,1);
});
test('native delivery rejects replay and old camera generation',()=>{
  globalThis.document={hidden:false};const {c,handled,messages}=fixture();const at=performance.now()-100;
  c.receive(result(at));c.receive(result(at,{id:2}));c.receive(result(at+1,{generation:6,id:3}));
  assert.equal(handled.length,1);assert.equal(messages.filter(m=>m.type==='ack').length,2);
});
test('hidden or stopped pages cannot accept native hand results',()=>{
  globalThis.document={hidden:true};const {c,handled}=fixture();c.receive(result(performance.now()-100));
  document.hidden=false;c.running=false;c.receive(result(performance.now()-90,{id:2}));assert.equal(handled.length,0);
});
test('clock mapping uses request send time, including request queue delay',()=>{
  const {c}=fixture();c.starting=true;c.offset=null;c.receive({type:'clock',generation:7,jsTime:1000,nativeTime:5000});
  assert.equal(c.offset,-4000);assert.equal(5200+c.offset,1200);
});

 test('clock resampling reduces startup skew but never shifts capture time backwards',()=>{
  const {c}=fixture();c.offset=null;
  c.receive({type:'clock',generation:7,jsTime:1000,nativeTime:5100});assert.equal(c.offset,-4100);
  c.receive({type:'clock',generation:7,jsTime:2000,nativeTime:6005});assert.equal(c.offset,-4005);
  c.receive({type:'clock',generation:7,jsTime:3000,nativeTime:7080});assert.equal(c.offset,-4005);
});

test('delivery telemetry separates fresh and rejected results in each interval',()=>{
  globalThis.document={hidden:false};const {c,messages}=fixture();
  c.receive(result(performance.now()-400));
  c.lastReport=performance.now()-6000;
  c.receive(result(performance.now()-100,{id:2}));
  const first=messages.find(m=>m.type==='stats');
  assert.ok(first.deliveredHz>.32 && first.deliveredHz<.34);
  assert.ok(first.freshHz>.16 && first.freshHz<.17);
  c.lastReport=performance.now()-6000;
  c.receive(result(performance.now()-50,{id:3}));
  const second=messages.filter(m=>m.type==='stats').at(-1);
  assert.ok(second.deliveredHz>.16 && second.deliveredHz<.17);
  assert.equal(second.freshHz,second.deliveredHz);
});
