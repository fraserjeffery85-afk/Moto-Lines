// Local, read-only reference extraction for the observed skinned rider EDF.
// Real glove vertices and ANM finger poses; attachment calibration is preview-only.
const THREE=require('three');
function readRider(buffer){
 const b=Buffer.from(buffer);let p=4;const need=(at,n)=>{if(at<0||at+n>b.length)throw Error('Truncated rider EDF');};
 const u=at=>{need(at,4);return b.readUInt32LE(at);};const f=at=>{need(at,4);const v=b.readFloatLE(at);if(!Number.isFinite(v)||Math.abs(v)>1e6)throw Error('Invalid rider geometry');return v;};
 const arr=(at,n)=>Array.from({length:n},(_,i)=>f(at+i*4));const name=at=>{need(at,100);const end=b.indexOf(0,at);if(end<at||end>=at+100)throw Error('Invalid rider node');return b.toString('utf8',at,end);};
 if(b.toString('ascii',0,4)!=='EDF\0')throw Error('This rider file is not a readable EDF. Choose an unprotected cockpit rider EDF.');
 p+=24;const materialCount=u(p);if(materialCount>256)throw Error('Unsupported rider materials');p+=4+56*materialCount;
 const vertexCount=u(p);if(vertexCount>1000000)throw Error('Unsupported rider mesh size');p+=4+72*vertexCount;
 const triangleCount=u(p);if(triangleCount>2000000)throw Error('Unsupported rider face count');p+=4;const indices=Array.from({length:triangleCount*3},(_,i)=>u(p+i*4));if(indices.some(v=>v>=vertexCount))throw Error('Invalid rider face');p+=triangleCount*12;
 const count=u(p);p+=4;if(count>2048)throw Error('Unsupported rider skeleton');const nodes=[],skin=new Map();
 for(let i=0;i<count;i++){
  const label=name(p),flags=u(p+100),matrix=new THREE.Matrix4().set(...arr(p+104,16));let q=p+236;const cc=u(q);q+=4;if(cc>count)throw Error('Invalid rider hierarchy');const children=Array.from({length:cc},(_,k)=>u(q+k*4));q+=cc*4;
  const gc=u(q);q+=4;if(gc>256)throw Error('Invalid rider groups');const groups=[];for(let j=0;j<gc;j++){groups.push(Array.from({length:6},(_,k)=>u(q+k*4)));q+=24;}
  const vn=u(q),vs=u(q+4);q+=8;if(vn+vs>vertexCount)throw Error('Invalid rider vertex range');
  if(flags&8192){for(let v=0;v<vn;v++){const at=q+v*124,n=u(at+40);if(n>10)throw Error('Unsupported rider skin weights');const weights=Array.from({length:n},(_,k)=>({bone:u(at+44+k*4),weight:f(at+84+k*4)}));if(weights.some(w=>w.bone>=count||w.weight<0)||Math.abs(weights.reduce((s,w)=>s+w.weight,0)-1)>.01)throw Error('Invalid rider skin weights');skin.set(vs+v,{position:new THREE.Vector3(...arr(at,3)),weights});}q+=vn*124;}
  need(q,24);q+=24;nodes.push({name:label,matrix,children,groups,parent:-1});p=q;
 }
 nodes.forEach((n,i)=>n.children.forEach(c=>{if(c>=count||nodes[c].parent!==-1)throw Error('Invalid rider hierarchy');nodes[c].parent=i;}));
 return {nodes,indices,skin};
}
function readPose(buffer,frame){
 const b=Buffer.from(buffer);if(b.toString('ascii',0,4)!=='ANM\0')throw Error('Unsupported animation format');
 const frames=b.readUInt32LE(108),count=b.readUInt32LE(112);if(!frames||frames>10000||count>2048||116+count*(104+frames*28)>b.length)throw Error('Unsupported animation layout');
 frame=frame==null?Math.floor(frames/2):frame;if(!Number.isInteger(frame)||frame<0||frame>=frames)throw Error('Invalid animation frame');const pose=new Map();let p=116;
 for(let i=0;i<count;i++){const end=b.indexOf(0,p);if(end<p||end>=p+100)throw Error('Invalid animation bone');const label=b.toString('utf8',p,end),v=Array.from({length:7},(_,k)=>b.readFloatLE(p+100+frame*28+k*4));if(v.some(x=>!Number.isFinite(x)))throw Error('Invalid animation transform');const quat=new THREE.Quaternion(...v.slice(0,4));if(Math.abs(quat.length()-1)>.02)throw Error('Unsupported animation quaternion');pose.set(label,new THREE.Matrix4().compose(new THREE.Vector3(...v.slice(4)),quat.normalize().conjugate(),new THREE.Vector3(1,1,1)));p+=104+frames*28;}
 return {pose,frame,frames};
}
function extractHands(edf,anm,riderCfg){
 const cfg=require('./cfg-core.js').parse(riderCfg);
 const {nodes,indices,skin}=readRider(edf),animation=readPose(anm),bind=[],posed=[],visiting=new Set();
 function world(i){if(bind[i])return;if(visiting.has(i))throw Error('Cyclic rider skeleton');visiting.add(i);const n=nodes[i];if(n.parent>=0)world(n.parent);bind[i]=(n.parent>=0?bind[n.parent].clone():new THREE.Matrix4()).multiply(n.matrix);posed[i]=(n.parent>=0?posed[n.parent].clone():new THREE.Matrix4()).multiply(animation.pose.get(n.name)||n.matrix);visiting.delete(i);}
 nodes.forEach((_,i)=>world(i));const result={frame:animation.frame,frames:animation.frames,hands:{}};
 for(const side of ['Left','Right']){
  const wrist=nodes.findIndex(n=>n.name==='riderRIG_'+side+'Wrist');if(wrist<0)throw Error('No '+side+' wrist in this rider');const family=new Set();function descend(i){family.add(i);nodes[i].children.forEach(descend);}descend(wrist);
  const selected=new Set();for(const [v,s]of skin)if(s.weights.reduce((sum,w)=>sum+(family.has(w.bone)?w.weight:0),0)>.5)selected.add(v);
  const faces=[];for(let i=0;i<indices.length;i+=3)if(indices.slice(i,i+3).every(v=>selected.has(v)))faces.push(...indices.slice(i,i+3));
  if(faces.length<90)throw Error('No usable '+side+' glove geometry');
  const transforms=bind.map((m,i)=>posed[i].clone().multiply(m.clone().invert()));const points=new Map();
  for(const v of new Set(faces)){const s=skin.get(v),out=new THREE.Vector3();for(const w of s.weights)out.addScaledVector(s.position.clone().applyMatrix4(transforms[w.bone]),w.weight);points.set(v,out);}
  const prefix=side.toLowerCase()+'hand',ref=cfg.fields.get(prefix+'.refobj')?.value;
  if(ref!==nodes[wrist].name)throw Error('Unsupported rider hand attachment bone');
  const anchor=['x','y','z'].map(axis=>{const v=cfg.fields.get(prefix+'.pos.'+axis)?.value;if(!require('./cfg-core.js').numeric(v))throw Error('Missing rider hand attachment');return Number(v);});
  const center=new THREE.Vector3(...anchor),wristInverse=posed[wrist].clone().invert();
  // Neutral wrist-to-steer reference axes. Actual runtime IK orientation is
  // not claimed here. The translation anchor comes directly from rider CFG.
  const orientation=new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,1),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,-1,0));
  for(const point of points.values())point.applyMatrix4(wristInverse).sub(center).applyMatrix4(orientation);
  const box=new THREE.Box3().setFromPoints([...points.values()]);
  const map=new Map(),positions=[],outIndices=[];for(const v of faces){if(!map.has(v)){map.set(v,map.size);positions.push(...points.get(v).toArray());}outIndices.push(map.get(v));}
  result.hands[side.toLowerCase()]={positions:new Float32Array(positions),indices:new Uint32Array(outIndices),size:box.getSize(new THREE.Vector3()).toArray(),sourceCenter:center.toArray(),anchor,referenceBone:ref};
 }
 return result;
}
module.exports={extractHands,readRider,readPose};
