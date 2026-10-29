'use strict';
// Entry point of the shipped app. Picks the newest verified update installed in
// user-data/updates (see update-core.cjs) and runs its main process; otherwise
// runs the app shipped in this folder. Must stay synchronous: main.cjs registers
// privileged protocols, which Electron only allows before the 'ready' event.
// This file itself is only replaced by a full download, so keep it small.
const path=require('node:path'),fs=require('node:fs');
const {app}=require('electron');
const ROOT=path.join(__dirname,'..','..');
const bundledVersion=require('../../package.json').version;
const info={bundled:bundledVersion,active:bundledVersion,dir:ROOT,root:null,skipped:[],error:null};
global.__mlsBoot=info;
try{
  // Updates apply to the packaged app; from source only when a test asks for it.
  if(app.isPackaged||process.env.MLS_ALLOW_DEV_UPDATES==='1'){
    const userData=process.env.MLS_USER_DATA||process.env.DGS_USER_DATA||path.join(app.isPackaged?path.dirname(process.execPath):ROOT,'user-data');
    const keyFile=!app.isPackaged&&process.env.MLS_UPDATE_PUBKEY?process.env.MLS_UPDATE_PUBKEY:path.join(__dirname,'update-public-key.pem');
    const core=require('./update-core.cjs');
    info.root=path.join(userData,'updates');
    if(fs.existsSync(info.root)&&fs.existsSync(keyFile)){
      const pick=core.selectApp({root:info.root,bundledVersion,electronVersion:process.versions.electron,publicKeyPem:fs.readFileSync(keyFile,'utf8')});
      info.skipped=pick.skipped;
      if(pick.dir){info.active=pick.version;info.dir=pick.dir;}
    }
  }
}catch(e){info.error=e.message;info.active=bundledVersion;info.dir=ROOT;}
if(info.dir===ROOT)require('./main.cjs');
else{
  try{require(path.join(info.dir,'src','main','main.cjs'));}
  catch(e){ // a broken update must never stop the app opening
    info.error='Update '+info.active+' failed to load: '+e.message;info.active=bundledVersion;info.dir=ROOT;
    require('./main.cjs');
  }
}
