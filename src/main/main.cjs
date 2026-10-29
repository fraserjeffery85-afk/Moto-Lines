'use strict';
const {app,BrowserWindow,ipcMain,dialog,Menu,protocol,net,shell,screen}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url'),{Worker}=require('node:worker_threads');
const ROOT=path.join(__dirname,'..','..'),CORE=path.join(ROOT,'src','core');
const CFG=require('../core/cfg-core.js'),storage=require('../core/storage.cjs');
const {Settings,findLegacyNear,inspectLegacy,importLegacy,exists}=require('./settings.cjs');
const {findRiderPackage}=require('./steam.cjs');
const {createUpdater}=require('./updater.cjs');
const PRODUCT='Moto Lines Studio',VERSION=require('../../package.json').version;

// Installed: %APPDATA%\Moto Lines Studio. Portable: user-data beside the exe (see paths.cjs).
const paths=require('./paths.cjs'),appFolder=paths.appFolder(app,ROOT);
app.setPath('userData',paths.userDataDir(app,ROOT));
const backupRoot=path.join(app.getPath('userData'),'backups');
const settings=new Settings(path.join(app.getPath('userData'),'settings.json'));
// Optional developer / test auto-open file (cfg, model, hands.package).
const projectFile=process.env.MLS_PROJECT||process.env.DGS_PROJECT||path.join(ROOT,'project.json');
protocol.registerSchemesAsPrivileged([{scheme:'model',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);

let updater=null,updateChecked=false;
let win,current=null,dirty=false,modelDirectory=null,sessionRider=null;
// Original generic gloves shipped with the app (not game data), used until a real rider.pkz is found.
const GENERIC_RIDER=path.join(ROOT,'assets','generic-rider.pkz');
const RIDER_ENTRIES=['rider/riders/default_mx/c_rider.edf','rider/animations/mx/rider.anm','rider/riders/default_mx/gfx.cfg'];

async function choose(title,extensions,save=false,defaultPath,name){
  const opts={title,filters:[{name:name||extensions.map(e=>'.'+e).join(', '),extensions}],defaultPath};
  const result=await (save?dialog.showSaveDialog(win,opts):dialog.showOpenDialog(win,{...opts,properties:['openFile']}));
  return result.canceled?null:(save?result.filePath:result.filePaths[0]);
}
async function discard(){
  if(!dirty)return true;
  const r=await dialog.showMessageBox(win,{type:'question',title:PRODUCT,message:'Discard unsaved lineup changes?',detail:'Your draft edits have not been written to the CFG.',buttons:['Keep editing','Discard changes'],defaultId:0,cancelId:0});
  return r.response===1;
}
async function openCfg(file){
  if(!await discard())return null;
  file=file||await choose('Open gfx.cfg',['cfg'],false,undefined,'MX Bikes graphics config');if(!file)return null;
  if(path.extname(file).toLowerCase()!=='.cfg')throw Error('Choose a .cfg file.');
  let next;
  try{next=await storage.readCfg(file);}
  catch(e){if(e.code==='ENOENT'){settings.removeRecent('cfg',file);throw Error('This file no longer exists:\n'+file);}throw e;}
  current=next;dirty=false;settings.addRecent('cfg',file);updateTitle();return next;
}
function decodeInWorker(file){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(CORE,'edf-worker.cjs'),{workerData:file});
    const timer=setTimeout(()=>{worker.terminate();reject(Error('EDF decoding timed out.'));},45000);
    worker.once('message',m=>{clearTimeout(timer);m.error?reject(Error(m.error)):resolve(m.result);});
    worker.once('error',e=>{clearTimeout(timer);reject(e);});
    worker.once('exit',code=>{if(code){clearTimeout(timer);reject(Error('EDF decoder stopped'));}});
  });
}
async function openModel(file){
  file=file||await choose('Open EDF or source model',['edf','fbx','glb','gltf','obj'],false,undefined,'Models');if(!file)return null;
  const ext=path.extname(file).toLowerCase();let stat;
  try{stat=await fs.stat(file);}catch(e){if(e.code==='ENOENT'){settings.removeRecent('model',file);throw Error('This file no longer exists:\n'+file);}throw e;}
  if(stat.size>1024*1024*1024)throw Error('Model exceeds the 1 GB limit.');
  if(ext==='.edf'){
    const result=await decodeInWorker(file);
    let assembly=null;
    try{const profile=JSON.parse(await fs.readFile(path.join(CORE,'assembly.json'),'utf8'));if(profile.version===1&&result.parts.some(p=>profile.parts[p.name]))assembly={...profile,match:profile.modelSha256===result.sha256?'exact':'template'};}catch(e){if(e.code!=='ENOENT')throw e;}
    let cfgPath=null;const sibling=path.join(path.dirname(file),'gfx.cfg');try{if((await fs.stat(sibling)).isFile())cfgPath=sibling;}catch{}
    settings.addRecent('model',file);
    return {kind:'edf',path:file,name:path.basename(file),size:stat.size,...result,assembly,cfgPath};
  }
  if(!['.fbx','.glb','.gltf','.obj'].includes(ext))throw Error('Unsupported model format. Choose EDF, FBX, GLB, glTF or OBJ.');
  const bytes=await fs.readFile(file);modelDirectory=await fs.realpath(path.dirname(file));
  settings.addRecent('model',file);
  return {kind:ext.slice(1),path:file,name:path.basename(file),size:stat.size,bytes};
}
async function openHands(files){
  const hands=require(path.join(CORE,'hands.cjs'));
  const generic=!!files?.generic;
  if(generic)files={package:GENERIC_RIDER};
  if(!files?.rider&&!files?.animation){
    let candidate=files?.package||(files?.choose?null:sessionRider||settings.data.riderPackage);
    if(candidate&&!await exists(candidate))candidate=null;
    if(!candidate)candidate=await choose('Select rider.pkz in your MX Bikes installation folder',['pkz'],false,undefined,'MX Bikes rider package');
    if(!candidate)return null;
    files={package:candidate};
  }
  if(files.package){
    const info=await fs.stat(files.package);if(info.size>256*1024*1024)throw Error('Rider package exceeds the 256 MB limit.');
    const {unzipSync}=await import('three/addons/libs/fflate.module.js');
    const entries=unzipSync(new Uint8Array(await fs.readFile(files.package)),{filter:f=>RIDER_ENTRIES.includes(f.name)&&f.originalSize<128*1024*1024});
    if(RIDER_ENTRIES.some(n=>!entries[n]))throw Error('Stock MX rider assets were not found in this package. Choose rider.pkz from the MX Bikes installation folder.');
    const extracted=hands.extractHands(entries[RIDER_ENTRIES[0]],entries[RIDER_ENTRIES[1]],Buffer.from(entries[RIDER_ENTRIES[2]]).toString('utf8'));
    if(generic)return {...extracted,rider:'Generic gloves (bundled)',animation:'Generic pose',generic:true};
    const result={...extracted,rider:files.package+' / default_mx',animation:'Stock mx / rider.anm',stock:true,package:files.package};
    sessionRider=files.package;settings.data.riderPackage=files.package;settings.save(); // the generic gloves are never remembered
    return result;
  }
  const rider=files.rider||await choose('Choose readable cockpit rider EDF',['edf']);if(!rider)return null;
  const animation=files.animation||await choose('Choose rider animation for the hand pose',['anm']);if(!animation)return null;
  if(path.extname(rider).toLowerCase()!=='.edf'||path.extname(animation).toLowerCase()!=='.anm')throw Error('Choose a rider EDF and ANM animation.');
  const [rs,as]=await Promise.all([fs.stat(rider),fs.stat(animation)]);if(rs.size>256*1024*1024||as.size>32*1024*1024)throw Error('Rider reference exceeds size limits.');
  const [r,a]=await Promise.all([fs.readFile(rider),fs.readFile(animation)]);
  const riderCfg=await fs.readFile(path.join(path.dirname(rider),'gfx.cfg'),'utf8');
  return {...hands.extractHands(r,a,riderCfg),rider,animation};
}
function requireCurrent(){if(!current)throw Error('Open a CFG first.');return current;}
async function save(edits,saveAs){
  requireCurrent();
  const text=CFG.patch(CFG.parse(current.text),edits);const errors=CFG.issues(CFG.parse(text));
  if(errors.length)throw Error(errors.map(e=>e.path+': '+e.message).join('\n'));
  const file=saveAs?await choose('Save gfx.cfg',['cfg'],true,path.join(path.dirname(current.path),'gfx-edited.cfg')):current.path;if(!file)return null;
  if(path.extname(file).toLowerCase()!=='.cfg')throw Error('Save with the .cfg extension.');
  const same=path.resolve(file).toLowerCase()===path.resolve(current.path).toLowerCase();
  const result=await storage.safeWrite(file,text,current.encoding,same?current.hash:null,backupRoot);
  current={...current,...result,text};dirty=false;settings.addRecent('cfg',file);updateTitle();
  return {...current,...result};
}
async function restore(name){
  requireCurrent();
  const backup=await storage.readBackup(current.path,backupRoot,name);
  const m=/\.(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\./.exec(name);
  const when=m?new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`).toLocaleString():name;
  const r=await dialog.showMessageBox(win,{type:'warning',title:PRODUCT,message:'Restore this recovery copy?',detail:`${path.basename(current.path)} will be replaced with the copy saved before ${when}.\n\nThe current file is backed up first, so this can be undone from the Backups tab.${dirty?'\n\nYour unsaved draft edits will be discarded.':''}`,buttons:['Cancel','Restore copy'],defaultId:0,cancelId:0});
  if(r.response!==1)return null;
  const result=await storage.restoreBackup(current.path,backupRoot,name,current.hash);
  current={...current,...result,text:backup.text,encoding:backup.encoding};dirty=false;updateTitle();
  return {...current,...result};
}
function updateTitle(){if(win&&!win.isDestroyed())win.setTitle((dirty?'● ':'')+(current?path.basename(path.dirname(current.path))+' / '+path.basename(current.path)+' — ':'')+PRODUCT);}
function send(command){win?.webContents.send('command',command);}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted request');return fn(...args);});}

function buildMenu(){
  const recent=settings.data.recent.cfg.map(r=>({label:r.path.split(/[\\/]/).slice(-2).join('\\'),click:()=>win.webContents.send('command','openRecent:'+r.path)}));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'File',submenu:[
      {label:'Open GFX…',accelerator:'CmdOrCtrl+O',click:()=>send('open')},
      {label:'Open model…',accelerator:'CmdOrCtrl+M',click:()=>send('model')},
      {label:'Open recent',submenu:recent.length?recent:[{label:'No recent files',enabled:false}]},
      {type:'separator'},
      {label:'Save',accelerator:'CmdOrCtrl+S',click:()=>send('save')},
      {label:'Save as…',accelerator:'CmdOrCtrl+Shift+S',click:()=>send('saveAs')},
      {label:'Save both views…',click:()=>send('saveBoth')},
      {type:'separator'},
      {label:'Show CFG in folder',click:()=>current&&shell.showItemInFolder(current.path)},
      {label:'Open backups folder',click:()=>openBackupsFolder().catch(()=>{})},
      {type:'separator'},{role:'quit'}]},
    {label:'Edit',submenu:[
      {label:'Undo lineup edit',accelerator:'CmdOrCtrl+Z',click:()=>send('undo')},
      {label:'Redo lineup edit',accelerator:'CmdOrCtrl+Y',click:()=>send('redo')},
      {type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'View',submenu:[
      {label:'Frame bike',click:()=>send('frame')},
      {label:'Toggle output drawer',accelerator:'CmdOrCtrl+J',click:()=>send('drawer')},
      {type:'separator'},{role:'togglefullscreen'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},
      ...(app.isPackaged?[]:[{type:'separator'},{role:'toggleDevTools'}])]},
    {label:'Help',submenu:[
      {label:'Keyboard shortcuts',accelerator:'F1',click:()=>send('shortcuts')},
      {label:'Check for updates…',click:()=>send('checkUpdates')},
      {label:'Import from older Moto Lines…',click:()=>send('importLegacy')},
      {type:'separator'},
      {label:'About '+PRODUCT,click:()=>send('about')}]}
  ]));
}
async function openBackupsFolder(){await fs.mkdir(backupRoot,{recursive:true});const error=await shell.openPath(backupRoot);if(error)throw Error(error);}
function windowBounds(){
  const w=settings.data.window;if(!w)return {width:1480,height:940};
  const bounds={width:w.width,height:w.height};
  if(Number.isFinite(w.x)&&Number.isFinite(w.y)&&screen.getAllDisplays().some(d=>{const a=d.workArea;return w.x>=a.x-40&&w.y>=a.y-40&&w.x<a.x+a.width-100&&w.y<a.y+a.height-100;})){bounds.x=w.x;bounds.y=w.y;}
  return bounds;
}

app.whenReady().then(async()=>{
  await settings.load();
  updater=createUpdater({settings,userData:app.getPath('userData'),send:s=>{if(win&&!win.isDestroyed())win.webContents.send('update',s);}});
  protocol.handle('model',async request=>{
    try{if(!modelDirectory)return new Response('No model',{status:404});const url=new URL(request.url);if(url.hostname!=='preview')return new Response('',{status:403});
      const target=await fs.realpath(path.resolve(modelDirectory,'.'+decodeURIComponent(url.pathname)));
      const rel=path.relative(modelDirectory,target);if(rel.startsWith('..')||path.isAbsolute(rel)||!['.bin','.png','.jpg','.jpeg','.webp','.bmp','.tga','.dds'].includes(path.extname(target).toLowerCase()))return new Response('',{status:403});
      return net.fetch(pathToFileURL(target).href);
    }catch{return new Response('Asset unavailable',{status:404});}
  });
  win=new BrowserWindow({...windowBounds(),minWidth:1120,minHeight:720,backgroundColor:'#16191d',title:PRODUCT,icon:path.join(ROOT,'assets/moto-lines.ico'),show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(settings.data.window?.maximized)win.maximize();
  buildMenu();
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());

  handle('open-cfg',async file=>{const r=await openCfg(file);buildMenu();return r;});
  handle('open-model',openModel);
  handle('open-hands',openHands);
  handle('save',async(edits,saveAs)=>{const r=await save(edits,saveAs);buildMenu();return r;});
  handle('dirty',value=>{dirty=!!value;updateTitle();});
  handle('startup',async()=>{
    // The renderer reached startup, so this version works: keep it as the fallback.
    updater.started();
    if(!updateChecked&&updater.enabled&&settings.data.prefs.autoUpdateCheck!==false){updateChecked=true;setTimeout(()=>updater.check().catch(()=>{}),2500);}
    let project={};
    try{project=JSON.parse(await fs.readFile(projectFile,'utf8'))||{};for(const key of ['cfg','model'])if(project[key]&&!await exists(project[key]))delete project[key];if(project.hands?.package&&!await exists(project.hands.package))delete project.hands;}catch{project={};}
    const legacy=settings.data.migratedFrom||settings.data.prefs.welcomeDismissedLegacy?[]:await findLegacyNear(appFolder);
    const recent={};for(const kind of ['cfg','model'])recent[kind]=await Promise.all(settings.data.recent[kind].map(async r=>({...r,exists:await exists(r.path)})));
    let riderPackage=settings.data.riderPackage&&await exists(settings.data.riderPackage)?settings.data.riderPackage:null,riderDetected=false;
    if(!riderPackage&&!project.hands){riderPackage=await findRiderPackage().catch(()=>null);riderDetected=!!riderPackage;}
    return {project,prefs:settings.data.prefs,recent,riderPackage,riderDetected,legacy,version:VERSION,product:PRODUCT,update:{...updater.info,enabled:updater.enabled,state:updater.state}};
  });
  handle('set-prefs',patch=>settings.setPrefs(patch));
  handle('forget-recent',(kind,file)=>{if(['cfg','model'].includes(kind))settings.removeRecent(kind,file);buildMenu();});
  handle('open-backups',openBackupsFolder);
  handle('reveal-cfg',()=>{if(current)shell.showItemInFolder(current.path);});
  handle('list-backups',async()=>current?storage.listBackups(current.path,backupRoot):[]);
  handle('read-backup',async name=>{requireCurrent();const b=await storage.readBackup(current.path,backupRoot,name);return {text:b.text,encoding:b.encoding};});
  handle('restore-backup',restore);
  handle('import-legacy',async folder=>{
    let info;
    if(folder){info=(await findLegacyNear(appFolder)).find(l=>path.resolve(l.root)===path.resolve(folder));}
    else{const r=await dialog.showOpenDialog(win,{title:'Choose the older Moto Lines folder (contains Moto Lines.exe)',properties:['openDirectory']});if(r.canceled)return null;info=await inspectLegacy(r.filePaths[0]);}
    if(!info)throw Error('That folder is not an older Moto Lines portable build. Choose the folder that contains "Moto Lines.exe".');
    const result=await importLegacy(info,settings,backupRoot);buildMenu();
    return {...result,riderPackage:settings.data.riderPackage};
  });
  handle('dismiss-legacy',()=>settings.setPrefs({welcomeDismissedLegacy:true}));
  handle('update-check',()=>updater.check({manual:true}));
  handle('update-download',()=>updater.download());
  handle('update-skip',()=>updater.skip());
  handle('update-release-page',()=>updater.openReleasePage());
  handle('update-restart',async()=>{
    if(updater.state.status!=='ready')return false;
    if(!await discard())return false;
    dirty=false;app.relaunch();app.exit(0);return true;
  });

  const remember=()=>{if(!win||win.isDestroyed())return;const b=win.getNormalBounds();settings.data.window={...b,maximized:win.isMaximized()};settings.save();};
  win.on('close',e=>{if(dirty){e.preventDefault();discard().then(ok=>{if(ok){dirty=false;win.close();}});return;}remember();});
  win.webContents.on('render-process-gone',(_event,details)=>{dialog.showErrorBox(PRODUCT+' stopped','The display process stopped ('+details.reason+'). Restart the app; your CFG is unchanged unless you saved.');});
  win.once('ready-to-show',()=>win.show());
  await win.loadFile(path.join(ROOT,'src','renderer','index.html'));
}).catch(error=>{dialog.showErrorBox(PRODUCT+' could not start',error.stack||String(error));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
