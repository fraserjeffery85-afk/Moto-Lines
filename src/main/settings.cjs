'use strict';
// Persistent, upgrade-safe settings. Stored in user-data/settings.json, which the
// build never touches (unlike resources/app/project.json, which it resets).
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');

const PREF_DEFAULTS={
  saveMode:'auto',step:0.001,showHands:true,handOpacity:100,grid:true,wire:false,helpers:true,snap:true,
  ghost:true,linkHands:false,gameHanded:true,autoUpdateCheck:true,skippedUpdate:null,drawer:'changes',drawerOpen:false,handAlignment:null,welcomeDismissedLegacy:false
};
const PREF_CHECKS={
  saveMode:v=>['auto','separate','external','cockpit'].includes(v),
  step:v=>[0.0001,0.001,0.01].includes(v),
  handOpacity:v=>Number.isInteger(v)&&v>=10&&v<=100,
  drawer:v=>['changes','output','compare','backups'].includes(v),
  handAlignment:v=>v===null||validAlignment(v),
  skippedUpdate:v=>v===null||(typeof v==='string'&&/^\d+\.\d+\.\d+$/.test(v))
};
const BOOL_PREFS=['showHands','grid','wire','helpers','snap','ghost','linkHands','gameHanded','autoUpdateCheck','drawerOpen','welcomeDismissedLegacy'];
const RECENT_LIMIT=8;

function validAlignment(v){
  if(!v||typeof v!=='object')return false;
  for(const view of ['external','cockpit'])for(const side of ['leftgrip','rightgrip']){
    const a=v[view]?.[side];if(!a)return false;
    for(const k of ['offset','rotation'])if(!Array.isArray(a[k])||a[k].length!==3||!a[k].every(Number.isFinite))return false;
  }
  return true;
}
function blank(){return {version:1,riderPackage:null,recent:{cfg:[],model:[]},window:null,prefs:{...PREF_DEFAULTS},migratedFrom:null};}
function sanitize(raw){
  const s=blank();if(!raw||typeof raw!=='object')return s;
  if(typeof raw.riderPackage==='string'&&raw.riderPackage)s.riderPackage=raw.riderPackage;
  for(const kind of ['cfg','model'])if(Array.isArray(raw.recent?.[kind]))
    s.recent[kind]=raw.recent[kind].filter(r=>typeof r?.path==='string'&&r.path).slice(0,RECENT_LIMIT).map(r=>({path:r.path,openedAt:typeof r.openedAt==='string'?r.openedAt:null}));
  const w=raw.window;if(w&&['width','height'].every(k=>Number.isFinite(w[k])&&w[k]>200))s.window={width:w.width,height:w.height,x:Number.isFinite(w.x)?w.x:undefined,y:Number.isFinite(w.y)?w.y:undefined,maximized:!!w.maximized};
  for(const [key,value] of Object.entries(raw.prefs||{}))if(acceptPref(key,value))s.prefs[key]=value;
  if(typeof raw.migratedFrom==='string')s.migratedFrom=raw.migratedFrom;
  return s;
}
function acceptPref(key,value){
  if(!Object.hasOwn(PREF_DEFAULTS,key))return false;
  if(BOOL_PREFS.includes(key))return typeof value==='boolean';
  return PREF_CHECKS[key]?PREF_CHECKS[key](value):false;
}

class Settings{
  constructor(file){this.file=file;this.data=blank();this.queue=Promise.resolve();}
  async load(){
    try{this.data=sanitize(JSON.parse(await fs.readFile(this.file,'utf8')));}
    catch(e){
      if(e.code!=='ENOENT'){ // keep the unreadable file for inspection rather than overwrite it silently
        await fs.copyFile(this.file,this.file+'.unreadable-'+Date.now()).catch(()=>{});
      }
      this.data=blank();
    }
    return this.data;
  }
  save(){
    const text=JSON.stringify(this.data,null,2)+'\n';
    this.queue=this.queue.then(async()=>{
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      const temp=this.file+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
      await fs.writeFile(temp,text);await fs.rename(temp,this.file);
    }).catch(e=>console.error('Settings were not saved:',e));
    return this.queue;
  }
  setPrefs(patch){
    const accepted={};
    for(const [k,v] of Object.entries(patch||{}))if(acceptPref(k,v)){this.data.prefs[k]=v;accepted[k]=v;}
    this.save();return accepted;
  }
  addRecent(kind,file){
    const list=this.data.recent[kind].filter(r=>path.resolve(r.path).toLowerCase()!==path.resolve(file).toLowerCase());
    list.unshift({path:file,openedAt:new Date().toISOString()});this.data.recent[kind]=list.slice(0,RECENT_LIMIT);this.save();
  }
  removeRecent(kind,file){this.data.recent[kind]=this.data.recent[kind].filter(r=>r.path!==file);this.save();}
}

async function exists(p){try{await fs.access(p);return true;}catch{return false;}}

// Older portable builds: <folder>/Moto Lines.exe + resources/app/{package.json,project.json}
// and <folder>/user-data/backups. Accepts the portable folder or its resources/app.
async function inspectLegacy(folder){
  let root=path.resolve(folder);
  if(path.basename(root).toLowerCase()==='app'&&path.basename(path.dirname(root)).toLowerCase()==='resources')root=path.dirname(path.dirname(root));
  const app=path.join(root,'resources','app');
  let pkg;try{pkg=JSON.parse(await fs.readFile(path.join(app,'package.json'),'utf8'));}catch{return null;}
  if(!/moto lines/i.test(pkg.productName||'')||pkg.name==='moto-lines-studio')return null;
  let project={};try{project=JSON.parse(await fs.readFile(path.join(app,'project.json'),'utf8'))||{};}catch{}
  const backups=path.join(root,'user-data','backups');let backupCount=0;
  async function count(dir){let list=[];try{list=await fs.readdir(dir,{withFileTypes:true});}catch{return;}for(const e of list){if(e.isDirectory())await count(path.join(dir,e.name));else if(e.name.endsWith('.bak'))backupCount++;}}
  await count(backups);
  return {root,version:pkg.version||'unknown',riderPackage:typeof project.hands?.package==='string'?project.hands.package:null,cfg:typeof project.cfg==='string'?project.cfg:null,model:typeof project.model==='string'?project.model:null,backups,backupCount};
}
async function findLegacyNear(appFolder){
  const parent=path.dirname(appFolder);let names=[];try{names=await fs.readdir(parent);}catch{return [];}
  const found=[];
  for(const name of names.filter(n=>/^moto[- ]lines.*windows$/i.test(n))){
    const full=path.join(parent,name);if(path.resolve(full)===path.resolve(appFolder))continue;
    const info=await inspectLegacy(full);if(info)found.push(info);
  }
  return found.sort((a,b)=>b.version.localeCompare(a.version,undefined,{numeric:true}));
}
// Copies (never moves) old backups into this app's backup folder. Existing
// files are never overwritten. Rider path and recents are adopted only if the
// files still exist.
async function importLegacy(info,settings,backupRoot){
  let copied=0,skipped=0;
  async function copy(from,to){
    let list=[];try{list=await fs.readdir(from,{withFileTypes:true});}catch{return;}
    await fs.mkdir(to,{recursive:true});
    for(const e of list){
      const a=path.join(from,e.name),b=path.join(to,e.name);
      if(e.isDirectory())await copy(a,b);
      else if(e.isFile()){try{await fs.copyFile(a,b,require('node:fs').constants.COPYFILE_EXCL);copied++;}catch(err){if(err.code==='EEXIST')skipped++;else throw err;}}
    }
  }
  await copy(info.backups,backupRoot);
  let rider=false;
  if(info.riderPackage&&await exists(info.riderPackage)){settings.data.riderPackage=info.riderPackage;rider=true;}
  for(const kind of ['model','cfg'])if(info[kind]&&await exists(info[kind]))settings.addRecent(kind,info[kind]);
  settings.data.migratedFrom=info.root;await settings.save();
  return {copied,skipped,rider,version:info.version};
}

module.exports={Settings,sanitize,inspectLegacy,findLegacyNear,importLegacy,PREF_DEFAULTS,validAlignment,exists};
