import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController } from '../src/native-vision.js';
import { HandController as BrowserHandController } from '../src/vision.js';
import { inDropArea } from '../src/hand-workspace.js';

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

test('camera inventory uses only native entries and preserves the chosen ID',()=>{
  const {c}=fixture();
  const previousOption=globalThis.Option;
  globalThis.Option=class { constructor(label,id){this.label=label;this.value=id;} };
  c.select={value:'usb-2',replaceChildren(...options){this.options=options;this.value=options[0]?.value || '';}};
  try {
    c.receive({type:'cameras',generation:7,cameras:[{id:'front',label:'Camera front'},{id:'usb-2',label:'Camera external'}]});
    assert.equal(c.select.value,'usb-2');assert.equal(c.select.disabled,false);
    c.receive({type:'cameras',generation:6,cameras:[]});assert.equal(c.select.options.length,2);
    c.receive({type:'cameras',generation:7,cameras:[]});assert.equal(c.select.options.length,0);assert.equal(c.select.disabled,true);
  } finally {globalThis.Option=previousOption;}
});
test('diagnostic age percentiles use the latest interval, not historical stalls',()=>{
  globalThis.document={hidden:false};const {c,messages}=fixture();
  c.lastReport=performance.now()-6000;c.receive(result(performance.now()-900));
  c.lastReport=performance.now()-6000;c.receive(result(performance.now()-20,{id:2}));
  const stats=messages.filter(m=>m.type==='stats').at(-1);
  assert.equal(stats.ageBasis,'analyzer-entry');assert.ok(stats.p95<100);assert.equal(c.summary.ages.length,0);
});

function startupFixture() {
  globalThis.document={hidden:false};
  const {c,messages}=fixture();
  Object.assign(c,{running:false,starting:false,select:{value:'0'},maxHands:1,
    overlay:{width:640,height:480,getContext:()=>({clearRect(){}})}});
  return {c,messages};
}
function ready(c,generation=c.generation) {
  c.receive({type:'clock',generation,jsTime:performance.now(),nativeTime:performance.now()});
  c.receive({type:'ready',generation});
}
test('native start awaits matching readiness and settles after running becomes true',async()=>{
  const {c,messages}=startupFixture();let settled=false;
  try {
    const started=c.start().then(()=>{settled=true;assert.equal(c.running,true);});
    await Promise.resolve();assert.equal(settled,false);
    assert.equal(messages.find(m=>m.type==='start').cameraId,'0');
    ready(c,c.generation-1);await Promise.resolve();assert.equal(settled,false);
    ready(c);await started;assert.equal(settled,true);
  } finally {c.stop();}
});
test('camera replacement keeps the original game await pending until new readiness',async()=>{
  const {c}=startupFixture();let settled=false;
  try {
    const original=c.start().then(()=>{settled=true;});const old=c.generation;
    const replacement=c.start();
    ready(c,old);await Promise.resolve();assert.equal(settled,false);
    ready(c);await Promise.all([original,replacement]);assert.equal(c.running,true);
  } finally {c.stop();}
});
test('explicit stop and native failure both settle pending startup without allowing late readiness',async()=>{
  const {c}=startupFixture();
  const first=c.start(),old=c.generation;c.stop();await first;ready(c,old);assert.equal(c.running,false);
  const second=c.start();c.receive({type:'error',generation:c.generation,message:'Permission denied'});
  await second;assert.equal(c.running,false);assert.equal(c.starting,false);assert.equal(c.pendingStart,null);
});
test('one camera selection creates one replacement session, including during startup',async()=>{
  globalThis.document={hidden:false,addEventListener(){}};
  const messages=[];globalThis.TomkoNative={postMessage:raw=>messages.push(JSON.parse(raw))};
  const select=Object.assign(new EventTarget(),{value:'0'});
  const c=new HandController({select,video:{},overlay:{getContext:()=>({clearRect(){}})},onInput(){},onState(){},getPhase:()=> 'blocked'});
  try {
    c.running=true;select.value='1';select.dispatchEvent(new Event('change'));
    assert.equal(messages.filter(m=>m.type==='start').length,1);
    select.value='2';select.dispatchEvent(new Event('change'));
    assert.equal(messages.filter(m=>m.type==='start').length,2);
    assert.equal(messages.at(-1).cameraId,'2');
  } finally {c.stop();delete globalThis.TomkoNative;}
});

// Contract: the real native handler emits exactly the browser's gameplay/role
// feedback, with no per-result canvas access. Older fixtures stubbed draw/handle.
for (const profile of ['hold-drop', 'dual']) test(`native ${profile} control callbacks match browser without overlay drawing`, t => {
  globalThis.document = { hidden: false, addEventListener() {} };
  globalThis.TomkoNative = { postMessage() {} };
  let now = 1000, phase = 'recognizing';
  t.mock.method(performance, 'now', () => now);
  const create = Controller => {
    const output = [], messages = []; let canvasCalls = 0;
    const context = new Proxy({}, { get: () => () => { canvasCalls++; } });
    const c = new Controller({ video: { videoWidth: 640, videoHeight: 480 },
      overlay: { width: 640, height: 480, dataset: {}, getContext: () => { canvasCalls++; return context; } },
      select: new EventTarget(), getPhase: () => phase, getControlProfile: () => profile,
      getControlTarget: p => ({ overTarget: p.x < .5, overDrop: p.x > .5 && p.y >= .6, aboveDrop: p.x > .5 && p.y < .6, nearDrop: inDropArea(p) }),
      onInput: value => output.push(['input', structuredClone(value)]),
      onState: value => output.push(['state', structuredClone(value)]),
      onGesture: (...args) => output.push(['gesture', ...args]),
      onDrop: () => { output.push(['drop']); return true; }, onStart() {},
    });
    c.running = true; c.generation = 7; c.offset = 100;
    c.send = value => messages.push(value);
    return { c, output, messages, calls: () => canvasCalls };
  };
  const native = create(HandController), browser = create(BrowserHandController);
  const hand = (x, side, gesture = 'Open_Palm', y = .6) => {
    const points = Array.from({ length: 21 }, () => ({ x: 1-x, y, z: 0 }));
    points[0].y += .06; points[9].y -= .06; points[5].x -= .06; points[17].x += .06;
    return { points, side, gesture };
  };
  let id = 0;
  const frames = (hands, count = 1, age = 0) => {
    for (let i = 0; i < count; i++) {
      now += 65;
      const sample = { landmarks: hands.map(h => h.points), handedness: hands.map(h => [{categoryName:h.side,score:.99}]), gestures: hands.map(h => [{categoryName:h.gesture,score:.99}]) };
      native.c.receive(result(now-age, { id: ++id, result: sample }));
      browser.c.acceptResult(sample, now-age, 7);
      assert.deepEqual(native.output, browser.output, 'player input, role states, hold progress, gestures and drops stay identical');
      assert.equal(native.messages.at(-1).type, 'ack');
    }
  };
  try {
    const left = hand(.35, 'Left'), right = hand(.65, 'Right');
    frames(profile === 'dual' ? [left, right] : [left], 12);
    phase = 'aim'; frames(profile === 'dual' ? [left, right] : [left], 12);
    if (profile === 'hold-drop') frames([hand(.48, 'Left')], 6);
    const closed = hand(.35, 'Left', 'Closed_Fist');
    frames(profile === 'dual' ? [closed, right] : [closed], 16);
    if (profile === 'dual') {
      frames([hand(.43, 'Left', 'Closed_Fist'), right], 6);
      frames([hand(.43, 'Left', 'Closed_Fist'), hand(.65, 'Right', 'Open_Palm', .5)], 5);
    }
    assert.ok(native.output.some(([type, input]) => type === 'input' && Math.abs(input.x) > 0), 'sequence exercises steering');
    assert.equal(native.output.filter(([type]) => type === 'drop').length, 1);
    if (profile === 'dual') assert.ok(native.output.some(([type, state]) => type === 'state' && state.hands?.left?.ready && state.hands?.right?.ready));
    frames([], 2); frames([left], 1, 400); phase = 'blocked'; frames([], 8);
    assert.equal(native.calls(), 0, 'native results never access the hidden canvas');
    assert.ok(browser.calls() > 100, 'browser continues drawing the same sequences');
  } finally { delete globalThis.TomkoNative; }
});

test('native ACK follows control processing, including a thrown handler', () => {
  globalThis.document = { hidden: false };
  const { c, messages } = fixture();
  c.handle = () => { assert.equal(messages.length, 0); throw new Error('handler failed'); };
  assert.throws(() => c.receive(result(performance.now()-10)), /handler failed/);
  assert.equal(messages.at(-1).type, 'ack');
});

test('preview eligibility is sampled from game state at each start and defaults closed', async () => {
  const { c, messages } = startupFixture();
  try {
    let pending = c.start(); assert.equal(messages.at(-1).applyPreview, false); ready(c); await pending;
    let betweenRuns = true; c.canConfigureCamera = () => betweenRuns;
    pending = c.start(); assert.equal(messages.at(-1).applyPreview, true);
    betweenRuns = false; ready(c); await pending;
    pending = c.start(); assert.equal(messages.at(-1).applyPreview, false); ready(c); await pending;
  } finally { c.stop(); }
});
