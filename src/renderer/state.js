// Draft state for one opened CFG. Pure logic on top of cfg-core (window.CFG in
// the app, require('cfg-core.js') in tests). No DOM, no Three.js.
//
// Rules carried over from Moto Lines 0.8.4:
//  * the parsed document and its original text never change until Save;
//  * edits hold draft strings by CFG path; equal-to-original edits are dropped;
//  * effective save output may mirror one view into the other (save mode);
//  * nothing is ever invented: only existing editable fields can be changed.

export const PARTS=['leftgrip','rightgrip','chain'];
export const HAND_SUFFIXES=['pos.x','pos.y','pos.z'];
export const CHAIN_SUFFIXES=['pos.x','pos.y','pos.z','engine.x','engine.y','engine.z','axis','ratio'];
export const VIEW_LABEL={external:'Third person',cockpit:'Cockpit'};
export const PART_LABEL={leftgrip:'Left hand',rightgrip:'Right hand',chain:'Chain'};
const UNDO_LIMIT=200;

export function formatNumber(v){return (Math.abs(v)<.0000005?0:v).toFixed(6).replace(/\.?0+$/,'')||'0';}

export class Draft{
  constructor(CFG,file){
    this.CFG=CFG;this.file=file;this.doc=CFG.parse(file.text);
    this.edits={};this.undoStack=[];this.redoStack=[];this.saveMode='auto';this.view='external';
    this.typing=null; // coalesces keystrokes in one field into one undo step
  }
  // ----- values
  original(path){return this.doc.fields.get(path)?.value;}
  value(path){return Object.hasOwn(this.edits,path)?this.edits[path]:this.original(path);}
  has(path){return this.doc.fields.has(path);}
  base(view,part){return this.CFG.base(view,part);}
  coords(base){const v=['x','y','z'].map(a=>this.value(base+'.'+a));return v.every(x=>x!==undefined&&this.CFG.numeric(x))?v.map(Number):null;}
  originalCoords(base){const v=['x','y','z'].map(a=>this.original(base+'.'+a));return v.every(x=>x!==undefined&&this.CFG.numeric(x))?v.map(Number):null;}
  suffixes(part){return part==='chain'?CHAIN_SUFFIXES:HAND_SUFFIXES;}
  partChanged(view,part){const b=this.base(view,part)+'.';return Object.keys(this.edits).some(p=>p.startsWith(b));}
  // ----- history
  snapshot(){return {...this.edits};}
  remember(){this.undoStack.push(this.snapshot());if(this.undoStack.length>UNDO_LIMIT)this.undoStack.shift();this.redoStack=[];}
  pushUndo(before){if(JSON.stringify(before)===JSON.stringify(this.edits))return;this.undoStack.push(before);if(this.undoStack.length>UNDO_LIMIT)this.undoStack.shift();this.redoStack=[];}
  undo(){if(!this.undoStack.length)return false;this.redoStack.push(this.snapshot());this.edits=this.undoStack.pop();this.typing=null;return true;}
  redo(){if(!this.redoStack.length)return false;this.undoStack.push(this.snapshot());this.edits=this.redoStack.pop();this.typing=null;return true;}
  endTyping(){this.typing=null;}
  // ----- edits
  assign(path,v){if(String(v)===this.original(path))delete this.edits[path];else this.edits[path]=String(v);}
  // Symmetric hands: the partner of a grip coordinate in the same view gets the
  // mirror value (X negated, Y and Z identical). Non-numbers (half-typed input)
  // leave the partner alone until the value is valid again.
  partnerValue(axis,v){if(!this.CFG.numeric(v))return null;return axis==='x'?formatNumber(-Number(v)):String(v).trim();}
  assignLinked(path,v){
    this.assign(path,v);const p=handPartner(path);
    if(p&&this.doc.fields.has(p.path)){const pv=this.partnerValue(p.axis,v);if(pv!==null)this.assign(p.path,pv);}
  }
  canLink(view){return ['leftgrip','rightgrip'].every(k=>['x','y','z'].every(a=>this.doc.fields.has(this.base(view,k)+'.pos.'+a)));}
  edit(path,v,{typing=false,linked=false}={}){
    if(!this.doc.fields.has(path)||!this.CFG.editable(path))return false;
    if(String(this.value(path))===String(v))return false;
    if(!(typing&&this.typing===path))this.remember();
    this.typing=typing?path:null;
    if(linked)this.assignLinked(path,v);else this.assign(path,v);
    return true;
  }
  editMany(values){ // one undo step
    const before=this.snapshot();for(const [p,v] of Object.entries(values))if(this.doc.fields.has(p)&&this.CFG.editable(p))this.assign(p,v);
    this.typing=null;this.pushUndo(before);return JSON.stringify(before)!==JSON.stringify(this.edits);
  }
  nudge(path,delta,{linked=false}={}){const v=this.value(path);if(!this.CFG.numeric(v))return false;return this.edit(path,formatNumber(Number(v)+delta),{linked});}
  reset(view,parts){
    const bases=[].concat(parts).map(p=>this.base(view,p)+'.'),before=this.snapshot();
    for(const p of Object.keys(this.edits))if(bases.some(b=>p.startsWith(b)))delete this.edits[p];
    this.typing=null;this.pushUndo(before);
  }
  // Copy this lineup's supported fields into the same lineup of the other view.
  transferTargets(view,part){
    const from=this.base(view,part),to=this.base(view==='external'?'cockpit':'external',part);
    const fields=[...this.doc.fields.values()].filter(f=>f.path.startsWith(from+'.')&&this.CFG.editable(f.path));
    if(!fields.length)return null;
    const values={};
    for(const f of fields){const target=to+f.path.slice(from.length),v=this.value(f.path);if(!this.doc.fields.has(target)||!this.CFG.valid(f.path,String(v)))return null;values[target]=v;}
    return values;
  }
  transfer(view,parts){
    const values={};
    for(const part of [].concat(parts)){const v=this.transferTargets(view,part);if(!v)return false;Object.assign(values,v);}
    return this.editMany(values);
  }
  // Mirror one hand across the steering centre plane (X → −X; Y and Z kept).
  mirrorTargets(view,from){
    const to=from==='leftgrip'?'rightgrip':'leftgrip',src=this.coords(this.base(view,from)+'.pos'),dst=this.base(view,to)+'.pos';
    if(!src||!['x','y','z'].every(a=>this.doc.fields.has(dst+'.'+a)))return null;
    return {[dst+'.x']:formatNumber(-src[0]),[dst+'.y']:formatNumber(src[1]),[dst+'.z']:formatNumber(src[2])};
  }
  mirror(view,from){const values=this.mirrorTargets(view,from);return values?this.editMany(values):false;}
  // ----- duplicated-decimal suggestions (never applied without confirmation)
  repairs(){
    const out=[];
    for(const f of this.doc.fields.values()){
      if(!this.CFG.editable(f.path))continue;const v=this.value(f.path);
      if(this.CFG.valid(f.path,String(v)))continue;const fixed=this.CFG.repairNumeric(v);
      if(fixed!==null)out.push({path:f.path,from:String(v),to:fixed,line:lineOf(this.doc.text,f.start)});
    }
    return out;
  }
  applyRepairs(paths){const map=Object.fromEntries(this.repairs().filter(r=>paths.includes(r.path)).map(r=>[r.path,r.to]));return Object.keys(map).length?this.editMany(map):false;}
  // ----- save semantics
  effectiveEdits(){
    if(this.saveMode==='separate')return this.edits;
    return this.CFG.matchViews(this.doc,this.edits,this.saveMode==='auto'?this.view:this.saveMode);
  }
  safeEffective(){try{return {edits:this.effectiveEdits(),error:null};}catch(e){return {edits:this.edits,error:e.message};}}
  sourceView(){return this.saveMode==='separate'?null:this.saveMode==='auto'?this.view:this.saveMode;}
  changedCount(){return Object.keys(this.safeEffective().edits).length;}
  dirty(){return Object.keys(this.edits).length>0;}
  // Exact preview text, invalid drafts included (they still cannot be saved).
  output(){
    const pending=this.safeEffective().edits;let text=this.doc.text;
    const changes=Object.entries(pending).map(([p,v])=>({...this.doc.fields.get(p),value:String(v)})).sort((a,b)=>b.start-a.start);
    for(const f of changes)text=text.slice(0,f.start)+f.value+text.slice(f.end);
    return text;
  }
  issues(){
    const CFG=this.CFG;
    if(this.saveMode!=='separate'){
      try{return CFG.issues(CFG.parse(CFG.patch(this.doc,this.effectiveEdits()))).map(i=>({...i,suggestion:null}));}
      catch(e){
        if(/Correct the source value: /.test(e.message)){
          const cockpit=this.sourceView()==='cockpit',out=[];
          for(const f of this.doc.fields.values()){
            if(!CFG.editable(f.path)||f.path.startsWith('cockpit.')!==cockpit)continue;const v=String(this.value(f.path));
            if(!CFG.valid(f.path,v))out.push({path:f.path,message:'Invalid '+(f.path.endsWith('.axis')?'texture axis':'number')+': '+v,suggestion:CFG.repairNumeric(v)});
          }
          if(out.length)return out;
        }
        const p=/Invalid value for (\S+): /.exec(e.message);
        if(p)return [{path:p[1],message:'Invalid value: '+this.value(p[1]),suggestion:CFG.repairNumeric(this.value(p[1]))}];
        return [{path:VIEW_LABEL[this.sourceView()]+' → both views',message:e.message,suggestion:null}];
      }
    }
    const pending=[];for(const [path,v] of Object.entries(this.edits))if(!CFG.valid(path,v))pending.push({path,message:'Invalid value: '+v,suggestion:CFG.repairNumeric(v)});
    const baseline=CFG.issues(this.doc).filter(i=>!Object.hasOwn(this.edits,i.path)||!CFG.valid(i.path,this.edits[i.path])).map(i=>({...i,suggestion:CFG.repairNumeric(this.value(i.path)??'')}));
    return [...baseline.filter(b=>!pending.some(p=>p.path===b.path)),...pending];
  }
  // Changed lines between the opened file and the effective output. Values never
  // contain newlines, so line counts match and a line-by-line compare is exact.
  changes(){
    const pending=this.safeEffective().edits,before=this.doc.text.split('\n'),after=this.output().split('\n');
    const byLine=new Map();
    for(const [path,v] of Object.entries(pending)){
      const f=this.doc.fields.get(path);if(!f)continue;const line=lineOf(this.doc.text,f.start);
      const mirrored=!Object.hasOwn(this.edits,path)||String(this.edits[path])!==String(v);
      if(!byLine.has(line))byLine.set(line,[]);byLine.get(line).push({path,from:f.value,to:String(v),mirrored});
    }
    return [...byLine.entries()].sort((a,b)=>a[0]-b[0]).map(([line,fields])=>({line,before:before[line-1]?.replace(/\r$/,''),after:after[line-1]?.replace(/\r$/,''),fields}));
  }
  // Side-by-side comparison of every supported field in both views.
  compare(){
    const rows=[];
    for(const part of PARTS)for(const suffix of this.suffixes(part)){
      const e=this.base('external',part)+'.'+suffix,c=this.base('cockpit',part)+'.'+suffix;
      if(!this.has(e)&&!this.has(c))continue;
      const ev=this.value(e),cv=this.value(c),numeric=this.CFG.numeric(ev??'')&&this.CFG.numeric(cv??'');
      rows.push({part,suffix,external:ev,cockpit:cv,externalChanged:Object.hasOwn(this.edits,e),cockpitChanged:Object.hasOwn(this.edits,c),
        delta:numeric?Number(cv)-Number(ev):null,same:ev!==undefined&&cv!==undefined&&(numeric?Math.abs(Number(cv)-Number(ev))<5e-7:ev===cv)});
    }
    return rows;
  }
  // Grip symmetry about the steering centre plane for one view.
  symmetry(view){
    const l=this.coords(this.base(view,'leftgrip')+'.pos'),r=this.coords(this.base(view,'rightgrip')+'.pos');if(!l||!r)return null;
    const width=Math.abs(r[0]-l[0]),centre=(l[0]+r[0])/2,dy=r[1]-l[1],dz=r[2]-l[2];
    return {width,centre,dy,dz,symmetric:Math.abs(centre)<5e-4&&Math.abs(dy)<5e-4&&Math.abs(dz)<5e-4};
  }
}
export function handPartner(path){
  const m=/^((?:cockpit\.)?steer\.)(leftgrip|rightgrip)(\.pos\.)([xyz])$/.exec(path);
  return m?{path:m[1]+(m[2]==='leftgrip'?'rightgrip':'leftgrip')+m[3]+m[4],axis:m[4]}:null;
}
export function lineOf(text,offset){let n=1;for(let i=0;i<offset;i++)if(text.charCodeAt(i)===10)n++;return n;}

// Small line diff (common prefix/suffix trimmed, LCS on the middle) used to
// compare a recovery copy with the current file. Returns hunks of lines.
export function diffLines(a,b,limit=4000){
  const A=a.replace(/\r\n/g,'\n').split('\n'),B=b.replace(/\r\n/g,'\n').split('\n');
  let s=0;while(s<A.length&&s<B.length&&A[s]===B[s])s++;
  let e=0;while(e<A.length-s&&e<B.length-s&&A[A.length-1-e]===B[B.length-1-e])e++;
  const a2=A.slice(s,A.length-e),b2=B.slice(s,B.length-e),out=[];
  if(a2.length*b2.length>limit*limit){a2.forEach((t,i)=>out.push({type:'del',a:s+i+1,text:t}));b2.forEach((t,i)=>out.push({type:'add',b:s+i+1,text:t}));return {ops:out,same:false};}
  const n=a2.length,m=b2.length,dp=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=a2[i]===b2[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0;
  while(i<n||j<m){
    if(i<n&&j<m&&a2[i]===b2[j]){out.push({type:'same',a:s+i+1,b:s+j+1,text:a2[i]});i++;j++;}
    else if(i<n&&(j>=m||dp[i+1][j]>=dp[i][j+1])){out.push({type:'del',a:s+i+1,text:a2[i]});i++;}
    else{out.push({type:'add',b:s+j+1,text:b2[j]});j++;}
  }
  return {ops:out,same:!a2.length&&!b2.length};
}
