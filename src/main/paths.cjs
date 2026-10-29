'use strict';
// Where settings, backups and updates live. Shared by boot.cjs and main.cjs so
// both always agree.
//  * Installed with the Setup.exe (an "Uninstall <product>.exe" sits beside the
//    app): %APPDATA%\<product>, which survives reinstalling and uninstalling.
//  * Portable folder: <folder>\user-data, beside the exe.
//  * From source: <repo>\user-data.
// MLS_USER_DATA (or the older DGS_USER_DATA) overrides all of these.
const fs=require('node:fs'),path=require('node:path');
const PRODUCT='Moto Lines Studio';

function appFolder(app,root){return app.isPackaged?path.dirname(process.execPath):root;}
function isInstalled(app,exe=process.execPath){return !!app.isPackaged&&fs.existsSync(path.join(path.dirname(exe),`Uninstall ${PRODUCT}.exe`));}
function userDataDir(app,root,env=process.env,exe=process.execPath){
  if(env.MLS_USER_DATA||env.DGS_USER_DATA)return env.MLS_USER_DATA||env.DGS_USER_DATA;
  if(isInstalled(app,exe))return path.join(app.getPath('appData'),PRODUCT);
  return path.join(app.isPackaged?path.dirname(exe):root,'user-data');
}
module.exports={appFolder,isInstalled,userDataDir,PRODUCT};
