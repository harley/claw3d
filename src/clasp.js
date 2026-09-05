import { clamp } from './mechanics.js';

// A deliberate apart -> together -> hold sequence. Time only advances while
// both hands are visible; a merged/occluded hand can never finish the DROP.
export class ClaspGesture {
  constructor(){this.reset();}
  reset(){this.armed=false;this.apart=0;this.held=0;this.last=0;this.seen=0;this.active=false;this.fired=false;}
  update(hands,owner,now,aspect=1){
    const dt=this.last?clamp(now-this.last,0,120):0;this.last=now;
    if(this.fired)return{active:true,progress:1,fired:false,message:'DROP confirmed.'};
    const distance=(a,b)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
    const valid=hands.length===2 && owner && hands.some(h=>distance(h.center,owner)<.28*aspect);
    if(!valid){
      if(this.active && now-this.seen<300)return{active:true,progress:this.held/650,message:'Keep both hands visible. Leave a small gap between your palms.'};
      this.reset();this.last=now;return{active:false,progress:0};
    }
    this.active=true;this.seen=now;
    const [a,b]=hands;
    const size=h=>Math.max(distance(h.landmarks[0],h.landmarks[9]),distance(h.landmarks[5],h.landmarks[17]));
    const sa=size(a),sb=size(b),scale=(sa+sb)/2;
    const ratio=distance(a.center,b.center)/scale;
    const comparable=scale>.035 && Math.min(sa,sb)/Math.max(sa,sb)>.52;
    const level=Math.abs(a.center.y-b.center.y)<scale*1.25;
    if(!comparable||!level||ratio<.28){this.held=0;return{active:true,progress:0,message:'Show both hands side by side, at the same height.'};}
    if(ratio>1.75){this.apart+=dt;this.held=0;if(this.apart>=220)this.armed=true;}
    else if(!this.armed)this.apart=0;
    if(!this.armed)return{active:true,progress:0,message:'Show both hands apart first, then bring them together.'};
    if(ratio>1.4){this.held=0;return{active:true,progress:0,message:'Bring your palms together to DROP. Keep both visible.'};}
    this.held+=dt;
    const progress=clamp(this.held/650,0,1);
    if(progress===1)this.fired=true;
    return{active:true,progress,fired:this.fired,message:progress===1?'DROP confirmed.':'Hold your hands together…'};
  }
}
