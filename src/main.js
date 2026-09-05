import './style.css';
import { ClawScene } from './scene.js';
import { HandController } from './vision.js';
import { moveClaw, findCatch, clamp } from './mechanics.js';

const $=id=>document.getElementById(id);
let scene;
const game={phase:'loading',position:{x:-.85,z:.12},elapsed:0,remaining:30,aligned:false,paused:false,round:0};
const keyboard=new Set();let cameraInput={x:0,z:0},pointerInput={x:0,z:0};
let lastTime=performance.now(),lastStateKind='off',lastVisionAt=0;
let mappedKey=readSetting('dropKey')||'Space';let mapping=false;let sound=false;let audioContext;let highQuality=true;
let lastHint='';let resultPrize=null;
let inspection=false;

function readSetting(key){try{return localStorage.getItem('cloudclaw:'+key);}catch{return null;}}
function saveSetting(key,value){try{localStorage.setItem('cloudclaw:'+key,value);}catch{/* Settings are optional when local storage is unavailable. */}}
function status(title,hint,eyebrow){$('status').textContent=title;if(hint!==undefined)$('hint').textContent=hint;if(eyebrow)$('control-eyebrow').textContent=eyebrow;}
function soundNote(frequency,duration=.13,delay=0){
  if(!sound)return;
  audioContext??=new AudioContext();audioContext.resume();
  const t=audioContext.currentTime+delay,osc=audioContext.createOscillator(),gain=audioContext.createGain();
  osc.type='sine';osc.frequency.setValueAtTime(frequency,t);gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.055,t+.012);gain.gain.exponentialRampToValueAtTime(.001,t+duration);osc.connect(gain).connect(audioContext.destination);osc.start(t);osc.stop(t+duration);
}

function startRound(source='keyboard') {
  if(!['idle','result'].includes(game.phase))return;
  document.activeElement?.blur();
  scene.reset();resultPrize=null;game.phase='aim';game.elapsed=0;game.remaining=30;game.paused=false;game.round++;
  game.position={x:-.85,z:.12};$('result').hidden=true;$('confetti').replaceChildren();
  if(source!=='camera')vision.resetOwner();
  $('round-clock').hidden=false;$('drop').disabled=false;$('keyboard-play').textContent='Arrow keys / WASD to steer · Space to drop';
  $('stage-label').textContent='LINE UP THE CLAW';
  status('LINE IT UP','Arrow keys / WASD steer. Space or Enter drops.','PLAYER 1');
  document.querySelectorAll('.instruction').forEach(e=>e.classList.toggle('active',e.dataset.step==='2'));
  soundNote(392);soundNote(523,.12,.10);
}

function drop() {
  if(game.phase!=='aim')return;
  const candidate=findCatch(game.position,scene.prizes);
  resultPrize=scene.beginDrop(candidate,game.position);game.phase='descend';game.elapsed=0;game.paused=false;
  cameraInput={x:0,z:0};pointerInput={x:0,z:0};keyboard.clear();
  $('drop').disabled=true;$('round-clock').hidden=true;$('gesture-progress').style.width='0%';
  $('stage-label').textContent='CLAW IN ACTION';
  status('GOING DOWN','The claw is moving into position.','DROP COMMITTED');
  document.querySelectorAll('.instruction').forEach(e=>e.classList.toggle('active',e.dataset.step==='3'));
  soundNote(196,.25);
}

function resetRound() {
  if(!scene?.ready)return;
  scene.reset();game.phase='idle';game.elapsed=0;game.paused=false;game.remaining=30;game.position={x:-.85,z:.12};resultPrize=null;
  keyboard.clear();cameraInput={x:0,z:0};pointerInput={x:0,z:0};vision.resetOwner();
  $('result').hidden=true;$('confetti').replaceChildren();$('drop').disabled=true;$('round-clock').hidden=true;
  $('keyboard-play').textContent='PLAY WITH KEYBOARD';$('stage-label').textContent='READY TO PLAY';
  status('READY TO PLAY',vision.running?'Show one hand. Hold it still to take control.':'Start the camera. Raise one hand to take control.','PLAYER 1');
  document.querySelectorAll('.instruction').forEach(e=>e.classList.toggle('active',e.dataset.step==='1'));
}

function showResult() {
  game.phase='result';game.elapsed=0;vision.resetOwner();
  const win=Boolean(resultPrize);$('result').classList.toggle('miss',!win);$('result').hidden=false;
  $('stage-label').textContent=win?'PRIZE WON':'ROUND COMPLETE';
  $('result-kicker').textContent=win?'WINNER!':'TRY AGAIN';
  $('result-title').textContent=win?"YOU GOT IT!":'JUST MISSED!';
  $('result-message').textContent=win?`You caught the ${resultPrize.kind==='bunny'?'CoderPush bunny':'travel pillow'}. At the event, your host will handle the real prize.`:'The claw missed this time. Line up the ring beneath a prize and give it another go.';
  $('play-again').firstChild.textContent=win?'PLAY AGAIN ':'PLAY AGAIN ';
  status(win?'GREAT CATCH':'JUST MISSED','Play again whenever you are ready.','ROUND COMPLETE');
  if(win){
    resultPrize.claimed=true;
    [523,659,784,1047].forEach((f,i)=>soundNote(f,.25,i*.13));
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)for(let i=0;i<55;i++){
      const confetto=document.createElement('i');confetto.className='confetto';confetto.style.left=Math.random()*100+'%';
      confetto.style.background=['#ef805d','#b7cc87','#f5e8b6','#759892','#b2a0c7'][i%5];
      confetto.style.setProperty('--drift',(Math.random()-.5)*200+'px');confetto.style.setProperty('--rotation',(Math.random()-.5)*1300+'deg');
      confetto.style.animationDelay=Math.random()*.7+'s';$('confetti').append(confetto);
    }
  }else{soundNote(330,.2);soundNote(294,.25,.2);}
}

const vision=new HandController({video:$('video'),overlay:$('hand-overlay'),select:$('camera-select'),getPhase:()=>game.phase,getProfile:()=>$('gesture-profile').value,onStart:startRound,onDrop:drop,
  onDiagnostic:data=>{$('vision-diagnostic').textContent=data.count?`${data.count} hand${data.count>1?'s':''} visible · ${data.gesture.replaceAll('_',' ')} · ${Math.round(data.milliseconds)} ms tracking`:'No hand visible. Move your hand into the camera preview.';},
  onInput:input=>{cameraInput={...input};},
  onState:state=>{
    lastStateKind=state.kind;lastVisionAt=performance.now();
    const pending=state.kind==='loading';$('start-camera').disabled=pending;$('camera-toggle').disabled=false;
    $('camera-toggle').textContent=pending?'Cancel camera startup':vision.running?'Stop camera':'Start camera';
    $('start-camera').hidden=vision.running;
    $('camera-empty').hidden=vision.running;$('camera-empty').textContent=state.kind==='error'?state.message:'Camera is off';
    $('joystick').classList.toggle('tracked',['tracking','dropping'].includes(state.kind));
    if(state.kind==='error')$('settings').hidden=false;
    if(!['idle','aim'].includes(game.phase))return;
    $('gesture-progress').style.width=(state.progress||0)*100+'%';
    if(state.kind==='lost'){status('HAND OUT OF VIEW',state.message,'MOVEMENT PAUSED');game.paused=true;}
    else if(['clasping','clenching'].includes(state.kind)){status(state.progress?'HOLD TO DROP':state.kind==='clenching'?'FIST TO DROP':'TWO-HAND DROP',state.message,'AIM LOCKED');game.paused=true;}
    else if(state.kind==='error'){game.paused=game.phase==='aim';status('KEYBOARD READY',state.message,'CAMERA NEEDS ATTENTION');}
    else if(state.kind==='tracking'||state.kind==='dropping'){
      game.paused=false;status(state.kind==='dropping'?'HOLD TO DROP':'YOU’RE IN CONTROL',state.message,'HAND TRACKING ACTIVE');
    }else if(state.kind==='calibrating'){status($('gesture-profile').value!=='pinch'?'HOLD STEADY':'PINCH TO GRAB',state.message,'FINDING YOUR HAND');}
    else if(state.kind==='ready' && game.phase==='idle')status('READY TO PLAY',state.message,'CAMERA READY');
    else if(state.kind==='loading'){game.paused=game.phase==='aim';status('CAMERA STARTING',state.message,'CAMERA STARTING');}
    else if(state.kind==='off'){game.paused=false;status(game.phase==='aim'?'LINE IT UP':'READY TO PLAY',state.message,'KEYBOARD READY');}
  }
});

function toggleCamera(){if(vision.running||vision.starting)vision.stop();else{$('settings').hidden=false;vision.start();}}
$('start-camera').addEventListener('click',toggleCamera);$('camera-toggle').addEventListener('click',toggleCamera);
$('control-mode').addEventListener('change',()=>{if($('control-mode').value==='keyboard')vision.stop();});
$('gesture-profile').addEventListener('change',()=>{vision.resetOwner();game.paused=game.phase==='aim'&&vision.running;updateProfile();$('gesture-profile').blur();});
$('recenter').addEventListener('click',()=>{vision.resetOwner();cameraInput={x:0,z:0};game.paused=game.phase==='aim'&&vision.running;$('recenter').blur();});
function updateProfile(){
  const clasp=$('gesture-profile').value==='clasp';
  const fist=$('gesture-profile').value==='fist';
  const easy=$('gesture-profile').value!=='pinch';
  const steps=[...document.querySelectorAll('.instruction')];
  steps[0].querySelector('strong').textContent=easy?'HAND UP':'PINCH TO GRAB';
  steps[0].querySelector('p').textContent=easy?'Hold still to start':'Pinch and hold';
  steps[2].querySelector('p').textContent=fist?'Clench your fist and hold':clasp?'Clasp both hands and hold':easy?'Press your DROP button':'Open your palm and hold';
  $('gesture-help').textContent=easy?'Show one relaxed hand. Hold still to begin, then move gently to steer. Return your hand to the centre to stop moving. Press Space, Enter, or your programmable button to drop.':'Pinch or use a loose fist to take the joystick. Keep holding and move gently. Release to stop. Hold an open palm for 0.8 seconds to drop.';
  document.querySelector('.footer-tip').textContent=easy?'SHOW YOUR HAND TO STEER  ·  PRESS YOUR BUTTON TO DROP':'PINCH TO STEER  ·  OPEN PALM TO DROP  ·  SPACE WORKS TOO';
  if(fist){
    $('gesture-help').textContent='Start with one open, relaxed hand and steer. Clench your hand and hold for the meter to DROP. Aiming locks while you hold. Open your hand to cancel. Two-hand clasp and Space also work.';
    document.querySelector('.footer-tip').textContent='OPEN HAND TO STEER · CLENCH & HOLD TO DROP';
  }
  if(clasp){
    $('gesture-help').textContent='Steer with one relaxed hand. To DROP, show both hands apart, then bring your palms together and hold for the meter. Keep a small gap so both hands stay visible. Separating cancels; lowering one hand returns to steering. After a round, hold one hand up to play again. Space still works.';
    document.querySelector('.footer-tip').textContent='ONE HAND TO STEER · TWO HANDS TOGETHER TO DROP';
  }
}
updateProfile();
$('keyboard-play').addEventListener('click',()=>startRound());$('drop').addEventListener('click',drop);
$('play-again').addEventListener('click',()=>{resetRound();startRound();});$('reset').addEventListener('click',resetRound);
$('settings-toggle').addEventListener('click',()=>{$('settings').hidden=!$('settings').hidden;vision.listCameras().catch(()=>{});});
$('settings-close').addEventListener('click',()=>{$('settings').hidden=true;});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status('Full screen is unavailable.','Use your browser’s full-screen command.');}});
$('sound').addEventListener('click',()=>{sound=!sound;$('sound').setAttribute('aria-pressed',sound);$('sound').setAttribute('aria-label',sound?'Mute sound':'Enable sound');soundNote(523);});
$('quality').addEventListener('click',()=>{highQuality=!highQuality;scene?.setQuality(highQuality);$('quality').textContent=`Quality: ${highQuality?'high':'light'}`;});
$('drop-key').addEventListener('click',()=>{mapping=true;document.body.classList.add('mapping');$('drop-key').textContent='Press your DROP button… (Esc cancels)';});
function mappingLabel(){ $('key-help').textContent=`DROP: ${mappedKey} or Enter. Arrows / WASD steer. Map your knob to ← / → for horizontal movement.`; }
mappingLabel();
const movementCodes=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD'];
window.addEventListener('keydown',event=>{
  if(mapping){event.preventDefault();event.stopPropagation();if(event.code!=='Escape'){
    if(movementCodes.includes(event.code)||event.code.startsWith('Shift')||event.code.startsWith('Control')||event.code.startsWith('Meta')||event.code.startsWith('Alt')){$('drop-key').textContent='Choose a key other than movement or modifiers';return;}
    mappedKey=event.code;saveSetting('dropKey',mappedKey);
  }mapping=false;document.body.classList.remove('mapping');$('drop-key').textContent='Map a DROP key';mappingLabel();$('drop-key').blur();return;}
  if(['SELECT','INPUT','TEXTAREA','BUTTON'].includes(event.target.tagName))return;
  if(event.code==='Escape'){$('settings').hidden=true;keyboard.clear();return;}
  if(movementCodes.includes(event.code)||event.code==='ShiftLeft'||event.code==='ShiftRight'){
    event.preventDefault();if(game.phase==='idle')startRound();keyboard.add(event.code);game.paused=false;
    // A discrete step also supports knobs that send rapid key-down/key-up pulses.
    if(!event.repeat && game.phase==='aim' && movementCodes.includes(event.code))game.position=moveClaw(game.position,keyInput(),.035,1.1,scene.field);
  }
  if([mappedKey,'Space','Enter'].includes(event.code)){
    event.preventDefault();if(event.repeat)return;
    if(['idle','result'].includes(game.phase))startRound();else drop();
  }
});
window.addEventListener('keyup',event=>keyboard.delete(event.code));
window.addEventListener('blur',()=>{keyboard.clear();pointerInput={x:0,z:0};cameraInput={x:0,z:0};});
document.addEventListener('visibilitychange',()=>{keyboard.clear();pointerInput={x:0,z:0};cameraInput={x:0,z:0};lastTime=performance.now();});
window.addEventListener('pagehide',()=>vision.stop(false));
function keyInput(){return{x:(keyboard.has('ArrowRight')||keyboard.has('KeyD')?1:0)-(keyboard.has('ArrowLeft')||keyboard.has('KeyA')?1:0),z:(keyboard.has('ArrowDown')||keyboard.has('KeyS')?1:0)-(keyboard.has('ArrowUp')||keyboard.has('KeyW')?1:0)};}
let dragging=false;
const joystick=$('joystick');
function drag(event){const bounds=joystick.getBoundingClientRect();pointerInput={x:clamp((event.clientX-bounds.left-bounds.width/2)/25,-1,1),z:clamp((event.clientY-bounds.top-bounds.height/2)/25,-1,1)};}
joystick.addEventListener('pointerdown',event=>{if(game.phase==='idle')startRound();if(game.phase!=='aim')return;dragging=true;joystick.setPointerCapture(event.pointerId);drag(event);});
joystick.addEventListener('pointermove',event=>{if(dragging)drag(event);});
for(const name of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(name,()=>{dragging=false;pointerInput={x:0,z:0};});

const phases={descend:[1.6,'grip'],grip:[.75,'lift'],lift:[1.8,'travel'],travel:[1.7,'release'],release:[.55,'settle'],settle:[2.0,'result']};
function frame(time){
  const dt=Math.min((time-lastTime)/1000,.06);lastTime=time;
  if(document.hidden){requestAnimationFrame(frame);return;}
  if(inspection){scene.update(time/1000,dt,game);requestAnimationFrame(frame);return;}
  if(game.phase==='aim'){
    const keys=keyInput();const stale=vision.running && time-lastVisionAt>700;
    const manual=keys.x||keys.z||pointerInput.x||pointerInput.z;
    if(stale&&!manual){game.paused=true;cameraInput={x:0,z:0};status('TRACKING PAUSED','Bring your hand back, or use the keyboard.','MOVEMENT PAUSED');}
    if(manual)game.paused=false;
    const input=manual?{x:keys.x||pointerInput.x,z:keys.z||pointerInput.z}:cameraInput;
    game.controlInput=game.paused?{x:0,z:0}:input;
    if(!game.paused){
      game.position=moveClaw(game.position,input,dt,keyboard.has('ShiftLeft')||keyboard.has('ShiftRight')?.4:1.1,scene.field);
      game.remaining=Math.max(0,game.remaining-dt);if(game.remaining===0)drop();
    }
    game.aligned=Boolean(findCatch(game.position,scene.prizes));
    $('seconds').textContent=Math.ceil(game.remaining).toString().padStart(2,'0');
    const cap=joystick.querySelector('.joystick-cap');cap.style.transform=`translate(${input.x*11}px,${input.z*11}px)`;
    if(!vision.running){const hint=game.aligned?'Looking good. Press Space or DROP.':'Arrows / WASD steer. Hold Shift for a finer move.';if(hint!==lastHint){lastHint=hint;$('hint').textContent=hint;}}
  }else{
    game.controlInput={x:0,z:0};
    joystick.querySelector('.joystick-cap').style.transform='translate(0,0)';
    if(phases[game.phase]){
      game.elapsed+=dt;
      const [duration,next]=phases[game.phase];
      if(game.elapsed>=duration){
        game.phase=next;game.elapsed=0;
        if(next==='grip'){soundNote(294,.18);status(scene.plan.stop==='bed'?'AT THE PRIZE BED':'TOY CONTACT','Closing the fingers…','CLAW CLOSING');}
        if(next==='lift')status(resultPrize?'GOT A GRIP':'CLAW RISING',resultPrize?'Lifting your prize.':'Keep an eye on the claw.','ON THE WAY UP');
        if(next==='travel')status(resultPrize?'PRIZE INCOMING':'RETURNING',resultPrize?'Delivering to the prize chute.':'Line up the ring for the next round.','HEADING TO THE CHUTE');
        if(next==='result')showResult();
      }
    }
  }
  scene?.update(time/1000,dt,game);requestAnimationFrame(frame);
}

try{
  scene=new ClawScene($('scene'));await scene.load();$('loading').hidden=true;game.phase='idle';
  requestAnimationFrame(frame);
  if(import.meta.env.DEV)window.__cloudClaw={snapshot:()=>({phase:game.phase,position:{...game.position},remaining:game.remaining,paused:game.paused,aligned:game.aligned,caught:resultPrize?.id??null,cameraRunning:vision.running,cameraState:lastStateKind,drawCalls:scene.renderer.info.render.calls,triangles:scene.renderer.info.render.triangles,prizes:scene.prizes.map(p=>({id:p.id,x:p.x,z:p.z,claimed:p.claimed,visible:p.object.visible}))})};
  // Freeze an exact animation pose for visual QA; removed from production builds.
  if(import.meta.env.DEV){
    const params=new URLSearchParams(location.search),id=params.get('inspect'),phase=params.get('phase')||'grip';
    const prize=scene.prizes.find(p=>p.id===id);
    if((prize||id==='empty')&&phases[phase]){
      startRound();game.position=prize?{x:prize.x,z:prize.z}:{x:-1,z:.4};drop();
      game.phase=phase;game.elapsed=clamp(Number(params.get('time')??phases[phase][0]),0,phases[phase][0]);inspection=true;
      status('POSE INSPECTION',`${id} · ${phase} · ${game.elapsed}s`,'DEVELOPMENT ONLY');
    }
  }
}catch(error){
  console.error('Could not load Cloud Claw',error);$('loading').querySelector('p').textContent='The 3D scene could not load. Refresh to try again.';$('loading').querySelector('.loader-ring').hidden=true;
}
