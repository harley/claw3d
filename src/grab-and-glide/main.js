import './style.css';
import { GlideGame } from './game.js';
import { GlideInput } from './input.js';
import { GlideScene } from './scene.js';
import { createArcadeAudio } from '../arcade-audio.js';

const $=id=>document.getElementById(id), game=new GlideGame(), input=new GlideInput(game), scene=new GlideScene($('scene'));
const pointerMode=import.meta.env.DEV&&new URLSearchParams(location.search).get('input')==='pointer';
const audio=createArcadeAudio({enabledByDefault:true,onChange:()=>{$('sound').textContent=audio.enabled?'Sound on':'Sound off';$('sound').setAttribute('aria-pressed',String(audio.enabled));}});
let camera, cameraStatus={kind:'off'}, last=performance.now(), outcomeTime=0, lastEvent=0, running=false;
let lastDraw=0;
let pointer={x:.5,y:.5,closed:false,visible:false}, pointerAt=0;
$('reduce-motion').checked=matchMedia('(prefers-reduced-motion: reduce)').matches;
const reduced=()=>$('reduce-motion').checked;
$('pointer-note').hidden=!pointerMode;
$('camera-video').addEventListener('loadedmetadata',()=>{const v=$('camera-video');if(v.videoWidth&&v.videoHeight)v.parentElement.style.aspectRatio=String(v.videoWidth/v.videoHeight);});
$('build').textContent=`BUILD ${__BUILD_INFO__.commit}${__BUILD_INFO__.dirty?' + local edits':''} · ${__BUILD_INFO__.branch}`;
if(pointerMode){$('play').textContent='Play pointer test →';$('local').textContent='Development pointer · Synthetic input · No webcam validation';}
async function startCamera(){
  if(pointerMode)return;
  try {
    if(!camera){const {GlideCamera}=await import('./camera.js');camera=new GlideCamera({video:$('camera-video'),overlay:$('camera-overlay'),select:$('camera-select'),
      onEvidence:e=>{if(!document.hidden)input.sample(e,performance.now(),reduced());},
      onStatus:s=>{cameraStatus=s;$('camera-status').textContent=s.pointer?'Hand tracked':s.message;}
    });}
    await camera.start();
    $('camera-restart').textContent=camera.running?'Restart camera':'Retry camera';
  }catch(error){$('camera-status').textContent=error.message;input.lose();}
}
function begin(){audio.unlock();game.start();input.reset();camera?.resetOwner();outcomeTime=0;lastEvent=0;running=true;$('menu').hidden=true;$('result').hidden=true;pointer.closed=false;if(!camera?.running)startCamera();}
$('play').onclick=begin;$('replay').onclick=begin;$('camera-restart').onclick=()=>{input.lose();startCamera();};$('sound').onclick=()=>audio.toggle();
document.addEventListener('visibilitychange',()=>{input.lose();audio.silence();last=performance.now();});
addEventListener('pagehide',()=>{camera?.stop();audio.silence();});
if(pointerMode){
  const position=e=>{const p=scene.point(e.clientX,e.clientY);pointer.x=.5+p.x/16;pointer.y=.5-p.y/10;pointer.visible=true;};
  $('scene').addEventListener('pointermove',position);
  $('scene').addEventListener('pointerdown',e=>{position(e);pointer.closed=true;$('scene').setPointerCapture(e.pointerId);});
  $('scene').addEventListener('pointerup',e=>{position(e);pointer.closed=false;});
  $('scene').addEventListener('pointerleave',()=>{pointer.visible=false;});
  $('scene').addEventListener('pointercancel',()=>{pointer.visible=false;input.lose();});
}
function frame(now){
  const clockDt=(now-last)/1000, dt=Math.min(.1,clockDt);last=now;
  if(!document.hidden){
    if(pointerMode&&now-pointerAt>=40){pointerAt=now;input.sample({at:now,point:pointer,open:!pointer.closed,closed:pointer.closed,valid:pointer.visible},now,reduced());}
    if(running)input.tick(now,clockDt);
    if(game.event&&game.event.sequence!==lastEvent){
      lastEvent=game.event.sequence;
      const kind=game.event.kind;
      if(kind==='bank')audio.fanfare('shelf');else if(kind==='grab')audio.note(330,.13,0,'triangle',165,.06);else if(kind==='gate')audio.note(880,.2);else if(kind==='contact')audio.note(120,.15,0,'triangle',70);else audio.note(180,.22,0,'triangle',70);
      if(game.phase==='outcome'){outcomeTime=0;input.reset();}
    }
    if(game.phase==='outcome'){
      outcomeTime+=dt;
      if(outcomeTime>=1.25){game.next();input.reset();camera?.resetOwner();if(game.phase==='result'){running=false;$('result').hidden=false;$('result-score').textContent=`${game.score} points`;$('results').replaceChildren(...game.results.map(r=>{const el=document.createElement('span');el.textContent=r.points?`+${r.points}`:'—';el.title=r.kind;return el;}));audio.fanfare('complete');}}
    }
    renderHud();
    if(!camera?.running||now-lastDraw>=1000/30){scene.draw(game,input,outcomeTime,reduced());lastDraw=now;}
  }
  requestAnimationFrame(frame);
}
function renderHud(){
  $('attempt').innerHTML=`${Math.min(3,game.results.length+(game.phase==='outcome'?0:1))} <small>/ 3</small>`;
  $('timer').innerHTML=`${Math.ceil(game.remaining)}<small>s</small>`;$('timer').style.color=game.remaining<=5?'#ffc671':'';$('score').textContent=game.score;
  let cue='';
  if(game.phase==='outcome')cue=game.event.kind==='bank'?`+${game.event.points} · Banked!`:game.event.kind==='miss'?'Missed!':game.event.kind==='timeout'?'Time’s up!':'Dropped!';
  else if(['position','carry'].includes(game.phase)){
    if(!input.valid&&input.armed)cue='Hold your hand steady';
    else if(!input.valid)cue=pointerMode?'Move pointer into the play area':cameraStatus.kind==='error'?'Camera paused · Retry below':'Show one open hand';
    else if(!input.armed)cue=game.cargo?'Close to resume carrying':'Hold open to ready';
    else if(input.pending)cue=game.phase==='carry'?'Opening…':'Closing…';
    else if(game.canBank())cue='Open over the tray';
  }
  $('cue').textContent=cue;
  $('instruction').textContent=game.phase==='carry'?'Open over the tray.':'Close to grab.';
}
requestAnimationFrame(frame);
// Test surface is development-only; no score/run/telemetry client is imported.
if(import.meta.env.DEV)window.__grabGlide={game,input,scene,begin,snapshot:()=>JSON.parse(JSON.stringify({phase:game.phase,remaining:game.remaining,score:game.score,results:game.results,cargo:game.cargo,position:game.position,gate:game.gate,armed:input.armed,valid:input.valid,build:__BUILD_INFO__})),get camera(){return camera;}};
