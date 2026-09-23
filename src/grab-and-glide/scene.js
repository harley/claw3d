import * as T from 'three';
import { box, ball, group, label, material, createArtMaterials, createToy } from '../arcade-art.js';
import { TOYS, GATE, TRAY } from './game.js';

export class GlideScene {
  constructor(canvas) {
    this.canvas = canvas; this.scene = new T.Scene(); this.scene.background = new T.Color('#101d26');
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.35;
    this.camera = new T.OrthographicCamera(-6,6,3.65,-3.65,.1,50); this.camera.position.set(0,0,18);
    this.scene.add(new T.HemisphereLight('#d2efff','#4c3140',2.6));
    const light = new T.DirectionalLight('#ffedce',4); light.position.set(-3,5,8); this.scene.add(light);
    const fill = new T.PointLight('#4adfff',22,16); fill.position.set(4,0,5); this.scene.add(fill);
    const cream = material('#e7dcc7',.48,.35), dark = material('#182a34',.85), metal = material('#a9bbc0',.27,.65);
    this.cyan = material('#54d9e0',.3,.25); this.cyan.emissive.set('#13767c');
    this.gold = material('#ffc671',.35,.5); this.gold.emissive.set('#513009');
    box(this.scene,cream,[0,0,-.6],[11.55,6.8,.5],.22);
    box(this.scene,dark,[0,0,-.28],[11.23,6.47,.3],.18);
    // A restrained cabinet, leaving the play plane visually dominant.
    for(const x of [-5.42,5.42]) box(this.scene,metal,[x,0,-.02],[.045,6.1,.07]);
    for(const y of [-3.08,3.08]) box(this.scene,this.cyan,[0,y,-.02],[10.85,.025,.04]);
    const dots=[];for(let x=-4.8;x<5;x+=.6)for(let y=-2.8;y<3;y+=.6)dots.push(x,y,-.1);
    this.scene.add(new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(dots,3)),new T.PointsMaterial({color:'#29404a',size:.025,sizeAttenuation:true})));
    label(this.scene,'PICK YOUR TOY',2.5,.22,[-3.65,2.76,.02],{font:'sans-serif',size:70,color:'#96a8ae',weight:'bold'});
    this.toys = new Map(); this.tags = new Map(); const mats = createArtMaterials();
    for(const t of TOYS) {
      const root = group(this.scene,t.x,t.y,.26);
      const toy = createToy({id:t.id,family:t.id==='bear'?'capybara':t.id,scale:1,yaw:0,color:t.color},mats);
      // Normalize the complete authored mesh to its conservative circular footprint.
      toy.updateMatrixWorld(true); const bounds = new T.Box3().setFromObject(toy), center = bounds.getCenter(new T.Vector3());
      const size = bounds.getSize(new T.Vector3()), scale = t.radius * 2 / Math.hypot(size.x,size.y);
      toy.position.copy(center.multiplyScalar(-scale)); toy.scale.setScalar(scale); root.add(toy);
      const footprint = new T.Mesh(new T.TorusGeometry(t.radius,.012,6,64),new T.MeshBasicMaterial({color:'#83b7bb',transparent:true,opacity:.3})); root.add(footprint);
      this.toys.set(t.id,{root,toy,footprint});
      const tag = group(this.scene,t.x+1.03,t.y,.02);
      label(tag,String(t.value),.73,.38,[0,.07,0],{font:'sans-serif',size:240,color:t.value===200?'#ffcc79':'#e2e6de',weight:'bold'});
      label(tag,t.value===200?'PRECISION':t.name.toUpperCase(),1.05,.19,[0,-.23,0],{font:'sans-serif',size:76,color:'#93a5ad',weight:'bold'});
      this.tags.set(t.id,tag);
    }
    this.tray = group(this.scene,TRAY.x,TRAY.y,.02);
    box(this.tray,material('#4c4637',.8),[0,0,0],[TRAY.halfX*2,TRAY.halfY*2,.15],.14);
    this.trayEdges=[];
    for(const y of [-TRAY.halfY,TRAY.halfY]) this.trayEdges.push(box(this.tray,this.gold,[0,y,.17],[TRAY.halfX*2+.14,.12,.3]));
    for(const x of [-TRAY.halfX,TRAY.halfX]) this.trayEdges.push(box(this.tray,this.gold,[x,0,.17],[.12,TRAY.halfY*2,.3]));
    label(this.tray,'TROPHY TRAY',2,.25,[0,-.9,.22],{font:'sans-serif',size:82,color:'#ffce89',weight:'bold'});
    label(this.tray,'↓',.6,.65,[0,.3,.19],{font:'sans-serif',size:390,color:'#ffce89'});
    this.gateMaterial=this.gold.clone(); this.gate=group(this.scene,GATE.x,GATE.y,.25);
    for(const sign of [-1,1]) box(this.gate,this.gateMaterial,[0,sign*(GATE.gap+GATE.thickness/2),0],[GATE.halfX*2,GATE.thickness,.32],.04);
    const dashMat=material('#6f6755');
    for(let y=-.65;y<.8;y+=.24) box(this.gate,dashMat,[0,y,-.1],[.018,.09,.025]);
    this.gateLabel=label(this.gate,'+50',1,.4,[0,1.27,0],{font:'sans-serif',size:240,color:'#ffca79',weight:'bold'});
    this.gateMark=label(this.gate,'×',.7,.5,[0,0,.4],{font:'sans-serif',size:260,color:'#ff8276',weight:'bold'});this.gateMark.visible=false;
    this.gateCheck=label(this.gate,'✓',.7,.5,[0,0,.4],{font:'sans-serif',size:260,color:'#76eee0',weight:'bold'});this.gateCheck.visible=false;
    this.claw=group(this.scene,0,0,1);
    this.ring=new T.Mesh(new T.TorusGeometry(1,.022,8,80),this.cyan);this.claw.add(this.ring);
    this.fingers=[];
    for(let i=0;i<3;i++) {
      const finger=group(this.claw); const arm=box(finger,cream,[0,.12,0],[.13,.38,.18],.06);
      box(finger,metal,[0,.28,-.03],[.17,.12,.14],.03); ball(finger,this.cyan,[0,-.07,.035],[.095,.075,.09]); this.fingers.push({finger,arm});
    }
    this.progress=new T.Mesh(new T.RingGeometry(1.07,1.12,64),new T.MeshBasicMaterial({color:'#fff2d7',transparent:true,opacity:.8,side:T.DoubleSide})); this.claw.add(this.progress);
    this.resize(); this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
  }
  resize() {
    const w=this.canvas.clientWidth,h=this.canvas.clientHeight; this.renderer.setSize(w,h,false);
    const aspect=w/h,halfY=Math.max(3.55,5.9/aspect);this.camera.left=-halfY*aspect;this.camera.right=halfY*aspect;this.camera.top=halfY;this.camera.bottom=-halfY;this.camera.updateProjectionMatrix();
  }
  point(clientX,clientY) {
    const r=this.canvas.getBoundingClientRect();return {x:this.camera.left+(clientX-r.left)/r.width*(this.camera.right-this.camera.left),y:this.camera.top-(clientY-r.top)/r.height*(this.camera.top-this.camera.bottom)};
  }
  draw(game,input,outcomeTime,reduced) {
    const held=game.cargo&&game.toys.find(t=>t.id===game.cargo.id);
    const nearest=held||game.toys.filter(t=>t.state==='available').sort((a,b)=>Math.hypot(a.x-game.position.x,a.y-game.position.y)-Math.hypot(b.x-game.position.x,b.y-game.position.y))[0]||TOYS[0];
    const aperture=nearest.aperture, target=game.target();
    this.claw.position.set(game.position.x,game.position.y,1);
    this.claw.visible=!['menu','result'].includes(game.phase);
    this.ring.scale.setScalar(aperture); this.ring.material.color.set(game.canBank()?'#ffc671':target?'#98ffdf':'#54d9e0');
    this.progress.visible=!!input.pending;this.progress.scale.setScalar(aperture);this.progress.rotation.z=-Math.PI/2;
    this.progress.geometry.setDrawRange(0,Math.floor(input.progress*64)*6);
    for(let i=0;i<3;i++) {
      const a=Math.PI/2+i*Math.PI*2/3,closed=game.phase==='carry';
      const radius=closed?held.radius*.89:aperture;
      const {finger}=this.fingers[i];
      // Contact fingers meet the actual cargo, including offset and bounded sway.
      const cx=closed?game.cargo.x-game.position.x:0,cy=closed?game.cargo.y-game.position.y:0;
      finger.position.set(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,closed?-.25:0);finger.rotation.z=a-Math.PI/2;
    }
    this.gateMaterial.color.set(game.gate==='failed'?'#b36f63':game.gate==='clean'?'#65dfc7':'#ffc671');
    this.gateMark.visible=game.gate==='failed';this.gateCheck.visible=game.gate==='clean';this.gateLabel.visible=game.gate!=='failed';
    this.trayEdges.forEach(m=>m.material.emissiveIntensity=game.canBank()?2:1);
    for(const t of game.toys) {
      const {root,toy,footprint}=this.toys.get(t.id); let x=t.x,y=t.y,z=.26;
      const isHeld=t.state==='held', latest=game.results.at(-1)?.toy===t.id;
      const settledTime=latest?outcomeTime:2;
      if(isHeld){x=game.cargo.x;y=game.cargo.y;z=.55;}
      if(t.state==='banked') {
        const index=game.toys.filter(t=>t.state==='banked').indexOf(t);
        const end={x:TRAY.x+(index-1)*.55,y:TRAY.y-.1};const k=reduced?1:Math.min(1,settledTime*2.3);
        x=t.x+(end.x-t.x)*k;y=t.y+(end.y-t.y)*k;
      }
      if(t.state==='dropped') { y=t.y-(reduced?1:Math.min(5,settledTime*settledTime*5));z=.2; }
      root.visible=t.state!=='dropped'||settledTime<.85;root.position.set(x,y,z);
      root.scale.set(1,1,1); const compression=isHeld?.95:1; toy.scale.y=toy.scale.x*compression; footprint.material.opacity=isHeld?.65:.22;toy.rotation.z=isHeld&&!reduced?Math.max(-.08,Math.min(.08,(game.cargo.x-game.position.x-game.cargo.offsetX)*1.2)):0;
      this.tags.get(t.id).visible=t.state==='available';
    }
    this.renderer.render(this.scene,this.camera);
  }
}
