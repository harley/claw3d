import {clamp} from './mechanics.js';

export const FIST_HOLD_MS = 550;

export function fistEvidence(landmarks,gesture,score=0,aspect=1){
  const d=(a,b)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
  const wrist=landmarks[0],palm=Math.max(d(wrist,landmarks[9]),d(landmarks[5],landmarks[17]));
  if(palm<.025)return{closed:false,open:false};
  const fingers=[[5,6,8],[9,10,12],[13,14,16],[17,18,20]];
  const folded=fingers.filter(([m,p,t])=>d(landmarks[t],wrist)<d(landmarks[p],wrist)*.93&&d(landmarks[t],landmarks[m])<palm*.8).length;
  const extended=fingers.filter(([,p,t])=>d(landmarks[t],wrist)>d(landmarks[p],wrist)+palm*.22).length;
  const closed=(gesture==='Closed_Fist'&&score>=.65)||(folded>=3&&extended===0);
  return{closed,open:!closed&&((gesture==='Open_Palm'&&score>=.6)||extended>=3)};
}

// Require an open hand first. Only visible, consecutive fist frames advance
// confirmation; a long frame gap or another hand cancels the pending action.
export class FistDrop {
  constructor(){this.reset();}
  reset(){this.armed=false;this.openMs=0;this.held=0;this.last=0;this.wasClosed=false;this.uncertainSince=0;this.fired=false;}
  update({open=false,closed=false,visible=true},now){
    const gap=this.last?now-this.last:0;
    if(!visible||gap>300){this.reset();this.last=now;return{active:false,progress:0,fired:false};}
    const dt=clamp(gap,0,300);this.last=now;
    if(this.fired)return{active:true,progress:1,fired:false};
    if(open){this.wasClosed=false;this.held=0;this.uncertainSince=0;this.openMs+=dt;if(this.openMs>=200)this.armed=true;return{active:false,progress:0,fired:false};}
    if(!this.armed){this.openMs=0;return{active:false,progress:0,fired:false};}
    if(!closed){
      this.wasClosed=false;
      this.uncertainSince||=now;
      if(now-this.uncertainSince>130)this.held=0;
      return{active:this.held>0,progress:this.held/FIST_HOLD_MS,fired:false};
    }
    if(this.uncertainSince && now-this.uncertainSince>130)this.held=0;
    // Only the interval between two closed detections counts as a hold.
    // Opening or uncertainty must not receive credit on the returning frame.
    if(this.wasClosed&&!this.uncertainSince)this.held+=dt;
    this.wasClosed=true;
    this.uncertainSince=0;
    const progress=clamp(this.held/FIST_HOLD_MS,0,1);this.fired=progress===1;
    return{active:true,progress,fired:this.fired};
  }
}
