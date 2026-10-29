'use strict';
// Update packages: verification, installation and version selection.
// No Electron imports, so the boot loader and unit tests can use it directly.
//
// A release publishes three assets:
//   update.json      – manifest: version, notes, minimum Electron, zip name/size/sha256,
//                      and the sha256 of every file the zip contains
//   update.json.sig  – base64 Ed25519 signature of update.json's exact bytes
//   <zip>            – the resources/app folder of that version
// Nothing is trusted unless the signature verifies against the public key built
// into the app and every hash matches. Installed versions live in
// user-data/updates/app-<version>/; the shipped app folder is never modified.
const crypto=require('node:crypto'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');

const VERSION=/^\d{1,4}\.\d{1,5}\.\d{1,6}$/,HEX64=/^[0-9a-f]{64}$/;
const SAFE_PATH=/^(?:[A-Za-z0-9_@][A-Za-z0-9_@.+ -]*\/)*[A-Za-z0-9_@][A-Za-z0-9_@.+ -]*$/;
const MAX_ZIP=300*1024*1024,MAX_FILES=5000;
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');

function compare(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function safeRelative(p){return typeof p==='string'&&p.length<300&&SAFE_PATH.test(p)&&!p.split('/').some(s=>s==='.'||s==='..'||/\.$/.test(s));}

function sign(bytes,privateKeyPem){return crypto.sign(null,Buffer.from(bytes),crypto.createPrivateKey(privateKeyPem)).toString('base64');}
// Verifies the signature first, then the manifest's shape. Returns the manifest.
function verifyManifest(bytes,signature,publicKeyPem){
  bytes=Buffer.from(bytes);
  let ok=false;
  try{ok=crypto.verify(null,bytes,crypto.createPublicKey(publicKeyPem),Buffer.from(String(signature||'').trim(),'base64'));}catch{ok=false;}
  if(!ok)throw Error('The update’s signature is not valid. It was not installed.');
  let m;try{m=JSON.parse(bytes.toString('utf8'));}catch{throw Error('The update manifest is unreadable.');}
  const bad=why=>{throw Error('The update manifest is invalid ('+why+').');};
  if(m?.format!==1)bad('format');
  if(!VERSION.test(m.version))bad('version');
  if(!VERSION.test(m.minElectron))bad('minElectron');
  if(typeof m.notes!=='string'||m.notes.length>20000)bad('notes');
  if(!m.zip||!/^[A-Za-z0-9_.-]+\.zip$/.test(m.zip.name)||!Number.isSafeInteger(m.zip.size)||m.zip.size<=0||m.zip.size>MAX_ZIP||!HEX64.test(m.zip.sha256))bad('zip');
  const files=Object.entries(m.files||{});
  if(!files.length||files.length>MAX_FILES||!files.every(([p,h])=>safeRelative(p)&&HEX64.test(h)))bad('files');
  if(!m.files['package.json']||!m.files['src/main/main.cjs'])bad('entry point');
  return m;
}

// Writes a verified package into root/app-<version>. Returns the directory.
async function installPackage({zipBytes,manifestBytes,signature,publicKeyPem,root}){
  const m=verifyManifest(manifestBytes,signature,publicKeyPem);
  zipBytes=Buffer.from(zipBytes);
  if(zipBytes.length!==m.zip.size||sha256(zipBytes)!==m.zip.sha256)throw Error('The downloaded update doesn’t match its signed checksum. It was not installed.');
  const {unzipSync}=await import('three/addons/libs/fflate.module.js');
  const entries=unzipSync(new Uint8Array(zipBytes),{filter:f=>!f.name.endsWith('/')});
  const names=Object.keys(entries),expected=Object.keys(m.files);
  if(names.length!==expected.length||!names.every(n=>Object.hasOwn(m.files,n)))throw Error('The update contains unexpected files. It was not installed.');
  for(const [name,data] of Object.entries(entries))if(sha256(data)!==m.files[name])throw Error('An update file doesn’t match its signed checksum: '+name);
  const pkg=JSON.parse(Buffer.from(entries['package.json']).toString('utf8'));
  if(pkg.version!==m.version)throw Error('The update’s version doesn’t match its manifest.');
  await fsp.mkdir(root,{recursive:true});
  const final=path.join(root,'app-'+m.version),temp=final+'.partial-'+crypto.randomBytes(4).toString('hex');
  try{
    for(const [name,data] of Object.entries(entries)){const p=path.join(temp,...name.split('/'));await fsp.mkdir(path.dirname(p),{recursive:true});await fsp.writeFile(p,data);}
    await fsp.writeFile(path.join(temp,'update.json'),Buffer.from(manifestBytes));
    await fsp.writeFile(path.join(temp,'update.json.sig'),String(signature).trim()+'\n');
    await fsp.rm(final,{recursive:true,force:true});
    await fsp.rename(temp,final);
  }catch(e){await fsp.rm(temp,{recursive:true,force:true}).catch(()=>{});throw e;}
  return {dir:final,manifest:m};
}

// Synchronous check of an installed version (the boot loader can't await).
function verifyInstalledSync(dir,publicKeyPem){
  const m=verifyManifest(fs.readFileSync(path.join(dir,'update.json')),fs.readFileSync(path.join(dir,'update.json.sig'),'utf8'),publicKeyPem);
  if(path.basename(dir)!=='app-'+m.version)throw Error('Update folder name doesn’t match its version.');
  for(const [rel,hash] of Object.entries(m.files))if(sha256(fs.readFileSync(path.join(dir,...rel.split('/'))))!==hash)throw Error('Modified update file: '+rel);
  return m;
}

function readState(root){try{const s=JSON.parse(fs.readFileSync(path.join(root,'boot-state.json'),'utf8'));return {bad:Array.isArray(s.bad)?s.bad.filter(v=>VERSION.test(v)):[],pending:s.pending&&VERSION.test(s.pending.version)?{version:s.pending.version,attempts:Number(s.pending.attempts)||0}:null,good:VERSION.test(s.good)?s.good:null};}catch{return {bad:[],pending:null,good:null};}}
function writeState(root,state){try{fs.mkdirSync(root,{recursive:true});const f=path.join(root,'boot-state.json'),t=f+'.'+process.pid+'.tmp';fs.writeFileSync(t,JSON.stringify(state,null,2));fs.renameSync(t,f);}catch{}}

// Picks the newest installed version that is newer than the shipped one, needs no
// newer Electron, verifies, and hasn't failed to start twice. Records the attempt.
function selectApp({root,bundledVersion,electronVersion,publicKeyPem,maxAttempts=2}){
  const state=readState(root),skipped=[];let names=[];
  try{names=fs.readdirSync(root).filter(n=>/^app-\d+\.\d+\.\d+$/.test(n));}catch{}
  const versions=names.map(n=>n.slice(4)).filter(v=>VERSION.test(v)&&compare(v,bundledVersion)>0).sort((a,b)=>compare(b,a));
  for(const v of versions){
    if(state.bad.includes(v)){skipped.push({version:v,reason:'failed to start before'});continue;}
    if(state.pending?.version===v&&state.pending.attempts>=maxAttempts&&state.good!==v){state.bad.push(v);skipped.push({version:v,reason:'failed to start twice'});continue;}
    const dir=path.join(root,'app-'+v);
    try{
      const m=verifyInstalledSync(dir,publicKeyPem);
      if(compare(m.minElectron,electronVersion)>0){skipped.push({version:v,reason:'needs a newer app download'});continue;}
      if(state.good!==v)state.pending={version:v,attempts:state.pending?.version===v?state.pending.attempts+1:1};
      writeState(root,state);
      return {version:v,dir,skipped};
    }catch(e){skipped.push({version:v,reason:e.message});}
  }
  state.pending=null;writeState(root,state);
  return {version:bundledVersion,dir:null,skipped};
}
function markGood(root,version){const s=readState(root);if(s.pending?.version===version)s.pending=null;s.good=version;s.bad=s.bad.filter(v=>v!==version);writeState(root,s);}
// Keeps the running version and the one before it; removes older and partial folders.
async function cleanup(root,keep){
  let names=[];try{names=await fsp.readdir(root);}catch{return;}
  const versions=names.filter(n=>/^app-\d+\.\d+\.\d+$/.test(n)).map(n=>n.slice(4)).sort((a,b)=>compare(b,a));
  const keepSet=new Set([...keep.filter(Boolean),...versions.slice(0,2)]);
  for(const n of names){
    if(/\.partial-[0-9a-f]+$/.test(n)||(/^app-\d+\.\d+\.\d+$/.test(n)&&!keepSet.has(n.slice(4))))await fsp.rm(path.join(root,n),{recursive:true,force:true}).catch(()=>{});
  }
}
// Hash every file of an app folder (release tooling).
function listFiles(dir){
  const out={};
  (function walk(d,prefix){for(const e of fs.readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(d,e.name),rel=prefix+e.name;if(e.isDirectory())walk(p,rel+'/');else if(e.isFile())out[rel]=sha256(fs.readFileSync(p));}})(dir,'');
  return out;
}

module.exports={compare,sign,verifyManifest,installPackage,verifyInstalledSync,selectApp,markGood,cleanup,listFiles,readState,sha256,VERSION};
