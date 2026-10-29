'use strict';
// Generates synthetic, redistributable test assets in tests/fixtures:
//   bike/model.edf  – four-component bike (chassis, steer, fsusp, rsusp) in the
//                     EDF/EXT layout that src/core/edf.cjs validates
//   bike/gfx.cfg    – a CRLF lineup file with comments, repeated plate blocks and
//                     one duplicated-decimal typo
//   rider.pkz       – skinned stock-layout rider EDF, ANM pose and rider gfx.cfg
// None of this is game data. It exists so tests and screenshots are reproducible.
const fs=require('node:fs'),path=require('node:path'),T=require('three');
const profile=require('../src/core/assembly.json');
const OUT=path.join(__dirname,'..','tests','fixtures');

// ---------- mesh primitives (world or frame coordinates)
class Mesh{
  constructor(){this.p=[];this.i=[];}
  vert(v){this.p.push(v.clone());return this.p.length-1;}
  tri(a,b,c){this.i.push(a,b,c);}
  quad(a,b,c,d){this.tri(a,b,c);this.tri(a,c,d);}
  box(c,s){const [x,y,z]=s.map(n=>n/2),V=[];for(const dx of [-x,x])for(const dy of [-y,y])for(const dz of [-z,z])V.push(this.vert(new T.Vector3(c[0]+dx,c[1]+dy,c[2]+dz)));
    const f=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];for(const q of f)this.quad(...q.map(k=>V[k]));return this;}
  cyl(a,b,r,seg=14){a=new T.Vector3(...a);b=new T.Vector3(...b);const d=b.clone().sub(a).normalize(),u=Math.abs(d.y)<.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0),x=u.clone().cross(d).normalize(),y=d.clone().cross(x);
    const ring=c=>Array.from({length:seg},(_,k)=>{const t=k/seg*Math.PI*2;return this.vert(c.clone().addScaledVector(x,Math.cos(t)*r).addScaledVector(y,Math.sin(t)*r));});
    const A=ring(a),B=ring(b),ca=this.vert(a),cb=this.vert(b);
    for(let k=0;k<seg;k++){const n=(k+1)%seg;this.quad(A[k],A[n],B[n],B[k]);this.tri(ca,A[n],A[k]);this.tri(cb,B[k],B[n]);}return this;}
  // Ring around an axis (default X): wheels, fingers.
  torus(c,R,r,axis=[1,0,0],seg=40,tube=10){const ax=new T.Vector3(...axis).normalize(),u=Math.abs(ax.y)<.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0),e1=u.clone().cross(ax).normalize(),e2=ax.clone().cross(e1),C=new T.Vector3(...c),V=[];
    for(let k=0;k<seg;k++){const t=k/seg*Math.PI*2,dir=e1.clone().multiplyScalar(Math.cos(t)).addScaledVector(e2,Math.sin(t)),row=[];
      for(let j=0;j<tube;j++){const s=j/tube*Math.PI*2;row.push(this.vert(C.clone().addScaledVector(dir,R+r*Math.cos(s)).addScaledVector(ax,r*Math.sin(s))));}V.push(row);}
    for(let k=0;k<seg;k++)for(let j=0;j<tube;j++){const a=V[k][j],b=V[(k+1)%seg][j],c2=V[(k+1)%seg][(j+1)%tube],d=V[k][(j+1)%tube];this.quad(a,b,c2,d);}return this;}
  disc(c,R,thick,axis=[1,0,0]){const a=new T.Vector3(...axis).normalize().multiplyScalar(thick/2),C=new T.Vector3(...c);return this.cyl(C.clone().sub(a).toArray(),C.clone().add(a).toArray(),R,28);}
  transform(m){this.p.forEach(v=>v.applyMatrix4(m));return this;}
}

// ---------- frames: CFG/component frame F = A * P^-1; mesh world = A * vertex
const SWAP=new T.Matrix4().set(-1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,1),FLIP=new T.Matrix4().makeScale(-1,1,-1);
const ROOT={chassis:FLIP,steer:SWAP,fsusp:SWAP,rsusp:FLIP};
const A=name=>new T.Matrix4().set(...profile.parts[name].assembledRoot.flat());
const F=name=>A(name).multiply(ROOT[name].clone().invert());

// ---------- bike, authored in each component's CFG frame
const groups={chassis:{},steer:{},fsusp:{},rsusp:{}};
const add=(part,name,build)=>{const m=new Mesh();build(m);groups[part][name]=m;};
// chassis frame == world (X right, Y up, Z forward)
add('chassis','frame',m=>{m.cyl([0,.97,.31],[0,.60,-.10],.024);for(const x of [-.07,.07]){m.cyl([x*.4,.98,.28],[x,.88,-.22],.016);m.cyl([x,.88,-.22],[x,.78,-.70],.013);m.cyl([x,.60,-.10],[x,.88,-.22],.016);m.cyl([x*.6,.60,-.10],[x*.6,.30,.10],.016);}});
add('chassis','engine',m=>{m.box([0,.42,.02],[.20,.26,.34]);m.box([0,.63,.13],[.15,.16,.16]);m.disc([-.074,.47,-.06],.035,.008);});
add('chassis','seat',m=>{m.box([0,.955,-.36],[.22,.06,.72]);m.box([0,.99,.09],[.28,.14,.34]);});
add('chassis','plastics',m=>{for(const s of [-1,1])m.box([s*.16,.87,.17],[.03,.22,.30]);m.box([0,.90,-.86],[.17,.025,.42]);m.box([.12,.72,-.30],[.03,.18,.36]);});
add('chassis','exhaust',m=>{m.cyl([.03,.60,.20],[.10,.36,.12],.022);m.cyl([.10,.36,.12],[.13,.72,-.42],.022);m.cyl([.13,.72,-.42],[.14,.84,-.82],.045);});
// steer frame: Y up the (raked) steering axis, Z forward, origin at the top clamp
add('steer','clamps',m=>{m.box([0,0,0],[.26,.032,.09]);m.box([0,-.17,0],[.26,.04,.09]);for(const s of [-1,1])m.cyl([s*.055,.01,-.01],[s*.055,.105,-.065],.012);});
add('steer','bar',m=>{m.cyl([-.33,.11,-.07],[.33,.11,-.07],.011);m.cyl([-.12,.105,-.068],[.12,.105,-.068],.014);});
add('steer','protapergrips',m=>{for(const s of [-1,1])m.cyl([s*.315,.11,-.07],[s*.43,.11,-.07],.016);});
add('steer','forks',m=>{for(const s of [-1,1])m.cyl([s*.105,.02,0],[s*.105,-.45,0],.026);m.box([0,.03,.13],[.24,.20,.02]);});
// fsusp frame: same axes as steer, origin lower on the steering axis
const FRONT_AXLE=[0,-.296,.025];
add('fsusp','legs',m=>{for(const s of [-1,1])m.cyl([s*.105,.05,0],[s*.105,FRONT_AXLE[1],FRONT_AXLE[2]],.029);m.box([0,.02,.05],[.20,.025,.30]);});
add('fsusp','wheel',m=>{m.torus(FRONT_AXLE,.33,.05,[1,0,0],48,10);m.torus(FRONT_AXLE,.27,.012,[1,0,0],48,6);m.cyl([-.06,...FRONT_AXLE.slice(1)],[.06,...FRONT_AXLE.slice(1)],.03);m.disc([.07,...FRONT_AXLE.slice(1)],.13,.004);});
// rsusp frame: swingarm, chain reference axle at Z ≈ -0.56
const REAR=profile.chainReference,REAR_AXLE=[0,(REAR.axleMin[1]+REAR.axleMax[1])/2,(REAR.axleMin[2]+REAR.axleMax[2])/2];
add('rsusp','swingarm',m=>{for(const s of [-1,1])m.cyl([s*.06,0,0],[s*.075,REAR_AXLE[1],REAR_AXLE[2]+.02],.022);m.cyl([-.07,0,0],[.07,0,0],.02);});
add('rsusp','wheel',m=>{m.torus(REAR_AXLE,.32,.06,[1,0,0],48,10);m.torus(REAR_AXLE,.26,.012,[1,0,0],48,6);m.cyl([-.07,...REAR_AXLE.slice(1)],[.07,...REAR_AXLE.slice(1)],.032);m.disc([REAR.rearX,...REAR_AXLE.slice(1)],.105,.005);});

// ---------- EDF writer (layout validated by src/core/edf.cjs)
class Writer{constructor(){this.parts=[];this.len=0;}push(b){this.parts.push(b);this.len+=b.length;}
  u32(...v){const b=Buffer.alloc(4*v.length);v.forEach((x,i)=>b.writeUInt32LE(x,i*4));this.push(b);}
  f32(...v){const b=Buffer.alloc(4*v.length);v.forEach((x,i)=>b.writeFloatLE(x,i*4));this.push(b);}
  name(s,n=100){const b=Buffer.alloc(n);b.write(s,'utf8');this.push(b);}
  zero(n){this.push(Buffer.alloc(n));}buffer(){return Buffer.concat(this.parts);}}
const BIG=3.4028234663852886e38;
function writeNode(w,{name,matrix,children=[],groups=[],vertexCount=0,firstVertex=0,flags=0}){
  w.name(name);w.u32(flags);w.f32(...matrix);w.zero(236-168);w.u32(children.length,...children);
  w.u32(groups.length);for(const g of groups)w.u32(0,0,g.firstTriangle,g.triangleCount,g.firstVertex,g.vertexCount);
  w.u32(vertexCount,firstVertex);w.f32(BIG,BIG,BIG,-BIG,-BIG,-BIG);
}
function writePart(w,name){
  const inv=A(name).invert(),frame=F(name),meshes=Object.entries(groups[name]);
  const positions=[],indices=[],nodes=[];
  for(const [label,m] of meshes){
    const first=positions.length/3,firstTri=indices.length/3;
    for(const v of m.p){const local=v.clone().applyMatrix4(frame).applyMatrix4(inv);positions.push(local.x,local.y,local.z);}
    for(const k of m.i)indices.push(k+first);
    nodes.push({name:label,group:{firstTriangle:firstTri,triangleCount:m.i.length/3,firstVertex:first,vertexCount:m.p.length}});
  }
  const box=new T.Box3();for(let k=0;k<positions.length;k+=3)box.expandByPoint(new T.Vector3(positions[k],positions[k+1],positions[k+2]));
  w.f32(...box.min.toArray(),...box.max.toArray());w.u32(1);w.zero(56);
  const vc=positions.length/3;w.u32(vc);w.f32(...positions);w.zero(60*vc);
  w.u32(indices.length/3);w.u32(...indices);
  w.u32(nodes.length+1);
  const rootMatrix=ROOT[name].clone().transpose().elements; // row-major for Matrix4.set
  writeNode(w,{name:name+'_root',matrix:rootMatrix,children:nodes.map((_,k)=>k+1)});
  const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  for(const n of nodes)writeNode(w,{name:n.name,matrix:I,groups:[n.group],vertexCount:n.group.vertexCount,firstVertex:n.group.firstVertex});
  return vc;
}
function writeEDF(){
  const w=new Writer();w.push(Buffer.from('EDF\0','ascii'));
  writePart(w,'chassis');const textureStart=w.len,starts={};
  for(const name of ['fsusp','rsusp','steer']){starts[name]=w.len;writePart(w,name);}
  const dir=w.len;w.u32(textureStart,3);for(const name of ['fsusp','rsusp','steer']){w.name(name);w.u32(starts[name]);}
  w.push(Buffer.from('EXT\0','ascii'));const total=w.len+4;w.u32(total-dir);return w.buffer();
}

// ---------- bike gfx.cfg (CRLF, tabs, comments, repeated plate blocks)
const block=(indent,name,body)=>`${indent}${name}\n${indent}{\n${body}${indent}}\n`;
const xyzBlock=(i,name,[x,y,z])=>block(i,name,`${i}\tx = ${x}\n${i}\ty = ${y}\n${i}\tz = ${z}\n`);
function lineups(i,{left,right,engine}){
  return block(i,'steer',
      `${i}\t// handlebar ends\n`+block(i+'\t','leftgrip',xyzBlock(i+'\t\t','pos',left))+block(i+'\t','rightgrip',xyzBlock(i+'\t\t','pos',right))
      +block(i+'\t','plate',`${i}\t\ttexture = "plate_front.tga"\n`))
    +block(i,'chassis',block(i+'\t','chain',xyzBlock(i+'\t\t','pos',['0','0','0'])+xyzBlock(i+'\t\t','engine',engine)+`${i}\t\taxis = u-\n${i}\t\tratio = 0.5\n`)
      +block(i+'\t','plate',`${i}\t\ttexture = "plate_side_l.tga"\n`)+block(i+'\t','plate',`${i}\t\ttexture = "plate_side_r.tga"\n`));
}
const cfg=('// Moto Lines Studio test fixture: synthetic bike, not game data\n'
  +'model = "model.edf"\nshadow\n{\n\tfile = "shadow.edf" ; contact shadow\n}\n'
  +lineups('',{left:['-0.4','0.11','-0.07'],right:['0.398','0.112','-0.068'],engine:['-0.074','0.47','-0.06']})
  +block('','cockpit',lineups('\t',{left:['-0.4','0.11','-0.07'],right:['0.4','0.11.0','-0.07'],engine:['-0.074','0.47','-0.06']}))
).replace(/\n/g,'\r\n');

// ---------- rider (skinned EDF, ANM, rider gfx.cfg) in rider.pkz
const WRISTS={Left:new T.Vector3(-.35,1.05,.15),Right:new T.Vector3(.35,1.05,.15)},ANCHOR={Left:[.08,-.02,.02],Right:[.08,.02,.02]};
function glove(side){ // authored in steer frame around the grip point, then mapped back to bind space
  const m=new Mesh(),inner=side==='Left'?1:-1;
  for(let k=0;k<4;k++)m.torus([inner*(-.03+k*.021),0,0],.022,.0095,[1,0,0],16,8);
  m.box([0,.026,-.03],[.085,.032,.06]);
  m.box([0,.04,-.075],[.075,.04,.06]);
  m.cyl([0,.05,-.10],[0,.09,-.17],.032,14);
  m.torus([inner*.05,.012,-.012],.016,.008,[.3,.6,.7],12,6);
  return toBind(m,side);
}
// inverse of hands.cjs: final=(−Ly,−Lz,Lx) about the CFG anchor, wrist is a pure translation
function toBind(m,side){for(const v of m.p){const G=v.clone(),a=ANCHOR[side];v.set(a[0]+G.z,a[1]-G.x,a[2]-G.y).add(WRISTS[side]);}return m;}
// The bundled generic glove: original geometry (not game data), a closed fist
// around the grip point in steer space. X along the bar, Y up, Z forward.
function genericGlove(side){
  const m=new Mesh(),inner=side==='Left'?1:-1;
  const fingers=[[.020,.0105],[.0215,.011],[.021,.0108],[.0185,.0098]]; // index → little finger
  fingers.forEach(([R,r],k)=>m.torus([inner*(-.032+k*.0205),0,0],R,r,[1,0,0],28,10));
  m.cyl([-.045,.024,.012],[.045,.024,.012],.011,16);          // knuckle ridge
  m.cyl([-.044,.018,-.03],[.044,.018,-.03],.027,20);           // palm / back of hand
  m.cyl([0,.03,-.045],[0,.058,-.105],.031,20);                 // hand to wrist
  m.cyl([0,.062,-.112],[0,.098,-.19],.037,22);                 // cuff
  m.cyl([inner*.043,.004,-.035],[inner*.052,.02,.006],.0115,14); // thumb
  m.torus([inner*.052,.022,.008],.006,.0065,[0,.4,1],10,6);    // thumb tip
  return toBind(m,side);
}
function writeRider(gloveFn=glove){
  const L=gloveFn('Left'),R=gloveFn('Right'),body=new Mesh().box([0,.85,-.2],[.32,.5,.22]);
  const meshes=[[L,1],[R,2],[body,0]],positions=[],indices=[],skin=[];
  for(const [m,bone] of meshes){const first=positions.length;for(const v of m.p){positions.push(v);skin.push(bone);}for(const k of m.i)indices.push(k+first);}
  const w=new Writer();w.push(Buffer.from('EDF\0','ascii'));w.f32(-1,0,-1,1,2,1);w.u32(1);w.zero(56);
  w.u32(positions.length);w.zero(72*positions.length);w.u32(indices.length/3);w.u32(...indices);
  const nodes=[
    {name:'riderRIG_Root',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],children:[1,2,3]},
    {name:'riderRIG_LeftWrist',matrix:[1,0,0,WRISTS.Left.x,0,1,0,WRISTS.Left.y,0,0,1,WRISTS.Left.z,0,0,0,1]},
    {name:'riderRIG_RightWrist',matrix:[1,0,0,WRISTS.Right.x,0,1,0,WRISTS.Right.y,0,0,1,WRISTS.Right.z,0,0,0,1]},
    {name:'rider_skin',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],skinned:true}];
  w.u32(nodes.length);
  for(const n of nodes){
    w.name(n.name);w.u32(n.skinned?8192:0);w.f32(...n.matrix);w.zero(236-168);w.u32((n.children||[]).length,...(n.children||[]));w.u32(0);
    if(n.skinned){w.u32(positions.length,0);positions.forEach((v,k)=>{const e=Buffer.alloc(124);e.writeFloatLE(v.x,0);e.writeFloatLE(v.y,4);e.writeFloatLE(v.z,8);e.writeUInt32LE(1,40);e.writeUInt32LE(skin[k],44);e.writeFloatLE(1,84);w.push(e);});}
    else w.u32(0,0);
    w.f32(0,0,0,0,0,0);
  }
  const edf=w.buffer();
  const frames=48,bones=[['riderRIG_LeftWrist',WRISTS.Left],['riderRIG_RightWrist',WRISTS.Right]];
  const anm=new Writer();anm.push(Buffer.from('ANM\0','ascii'));anm.zero(104);anm.u32(frames,bones.length);
  for(const [name,t] of bones){anm.name(name);for(let f=0;f<frames;f++)anm.f32(0,0,0,1,t.x,t.y,t.z);anm.zero(4);}
  const riderCfg=['lefthand','righthand'].map((h,k)=>{const side=k?'Right':'Left',a=ANCHOR[side];return `${h}\n{\n\trefobj = riderRIG_${side}Wrist\n\tpos\n\t{\n\t\tx = ${a[0]}\n\t\ty = ${a[1]}\n\t\tz = ${a[2]}\n\t}\n}\n`;}).join('');
  return {edf,anm:anm.buffer(),cfg:riderCfg};
}

(async()=>{
  const {zipSync}=await import('three/addons/libs/fflate.module.js');
  fs.mkdirSync(path.join(OUT,'bike'),{recursive:true});
  const edf=writeEDF();fs.writeFileSync(path.join(OUT,'bike','model.edf'),edf);
  fs.writeFileSync(path.join(OUT,'bike','gfx.cfg'),cfg);
  const r=writeRider();
  const zip=zipSync({'rider/riders/default_mx/c_rider.edf':new Uint8Array(r.edf),'rider/animations/mx/rider.anm':new Uint8Array(r.anm),'rider/riders/default_mx/gfx.cfg':new TextEncoder().encode(r.cfg),'rider/readme.txt':new TextEncoder().encode('Synthetic test rider, not game data.')});
  fs.writeFileSync(path.join(OUT,'rider.pkz'),zip);
  const g=writeRider(genericGlove);
  const generic=zipSync({'rider/riders/default_mx/c_rider.edf':new Uint8Array(g.edf),'rider/animations/mx/rider.anm':new Uint8Array(g.anm),'rider/riders/default_mx/gfx.cfg':new TextEncoder().encode(g.cfg),
    'rider/readme.txt':new TextEncoder().encode('Generic gloves made for Moto Lines Studio by OB Industries.\nOriginal geometry; not MX Bikes game data. Used only until the real rider.pkz is loaded.\n')});
  fs.writeFileSync(path.join(__dirname,'..','assets','generic-rider.pkz'),generic);
  console.log('fixtures:',OUT,`model.edf ${edf.length} bytes, rider.pkz ${zip.length} bytes`);
})().catch(e=>{console.error(e);process.exitCode=1;});
